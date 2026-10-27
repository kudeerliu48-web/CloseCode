"use strict";
/**
 * 补丁签名与校验。
 *
 * 为什么必须有这一层：热补丁的本质是「从网上下载 JS 并执行」。更新源是明文 HTTP 的静态
 * 目录，任何能改那个目录、或能中间人劫持的人，都等于能在所有用户机器上执行任意代码。
 * HTTPS 只能防中间人，防不了源站被写坏，所以校验必须落在内容本身上：
 * 构建时用私钥签 manifest，客户端用内置公钥验签，私钥永不进仓库、永不进安装包。
 *
 * 签名覆盖范围：只签 manifest.json 的原始字节。manifest 里有每个文件的 sha256，
 * 所以「验签通过 + 逐文件哈希比对」就等价于签掉了整个补丁内容。
 *
 * ⚠️ PROTECTED_PATHS 里的文件不允许出现在补丁里。补丁机制自身（加载器、验签、更新器）
 * 一旦被补丁改坏，就没有任何东西能再修好它了——这类改动必须走全量安装。
 */

const crypto = require("crypto");

/**
 * 内置公钥（SPKI DER，base64）。
 * 用 `node scripts/patch-keygen.js` 生成一对新的，把这里替换成它打印的公钥，
 * 私钥存到 CI 的密钥管理里（环境变量 CLOSECODE_PATCH_PRIVATE_KEY）。
 *
 * 占位值为空串时，验签一律失败 —— 也就是「没配公钥就等于热补丁关闭」，
 * 这是故意的：默认安全，配置缺失不会退化成不校验。
 */
// 2026-09-10 生成的 Ed25519 密钥对（已打进 2.0.0 版本）
const PUBLIC_KEY_B64 = "MCowBQYDK2VwAyEAbJFxudbdRcBO9X4rNfRJtgR3Z6OUko7kLc7xq8RKbGk=";

/** 这些路径不接受补丁。见文件头 ⚠️ */
const PROTECTED_PATHS = new Set([
  "patch-loader.js",
  "patch-crypto.js",
  "patch-updater.js",
  "package.json",
  "preload.js", // preload 在 contextIsolation 边界上，改它等于改安全模型
]);

function isProtected(relPath) {
  const norm = String(relPath || "").split("\\").join("/");
  if (PROTECTED_PATHS.has(norm)) return true;
  // node_modules 整体不可补（原生模块与 Electron ABI 绑定，热换即崩）
  return norm.startsWith("node_modules/") || norm.includes("/node_modules/");
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** 用私钥签 manifest 字节，返回 base64 签名 */
function signManifest(manifestBuffer, privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`补丁签名要求 ed25519 私钥，实际是 ${key.asymmetricKeyType}`);
  }
  return crypto.sign(null, manifestBuffer, key).toString("base64");
}

/**
 * 验签。返回 { ok, reason }，绝不抛异常 —— 调用方在更新流程里，
 * 任何异常都应该被当成「这个补丁不可信」而不是让进程崩掉。
 */
function verifyManifest(manifestBuffer, signatureB64, publicKeyB64 = PUBLIC_KEY_B64) {
  try {
    if (!publicKeyB64) return { ok: false, reason: "客户端未内置补丁公钥，热补丁已禁用" };
    if (!signatureB64) return { ok: false, reason: "补丁缺少签名" };

    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    const ok = crypto.verify(null, manifestBuffer, publicKey, Buffer.from(signatureB64, "base64"));
    return ok ? { ok: true } : { ok: false, reason: "补丁签名校验失败" };
  } catch (err) {
    return { ok: false, reason: `验签出错: ${err.message}` };
  }
}

/**
 * 校验解压出来的补丁内容与 manifest 是否一致。
 * @param manifest 已验签的 manifest 对象
 * @param readFile (relPath) => Buffer|null
 */
function verifyContents(manifest, readFile) {
  const files = manifest.files || {};
  const names = Object.keys(files);
  if (!names.length) return { ok: false, reason: "补丁不包含任何文件" };

  for (const rel of names) {
    if (isProtected(rel)) return { ok: false, reason: `补丁试图修改受保护文件: ${rel}` };
    // 路径穿越：补丁里写 ../../ 就能覆盖补丁目录外的任意文件
    if (rel.includes("..") || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) {
      return { ok: false, reason: `补丁包含非法路径: ${rel}` };
    }
    const buf = readFile(rel);
    if (!buf) return { ok: false, reason: `补丁缺少文件: ${rel}` };
    const actual = sha256(buf);
    if (actual !== files[rel].sha256) {
      return { ok: false, reason: `文件哈希不匹配: ${rel}` };
    }
  }

  for (const rel of manifest.deleted || []) {
    if (isProtected(rel)) return { ok: false, reason: `补丁试图删除受保护文件: ${rel}` };
  }

  return { ok: true };
}

module.exports = {
  PUBLIC_KEY_B64,
  PROTECTED_PATHS,
  isProtected,
  sha256,
  signManifest,
  verifyManifest,
  verifyContents,
};
