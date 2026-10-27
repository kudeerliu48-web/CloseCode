"use strict";
/**
 * 桌面宠物——桌面角落的一个透明小窗口，把 agent 正在干什么摆到台面上。
 *
 * 默认不存在。用户在对话里说一句「把这张图做成桌面宠物」并传张照片，agent 调 desktop_pet 工具现做一只；
 * 也可以去 设置 → 人设 手动开。不主动出现是刻意的——没人要求就常驻桌面的挂件，在中文用户心智里等同于流氓软件。
 *
 * 为什么值得单开一个窗口：主窗口一被别的应用盖住，任务是死是活就全凭猜；更要命的是
 * agent 用 ask_user 弹了问题，卡片安安静静躺在后台，5 分钟没人答就按默认继续了——
 * 用户的体感是「它从来不问我」。宠物解决的就是这件事：状态一直在眼角余光里，要问你的时候
 * 它会跳起来 + 系统通知 + Dock/任务栏闪，你想不看见都难。
 *
 * 实现上刻意只用 Electron 自带能力：透明无边框窗口 + 一个自包含的 HTML（纯 SVG/CSS 动画），
 * 不引第三方依赖，不落任何素材文件。Windows 同样吃透明窗口，位置记在 userData 里。
 */

const path = require("path");
const { dataPath, appPath } = require("./paths");
const fs = require("fs");

let electron = null;
try { electron = require("electron"); } catch {} // 纯 node 跑 server.js 时整个模块降级成空壳

const IS_LINUX = process.platform === "linux";
const PET_W = 168;
const PET_H = 196;

let petWin = null;
let curState = { name: "idle", text: "", tokens: null, taskId: null };
let idleTimer = null;
let dragTimer = null;
let dragActive = false;
let pointerTimer = null;
let dragMoved = false;
let dragStartPoint = null;
let dragStartPosition = null;
let dragCharacter = null;
let ipcBound = false;
let clickSerial = 0, pendingClick = null;
let voiceEntranceSent = false; // 程序生命周期一次，收起后重建窗口也不重复登场
function syncScale(win) {
  const scale = Math.min(2, Math.max(0.6, Number(cfg.scale) || 1));
  win.webContents.setZoomFactor(scale);
  win.setSize(Math.round(PET_W * scale), Math.round(PET_H * scale));
}
let cfg = { enabled: false, scale: 1, opacity: 1, notify: true, character: "yaya3d" };
let dndUntil = 0;     // 免打扰截止时间戳：只压「要你动手」的提醒，状态显示照常
let lastHit = false;  // 光标当前是不是压在宠物实体上（渲染进程按像素判定后报上来）
let photoCache = { key: "", url: "" }; // 照片按 路径+修改时间 缓存，换了图自动失效

/**
 * 自定义形象（用户自己或朋友的照片）。走 data URL 直接推给渲染进程，
 * 不给宠物窗口开 HTTP 通道——它是 loadFile 起来的本地页面，接口在登录闸后面，
 * 塞 data URL 是最省事也最不容易出岔子的做法。前端上传前已压到 320px，体积很小。
 */
function photoDataUrl() {
  const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
  for (const ext of [".png", ".jpg", ".webp", ".gif"]) {
    const p = dataPath("data", "pet-avatar" + ext);
    try {
      const st = fs.statSync(p);
      const key = p + ":" + st.mtimeMs;
      if (photoCache.key === key) return photoCache.url;
      const url = `data:${MIME[ext]};base64,` + fs.readFileSync(p).toString("base64");
      photoCache = { key, url };
      return url;
    } catch {}
  }
  photoCache = { key: "", url: "" };
  return "";
}

function posFile() {
  try { return path.join(electron.app.getPath("userData"), "pet-position.json"); } catch { return ""; }
}
function loadPos() {
  try { return JSON.parse(fs.readFileSync(posFile(), "utf8")); } catch { return null; }
}
function savePos() {
  if (!petWin || petWin.isDestroyed()) return;
  try {
    const [x, y] = petWin.getPosition();
    fs.writeFileSync(posFile(), JSON.stringify({ x, y }));
  } catch {}
}

/** 默认停在主屏右下角，离边缘留一点，别贴着 Dock */
function defaultPos(w, h) {
  const { workArea } = electron.screen.getPrimaryDisplay();
  return { x: Math.round(workArea.x + workArea.width - w - 24), y: Math.round(workArea.y + workArea.height - h - 24) };
}
/** 记忆的位置可能来自已拔掉的外接屏：落在任何显示器工作区外就退回默认位置 */
function sanePos(p, w, h) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return defaultPos(w, h);
  const ok = electron.screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return p.x + w > a.x + 40 && p.x < a.x + a.width - 40 && p.y + h > a.y + 20 && p.y < a.y + a.height - 20;
  });
  return ok ? { x: Math.round(p.x), y: Math.round(p.y) } : defaultPos(w, h);
}

function toggleMain() {
  const win = global.__wbWin;
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && win.isFocused()) { win.hide(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function clearDrag() {
  dragActive = false;
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  dragStartPoint = null;
  dragStartPosition = null;
  dragCharacter = null;
  dragMoved = false;
}

function updateDragPosition(point) {
  if (!petWin || petWin.isDestroyed() || !dragStartPoint || !dragStartPosition) return;
  const dx = point.x - dragStartPoint.x, dy = point.y - dragStartPoint.y;
  if (!dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) dragMoved = true;
  if (dragMoved) petWin.setPosition(dragStartPosition.x + dx, dragStartPosition.y + dy);
}

function stopPointerTracking() {
  if (pointerTimer) clearInterval(pointerTimer);
  pointerTimer = null;
  clearDrag();
  lastHit = false;
}

function setMouseHit(win, hit) {
  // Linux 不支持 forward；始终让小窗口接收事件，不能依赖全局光标轮询救活。
  try { win.setIgnoreMouseEvents(IS_LINUX ? false : !hit, { forward: true }); } catch {}
}

function startPointerTracking(win) {
  if (pointerTimer) clearInterval(pointerTimer);
  pointerTimer = null;
  // Linux 使用页面原生 pointermove；Wayland 全局坐标可能不可用。
  if (IS_LINUX) return;
  const timer = setInterval(() => {
    if (petWin !== win || win.isDestroyed()) { clearInterval(timer); return; }
    try {
      if (!win.isVisible() || win.webContents.isDestroyed()) return;
      const point = electron.screen.getCursorScreenPoint();
      const bounds = win.getContentBounds();
      win.webContents.send("pet:pointer", {
        x: point.x - bounds.x, y: point.y - bounds.y,
        width: bounds.width, height: bounds.height,
      });
    } catch {
      clearInterval(timer);
      if (pointerTimer === timer) pointerTimer = null;
      setMouseHit(win, true);
    }
  }, 32);
  pointerTimer = timer;
}

function validPetSender(event) {
  return !!(petWin && !petWin.isDestroyed() && event.sender === petWin.webContents &&
    event.senderFrame && event.senderFrame === petWin.webContents.mainFrame &&
    event.senderFrame.url === require("url").pathToFileURL(appPath("public", "pet.html")).href);
}

function bindIpc() {
  if (ipcBound || !electron) return;
  ipcBound = true;
  const { ipcMain, screen, Menu } = electron;
  ipcMain.on("pet:voice-entrance", (event) => {
    if (validPetSender(event) && cfg.voice_enabled === true) voiceEntranceSent = true;
  });

  // 拖动：不用 -webkit-app-region（拖拽区吞点击，没法区分「拖」和「点」），改成主进程轮询光标。
  // 松手时位移小于阈值就算点击 → 唤起主窗口，大于阈值才算真拖动 → 记住新位置。
  ipcMain.on("pet:show-main", (event) => {
    if (!validPetSender(event) || cfg.character !== "muyu" || dragActive || dragMoved) return;
    const win = global.__wbWin;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  ipcMain.on("pet:click-result", (event, id, woke) => {
    if (!validPetSender(event) || !pendingClick || pendingClick.id !== id ||
        pendingClick.character !== cfg.character || dragActive || dragMoved) return;
    pendingClick = null;
    if (woke === true && ["yaya", "yaya3d"].includes(cfg.character) && ["idle", "sleep"].includes(curState.name)) {
      setState("idle", "", curState);
    } else if (cfg.character !== "muyu") toggleMain();
  });
  ipcMain.on("pet:drag-start", (event) => {
    if (!validPetSender(event) || dragActive) return;
    pendingClick = null;
    dragActive = true;
    dragCharacter = cfg.character;
    setMouseHit(petWin, true);
    dragMoved = false;
    const win = petWin;
    try {
      dragStartPoint = screen.getCursorScreenPoint();
      const [wx, wy] = win.getPosition();
      dragStartPosition = { x: wx, y: wy };
      dragTimer = setInterval(() => {
        if (petWin !== win || win.isDestroyed()) { clearDrag(); return; }
        try { updateDragPosition(screen.getCursorScreenPoint()); }
        catch {
          clearInterval(dragTimer); dragTimer = null;
          dragStartPoint = null; dragStartPosition = null;
          setMouseHit(win, true);
        }
      }, 16);
    } catch {
      // 不可用的全局坐标不应丢掉本次按下；仍可在 release 时完成点击。
      dragStartPoint = null; dragStartPosition = null;
    }
  });
  ipcMain.on("pet:drag-end", (event, cancelled) => {
    if (!validPetSender(event) || !dragActive) return;
    // Apply the release point even when no 16 ms polling tick has run yet.
    try { updateDragPosition(screen.getCursorScreenPoint()); } catch {}
    clearInterval(dragTimer); dragTimer = null;
    dragActive = false;
    // 完成态打字会在拖动中更新 lastHit；这里必须用最新值，不能沿用按下前的命中。
    setMouseHit(petWin, lastHit);
    if (dragMoved) savePos();
    else if (!cancelled && dragCharacter === cfg.character) {
      if (["muyu", "yaya", "yaya3d"].includes(cfg.character)) {
        pendingClick = { id: ++clickSerial, character: cfg.character };
        petWin.webContents.send("pet:click", pendingClick.id);
      } else toggleMain();
    }
    dragStartPoint = null;
    dragStartPosition = null;
    dragCharacter = null;
  });
  /**
   * 点击穿透：透明窗口默认是一整个矩形都吃鼠标的，宠物只占中间一小块，
   * 剩下的空白会把底下应用的点击全挡掉——这是桌宠差评第一名。
   * 渲染进程按「光标底下到底压着不压着图形」判定后报上来，这里翻转 ignore。
   * forward:true 是关键：忽略鼠标之后仍然要收到 mousemove，不然光标移回宠物身上就再也醒不过来。
   * 失效方向刻意选「可交互」：渲染进程要是没报或者挂了，窗口就保持能点，最多挡一小块，
   * 而不是变成一个永远点不中的鬼影。
   */
  ipcMain.on("pet:hit", (event, on) => {
    if (!validPetSender(event)) return;
    lastHit = !!on;
    // 拖动中不立刻改穿透，避免中途把窗口交还给桌面把拖拽打断；
    // lastHit 仍要更新，松手时按完成态重绘后的真实命中恢复。
    if (dragActive) return;
    setMouseHit(petWin, lastHit);
  });

  ipcMain.on("pet:menu", (event) => {
    if (!validPetSender(event)) return;
    Menu.buildFromTemplate([
      { label: "打开主窗口", click: () => { const w = global.__wbWin; if (w && !w.isDestroyed()) { w.show(); w.focus(); } } },
      { label: "回到右下角", click: () => { const p = defaultPos(PET_W, PET_H); petWin.setPosition(p.x, p.y); savePos(); } },
      { type: "separator" },
      dndUntil > Date.now()
        ? { label: `免打扰中（剩 ${Math.ceil((dndUntil - Date.now()) / 60000)} 分钟）· 点此结束`, click: () => { dndUntil = 0; } }
        : { label: "先别烦我", submenu: [
            { label: "30 分钟", click: () => { dndUntil = Date.now() + 30 * 60000; } },
            { label: "1 小时", click: () => { dndUntil = Date.now() + 60 * 60000; } },
          ] },
      { type: "separator" },
      { label: "收起宠物（跟我说一声就能叫回来）", click: () => hide() },
    ]).popup({ window: petWin });
  });
}

function create() {
  if (!electron || !electron.app) return null;
  if (petWin && !petWin.isDestroyed()) return petWin;
  bindIpc();
  const scale = Math.min(2, Math.max(0.6, Number(cfg.scale) || 1));
  const w = Math.round(PET_W * scale), h = Math.round(PET_H * scale);
  const p = sanePos(loadPos(), w, h);
  petWin = new electron.BrowserWindow({
    width: w, height: h, x: p.x, y: p.y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true, // Windows 任务栏 / mac 窗口列表里不占位，它是个挂件不是窗口
    alwaysOnTop: true,
    show: false,
    focusable: IS_LINUX, // Linux 需要可聚焦窗口以稳定接收按下/捕获；其他平台保持不抢焦点
    acceptFirstMouse: true,
    webPreferences: {
      preload: appPath("pet-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 被别的窗口盖住时动画和状态照常走
      autoplayPolicy: "no-user-gesture-required", // 本地桌宠按用户语音开关播放，不依赖透明窗口先获焦
    },
  });
  petWin.setAlwaysOnTop(true, "floating");
  // 跟着所有桌面走，但**不**在全屏应用上露面：开会投屏、放全屏演示时它跳出来就是事故。
  // 那种场景下提醒仍然走系统通知（通知会被系统「专注模式」正常压制），不会真漏掉。
  try { petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false }); } catch {}
  const win = petWin;
  win.once("ready-to-show", () => {
    if (petWin !== win || win.isDestroyed()) return;
    syncScale(win);
    win.showInactive(); // 不抢焦点地亮相
    setMouseHit(win, false); // Linux 保持可交互，其他平台先穿透再按实体命中恢复
    startPointerTracking(win);
    push();
  });
  win.on("show", () => {
    if (petWin === win && !win.isDestroyed()) { startPointerTracking(win); push(); }
  });
  win.on("hide", () => {
    if (petWin !== win) return;
    push();
    stopPointerTracking();
    clearTimeout(idleTimer); idleTimer = null;
  });
  win.on("closed", () => {
    if (petWin !== win) return;
    stopPointerTracking();
    clearTimeout(idleTimer); idleTimer = null;
    petWin = null;
  });
  win.loadFile(appPath("public", "pet.html"));
  return petWin;
}

function push() {
  if (!petWin || petWin.isDestroyed()) return;
  try {
    const photo = cfg.character === "photo" ? photoDataUrl() : "";
    const announceEntrance = !voiceEntranceSent && cfg.voice_enabled === true &&
      cfg.character === "yaya3d" && petWin.isVisible() && cfg.voice_volume !== 0;
    petWin.webContents.send("pet:state", {
      ...curState,
      scale: Number(cfg.scale) || 1,
      opacity: Number(cfg.opacity) || 1,
      announceEntrance,
      voice_enabled: cfg.voice_enabled === true,
      voice_volume: Number.isFinite(cfg.voice_volume) ? Math.max(0, Math.min(1, cfg.voice_volume)) : .7,
      hidden: !petWin.isVisible(),
      character: photo ? "photo" : cfg.character === "photo" || cfg.character === undefined ? "yaya3d" : ["cat", "spider", "judy", "fox", "muyu", "yaya", "yaya3d"].includes(cfg.character) ? cfg.character : "cat", // 缺省或照片丢失回落芽芽，非法值兼容小猫
      photo,
    });
  } catch {}
}

/**
 * 设置宠物状态。name: idle | working | asking | done | error | sleep
 * text 是一句人话，鼠标悬停时显示（asking 会直接把问题挂在气泡里）。
 */
function setState(name, text, meta = {}) {
  const n = ["idle", "working", "asking", "done", "error", "sleep"].includes(name) ? name : "idle";
  const tokens = Number.isSafeInteger(meta?.tokens) && meta.tokens >= 0 ? meta.tokens : null;
  const taskId = typeof meta?.taskId === "string" ? meta.taskId.slice(0, 200) : null;
  curState = { name: n, text: String(text || "").slice(0, 120), tokens, taskId };
  push();
  clearTimeout(idleTimer);
  // 完成/出错是瞬时表情，几秒后自己回到待机；asking 必须等到有人回答才解除，不设自动过期
  if (n === "done" || n === "error") idleTimer = setTimeout(() => setState("idle", ""), n === "done" ? 6000 : 10000);
}

/**
 * agent 要问用户了：宠物跳 + 系统通知 + Dock 弹跳/任务栏闪。
 * 三路一起上是故意的——用户可能正在另一个全屏应用里，少一路就可能整个漏掉。
 */
function alertAsk(question) {
  setState("asking", question); // 状态显示永远不压制——用户要静的是"提醒"，不是"看不见它在等我"
  if (!electron || !cfg.notify) return;
  if (Date.now() < dndUntil) return; // 免打扰：宠物照样举着问号等你，但不弹通知、不弹 Dock
  const { Notification, app } = electron;
  const win = global.__wbWin;
  try {
    if (win && !win.isDestroyed() && !win.isFocused()) {
      if (process.platform === "darwin" && app.dock) app.dock.bounce("critical");
      else win.flashFrame(true); // Windows/Linux：任务栏图标闪烁，直到用户点进来
    }
  } catch {}
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: "CloseCode 有个问题要问你",
        body: String(question || "").slice(0, 160) || "任务卡在一个只有你能决定的岔路口",
        silent: false,
      });
      n.on("click", () => { const w = global.__wbWin; if (w && !w.isDestroyed()) { w.show(); w.focus(); } });
      n.show();
    }
  } catch {}
}

/** 用户答了/超时了：停止闪烁，回到干活状态 */
function clearAsk(stillWorking) {
  try {
    const win = global.__wbWin;
    if (win && !win.isDestroyed() && process.platform !== "darwin") win.flashFrame(false);
  } catch {}
  setState(stillWorking ? "working" : "idle", "");
}

function show() { cfg.enabled = true; create(); if (petWin && !petWin.isDestroyed() && !petWin.isVisible()) petWin.showInactive(); }
function hide() {
  cfg.enabled = false;
  stopPointerTracking();
  clearTimeout(idleTimer); idleTimer = null;
  if (petWin && !petWin.isDestroyed()) { savePos(); petWin.destroy(); }
  petWin = null;
}
function isVisible() { return !!(petWin && !petWin.isDestroyed() && petWin.isVisible()); }

/** 设置页改了开关/大小/透明度后热生效 */
function applyConfig(next) {
  const prev = { ...cfg };
  cfg = { ...cfg, ...(next || {}) };
  if (cfg.character === undefined) cfg.character = "yaya3d";
  else if (!["cat", "spider", "judy", "fox", "muyu", "yaya", "yaya3d", "photo"].includes(cfg.character)) cfg.character = "cat";
  cfg.enabled = cfg.enabled === true;
  photoCache = { key: "", url: "" }; // 设置动过就重读一次图，省得换了照片还显示旧的
  if (!cfg.enabled) { hide(); cfg.enabled = false; return; }
  if (!petWin || petWin.isDestroyed()) { create(); return; }
  if (Number(cfg.scale) !== Number(prev.scale)) {
    syncScale(petWin);
  }
  push();
}

function destroy() {
  clearTimeout(idleTimer); idleTimer = null;
  stopPointerTracking();
  if (petWin && !petWin.isDestroyed()) { savePos(); petWin.destroy(); }
  petWin = null;
}

module.exports = { create, setState, alertAsk, clearAsk, show, hide, isVisible, applyConfig, destroy, get enabled() { return cfg.enabled; } };
