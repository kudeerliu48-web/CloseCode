"use strict";
const os = require("os");
const CHANNEL = "desktop:set-appearance";
const CONTROL_CHANNEL = "desktop:window-control";
const STATE_CHANNEL = "desktop:window-state";
const TITLEBAR_HEIGHT = 36;
const PALETTE = {light:{background:"#ffffff", foreground:"#17181c"}, dark:{background:"#1e1f24", foreground:"#e8eaf0"}};
function supportsMaterial(platform = process.platform, release = os.release()) {
  const [major, , build] = release.split(".").map(Number);
  return platform === "darwin" || (platform === "win32" && (major > 10 || (major === 10 && build >= 22621)));
}
function themeSource(value) { return ["system", "light", "dark"].includes(value) ? value : "system"; }
function windowOptions(settings, nativeTheme, platform = process.platform) {
  nativeTheme.themeSource = themeSource(settings?.theme);
  const colors = PALETTE[nativeTheme.shouldUseDarkColors ? "dark" : "light"];
  return {
    backgroundColor: colors.background,
    titleBarStyle: platform === "darwin" ? "hiddenInset" : "hidden",
    // Windows/Linux controls share the renderer title bar, with no separately
    // painted native surface. Transparent native overlays can expose a black block.
    titleBarOverlay: platform === "darwin",
    ...(platform === "darwin" ? {trafficLightPosition:{x:14,y:11}} : {}),
  };
}
function applyAppearance(win, nativeTheme, value, platform = process.platform, release = os.release()) {
  if (!value || !["system","light","dark"].includes(value.themeSource) || !["light","dark"].includes(value.theme) || typeof value.glassEffect !== "boolean") throw Error("无效的窗口外观设置");
  nativeTheme.themeSource = value.themeSource;
  const colors = PALETTE[value.theme];
  // Only accept fixed-format color tokens, never arbitrary CSS or OS commands.
  const background = /^#[0-9a-f]{6}$/i.test(value.background) ? value.background : colors.background;
  const glass = value.glassEffect && !nativeTheme.shouldUseHighContrastColors && !nativeTheme.prefersReducedTransparency;
  let nativeGlass = false;
  if (supportsMaterial(platform, release)) {
    try {
      if (platform === "win32") win.setBackgroundMaterial(glass ? "acrylic" : "none");
      else win.setVibrancy(glass ? "under-window" : null);
      nativeGlass = glass;
    } catch {
      // An unavailable compositor must not break theme changes or the close button.
      try { if (platform === "win32") win.setBackgroundMaterial("none"); else win.setVibrancy(null); } catch {}
    }
  }
  win.setBackgroundColor(nativeGlass ? "#00000000" : background);
  // Do not re-enable a native caption overlay here: it would cover the transparent
  // HTML controls again when the theme or material changes. macOS keeps traffic lights.
  return {nativeGlass};
}
function attachAppearance({win, ipcMain, nativeTheme, origin}) {
  let stateRevision = 0;
  const snapshot = () => ({fullscreen:win.isFullScreen(), maximized:win.isMaximized(), stateRevision});
  function validateSender(event) {
    if (win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error("窗口调用来源无效");
    let senderOrigin;
    try { senderOrigin = new URL(event.senderFrame.url).origin; } catch {}
    if (senderOrigin !== origin) throw Error("窗口操作仅允许主应用页面调用");
  }
  ipcMain.handle(CHANNEL, (event, value) => {
    validateSender(event);
    return {...applyAppearance(win, nativeTheme, value), ...snapshot()};
  });
  ipcMain.handle(CONTROL_CHANNEL, (event, action) => {
    validateSender(event);
    // Never dispatch arbitrary BrowserWindow methods received from a renderer.
    switch (action) {
      case "minimize": win.minimize(); break;
      case "toggle-maximize":
        if (!win.isFullScreen()) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
        break;
      case "close": win.close(); break; // Preserve the existing close-to-tray hook.
      default: throw Error("无效的窗口操作");
    }
    return win.isDestroyed() ? null : snapshot();
  });
  const events = ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"];
  const state = () => {
    if (!win.isDestroyed()) { stateRevision++; win.webContents.send(STATE_CHANNEL, snapshot()); }
  };
  for (const event of events) win.on(event, state);
  win.once("closed", () => {
    ipcMain.removeHandler(CHANNEL); ipcMain.removeHandler(CONTROL_CHANNEL);
    for (const event of events) win.removeListener(event, state);
  });
}
module.exports = {CHANNEL, CONTROL_CHANNEL, STATE_CHANNEL, TITLEBAR_HEIGHT, PALETTE, supportsMaterial, windowOptions, applyAppearance, attachAppearance};
