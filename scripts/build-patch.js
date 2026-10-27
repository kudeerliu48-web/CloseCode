#!/usr/bin/env node
"use strict";
/**
 * 构建补丁包 —— 对比两个版本的源码，产出只含差异文件的 zip + 已签名 manifest。
 *
 * 用法：
 *   node scripts/build-patch.js --base <基线目录> --version <新版本号>
 *
 * 例如发 1.1.9 的补丁（基线是已发布的 1.1.8 那份代码）：
 *   node scripts/build-patch.js --base ../closecode-1.1.8 --version 1.1.9
 *
 * 基线目录从哪来：把上一个发布 tag 的代码 checkout 一份出来即可，例如
 *   git worktree add ../closecode-1.1.8 v1.1.8
 *
 * 私钥从环境变量 CLOSECODE_PATCH_PRIVATE_KEY 读（PEM 内容）。没有私钥就只 dry-run，
 * 不产出可用补丁 —— 未签名的补丁客户端一律拒收，产出来也是废的。
 *
 * 产物（默认在 dist/patches/ 下）：
 *   CloseCode-patch-<version>.zip   里面是 manifest.json + manifest.json.sig + 差异文件
 *   patches.json                    补丁索引，上传到静态服务器 /updates/ 下
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { signManifest, sha256, isProtected } = require("../patch-crypto");
const {readCatalog, skillFiles} = require("../lib/builtin-resources");

const REPO = path.resolve(__dirname, "..");

/**
 * 哪些文件参与补丁。必须与 electron-builder.config.js 的 files 白名单保持一致的子集：
 * 只收纯 JS 和前端资源，node_modules 和二进制一律不收（见 patch-crypto 的 PROTECTED_PATHS）。
 */
const INCLUDE_DIRS = ["public", "lib"];
const INCLUDE_ROOT_GLOB = /\.js$/; // 根目录下的 *.js

/** 根目录下不参与补丁的 js（构建期脚本、配置，不进安装包或不该热改） */
const ROOT_EXCLUDE = new Set([
  "electron-builder.config.js",
  "market.js",
]);

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") out.base = argv[++i];
    else if (a === "--version") out.version = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--key-file") out.keyFile = argv[++i];
  }
  return out;
}

/** 递归列出参与补丁的相对路径（posix 分隔符） */
function collectFiles(root, catalog = readCatalog(path.join(REPO, "lib", "builtin-resources.json"))) {
  const found = [];

  for (const name of fs.readdirSync(root)) {
    if (INCLUDE_ROOT_GLOB.test(name) && !ROOT_EXCLUDE.has(name)) {
      const st = fs.statSync(path.join(root, name));
      if (st.isFile()) found.push(name);
    }
  }

  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || /(?:\.bak|\.backup|\.\d{4}-\d{2}-\d{2}T.*)$/i.test(entry.name)) continue;
      const rel = `${prefix}/${entry.name}`;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) found.push(rel);
    }
  };
  for (const d of INCLUDE_DIRS) walk(path.join(root, d), d);
  // Use the same explicit catalog as the installer. Never distribute local user
  // skills, duplicate backups or a developer's mutable experts.json.
  for (const rel of skillFiles(catalog)) if (fs.existsSync(path.join(root, rel))) found.push(rel);

  return found.filter((f) => !isProtected(f));
}

function hashFile(abs) {
  return sha256(fs.readFileSync(abs));
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.base || !args.version) {
    console.error("用法: node scripts/build-patch.js --base <基线目录> --version <新版本号> [--dry-run]");
    process.exit(1);
  }

  const baseDir = path.resolve(args.base);
  if (!fs.existsSync(baseDir)) {
    console.error(`基线目录不存在: ${baseDir}`);
    process.exit(1);
  }

  // 基线的版本号就是补丁的 baseVersion —— 客户端靠它判断补丁适不适用于自己
  let baseVersion;
  try {
    baseVersion = JSON.parse(fs.readFileSync(path.join(baseDir, "package.json"), "utf8")).version;
  } catch {
    console.error(`读不到基线的 package.json 版本号: ${baseDir}`);
    process.exit(1);
  }
  if (!baseVersion) {
    console.error("基线 package.json 里没有 version");
    process.exit(1);
  }

  console.log(`[补丁] 基线 ${baseVersion} (${baseDir})`);
  console.log(`[补丁] 目标 ${args.version} (${REPO})`);

  const baseFiles = new Map(collectFiles(baseDir).map((f) => [f, hashFile(path.join(baseDir, f))]));
  const newFiles = new Map(collectFiles(REPO).map((f) => [f, hashFile(path.join(REPO, f))]));
  const catalog = readCatalog(path.join(REPO, "lib", "builtin-resources.json"));
  const required = new Set(["lib/builtin-resources.json", ...skillFiles(catalog)]);
  for (const rel of required) if (!newFiles.has(rel)) throw Error("发布清单缺少内置资源：" + rel);

  const changed = [];
  for (const [rel, hash] of newFiles) {
    if (required.has(rel) || baseFiles.get(rel) !== hash) changed.push(rel);
  }
  const deleted = [...baseFiles.keys()].filter((rel) => !newFiles.has(rel));

  if (!changed.length && !deleted.length) {
    console.log("[补丁] 两个版本没有差异，无需发补丁");
    process.exit(0);
  }

  console.log(`[补丁] 变更 ${changed.length} 个文件，删除 ${deleted.length} 个`);
  for (const f of changed.slice(0, 20)) console.log(`       ~ ${f}`);
  if (changed.length > 20) console.log(`       ... 另外 ${changed.length - 20} 个`);
  for (const f of deleted) console.log(`       - ${f}`);

  // manifest：files 里带每个文件的 sha256，签名签的是这份 manifest，
  // 于是「验签通过 + 逐文件哈希比对」等价于签掉了整个补丁内容
  const manifest = {
    version: args.version,
    baseVersion,
    createdAt: new Date().toISOString(),
    files: {},
    deleted,
  };
  let totalBytes = 0;
  for (const rel of changed) {
    const buf = fs.readFileSync(path.join(REPO, rel));
    totalBytes += buf.length;
    manifest.files[rel] = { sha256: sha256(buf), size: buf.length };
  }

  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");

  let privPem = process.env.CLOSECODE_PATCH_PRIVATE_KEY;
  const baselineCrypto = fs.readFileSync(path.join(baseDir,"patch-crypto.js"),"utf8");
  const baselinePublicKey = /const PUBLIC_KEY_B64\s*=\s*"([^"]+)"/.exec(baselineCrypto)?.[1];
  if (!baselinePublicKey) throw Error("无法读取基线签名公钥");
  if (args.keyFile) {
    const text = fs.readFileSync(path.resolve(args.keyFile),"utf8");
    const candidates = [...new Set(text.match(/-----BEGIN (?:ED25519 )?PRIVATE KEY-----[\s\S]*?-----END (?:ED25519 )?PRIVATE KEY-----/g) || [])];
    const matching = candidates.filter(pem => {
      try { return crypto.createPublicKey(crypto.createPrivateKey(pem)).export({type:"spki",format:"der"}).toString("base64") === baselinePublicKey; }
      catch { return false; }
    });
    if (!matching.length) throw Error("密钥文件中没有与基线公钥匹配的私钥");
    privPem = matching[0];
  }
  if (!privPem) {
    console.log();
    console.log("⚠️  没有 CLOSECODE_PATCH_PRIVATE_KEY，只做 dry-run，不产出补丁包。");
    console.log(`   差异 ${changed.length} 个文件，未压缩共 ${(totalBytes / 1024).toFixed(1)} KB`);
    console.log("   要产出可用补丁：export CLOSECODE_PATCH_PRIVATE_KEY=\"$(cat 私钥.pem)\"");
    process.exit(args.dryRun ? 0 : 2);
  }
  if (args.dryRun) {
    console.log(`[补丁] dry-run：差异 ${changed.length} 个文件，共 ${(totalBytes / 1024).toFixed(1)} KB`);
    process.exit(0);
  }

  const signature = signManifest(manifestBuf, privPem);
  const {verifyManifest,verifyContents} = require("../patch-crypto");
  const verified = verifyManifest(manifestBuf,signature,baselinePublicKey);
  if (!verified.ok) throw Error("基线签名校验失败：" + verified.reason);
  const contents = verifyContents(manifest,rel=>fs.readFileSync(path.join(REPO,rel)));
  if (!contents.ok) throw Error(contents.reason);

  // 打 zip
  const JSZip = require("jszip");
  const zip = new JSZip();
  zip.file("manifest.json", manifestBuf);
  zip.file("manifest.json.sig", signature);
  for (const rel of changed) zip.file(rel, fs.readFileSync(path.join(REPO, rel)));

  const outDir = path.resolve(args.out || path.join(REPO, "dist", "patches"));
  fs.mkdirSync(outDir, { recursive: true });

  const zipName = `CloseCode-patch-${args.version}.zip`;
  const zipPath = path.join(outDir, zipName);
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  fs.writeFileSync(zipPath, zipBuf);

  // 索引：客户端只读这一个文件。多条补丁并存时，客户端按 baseVersion 挑适用的那条
  const indexPath = path.join(outDir, "patches.json");
  let index = { patches: [] };
  try {
    const prev = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (Array.isArray(prev.patches)) index = prev;
  } catch {}
  index.patches = index.patches.filter((p) => p.version !== args.version);
  index.patches.push({
    version: args.version,
    baseVersion,
    url: `/updates/${zipName}`,
    size: zipBuf.length,
    sha256: sha256(zipBuf),
    releaseDate: manifest.createdAt,
  });
  index.patches.sort((a, b) => (a.version < b.version ? 1 : -1));
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  console.log();
  console.log(`[补丁] 已产出 ${zipPath}`);
  console.log(`       补丁包 ${(zipBuf.length / 1024).toFixed(1)} KB（全量安装包约 ${"800 MB"}）`);
  console.log(`[补丁] 已更新索引 ${indexPath}`);
  console.log();
  console.log("上传这两个文件到静态服务器的 /updates/ 目录：");
  console.log(`       ${zipName}`);
  console.log(`       patches.json`);
}

module.exports = {collectFiles};
if (require.main === module) main().catch((err) => {
  console.error("[补丁] 构建失败:", err);
  process.exit(1);
});
