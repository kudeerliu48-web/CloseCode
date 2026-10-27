"use strict";
/**
 * 热补丁加载器 —— 在应用启动最早期劫持模块解析，让 require("./xxx") 优先命中补丁目录。
 *
 * 必须在 electron-main.js 的第一行 require，早于任何业务模块。
 *
 * 几个关键约束，改之前先读：
 *
 * 1) baseVersion 必须与当前安装的版本严格相等，否则补丁一律不生效。
 *    用户装了全量新版之后，磁盘上可能还躺着针对旧版做的补丁；套上去就是新旧代码混跑，
 *    比不更新危险得多。这里读的是 APP_DIR 下的 package.json（原始版本），
 *    绝不能读补丁里的——所以补丁不允许包含 package.json。
 *
 * 2) node_modules 一律不劫持。原生模块（sharp 等）跟 Electron ABI 绑定，
 *    热替换会直接段错误；纯 JS 依赖也一起排除，保持「补丁只动我们自己的代码」这条边界清晰。
 *
 * 3) 启动哨兵：应用起来之前先落一个 .pending 标记，确认启动成功后由 confirmPatch() 删掉。
 *    下次启动若发现标记还在，说明这个补丁把应用搞崩了，把它拉黑并回落到基础版本。
 *    拉黑是必要的——只删 current.json 的话，更新器下一轮又会把同一个坏补丁拉回来，形成循环。
 */

const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");

const APP_DIR = __dirname;

/** 与 paths.js 保持一致的装机态判定；这里不能 require("./paths")，那会绕过劫持顺序 */
function isPackaged() {
  if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) return false;
  try {
    return !!require("electron").app.isPackaged;
  } catch {
    return false;
  }
}

const DATA_DIR = process.env.CLOSECODE_HOME
  ? path.resolve(process.env.CLOSECODE_HOME)
  : isPackaged()
    ? path.join(os.homedir(), "CloseCode")
    : APP_DIR;

const PATCHES_DIR = path.join(DATA_DIR, "patches");
const CURRENT_FILE = path.join(PATCHES_DIR, "current.json");
const SENTINEL_FILE = path.join(PATCHES_DIR, ".pending");
const BLACKLIST_FILE = path.join(PATCHES_DIR, "blacklist.json");

/** 安装包自带的版本号。绝不从补丁读——见文件头 (1) */
function baseAppVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function blacklist() {
  const list = readJson(BLACKLIST_FILE, []);
  return Array.isArray(list) ? list : [];
}

/** 把一个补丁版本拉黑，让更新器不再重复应用它 */
function blacklistPatch(version, reason) {
  try {
    const list = blacklist();
    if (!list.some((e) => e.version === version)) {
      list.push({ version, reason, at: new Date().toISOString() });
      fs.mkdirSync(PATCHES_DIR, { recursive: true });
      fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(list, null, 2));
    }
  } catch (e) {
    console.warn("[补丁] 写黑名单失败:", e.message);
  }
}

/** 读取已激活的补丁；任何一项校验不过就返回 null，宁可不打补丁 */
function loadActivePatch() {
  const current = readJson(CURRENT_FILE, null);
  if (!current || !current.version || !current.baseVersion) return null;

  const base = baseAppVersion();
  if (current.baseVersion !== base) {
    // 见文件头 (1)：装了全量新版，旧补丁自动失效
    console.log(`[补丁] 补丁 ${current.version} 针对 ${current.baseVersion}，当前安装版本 ${base}，忽略`);
    try {
      fs.unlinkSync(CURRENT_FILE);
    } catch {}
    return null;
  }

  if (blacklist().some((e) => e.version === current.version)) {
    console.warn(`[补丁] ${current.version} 在黑名单中（曾导致启动失败），忽略`);
    return null;
  }

  const patchDir = path.join(PATCHES_DIR, current.version);
  const manifest = readJson(path.join(patchDir, "manifest.json"), null);
  if (!manifest || !manifest.files) {
    console.warn(`[补丁] ${current.version} 的 manifest 缺失或损坏，忽略`);
    return null;
  }

  return {
    version: current.version,
    baseVersion: current.baseVersion,
    patchDir,
    // 相对路径集合，用 Set 查得快；路径统一成正斜杠，跟 manifest 里一致
    files: new Set(Object.keys(manifest.files)),
    deleted: new Set(manifest.deleted || []),
  };
}

/**
 * 启动哨兵。返回 false 表示上次启动崩了，本次回落基础版本。见文件头 (3)
 * 失败计数：第一次失败给一次重试机会，连续两次才拉黑——避免偶发问题冤枉好补丁
 */
function checkBootSafety(patch) {
  try {
    if (fs.existsSync(SENTINEL_FILE)) {
      const data = readJson(SENTINEL_FILE, null);
      const failed = typeof data === "string" ? data : (data && data.version) || patch.version;
      const failCount = (data && typeof data.failCount === "number") ? data.failCount : 0;

      if (failCount >= 1) {
        // 第二次失败，拉黑
        console.error(`[补丁] ${failed} 连续两次启动失败，拉黑并回落基础版本`);
        blacklistPatch(failed, "启动未完成（连续失败）");
        try { fs.unlinkSync(CURRENT_FILE); } catch {}
        try { fs.unlinkSync(SENTINEL_FILE); } catch {}
        return false;
      } else {
        // 第一次失败，给一次重试机会
        console.warn(`[补丁] ${failed} 上次启动未完成，本次重试（失败计数：${failCount + 1}）`);
        fs.writeFileSync(SENTINEL_FILE, JSON.stringify({ version: patch.version, failCount: failCount + 1 }), "utf8");
        return true;
      }
    }
    fs.mkdirSync(PATCHES_DIR, { recursive: true });
    fs.writeFileSync(SENTINEL_FILE, JSON.stringify({ version: patch.version, failCount: 0 }), "utf8");
    return true;
  } catch (err) {
    // 哨兵写不了就别打补丁：没有回滚兜底的热补丁不能上
    console.error("[补丁] 启动哨兵不可用，回落基础版本:", err.message);
    return false;
  }
}

let activePatch = loadActivePatch();

if (activePatch && !checkBootSafety(activePatch)) activePatch = null;

/** 相对路径 → 补丁文件绝对路径；不在补丁里就返回 null */
function patchFileFor(relPosix) {
  if (!activePatch || !activePatch.files.has(relPosix)) return null;
  return path.join(activePatch.patchDir, relPosix);
}

function toPosixRel(absPath) {
  return path.relative(APP_DIR, absPath).split(path.sep).join("/");
}

if (activePatch) {
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    // 补丁文件在解析模块时，Node 从补丁目录往上找 node_modules，找不到就炸。
    // 解法：如果 parent 是补丁文件，伪装成它在 APP_DIR 的对应位置，这样解析路径正确。
    let effectiveParent = parent;
    if (parent && parent.filename && parent.filename.startsWith(PATCHES_DIR + path.sep)) {
      // 补丁文件 ~/CloseCode/patches/1.2.5/server.js -> APP_DIR/server.js
      const rel = path.relative(activePatch.patchDir, parent.filename).split(path.sep).join("/");
      const appEquiv = path.join(APP_DIR, rel);
      effectiveParent = {
        id: appEquiv,
        filename: appEquiv,
        paths: Module._nodeModulePaths(path.dirname(appEquiv)),
      };
    }

    const resolved = origResolve.call(this, request, effectiveParent, ...rest);
    // 只管我们自己的代码：包外的、node_modules 的一律放行。见文件头 (2)
    if (!resolved.startsWith(APP_DIR + path.sep) || resolved.includes("node_modules")) return resolved;

    const rel = toPosixRel(resolved);
    if (activePatch.deleted.has(rel)) {
      const err = new Error(`Cannot find module '${request}' (removed by patch ${activePatch.version})`);
      err.code = "MODULE_NOT_FOUND";
      throw err;
    }
    return patchFileFor(rel) || resolved;
  };
  console.log(`[补丁] 已激活 ${activePatch.version}（基于 ${activePatch.baseVersion}），覆盖 ${activePatch.files.size} 个文件`);
} else {
  console.log(`[补丁] 运行基础版本 ${baseAppVersion()}`);
}

/** 启动成功，撤下哨兵。由 electron-main 在服务端就绪后调用 */
function confirmPatch() {
  if (!activePatch) return;
  try {
    if (fs.existsSync(SENTINEL_FILE)) fs.unlinkSync(SENTINEL_FILE);
    console.log(`[补丁] ${activePatch.version} 启动成功`);
  } catch (e) {
    console.warn("[补丁] 撤哨兵失败:", e.message);
  }
}

/** 对外的有效版本号：打了补丁就是补丁版本，否则是安装版本 */
function effectiveVersion() {
  return activePatch ? activePatch.version : baseAppVersion();
}

/** 回滚当前补丁：拉黑 + 清除 current.json + 删哨兵，供启动失败时紧急恢复用 */
function rollbackPatch(reason) {
  if (!activePatch) return false;
  blacklistPatch(activePatch.version, reason);
  try { fs.unlinkSync(CURRENT_FILE); } catch {}
  try { fs.unlinkSync(SENTINEL_FILE); } catch {}
  console.error(`[补丁] 已回滚 ${activePatch.version}：${reason}`);
  activePatch = null;
  return true;
}

/**
 * 资源文件的补丁感知解析。paths.js 的 appPath 会走这里。
 * ⚠️ 只对**精确文件路径**生效；挂目录的场景见下面的 patchPublicDir()。
 */
function resolveAppFile(...segments) {
  const rel = segments.join("/").split(path.sep).join("/");
  return patchFileFor(rel) || path.join(APP_DIR, ...segments);
}

/**
 * 补丁里的 public/ 目录，没有就返回 null。
 *
 * server.js 用它在包内 static 之前再挂一层 express.static。
 * 为什么不能靠 resolveAppFile：那个只对精确文件路径生效，而 express.static 挂的是
 * 一整个目录——appPath("public") 只在启动时求值一次，返回的就是包内目录，
 * 补丁里的 public/js/app-05.js 永远不会被服务出去。
 */
function patchPublicDir() {
  if (!activePatch) return null;
  // 补丁里没有任何前端文件时不挂，省掉一层无谓的 static 中间件
  let hasPublic = false;
  for (const rel of activePatch.files) {
    if (rel.startsWith("public/")) {
      hasPublic = true;
      break;
    }
  }
  if (!hasPublic) return null;
  const dir = path.join(activePatch.patchDir, "public");
  return fs.existsSync(dir) ? dir : null;
}

module.exports = {
  get activePatch() {
    return activePatch;
  },
  confirmPatch,
  effectiveVersion,
  baseAppVersion,
  resolveAppFile,
  patchPublicDir,
  blacklistPatch,
  rollbackPatch,
  APP_DIR,
  DATA_DIR,
  PATCHES_DIR,
  CURRENT_FILE,
};
