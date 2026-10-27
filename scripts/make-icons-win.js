"use strict";
/**
 * Windows/跨平台图标生成 —— make-icons.sh 的替代品。
 *
 * make-icons.sh 只能在 macOS 上跑（qlmanage 渲染 SVG、iconutil 打 icns），
 * 而且源头是 build/icon.svg。这个脚本用项目已有的 sharp + png-to-ico，
 * 从任意位图（webp/png/jpg）生成 build/icon.png 和 build/icon.ico，Windows 上直接可用。
 *
 * 用法：node scripts/make-icons-win.js [源图路径]
 *   默认源图 public/assets/logos/docode2.webp
 *
 * ⚠️ 不生成 icns：那需要 macOS 的 iconutil。mac 版打包仍用仓库里已提交的 icon.icns，
 *    要换 mac 图标就在 mac 上跑 npm run icons。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = process.argv[2] || path.join(ROOT, "public", "assets", "logos", "docode2.webp");

// electron-builder 要求 ico 至少含 256x256，且主 png 不小于 512
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`源图不存在：${SRC}`);
  const sharp = require("sharp");
  const { default: pngToIco } = require("png-to-ico");

  const meta = await sharp(SRC).metadata();
  console.log(`源图 ${path.relative(ROOT, SRC)}  ${meta.width}x${meta.height} ${meta.format}`);

  // 非正方形先补成正方形（透明留白居中），否则 resize 会变形
  const side = Math.max(meta.width, meta.height);
  const square = await sharp(SRC)
    .resize(side, side, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // 1024 通用图：build/icon.png（回退用）+ public/icon.png（favicon、托盘、关于页）
  const png1024 = await sharp(square).resize(1024, 1024).png().toBuffer();
  fs.writeFileSync(path.join(ROOT, "build", "icon.png"), png1024);
  fs.writeFileSync(path.join(ROOT, "public", "icon.png"), png1024);

  // ico：逐尺寸出 png 再打包。png-to-ico 只吃 buffer 数组，尺寸从大到小无所谓
  const frames = [];
  for (const s of ICO_SIZES) {
    frames.push(await sharp(square).resize(s, s).png().toBuffer());
  }
  fs.writeFileSync(path.join(ROOT, "build", "icon.ico"), await pngToIco(frames));

  console.log("生成完毕：");
  for (const f of ["build/icon.png", "build/icon.ico", "public/icon.png"]) {
    console.log(`  ${f}  ${(fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(1)} KB`);
  }
  console.log(`ico 含尺寸：${ICO_SIZES.join(", ")}`);
}

main().catch((e) => {
  console.error("图标生成失败:", e.message);
  process.exit(1);
});
