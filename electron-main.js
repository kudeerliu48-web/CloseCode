"use strict";
/** Electron 桌面壳 — 启动内嵌服务并打开桌面窗口。运行：npm run app */

const BOOT_T0 = Date.now(); // 启动分段计时：哪段慢一眼看清，别靠体感猜
// Hot-patch loader. MUST be the first local module required: it hijacks
// Module._resolveFilename, so anything required before it keeps the un-patched code.
const patchLoader = require("./patch-loader");
require(patchLoader.resolveAppFile("lib", "patch-module-resolution.js")).install(patchLoader);

const { app, BrowserWindow, shell, session, globalShortcut, Tray, Menu, nativeImage, nativeTheme } = require("electron");
const desktopAccess = require("./lib/desktop-access");
// 桌宠拖拽依赖全局坐标和 setPosition，原生 Wayland 不保证这些能力。
// 有 X11/XWayland 时使用它；尊重用户显式 Ozone 配置，不修改系统环境。
if (process.platform === "linux" && process.env.DISPLAY &&
    !app.commandLine.hasSwitch("ozone-platform") &&
    !app.commandLine.hasSwitch("ozone-platform-hint") &&
    !process.env.ELECTRON_OZONE_PLATFORM_HINT) {
  app.commandLine.appendSwitch("ozone-platform", "x11");
}
const windowAppearance = require("./lib/window-appearance");
const path = require("path");
const fs = require("fs");
const { dataPath, migrateLegacyDataDir, seedDataDir } = require("./paths");

// 装机态：代码在只读的应用包里，配置、数据/工作区落到 ~/DoCode。
// 首次启动（以及每次升级后）把包里自带的 experts.json 和内置技能补进去，只补缺、不覆盖用户改过的。
migrateLegacyDataDir();
seedDataDir();

// Electron 的 userData 目录也统一到 DoCode；旧名称只用于一次性兼容迁移。
// package.json 的 name 走，不搬家的话老用户会丢 localStorage（表现为莫名其妙被登出）。
// 按时间倒序找最近的一个旧目录搬过来，只在新目录不存在时搬一次。
// ⚠️ 白名单里只有我们自己用过的精确名字：同级还躺着腾讯官方 WorkBuddy 的目录，绝不能碰。
const LEGACY_USERDATA = ["docode", "openworkbuddy", "openbuddy", "workbuddy-clone"];
(function migrateUserData() {
  try {
    const base = app.getPath("appData");
    const to = path.join(base, "DoCode");
    if (!fs.existsSync(to)) {
      for (const name of LEGACY_USERDATA) {
        const from = path.join(base, name);
        if (!fs.existsSync(from)) continue;
        fs.renameSync(from, to);
        console.log(`[迁移] userData 已从 ${name} 搬到 DoCode`);
        break;
      }
    }
    app.setPath("userData", to);
  } catch (e) {
    console.warn("[迁移] userData 搬家失败（不影响使用，只是要重新登录一次）:", e.message);
  }
})();

const PORT = (() => {
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    return Number(require(dataPath("config.json")).server.port || 3800);
  } catch {
    return 3800;
  }
})();
desktopAccess.initialize(app, PORT);

let win;
let tray = null;
let isQuitting = false;

// 关闭主窗口时保留应用进程，让桌面宠物和任务栏仍可唤起它；只有真正退出应用时才销毁窗口。
app.on("before-quit", () => { isQuitting = true; });

function showMainWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const iconPath = path.join(__dirname, "public", "icon.png");
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon || icon.isEmpty()) icon = nativeImage.createEmpty();
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("CloseCode");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 CloseCode", click: showMainWindow },
    { type: "separator" },
    { label: "退出 CloseCode", click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", showMainWindow);
  return tray;
}

// 单实例：双击启动器、重开 npm run app 时，把已开的窗口拉到前台，而不是再叠一个实例
// （第二个实例的服务端会撞端口起连接已运行实例分支，结果就是两个窗口两件 Dock 图标）
if (!app.requestSingleInstanceLock()) {
  app.exit(0); // 立即退出：app.quit() 是异步的，慢一步的话 whenReady 还会抢跑建出第二个窗口
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
}

async function waitForServer(url, tries = 200) {
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(url, { headers: desktopAccess.headers(), redirect: "error", signal: AbortSignal.timeout(1000) });
      if (!desktopAccess.enabled() || (global.__wbServer?.listening && response.status === 204)) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150)); // 服务端 1 秒内就绪，粗轮询白等半秒
  }
  return false;
}

app.whenReady().then(async () => {
  console.log(`[启动] Electron 就绪 +${Date.now() - BOOT_T0}ms`);
  // 窗口先开（秒响应），服务端在同进程内随后启动，就绪即加载页面。
  // 顺序反过来的话，用户要盯着 Dock 图标空等服务端把路由全注册完。
  let appearanceSettings = {};
  try { appearanceSettings = JSON.parse(fs.readFileSync(dataPath("config.json"), "utf8")); } catch {}
  const desktopSession = desktopAccess.enabled()
    ? session.fromPartition("persist:closecode-desktop", { cache: false }) : null;
  win = new BrowserWindow({
    width: 1520,
    height: 900,
    minWidth: 680,
    minHeight: 480,
    title: "CloseCode",
    autoHideMenuBar: true,
    ...windowAppearance.windowOptions(appearanceSettings, nativeTheme),
    show: false, // 页面渲染好了再亮相（ready-to-show），不给用户看白屏；下面有兜底定时防止永不出现
    webPreferences: {
      ...(desktopSession ? { session: desktopSession, sandbox: true } : {}),
      backgroundThrottling: false, // 窗口隐藏（快捷键收起）时任务还在流式回报，让时器不要被降频
      preload: path.join(__dirname, "preload.js"), // 加载 preload 脚本，暴露自动更新 API
      contextIsolation: true, // 启用上下文隔离，安全地暴露 API
      nodeIntegration: false, // 禁用 nodeIntegration，提高安全性
    },
  });

  if (desktopSession) desktopAccess.protectWindow(win, desktopSession, { openExternal: url => shell.openExternal(url) });
  windowAppearance.attachAppearance({ win, ipcMain, nativeTheme, origin: `http://127.0.0.1:${PORT}` });

  // 在 Electron 主进程内直接启动服务端
  // Close-to-background behavior keeps the process and desktop pet alive.
  createTray();
  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    // 隐藏到托盘时不断开WebSocket，保持后台连接以接收消息
    win.hide();
  });

  try {
    require(path.join(__dirname, "server.js"));
  } catch (err) {
    console.error("[启动] 服务端加载失败:", err.message);
    const { dialog } = require("electron");

    if (err.code === "EADDRINUSE" || (err.cause && err.cause.code === "EADDRINUSE")) {
      // 端口占用：可能是旧进程还在，等一会儿重试
      dialog.showErrorBox(
        "端口已被占用",
        `HTTP 服务无法绑定端口 ${PORT}（可能旧进程尚未退出）。\n\n应用将在 3 秒后自动重试。如仍失败，请手动结束所有 CloseCode 进程后重新打开。`
      );
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 3000);
      return; // 中断后续流程
    }

    // 带着补丁跑挂了 → 补丁的锅，回滚到基础版本再重启。
    // 不能只弹框了事：窗口是 show:false，用户看到的就是「点了没反应，只剩托盘图标」。
    // 哨兵机制只在「下一次」启动时才回落，这里直接回滚能省掉那一轮崩溃。
    if (patchLoader.activePatch && patchLoader.rollbackPatch) {
      const bad = patchLoader.activePatch.version;
      patchLoader.rollbackPatch(`启动失败：${err.message}`);
      dialog.showErrorBox(
        "热补丁已回滚",
        `补丁 ${bad} 无法启动（${err.message}）。\n\n已自动回滚到安装版本 ${patchLoader.baseAppVersion()}，应用即将重启。`
      );
      app.relaunch();
      app.exit(0);
      return;
    }

    // 基础版本自己就起不来：这是装包坏了，光重启没用，如实告诉用户
    dialog.showErrorBox("启动失败", `服务端初始化出错：${err.message}\n\n请检查日志或重新安装应用。`);
    isQuitting = true; // 绕过 close 钩子的「藏到托盘」，别留个死进程在那儿
    app.quit();
    return;
  }

  // 首绘打磨：正常流程 ready-to-show 在 ~0.7s 内到，一次干净的整页亮相；
  // 服务端起不来时它可能永远不触发，3 秒兜底强制亮窗，让用户看到报错而不是什么都没有
  const showOnce = () => { if (win && !win.isVisible()) { win.show(); } };
  win.once("ready-to-show", () => { console.log(`[启动] 窗口亮相 +${Date.now() - BOOT_T0}ms`); showOnce(); });
  setTimeout(showOnce, 3000);

  const ready = await waitForServer(`http://127.0.0.1:${PORT}${desktopAccess.enabled() ? "/__desktop_health" : "/api/info"}`);
  if (!ready) {
    require("electron").dialog.showErrorBox("启动失败", "桌面服务未能通过启动验证，应用将退出。");
    isQuitting = true;
    app.quit();
    return;
  }
  console.log(`[启动] 服务端就绪 +${Date.now() - BOOT_T0}ms`);
  win.webContents.once("did-finish-load", () => console.log(`[启动] 页面加载完成 +${Date.now() - BOOT_T0}ms`));
  win.loadURL(`http://127.0.0.1:${PORT}`);

  // Boot succeeded end-to-end (server up AND page rendered) -> retire the patch sentinel.
  // Anything earlier is too weak a signal: a bad patch can break the renderer while the
  // server still answers /api/info, and that must count as a failed boot so we roll back.
  win.webContents.once("did-finish-load", () => patchLoader.confirmPatch());

  // 外链用系统浏览器打开
  if (!desktopAccess.enabled()) win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // 供 server.js（同进程内运行）访问窗口：全屏切换 / 快捷键热更新
  global.__wbWin = win;
  global.__wbShowMain = showMainWindow;
  global.__wbRegisterShortcuts = registerShortcuts;

  // 桌面宠物：常驻脚落显示 agent 在干什么，agent 要提问时跳给你看。
  // 放在窗口之后创建，这样它一出生 global.__wbWin 就是齐的（点它要唤起主窗口）。
  const pet = require(path.join(__dirname, "pet.js"));
  global.__wbPet = pet;
  try {
    const petCfg = require(dataPath("config.json")).pet || {};
    pet.applyConfig({ enabled: petCfg.enabled === true, scale: petCfg.scale || 1, opacity: petCfg.opacity || 1, notify: petCfg.notify !== false, character: petCfg.character || "cat" });
  } catch {
    pet.applyConfig({ enabled: false }); // 读不到配置就当没配过：默认不该有宠物
  }
  try {
    const shortcuts = require(dataPath("config.json")).shortcuts || {};
    registerShortcuts(shortcuts);
  } catch {
    registerShortcuts({});
  }
});

/** 全局快捷键（系统级，仅「唤起、隐藏主窗口」需要）；设置页改绑后由 server.js 调用热更新 */
function registerShortcuts(shortcuts) {
  try {
    globalShortcut.unregisterAll();
    const accel = String((shortcuts || {})["toggle-window"] || "Shift+Alt+W")
      .replace(/\bMeta\b/g, "Command")
      .replace(/\bCtrl\b/g, "Control");
    globalShortcut.register(accel, () => {
      if (!win) return;
      if (win.isVisible() && win.isFocused()) win.hide();
      else showMainWindow();
    });
  } catch (e) {
    console.warn("[快捷键] 全局快捷键注册失败", e.message);
  }
}

app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll();
  } catch {}
  try {
    if (global.__wbPet) global.__wbPet.destroy();
  } catch {}
  try {
    if (tray && !tray.isDestroyed()) tray.destroy();
  } catch {}
  tray = null;
});

// 主窗口关闭时只挂起到后台；显式退出应用时再由 will-quit 清理宠物窗口。
// macOS Dock / taskbar activation should always restore the backgrounded main window.
app.on("activate", () => {
  showMainWindow();
});

// The close button is handled above as a background/minimize action. The app only exits
// when Electron is explicitly quitting (for example, from the OS or a future Quit command).
app.on("window-all-closed", () => {
  if (isQuitting) app.quit();
});


// ================= 自动更新集成 =================
const { setupAutoUpdater, autoUpdater } = require("./auto-updater");
const { ipcMain } = require("electron");

// 在 app ready 后初始化自动更新
app.whenReady().then(() => {
  if (win) {
    setupAutoUpdater(win);
    console.log("[自动更新] 已初始化");
  }
});

// 存储检查更新的结果，供下载时使用
let lastUpdateCheckResult = null;

/**
 * 比较两个版本号（形如 1.1.4 / 1.1.4-beta.1）
 * @returns 正数：a 比 b 新；0：相同；负数：a 比 b 旧
 */
function compareVersions(a, b) {
  // 只取主版本部分，忽略 -beta 之类的预发布后缀
  const parse = (v) => String(v || "0").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const va = parse(a);
  const vb = parse(b);
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) {
    const diff = (va[i] || 0) - (vb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// IPC 通信：前端触发检查更新
ipcMain.handle("check-for-updates", async () => {
  try {
    // 开发模式下强制允许更新检查
    if (process.env.NODE_ENV !== "production" && !app.isPackaged) {
      // 开发模式：直接调用 HTTP API（使用 Node.js 内置 fetch，Node 18+ 支持）
      const currentVersion = require("./package.json").version;
      const response = await fetch("https://close.codes/api/agents");
      const result = await response.json();

      if (!result.success || !Array.isArray(result.data)) {
        return { success: false, error: "获取更新信息失败" };
      }

      const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
      const platformUpdates = result.data.filter(item => item.platform === platform);

      if (platformUpdates.length === 0) {
        return { success: false, error: "当前平台暂无更新" };
      }

      const latest = platformUpdates.sort((a, b) => compareVersions(b.version, a.version))[0];

      // 服务端版本不比本地新时，就是已经最新了，别再提示更新
      if (compareVersions(latest.version, currentVersion) <= 0) {
        console.log(`[自动更新] 当前已是最新版本: ${currentVersion}（服务端 ${latest.version}）`);
        lastUpdateCheckResult = null;
        return { success: false, upToDate: true, error: "当前已是最新版本", currentVersion, latestVersion: latest.version };
      }

      // 保存检查结果供下载时使用
      lastUpdateCheckResult = {
        success: true,
        isDev: true,
        updateInfo: {
          version: latest.version,
          releaseDate: latest.updated_at,
          files: [{ size: latest.file_size, url: latest.filename }]
        },
        downloadUrl: `https://close.codes/api/agents/${latest.id}/download`
      };

      return lastUpdateCheckResult;
    }

    // 生产模式：使用 electron-updater
    // 注意：checkForUpdates() 只要能拉到 latest.yml 就会返回 updateInfo，
    // 它本身不代表「有新版本」，所以必须自己比一次版本号。
    const currentVersion = app.getVersion();
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo && compareVersions(result.updateInfo.version, currentVersion) > 0) {
      // 保存检查结果
      lastUpdateCheckResult = { success: true, isDev: false, updateInfo: result.updateInfo };
      return { success: true, updateInfo: result.updateInfo };
    } else {
      const latestVersion = result && result.updateInfo ? result.updateInfo.version : currentVersion;
      console.log(`[自动更新] 当前已是最新版本: ${currentVersion}（服务端 ${latestVersion}）`);
      lastUpdateCheckResult = null;
      return { success: false, upToDate: true, error: "当前已是最新版本", currentVersion, latestVersion };
    }
  } catch (err) {
    console.error("[自动更新] 检查失败:", err);
    lastUpdateCheckResult = null;
    return { success: false, error: err.message };
  }
});

// 前端触发下载更新
ipcMain.handle("download-update", async () => {
  try {
    // 检查是否已经执行过更新检查
    if (!lastUpdateCheckResult || !lastUpdateCheckResult.success) {
      return { success: false, error: "请先检查更新" };
    }

    // 开发模式：使用 HTTP 下载
    if (lastUpdateCheckResult.isDev) {
      const { downloadUrl } = lastUpdateCheckResult;
      // 返回下载链接，让前端打开浏览器下载
      return {
        success: true,
        isDev: true,
        downloadUrl,
        message: "开发模式下请手动下载安装包"
      };
    }

    // 生产模式：使用 electron-updater 自动下载（异步，不阻塞）
    autoUpdater.downloadUpdate().then(() => {
      console.log("[自动更新] 下载任务已启动");
    }).catch((err) => {
      console.error("[自动更新] 下载启动失败:", err);
      if (win && win.webContents) {
        win.webContents.send("update-error", err.message);
      }
    });

    // 立即返回，不等待下载完成（进度通过事件通知前端）
    return { success: true, message: "下载已开始" };
  } catch (err) {
    console.error("[自动更新] 下载失败:", err);
    return { success: false, error: err.message };
  }
});

// 前端触发安装更新（退出并安装）
ipcMain.handle("install-update", () => {
  console.log("[自动更新] 准备退出并安装更新");
  try {
    // 参数说明：
    // isSilent: true - 静默安装，不显示安装界面（Windows NSIS 支持）
    // isForceRunAfter: true - 安装后自动启动应用
    // 注意：在 Windows 上，非静默安装可能导致"请选择应用打开"的错误
    setImmediate(() => {
      autoUpdater.quitAndInstall(true, true);
    });
    return { success: true };
  } catch (err) {
    console.error("[自动更新] 安装失败:", err);
    return { success: false, error: err.message };
  }
});

// ================= 热补丁更新 =================
const { checkForPatch, downloadAndApplyPatch } = require("./patch-updater");

// 检查热补丁更新
ipcMain.handle("check-for-patch", async () => {
  try {
    const result = await checkForPatch();
    if (result.hasUpdate) {
      return {
        success: true,
        updateInfo: {
          version: result.patch.version,
          baseVersion: result.patch.baseVersion,
          size: result.patch.size,
          releaseDate: result.patch.releaseDate,
          type: "patch", // 标记为补丁更新，前端可据此展示不同的 UI
        },
      };
    } else {
      return { success: false, reason: result.reason };
    }
  } catch (err) {
    console.error("[热补丁] 检查失败:", err);
    return { success: false, reason: err.message };
  }
});

// 下载并应用热补丁
ipcMain.handle("download-patch", async () => {
  try {
    const checkResult = await checkForPatch();
    if (!checkResult.hasUpdate) {
      return { success: false, reason: checkResult.reason || "无可用更新" };
    }

    const result = await downloadAndApplyPatch(checkResult.patch, (progress) => {
      if (win && win.webContents) {
        win.webContents.send("patch-progress", progress);
      }
    });

    return result;
  } catch (err) {
    console.error("[热补丁] 下载失败:", err);
    return { success: false, reason: err.message };
  }
});

// 获取当前补丁信息
ipcMain.handle("get-patch-info", () => {
  return {
    baseVersion: patchLoader.baseAppVersion(),
    effectiveVersion: patchLoader.effectiveVersion(),
    activePatch: patchLoader.activePatch ? {
      version: patchLoader.activePatch.version,
      baseVersion: patchLoader.activePatch.baseVersion,
      fileCount: patchLoader.activePatch.files.size,
    } : null,
  };
});
