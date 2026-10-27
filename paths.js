"use strict";
/**
 * 代码在哪 vs 数据在哪。
 *
 * 开发态（git clone + npm run app）：两者都是仓库目录，跟以前一模一样，行为一个字节都不变。
 * 装机态（.dmg / .exe 装出来的那份）：代码在应用包里，那地方是只读的——macOS 上往签名过的
 *   包里写东西会直接破坏签名，Windows 装在 Program Files 下普通用户也没有写权限。
 *   所以所有会被写的东西（配置、账号、会话、工作区、技能、插件、备份、日程）一律落到
 *   用户家目录下的 ~/CloseCode。
 *
 * 为什么用家目录而不是 Library/Application Support 或 AppData：工作区里放的是 PPT/Word/Excel
 * 这些要交到用户手上的成果文件，得让人在访达/资源管理器里自己找得到、能拖走。
 *
 * 想放别处：设环境变量 CLOSECODE_HOME=/你的/路径（开发态也吃这个变量，方便隔离测试）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

/** paths.js 自身也可能来自热补丁；安装根目录必须以不可热替换的加载器为准。 */
const patchLoader = require("./patch-loader");
if (patchLoader.activePatch) require(patchLoader.resolveAppFile("lib", "patch-module-resolution.js")).install(patchLoader);
const APP_DIR = patchLoader.APP_DIR;

function isPackaged() {
  // ELECTRON_RUN_AS_NODE：run_node 派生出去的子进程也带 electron 版本号，但它不是应用本体
  if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) return false;
  try {
    return !!require("electron").app.isPackaged;
  } catch {
    return false;
  }
}

/** 可写：配置 / 数据 / 工作区 / 技能 / 插件 / 备份都在这儿 */
const DATA_DIR = process.env.CLOSECODE_HOME
  ? path.resolve(process.env.CLOSECODE_HOME)
  : isPackaged()
    ? path.join(os.homedir(), "CloseCode")
    : APP_DIR;

/** 安装版首次使用新名称时，把旧数据目录整体迁移过来。
 *  ⚠️ 这里的名字是**老用户磁盘上已经存在的那个目录**，改品牌名时不能跟着改，
 *  否则迁移永远找不到源目录，老用户一升级就像换了台新电脑。 */
function migrateLegacyDataDir() {
  if (!isPackaged() || process.env.CLOSECODE_HOME || fs.existsSync(DATA_DIR)) return false;
  const legacyDir = path.join(os.homedir(), "OpenWorkBuddy");
  if (!fs.existsSync(legacyDir)) return false;
  try {
    fs.renameSync(legacyDir, DATA_DIR);
    console.log(`[迁移] 用户数据已从 ${legacyDir} 搬到 ${DATA_DIR}`);
    return true;
  } catch (e) {
    console.warn(`[迁移] 用户数据目录搬家失败，将使用新目录 ${DATA_DIR}:`, e.message);
    return false;
  }
}

/** 数据根下的路径 */
function dataPath(...seg) {
  return path.join(DATA_DIR, ...seg);
}

/** 应用包内的只读资源。
 *  打了热补丁时，补丁里的同名文件优先——这样 express.static(appPath("public")) 也能吃到
 *  补丁里的前端资源。patch-loader 没加载或没激活补丁时，行为与原来完全一致。 */
function appPath(...seg) {
  try {
    return require("./patch-loader").resolveAppFile(...seg);
  } catch {
    return path.join(APP_DIR, ...seg);
  }
}

/** 两处同名时，用户那份优先、包里那份兜底（读用；写一律写 dataPath） */
function preferData(...seg) {
  const mine = dataPath(...seg);
  return fs.existsSync(mine) ? mine : appPath(...seg);
}

function copyIfMissing(from, to) {
  if (fs.existsSync(to) || !fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // Electron 的 ASAR 是虚拟文件系统；readFile 可读，cpSync 的目录复制并不可靠。
  fs.writeFileSync(to, fs.readFileSync(from), { flag: "wx" });
  return true;
}

/** Only the release catalog owns built-ins. Resolve every exact resource path so
 * an old base package and a newer hot patch can supply the same skill together. */
function bundledSkillFiles() {
  const {readCatalog, skillFiles} = require("./lib/builtin-resources");
  const catalog = readCatalog(appPath("lib", "builtin-resources.json"));
  const files = new Map();
  for (const rel of skillFiles(catalog)) {
    files.set(rel, appPath(...rel.split("/")));
  }
  return files;
}

/**
 * 装机态首次启动：把包里的「出厂内容」铺到数据目录。
 * 每次启动都会补一次缺失项——这样应用升级带来的新内置技能能自动出现，
 * 而用户自己改过的那些不会被覆盖（只补不存在的）。
 */
function seedDataDir() {
  if (DATA_DIR === APP_DIR) return; // source checkout owns its files; only installed data is migrated
  const {readCatalog, seedExperts} = require("./lib/builtin-resources");
  const catalog = readCatalog(appPath("lib", "builtin-resources.json"));
  for (const d of ["data", "workspace", "skills", "plugins", "backups"]) {
    fs.mkdirSync(dataPath(d), { recursive: true });
  }
  seedExperts(dataPath("experts.json"), catalog);
  require("./lib/skill-migration").migrateSkills({dataDir:DATA_DIR,appDir:APP_DIR,catalog});
  for (const [rel, source] of bundledSkillFiles()) {
    try {
      if (!fs.existsSync(source)) throw Error("安装包或补丁缺少内置资源");
      const parts = rel.split("/"), skill = catalog.skills.find(s=>s.directory===parts[1]);
      if (DATA_DIR !== APP_DIR) parts[1] = skill.name;
      const target = dataPath(...parts);
      const copied = copyIfMissing(source, target);
      if (copied && parts.length === 3 && /^skill\.md$/i.test(parts[2])) {
        const {withSkillName} = require("./lib/skill-names");
        fs.writeFileSync(target,withSkillName(fs.readFileSync(target,"utf8"),skill.name),"utf8");
      }
    } catch (error) {
      // 单个资源失败不阻止其它技能恢复，但必须留下可诊断的日志。
      console.warn(`[技能] 初始化 ${rel} 失败:`, error.message);
    }
  }
}

module.exports = { APP_DIR, DATA_DIR, dataPath, appPath, preferData, migrateLegacyDataDir, seedDataDir, isPackaged };
