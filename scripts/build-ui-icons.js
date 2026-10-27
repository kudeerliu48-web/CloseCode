"use strict";
// Reuse the workbench's outline geometry, rasterized at 4x for crisp WebP UI assets.
// No network or emoji fonts required. Run: npm run icons:ui
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const root = path.resolve(__dirname, "..");
const spriteIcons = {
  models: "zap", skills: "blocks", agent: "bot", update: "refresh-cw",
  settings: "settings", tip: "lightbulb", clock: "clock", error: "x",
  warning: "triangle-alert", folder: "folder", "folder-open": "folder-open",
  note: "file-text", export: "download", check: "circle-check", globe: "globe",
  sparkles: "sparkles", monitor: "monitor",
};
const customIcons = {
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
  context: '<path d="M4 3v17h17M9 15v-4M14 15V7M19 15v-6"/>',
  persona: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.5-3.3 1.5 1.5 0 0 1 1.2-2.5h1.7A3.6 3.6 0 0 0 21 11.6 9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="11" r=".6"/><circle cx="10" cy="7" r=".6"/><circle cx="15" cy="7.5" r=".6"/>',
  pet: '<path d="M5 8 4 3l6 3h4l6-3-1 5a7 7 0 0 1 2 5c0 5-4 8-9 8s-9-3-9-8a7 7 0 0 1 2-5Z"/><path d="M8 12v1M16 12v1M11 16l1 1 1-1M12 17v2"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M16 16l3-3M19 19l3-3"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
  edit: '<path d="m15 4 5 5M4 15 16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20l-6 1 1-6Z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3ZM12 8h4a3 3 0 1 0-3-3l-1 3Z"/>',
  logout: '<path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M9 12h12m-5-5 5 5-5 5"/>',
  basketball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6a9 9 0 0 1 0 12.8M18.4 5.6a9 9 0 0 0 0 12.8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  pin: '<path d="m15 3 6 6-3 1-4 4v4l-2 2-8-8 2-2h4l4-4 1-3ZM8 16l-5 5"/>',
  move: '<path d="M4 8h16l-4-4M20 16H4l4 4"/>',
  broom: '<path d="m15 9 6-6M13 8l3 3-2 3-3-3 2-3ZM11 11c-4-1-6 3-8 7l3 3c4-2 8-4 7-8M6 18l3-3"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h9V3M7 21v-7h10v7"/>',
};
async function main() {
  const html = await fs.readFile(path.join(root, "public/index.html"), "utf8");
  const icons = { ...customIcons };
  for (const [name, id] of Object.entries(spriteIcons)) {
    const match = html.match(new RegExp('<symbol id="i-' + id + '"[^>]*>([\\s\\S]*?)</symbol>'));
    if (!match) throw new Error("Missing sprite: " + id);
    icons[name] = match[1];
  }
  const out = path.join(root, "public/assets/icons");
  await fs.mkdir(out, { recursive: true });
  for (const [name, geometry] of Object.entries(icons)) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + geometry + '</svg>';
    await sharp(Buffer.from(svg)).webp({ lossless: true, effort: 6 }).toFile(path.join(out, name + '.webp'));
  }
  for (const provider of ["gpt", "grok", "claude", "gemini"]) {
    await sharp(path.join(root, 'public/assets/logos', provider + '.png'))
      .resize(96, 96).webp({ lossless: true, effort: 6 })
      .toFile(path.join(root, 'public/assets/logos', provider + '.webp'));
  }
  console.log('Generated ' + Object.keys(icons).length + ' UI icons and 4 provider logos (96px lossless WebP).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
