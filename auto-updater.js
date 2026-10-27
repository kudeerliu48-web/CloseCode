"use strict";
/**
 * electron-updater 自动更新模块
 * 支持在线检查更新、后台下载、自动安装
 */

const { autoUpdater } = require("electron-updater");
const { dialog, app } = require("electron");
const path = require("path");

// 配置自动更新
function setupAutoUpdater(win) {
  // 禁用自动下载（改为手动触发）
  autoUpdater.autoDownload = false;

  // 禁用自动安装
  autoUpdater.autoInstallOnAppQuit = false;

  // 配置更新缓存目录到应用数据目录，避免弹出选择下载位置对话框
  const updateCacheDir = path.join(app.getPath("userData"), "updates");
  try {
    const fs = require("fs");
    if (!fs.existsSync(updateCacheDir)) {
      fs.mkdirSync(updateCacheDir, { recursive: true });
    }
    console.log("[自动更新] 更新缓存目录:", updateCacheDir);
  } catch (err) {
    console.error("[自动更新] 创建缓存目录失败:", err);
  }

  // 配置更新服务器（使用你的自定义 API）
  // 注意：electron-updater 默认需要 latest.yml 格式的更新清单
  // 这里我们使用 generic provider，指向你的更新服务器
  autoUpdater.setFeedURL({
    provider: "generic",
    url: "https://close.codes/updates/", // 更新清单的根目录
    useMultipleRangeRequest: false,
    channel: "latest" // 使用 latest 频道
  });

  // 由于你的 latest.yml 中文件路径是 /api/agents/7/download（相对路径）
  // electron-updater 会自动拼接成：https://close.codes/api/agents/7/download
  // 这样就能正确下载了

  // 开发模式：允许开发版本检查更新
  autoUpdater.allowDowngrade = true;
  autoUpdater.allowPrerelease = false;

  // 检查更新出错
  autoUpdater.on("error", (err) => {
    console.error("[自动更新] 错误:", err);
    if (win && win.webContents) {
      win.webContents.send("update-error", err.message);
    }
  });

  // 检查到有新版本
  autoUpdater.on("update-available", (info) => {
    console.log("[自动更新] 发现新版本:", info.version);
    if (win && win.webContents) {
      win.webContents.send("update-available", info);
    }
  });

  // 当前已是最新版本
  autoUpdater.on("update-not-available", (info) => {
    console.log("[自动更新] 当前已是最新版本:", info.version);
    if (win && win.webContents) {
      win.webContents.send("update-not-available", info);
    }
  });

  // 下载进度
  autoUpdater.on("download-progress", (progressObj) => {
    const msg = `下载速度: ${(progressObj.bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s - 已下载 ${progressObj.percent.toFixed(2)}%`;
    console.log("[自动更新]", msg);
    if (win && win.webContents) {
      win.webContents.send("download-progress", progressObj);
    }
  });

  // 下载完成
  autoUpdater.on("update-downloaded", (info) => {
    console.log("[自动更新] 下载完成:", info.version);
    if (win && win.webContents) {
      win.webContents.send("update-downloaded", info);
    }

    // 不自动弹窗，改为由前端控制
    // 用户点击前端的"立即安装"按钮时才执行安装
  });

  return autoUpdater;
}

module.exports = { setupAutoUpdater, autoUpdater };
