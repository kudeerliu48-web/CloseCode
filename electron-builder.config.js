"use strict";
/**
 * 打安装包的配置。跑 npm run dist:mac / npm run dist:win。
 *
 * 三个不能改的决定，改之前先看理由：
 *
 * 1) asar: false —— 必须关。tools.js 的 run_node 会把 node_modules 软链进
 *    workspace/.tmp 好让生成的脚本 require 到依赖；asar 是个压缩包不是真目录，
 *    软链过去指向一个文件系统上不存在的路径，run_node 会直接失效。
 *    代价是应用包体积大、文件多，换的是「装完就能跑代码」这个核心能力。
 *
 * 2) 技能只打包 lib/builtin-resources.json 发布清单中的精确文件。
 *    安装包与热补丁共用清单，开发机的用户技能、备份和额外资源不随包分发。
 *
 * 3) 不签名、不公证（identity: null）。没有 Apple 开发者证书，硬签不了。
 *    后果是用户第一次打开会被 Gatekeeper 拦，需要手动放行。
 *    真要消掉这一步，得买证书 + 配 APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD 走 notarize。
 */
// identity: null 拦不住签名——electron-builder 会自动去钥匙串里翻可用证书，
// 本机有一张个人的 Apple Development 证书，它就直接拿来签了。公开发的包不该带上任何人的
// 开发者身份（证书里有真实 Apple ID），而且 Development 证书在别人机器上照样过不了 Gatekeeper。
// 只有这个环境变量能真正关掉自动查找，关掉之后走 ad-hoc 签名（签名标识为 "-"），
// 这也是 Apple Silicon 上应用能启动的最低要求。放在配置文件里是为了 mac/Windows 都生效。
process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/** 安装包与热补丁使用同一份内置资源白名单。 */
function skillPatterns() {
  const {readCatalog, skillFiles} = require("./lib/builtin-resources");
  const catalog = readCatalog(path.join(__dirname, "lib", "builtin-resources.json"));
  const files = skillFiles(catalog);
  for (const rel of files) if (!fs.existsSync(path.join(__dirname, rel))) throw Error("发布清单缺少内置资源：" + rel);
  console.log(`[打包] 内置技能 ${catalog.skills.length} 个`);
  return files;
}

/** 校验每个发布目标都带有可执行的官方 Tunnel 客户端。 */
function cloudflaredPatterns() {
  const manifestPath = path.join(__dirname, "cloudflared", "manifest.json");
  if (!fs.existsSync(manifestPath)) throw Error("缺少 cloudflared/manifest.json，禁止生成不完整安装包");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const entries = Object.entries(manifest.assets || {});
  const required = [
    "linux-x64/cloudflared",
    "linux-arm64/cloudflared",
    "darwin-x64/cloudflared",
    "darwin-arm64/cloudflared",
    "win32-x64/cloudflared.exe",
  ];
  for (const rel of required) {
    const expected = manifest.assets[rel];
    const file = path.join(__dirname, "cloudflared", rel);
    if (!expected || !fs.existsSync(file)) throw Error("缺少内置 Tunnel 客户端：" + rel);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1024 * 1024) throw Error("内置 Tunnel 客户端无效：" + rel);
    if (!rel.startsWith("win32-") && (stat.mode & 0o111) === 0) throw Error("内置 Tunnel 客户端不可执行：" + rel);
    const actual = require("crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== expected) throw Error("内置 Tunnel 客户端校验失败：" + rel);
  }
  if (entries.length !== required.length) throw Error("cloudflared/manifest.json 含有未校验的资源");
  console.log(`[打包] cloudflared ${manifest.version}：${required.length} 个平台资源校验通过`);
  return ["cloudflared/**/*"];
}

/**
 * 打完包重新做一次 ad-hoc 签名。
 * 不做的话 codesign --verify 报「code has no resources but signature indicates they must be present」：
 * Electron 的二进制本身带一个 linker-signed 的 ad-hoc 签名，我们往包里塞了 app/ 之后那个签名就对不上了。
 * 本机双击可能还能开，但用户从网上下下来的包带 quarantine 标记，Gatekeeper 会直接判「已损坏」。
 * 签名标识用 "-" 就是 ad-hoc：不需要任何证书，只是让包内容自洽。
 * 它替代不了 Developer ID + 公证——用户首次打开仍要手动放行。
 */
async function adhocSign(ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  const app = require("path").join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".app");
  execSync(`codesign --force --deep --sign - ${JSON.stringify(app)}`, { stdio: "inherit" });
  execSync(`codesign --verify --deep --strict ${JSON.stringify(app)}`, { stdio: "inherit" });
  console.log("[打包] ad-hoc 签名通过：" + app);
}

module.exports = {
  afterPack: adhocSign,
  appId: "com.catcatuncle.closecode",
  productName: "CloseCode",
  copyright: "Copyright © 2026 CatCatUncle",
  asar: true, // 启用 asar 打包加速安装，把需要原始访问的文件用 asarUnpack 排除
  asarUnpack: [
    "node_modules/**/*", // node_modules 必须原始访问（run_node 会软链进 workspace/.tmp）
    "skills/**/*",       // 技能脚本和资源可由子进程直接访问
    ...cloudflaredPatterns(), // Tunnel 原生可执行文件必须从真实文件系统启动
  ],
  directories: { output: "dist", buildResources: "build" },

  // 白名单：只有列出来的才进包。用户数据（data/ workspace/ config.json backups/ .tmp/
  // plugins/ eval/runs/）一个都不能进——那是本机的账号和聊天记录，装机态它们在 ~/DoCode
  files: [
    "*.js",
    "!market.js",
    "!electron-builder.config.js",
    "public/**/*",
    "lib/**/*",  // 包含 lib 目录
    "eval/run.js",
    "config.example.json",
    "package.json",
    "LICENSE",
    "COMMERCIAL-LICENSE.md",
    "node_modules/**/*",  // 明确包含所有依赖
    ...cloudflaredPatterns(), // 按平台放置官方 cloudflared 二进制后随安装包发布
    ...skillPatterns(),
  ],

  mac: {
    category: "public.app-category.productivity",
    icon: "build/icon.icns",
    identity: null, // 见文件头 (3)
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    artifactName: "${productName}-${version}-mac-${arch}.${ext}",
    extendInfo: {
      // 这些是 macOS 的权限说明弹窗文案。截图/录屏能力和「打开所在位置」会摸到这些
      NSDesktopFolderUsageDescription: "DoCode 需要访问桌面来读写你交给它的文件",
      NSDocumentsFolderUsageDescription: "DoCode 需要访问文稿来读写你交给它的文件",
      NSDownloadsFolderUsageDescription: "DoCode 需要访问下载文件夹来读写你交给它的文件",
    },
  },
  dmg: {
    title: "${productName} ${version}",
    contents: [
      { x: 140, y: 200, type: "file" },
      { x: 400, y: 200, type: "link", path: "/Applications" },
    ],
  },

  win: {
    // 直接给 .ico：指 .png 会让 electron-builder 起一个 WASM 图标转换工具，
    // 那东西在内存紧张的机器上会 `WebAssembly.Memory(): could not allocate memory` 挂掉。
    // build/icon.ico 是 npm run icons 生成的，跟 icon.png 同源。
    icon: "build/icon.ico",
    target: [
      { target: "nsis", arch: ["x64"] },     // 带安装向导的安装包
    ],
    artifactName: "${productName}-${version}-win-${arch}.${ext}",
  },
  nsis: {
    // 标准安装向导：可选择安装位置，显示进度条
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    // 用户选择 D:\ 时，自动安装到 D:\CloseCode\
    // installerSidebar: "build/installerSidebar.bmp",  // 可选：自定义安装界面侧边栏图片
    // installerHeader: "build/installerHeader.bmp",    // 可选：自定义安装界面头部图片
    // 设置默认安装路径，在用户选择的盘符下自动创建 CloseCode 文件夹
    // 例如用户选 D:\，实际安装到 D:\CloseCode\
    allowElevation: true,
    perMachine: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "CloseCode",
    // 卸载时不碰 ~/CloseCode：那里面是用户的工作区和成果文件，卸个应用不该把人家的
    // 代码一起删了。彻底清理用户数据需手动删除该目录。
    deleteAppDataOnUninstall: false,
    // 安装包文件名中包含版本号和架构
    include: "build/installer.nsh",  // 自定义 NSIS 脚本，创建数据目录
    warningsAsErrors: false,  // 不把警告当作错误处理
  },

  linux: {
    icon: "build/icon.png",
    category: "Office",
    target: ["AppImage"],
    artifactName: "${productName}-${version}-linux-${arch}.${ext}",
  },
};
