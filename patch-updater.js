"use strict";
/**
 * 补丁更新器 —— 检查、下载、验签、应用补丁。
 *
 * 流程：
 * 1. 从静态服务器拉 /updates/patches.json（补丁索引）
 * 2. 筛选：baseVersion 等于当前安装版本、version 比当前生效版本新、不在黑名单
 * 3. 下载 .zip、验签、逐文件哈希校验
 * 4. 解压到临时目录，原子 rename 到 patches/${version}
 * 5. 写 current.json 激活，下次启动生效
 *
 * 对外暴露一个 IPC handler，前端调用 checkAndApplyPatch() 即可完成整个流程。
 */

const path = require("path");
const fs = require("fs");

// 故意不 require("electron")：这个模块要能在纯 Node 下跑测试和脚本校验。
// 需要窗口/IPC 的部分留在 electron-main.js 里。
const {
  baseAppVersion,
  effectiveVersion,
  PATCHES_DIR,
  CURRENT_FILE,
} = require("./patch-loader");
const { verifyManifest, verifyContents, sha256 } = require("./patch-crypto");

/** 补丁索引 URL（静态 JSON） */
const INDEX_URL = "https://close.codes/updates/patches.json";

/**
 * 读取黑名单。loader 里也有一份，这里复制一遍避免循环依赖
 */
function blacklist() {
  try {
    const data = fs.readFileSync(path.join(PATCHES_DIR, "blacklist.json"), "utf8");
    const list = JSON.parse(data);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * 检查可用的补丁更新。返回 { hasUpdate, patch } 或 { hasUpdate: false, reason }
 */
async function checkForPatch() {
  try {
    const base = baseAppVersion();
    const current = effectiveVersion();
    const banned = new Set(blacklist().map((e) => e.version));

    // 拉取补丁索引
    const resp = await fetch(INDEX_URL);
    if (!resp.ok) {
      return { hasUpdate: false, reason: `获取补丁索引失败: HTTP ${resp.status}` };
    }
    const index = await resp.json();
    if (!Array.isArray(index.patches)) {
      return { hasUpdate: false, reason: "补丁索引格式错误" };
    }

    // 筛选：baseVersion 匹配、比当前版本新、不在黑名单
    const candidates = index.patches.filter((p) => {
      return (
        p.baseVersion === base &&
        compareVersion(p.version, current) > 0 &&
        !banned.has(p.version)
      );
    });

    if (!candidates.length) {
      return { hasUpdate: false, reason: "当前已是最新版本" };
    }

    // 取版本号最大的那个
    candidates.sort((a, b) => compareVersion(b.version, a.version));
    const latest = candidates[0];

    return {
      hasUpdate: true,
      patch: {
        version: latest.version,
        baseVersion: latest.baseVersion,
        url: latest.url.startsWith("http") ? latest.url : `https://close.codes${latest.url}`,
        size: latest.size || 0,
        sha256: latest.sha256,
        releaseDate: latest.releaseDate || "",
      },
    };
  } catch (err) {
    return { hasUpdate: false, reason: `检查更新失败: ${err.message}` };
  }
}

/**
 * 下载并应用补丁。返回 { success, reason }
 */
async function downloadAndApplyPatch(patchInfo, progressCallback) {
  const { version, baseVersion, url, size, sha256: expectedHash } = patchInfo;
  const tempDir = path.join(PATCHES_DIR, `.tmp-${version}`);
  const finalDir = path.join(PATCHES_DIR, version);

  try {
    // 清理旧的临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // 下载 zip
    progressCallback?.({ stage: "downloading", percent: 0 });
    const zipPath = path.join(tempDir, "patch.zip");
    const zipData = await downloadFile(url, (loaded, total) => {
      progressCallback?.({ stage: "downloading", percent: (loaded / total) * 100 });
    });
    fs.writeFileSync(zipPath, zipData);

    // 校验 zip 哈希
    progressCallback?.({ stage: "verifying", percent: 0 });
    const actualHash = sha256(zipData);
    if (expectedHash && actualHash !== expectedHash) {
      throw new Error(`补丁包哈希不匹配（预期 ${expectedHash.slice(0, 8)}...，实际 ${actualHash.slice(0, 8)}...）`);
    }

    // 解压
    progressCallback?.({ stage: "extracting", percent: 0 });
    await extractZip(zipPath, tempDir);

    // 验签
    progressCallback?.({ stage: "verifying", percent: 50 });
    const manifestPath = path.join(tempDir, "manifest.json");
    const signaturePath = path.join(tempDir, "manifest.json.sig");
    if (!fs.existsSync(manifestPath)) {
      throw new Error("补丁缺少 manifest.json");
    }
    if (!fs.existsSync(signaturePath)) {
      throw new Error("补丁缺少签名文件 manifest.json.sig");
    }

    const manifestBuf = fs.readFileSync(manifestPath);
    const signatureB64 = fs.readFileSync(signaturePath, "utf8").trim();
    const verifyResult = verifyManifest(manifestBuf, signatureB64);
    if (!verifyResult.ok) {
      throw new Error(verifyResult.reason);
    }

    const manifest = JSON.parse(manifestBuf.toString("utf8"));
    if (manifest.version !== version || manifest.baseVersion !== baseVersion) {
      throw new Error(`manifest 版本不符（预期 ${version}，实际 ${manifest.version}）`);
    }

    // 校验文件内容
    const contentsResult = verifyContents(manifest, (rel) => {
      const p = path.join(tempDir, rel);
      return fs.existsSync(p) ? fs.readFileSync(p) : null;
    });
    if (!contentsResult.ok) {
      throw new Error(contentsResult.reason);
    }

    // 原子切换：临时目录 -> 正式目录
    progressCallback?.({ stage: "installing", percent: 0 });
    if (fs.existsSync(finalDir)) {
      fs.rmSync(finalDir, { recursive: true, force: true });
    }
    fs.renameSync(tempDir, finalDir);

    // 激活补丁
    fs.writeFileSync(
      CURRENT_FILE,
      JSON.stringify({ version, baseVersion, activatedAt: new Date().toISOString() }, null, 2)
    );

    progressCallback?.({ stage: "done", percent: 100 });
    return { success: true, message: `补丁 ${version} 已安装，重启应用后生效` };
  } catch (err) {
    // 清理失败的临时目录
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    return { success: false, reason: err.message };
  }
}

/**
 * 下载文件，返回 Buffer
 */
async function downloadFile(url, progressCallback) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }

  const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    progressCallback?.(loaded, contentLength || loaded);
  }

  return Buffer.concat(chunks);
}

/**
 * 解压 zip 到指定目录。
 *
 * ⚠️ 路径穿越必须在**写盘之前**拦掉。verifyContents 里也有一道检查，但那是解压完才跑的，
 * 那时候 `../../foo.js` 早就落到目录外面了——校验再严也来不及。zip slip 就是这么中的。
 */
async function extractZip(zipPath, destDir) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const root = path.resolve(destDir);

  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;

    // 逐项确认解析后仍落在 destDir 内；path.resolve 会把 ../ 正规化掉，
    // 所以这里比对前缀就能挡住穿越（含 Windows 的 ..\ 和绝对路径两种写法）
    const destPath = path.resolve(root, entryName);
    if (destPath !== root && !destPath.startsWith(root + path.sep)) {
      throw new Error(`补丁包含越界路径，已拒绝: ${entryName}`);
    }
    // 符号链接同样能指到目录外，jszip 会把它当普通文件写出去，直接拒
    if (entry.unixPermissions && (entry.unixPermissions & 0xf000) === 0xa000) {
      throw new Error(`补丁包含符号链接，已拒绝: ${entryName}`);
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, await entry.async("nodebuffer"));
  }
}

/**
 * 版本号比较（形如 1.1.8、1.2.0-beta.1）
 * @returns 正数：a > b；0：相等；负数：a < b
 */
function compareVersion(a, b) {
  const parse = (v) =>
    String(v || "0.0.0")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const va = parse(a);
  const vb = parse(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const diff = (va[i] || 0) - (vb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

module.exports = {
  checkForPatch,
  downloadAndApplyPatch,
};
