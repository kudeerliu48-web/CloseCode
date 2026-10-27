/**
 * Electron Preload Script
 * 在渲染进程和主进程之间建立安全的通信桥梁
 */

const { contextBridge, ipcRenderer } = require("electron");

// 暴露自动更新 API 给前端
contextBridge.exposeInMainWorld("electronAPI", {
  // Main-window-only appearance and allowlisted controls. Never expose raw IPC.
  desktopPlatform: process.platform,
  setWindowAppearance: (settings) => ipcRenderer.invoke("desktop:set-appearance", settings),
  windowControl: (action) => ipcRenderer.invoke("desktop:window-control", action),
  onWindowState: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on("desktop:window-state", listener);
    return () => ipcRenderer.removeListener("desktop:window-state", listener);
  },

  // 检查更新
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),

  // 下载更新
  downloadUpdate: () => ipcRenderer.invoke("download-update"),

  // 安装更新（退出并安装）
  installUpdate: () => ipcRenderer.invoke("install-update"),

  // 监听更新事件
  onUpdateAvailable: (callback) => ipcRenderer.on("update-available", (_, info) => callback(info)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on("update-not-available", (_, info) => callback(info)),
  onDownloadProgress: (callback) => ipcRenderer.on("download-progress", (_, progress) => callback(progress)),
  onUpdateDownloaded: (callback) => ipcRenderer.on("update-downloaded", (_, info) => callback(info)),
  onUpdateError: (callback) => ipcRenderer.on("update-error", (_, error) => callback(error)),

  // ===== 热补丁更新 API =====
  checkForPatch: () => ipcRenderer.invoke("check-for-patch"),
  downloadPatch: () => ipcRenderer.invoke("download-patch"),
  getPatchInfo: () => ipcRenderer.invoke("get-patch-info"),
  onPatchProgress: (callback) => ipcRenderer.on("patch-progress", (_, progress) => callback(progress)),
});
