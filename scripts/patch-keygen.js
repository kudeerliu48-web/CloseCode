#!/usr/bin/env node
"use strict";
/**
 * 生成补丁签名密钥对（Ed25519）。
 *
 * 用法：node scripts/patch-keygen.js
 *
 * 输出：
 *   - 公钥（base64）—— 复制到 patch-crypto.js 的 PUBLIC_KEY_B64
 *   - 私钥（PEM）—— 存到 CI 环境变量 CLOSECODE_PATCH_PRIVATE_KEY，绝不进仓库
 */

const crypto = require("crypto");

console.log("=== 生成补丁签名密钥对 ===\n");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

const pubDer = publicKey.export({ type: "spki", format: "der" });
const privPem = privateKey.export({ type: "pkcs8", format: "pem" });

console.log("【公钥】（复制到 patch-crypto.js 的 PUBLIC_KEY_B64）：");
console.log(pubDer.toString("base64"));
console.log();

console.log("【私钥】（存到 CI 环境变量，绝不进仓库）：");
console.log(privPem);
console.log();

console.log("⚠️  私钥泄露 = 任何人都能签出合法补丁在所有用户机器上执行任意代码");
console.log("   1. 私钥存 CI 的密钥管理（GitHub Secrets / GitLab CI Variables）");
console.log("   2. 构建脚本从环境变量 CLOSECODE_PATCH_PRIVATE_KEY 读取");
console.log("   3. 开发机上不留私钥文件（控制台输出看完就关）");
