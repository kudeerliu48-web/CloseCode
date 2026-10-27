"use strict";
/**
 * CloseCode — 服务器主入口。
 * 功能：Web 工作台（SSE 流式）、技能系统、MCP 连接器、专家团多智能体、IM 远程指挥（飞书/企业微信/通用 Webhook）。
 */

const BOOT_T0 = Date.now(); // server.js 从加载到 listen 的耗时，启动慢时先看这行日志
// 测试热更新标记 - v1.3.1 补丁测试
const patchLoader = require("./patch-loader");
if (patchLoader.activePatch) {
  require(patchLoader.resolveAppFile("lib", "patch-module-resolution.js")).install(patchLoader);
}
const express = require("express");
const desktopAccess = require(patchLoader.resolveAppFile("lib", "desktop-access.js"));
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID, randomBytes, createHash } = require("crypto");
const https = require("https");
const http = require("http");
const { DATA_DIR, dataPath, appPath, seedDataDir } = require("./paths");
// Packaged Electron must be initialized by its main process, never silently open.
if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE && require("electron").app.isPackaged && !desktopAccess.enabled()) {
  const { app, shell, BrowserWindow } = require("electron");
  let port = 3800;
  try { port = Number(process.env.PORT || require(dataPath("config.json")).server?.port || 3800); } catch {}
  desktopAccess.initialize(app, port);
  const win = BrowserWindow.getAllWindows?.()[0];
  if (win) desktopAccess.protectWindow(win, win.webContents.session, { openExternal: url => shell.openExternal(url) });
}
seedDataDir(); // node / Electron 启动都补齐新增预设，不覆盖用户已有内容
const { createLLM, createEmbedder } = require("./llm");
const { outputFiles, safePath, getWorkspaceDir, setWorkspaceDir, SEARCH_PROVIDERS, searchProviderKey, shellPath } = require("./tools");
const { McpManager } = require("./mcp");
const { createAgentRuntime, runSimpleTest } = require("./agent");
const { validateDelegation } = require("./lib/expert-routing");
// IM 远程指挥模块（飞书/QQ/企微/微信/钉钉）- 暂时禁用
// const { createImRouter } = require("./im");
const { createScheduler } = require("./scheduler");
const security = require("./security");
const memory = require("./memory");
const notify = require("./notify");
const store = require("./store");
// IM 会话存储 - 暂时禁用
// const { createImSessionStore } = require("./im-store");

// config.json 不入 git（可能含 API Key）；首次运行自动从模板复制
const CONFIG_PATH = dataPath("config.json");
if (!fs.existsSync(CONFIG_PATH)) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.copyFileSync(appPath("config.example.json"), CONFIG_PATH);
  console.log("已从 config.example.json 生成 config.json，请填入你的模型 API Key");
}
// 配置读坏了不能就这么空着起来：那样界面上所有 Key 都变成空的，用户随手一保存就把
// 真 Key 覆盖没了。store 会先拿 .bak 顶（Key 原样还在），实在顶不住才把坏文件改名隔离、
// 退回模板——原文还在 .corrupt-时间戳 里，Key 捞得回来。
const config = store.readJson(CONFIG_PATH, JSON.parse(fs.readFileSync(appPath("config.example.json"), "utf8")));

// 旧配置迁移：生成 models 列表（内置国产模型预设 + 自定义），active_model 指定当前使用
// 仅在完全没有 models 配置时才自动添加国模（兼容老版本）
if (!Array.isArray(config.models) || !config.models.length) {
  const old = config.openai || {};
  // 默认只提供国际模型，国产模型由用户在设置中主动添加
  config.models = [
    { name: "OpenAI", provider: "openai", base_url: "https://api.openai.com/v1", api_key: old.base_url?.includes("openai") ? old.api_key || "" : "", model: "gpt-4o" },
    { name: "Anthropic Claude", provider: "anthropic", base_url: "", api_key: "", model: "claude-sonnet-4" },
  ];
  config.active_model = "OpenAI";
  saveConfig();
}

security.getSecurity(config); // 补齐安全中心默认策略
config.shortcuts = config.shortcuts || {}; // 快捷键自定义绑定（只存改过的项，默认值在前端定义）
// 助理的名字和头像：想叫它「小秘」就叫「小秘」。界面（气泡头像/侧栏/品牌位）和系统提示词都跟着这里走
const ASSISTANT_DEFAULT = { name: "CloseCode", avatar: "🤖" };
function normalizeAssistantAvatar(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) {
    if (v.length > 256 * 1024) throw new Error("头像图片超过 256KB");
    return v;
  }
  if (/^data:/i.test(v) || /^(?:https?:)?\/\//.test(v) || v.includes("<") || [...new Intl.Segmenter().segment(v)].length > 2) throw new Error("头像只支持 emoji 或不超过 256KB 的上传图片");
  return v;
}
config.assistant = { ...ASSISTANT_DEFAULT, ...(config.assistant || {}) };

if (config.workspace_dir) {
  try {
    setWorkspaceDir(config.workspace_dir);
  } catch (e) {
    console.warn("workspace_dir 无效，使用默认工作空间:", e.message);
  }
}
let llmInner = createLLM(config, true); // 启动时容错：找不到 active_model 降级到首项，不抛错
// 记忆向量召回：有能算 embeddings 的渠道就接上，没有就退回关键词匹配（memory 自己兜底）
memory.setEmbedder(createEmbedder(config));
memory.ensureVectors().then((r) => { if (r.computed) console.log(`[记忆向量] 启动补算了 ${r.computed} 条`); }).catch((e) => console.warn("[记忆向量] 启动补算失败:", e.message));
// 可热替换的 LLM 包装：设置修改后 runtime 无需重建
const llm = {
  get provider() { return llmInner.provider; },
  get model() { return llmInner.model; },
  chat: (args) => llmInner.chat(args),
  getRequestConfig: () => llmInner.getRequestConfig(),
};
/** 按对话覆盖模型：会话里选过就用会话的，没选跟全局默认。
 *  选过的模型已被从列表删掉 → 明确报错，绝不悄悄换成别的模型跑 */
function llmForSession(sess) {
  const name = sess && sess.model;
  if (!name) return llm;
  if (Array.isArray(config.models) && config.models.some((m) => m.name === name)) {
    return createLLM({ ...config, active_model: name });
  }
  return {
    provider: name,
    model: name,
    chat: () => Promise.reject(new Error(`该对话指定的模型「${name}」已不在模型列表里。点输入框右下角的模型按钮重新选一个，或选「跟随全局默认」。`)),
  };
}
// 同一模型连续「整跑失败」计数（成功一次即清零）：连挂说明是模型/渠道本身的问题，光报错用户不知道该干嘛
const modelFailStreak = new Map();

// 模型健康账本：每次整跑记一笔成败（按模型条目名，滚动只留最近 20 次），选模型时能看到
// 「这个渠道最近靠不靠谱」，不用踩了才知道。落盘 data/model_health.json，重启不清零
const HEALTH_FILE = dataPath("data", "model_health.json");
const modelHealth = store.readJson(HEALTH_FILE, {}) || {};
function recordModelHealth(name, ok, failMsg) {
  if (!name) return;
  const h = (modelHealth[name] = modelHealth[name] || { recent: [] });
  h.recent.push(ok ? 1 : 0);
  if (h.recent.length > 20) h.recent = h.recent.slice(-20);
  if (ok) h.last_ok_t = Date.now();
  else { h.last_fail_t = Date.now(); h.last_fail = String(failMsg || "").slice(0, 200); }
  try { store.writeJsonAtomic(HEALTH_FILE, modelHealth); } catch {}
}
function healthSummary() {
  const out = {};
  for (const [name, h] of Object.entries(modelHealth)) {
    const recent = Array.isArray(h.recent) ? h.recent : [];
    let streak = 0;
    for (let i = recent.length - 1; i >= 0 && !recent[i]; i--) streak++;
    out[name] = { n: recent.length, ok: recent.filter(Boolean).length, fail_streak: streak, last_fail: h.last_fail || "", last_fail_t: h.last_fail_t || 0 };
  }
  return out;
}
/** 返回当前正在用的模型的 base_url（跟 llm.js/createLLM 逻辑一致） */
function activeBaseUrl() {
  if (Array.isArray(config.models) && config.models.length) {
    const wanted = String(config.active_model || "").trim();
    const entry = wanted ? config.models.find((m) => m.name === wanted) : config.models[0];
    return String((entry || {}).base_url || "").trim();
  }
  return "";
}

// 专家团：数组引用被 runtime 闭包持有，增删改都就地改这个数组（热生效，无需重启）
const EXPERTS_FILE = dataPath("experts.json");
const experts = [];
const expertTeams = []; // 专家团 = 智能体团队，同样是被 runtime 闭包持有的活引用
let expertsMeta = store.readJson(EXPERTS_FILE, {}) || {};
experts.push(...(expertsMeta.experts || []));
expertTeams.push(...(expertsMeta.teams || []));
function saveExperts() {
  store.writeJsonAtomic(EXPERTS_FILE, { ...expertsMeta, experts, teams: expertTeams }, { pretty: true });
}
const mcpManager = new McpManager();
const CLOUDFLARED_DOWNLOADS = {
  "win32-x64": {
    url: "https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-windows-amd64.exe",
    sha256: "f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2",
  },
};
let imBridge = null; // IM 桥（含飞书长连接控制），init() 里创建
let cloudflareTunnel = null;
let cloudflareTunnelBuffer = "";
let cloudflareTunnelGeneration = 0;
let cloudflareTunnelState = { status: "off", url: "", error: "" };
let cloudflareTunnelStarting = false;
let remoteProxyServer = null;
const remoteTasks = new Map();
const remoteTaskClients = new Map();
let remoteRuntime = null;
let remoteProxyPort = null;
let remoteControlToken = "";
let remoteLastSeenAt = 0;
let remoteRequestCount = 0;
let pcRemoteContext = { project: "", session_id: "", updated_at: 0 };
async function ensureRemoteProxy(targetPort) {
  if (!desktopAccess.enabled()) return targetPort;
  if (remoteProxyServer && remoteProxyPort) return remoteProxyPort;
  remoteProxyServer = http.createServer((req, res) => {
    const headers = { ...req.headers, ...desktopAccess.headers(), host: `127.0.0.1:${targetPort}` };
    const upstream = http.request({ hostname: "127.0.0.1", port: targetPort, path: req.url, method: req.method, headers }, response => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("Remote proxy unavailable"); });
    req.pipe(upstream);
  });
  await new Promise((resolve, reject) => {
    remoteProxyServer.once("error", reject);
    remoteProxyServer.listen(0, "127.0.0.1", () => { remoteProxyPort = remoteProxyServer.address().port; resolve(); });
  });
  return remoteProxyPort;
}
function stopRemoteProxy() {
  if (remoteProxyServer) try { remoteProxyServer.close(); } catch {}
  remoteProxyServer = null;
  remoteProxyPort = null;
}

function stopCloudflareTunnel() {
  cloudflareTunnelGeneration += 1;
  cloudflareTunnelStarting = false;
  const tunnel = cloudflareTunnel;
  cloudflareTunnel = null;
  cloudflareTunnelBuffer = "";
  config.remote_control = config.remote_control || {};
  config.remote_control.public_url = "";
  cloudflareTunnelState = { status: "off", url: "", error: "" };
  remoteControlToken = "";
  if (tunnel) try { tunnel.kill("SIGTERM"); } catch {}
}
function cloudflaredExecutable() {
  const platform = process.platform;
  const arch = process.arch;
  const name = platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const candidates = [
    process.env.CLOSECODE_CLOUDFLARED,
    path.join(process.resourcesPath || "", "app.asar.unpacked", "cloudflared", platform + "-" + arch, name),
    path.join(process.resourcesPath || "", "cloudflared", platform + "-" + arch, name),
    appPath("cloudflared", platform + "-" + arch, name),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile() && (platform === "win32" || (fs.statSync(candidate).mode & 0o111))) return candidate;
    } catch {}
  }
  return name;
}
function downloadCloudflared(url, target, expectedHash) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return downloadCloudflared(new URL(response.headers.location, url).href, target, expectedHash).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`下载 cloudflared 失败（HTTP ${response.statusCode}）`)); }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = target + ".download-" + process.pid;
      const out = fs.createWriteStream(temp);
      const hash = createHash("sha256");
      response.on("data", chunk => hash.update(chunk));
      response.pipe(out);
      out.on("finish", () => out.close(() => {
        try {
          const actual = hash.digest("hex");
          if (expectedHash && actual !== expectedHash) throw new Error("cloudflared 下载校验失败");
          fs.renameSync(temp, target);
          if (process.platform !== "win32") fs.chmodSync(target, 0o755);
          resolve(target);
        } catch (e) { try { fs.unlinkSync(temp); } catch {} reject(e); }
      }));
      out.on("error", e => { try { fs.unlinkSync(temp); } catch {} reject(e); });
    });
    request.setTimeout(120000, () => request.destroy(new Error("下载 cloudflared 超时")));
    request.on("error", reject);
  });
}
async function resolveCloudflaredExecutable() {
  const builtIn = cloudflaredExecutable();
  if (builtIn !== (process.platform === "win32" ? "cloudflared.exe" : "cloudflared")) return builtIn;
  const key = process.platform + "-" + process.arch;
  const download = CLOUDFLARED_DOWNLOADS[key];
  if (!download) throw new Error("当前平台没有可用的内置 cloudflared 下载包");
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const target = dataPath("bin", name);
  if (fs.existsSync(target)) {
    const actual = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    if (actual === download.sha256) return target;
    try { fs.unlinkSync(target); } catch {}
  }
  return downloadCloudflared(download.url, target, download.sha256);
}
async function startCloudflareQuickTunnel(port) {
  if (cloudflareTunnel || cloudflareTunnelStarting) return;
  const generation = ++cloudflareTunnelGeneration;
  cloudflareTunnelStarting = true;
  remoteControlToken = randomBytes(32).toString("hex");
  let executable;
  try { executable = await resolveCloudflaredExecutable(); }
  catch (e) {
    cloudflareTunnelStarting = false;
    cloudflareTunnelState = { status: "error", url: "", error: e.message || "cloudflared 获取失败" };
    remoteControlToken = "";
    return;
  }
  if (generation !== cloudflareTunnelGeneration || config.remote_control?.enabled !== true) {
    cloudflareTunnelStarting = false;
    remoteControlToken = "";
    return;
  }
  cloudflareTunnelStarting = false;
  cloudflareTunnelState = { status: "starting", url: "", error: "" };
  config.remote_control = config.remote_control || {};
  config.remote_control.public_url = "";
  let tunnel;
  try {
    tunnel = spawn(executable, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
    cloudflareTunnel = tunnel;
  } catch (e) {
    cloudflareTunnelState = { status: "error", url: "", error: "未找到 cloudflared，请先安装 Cloudflare Tunnel 客户端" };
    return;
  }
  const isCurrent = () => generation === cloudflareTunnelGeneration && cloudflareTunnel === tunnel;
  const fail = (message) => {
    if (!isCurrent()) return;
    cloudflareTunnelState = { status: "error", url: "", error: message };
    cloudflareTunnel = null;
    cloudflareTunnelBuffer = "";
    config.remote_control.public_url = "";
    saveConfig();
  };
  const onData = chunk => {
    if (!isCurrent()) return;
    cloudflareTunnelBuffer += String(chunk);
    const match = cloudflareTunnelBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      const url = match[0].replace(/\/$/, "");
      config.remote_control.public_url = url;
      cloudflareTunnelState = { status: "online", url, error: "" };
      saveConfig();
    }
    if (cloudflareTunnelBuffer.length > 12000) cloudflareTunnelBuffer = cloudflareTunnelBuffer.slice(-6000);
  };
  tunnel.stdout.on("data", onData);
  tunnel.stderr.on("data", onData);
  const startupTimer = setTimeout(() => {
    if (isCurrent() && cloudflareTunnelState.status === "starting") {
      fail("Cloudflare 临时通道启动超时，请检查网络或 cloudflared 安装状态");
      try { tunnel.kill("SIGTERM"); } catch {}
    }
  }, 20000);
  startupTimer.unref?.();
  tunnel.once("error", e => {
    clearTimeout(startupTimer);
    fail(/ENOENT/.test(e.code || "") ? "未找到 cloudflared，请先安装 Cloudflare Tunnel 客户端" : e.message || "cloudflared 启动失败");
  });
  tunnel.once("exit", (code, signal) => {
    clearTimeout(startupTimer);
    if (!isCurrent()) return;
    if (cloudflareTunnelState.status === "online") fail("Cloudflare 临时通道已断开，请重新开启远程控制");
    else fail(`cloudflared 启动失败（code=${code ?? ""}, signal=${signal || ""}）`);
  });
}

// ---------- 会话持久化：内存 + 磁盘（data/sessions/<id>.json） ----------
// 结构：{ history: 统一格式历史(供LLM), transcript: 界面回放记录, title, updated_at }
const SESS_DIR = dataPath("data", "sessions");
const sessions = new Map();
const sessionSaveQueues = new Map();
const deletedSessions = new Set();
const renamingSessions = new Set();
const activeRuns = new Map(); // sessionId -> { ctrl: AbortController, interject: [] }（「停止」与「插队」用）
// 正在跑的任务落一份名单到磁盘：应用中途被关/被重启时，内存里的 activeRuns 直接蒸发，
// 下次启动就靠这份名单知道哪些会话是被打断的，在回放里明说，而不是让那一轮无声地断在半空
const RUNNING_FILE = dataPath("data", "running.json");
function persistRunning() {
  try { store.writeJsonAtomic(RUNNING_FILE, [...activeRuns.keys()]); } catch {}
}
function sweepInterruptedRuns() {
  const ids = store.readJson(RUNNING_FILE, []);
  if (!Array.isArray(ids) || !ids.length) return;
  let marked = 0;
  for (const id of ids) {
    try {
      const sess = getSession(id);
      const last = sess.transcript[sess.transcript.length - 1];
      if (!last || last.type !== "assistant") continue;
      const evs = last.events || (last.events = []);
      const tail = evs[evs.length - 1];
      if (tail && tail.type === "error") continue; // 已有明确收场就别重复盖章

      // 补发中断前的 token 消耗统计：从 transcript 条目的 _usage 字段读取
      // （recordingEmit 在收到 usage 事件时会把累积值写进去，autosave 时已落盘）
      if (last._usage && last._usage.calls > 0) {
        // 检查是否已经有 usage 事件了（正常结束的任务会有），避免重复
        const hasUsage = evs.some((e) => e.type === "usage");
        if (!hasUsage) {
          evs.push({
            type: "usage",
            model: last._usage.model || "",
            provider: last._usage.provider || "",
            prompt: last._usage.prompt || 0,
            completion: last._usage.completion || 0,
            cached: last._usage.cached || 0,
            calls: last._usage.calls || 0,
            elapsed_ms: last._usage.elapsed_ms || 0,
          });
        }
      }

      evs.push({ type: "error", message: "应用在任务执行中被关闭或重启，这一轮已中断（已完成的进度和文件都还在）。可以对我说「接着上次进度继续」。" });
      saveSessionSync(id);
      marked++;
    } catch {}
  }
  try { store.writeJsonAtomic(RUNNING_FILE, []); } catch {}
  if (marked) console.log(`[恢复] 检测到 ${marked} 个被重启打断的任务，已在会话回放里标注中断`);
}
const assignedDirs = new Set(); // 刚分配、还没写出文件的对话文件夹名：两个新对话同时起步不许撞同名

// 运行中的任务已经固定会话项目目录，不再随活动项目切换。
// 修改全局目录配置等管理动作仍保留忙碌保护，避免改变尚未绑定的入口和旧客户端。
function workspaceBusy() {
  return activeRuns.size > 0;
}
function busyPayload() {
  return {
    ok: false,
    busy: true,
    running: activeRuns.size,
    error: `有 ${activeRuns.size} 个任务正在运行，切换工作目录会让它们的文件写错地方。请等任务结束或先停止任务。`,
    workspace_dir: getWorkspaceDir(),
    active: config.active_project,
  };
}

function sessFile(id) {
  return path.join(SESS_DIR, id.replace(/[^\w-]/g, "_") + ".json");
}
function getSession(id) {
  if (!sessions.has(id)) {
    // 会话文件坏了不抛错（不能因为一条对话打不开就让整个工作台起不来），
    // 但也绝不装作没有过这条对话：store 会先拿 .bak 顶上，实在不行把坏文件改名隔离
    const data = store.readJson(sessFile(id), { history: [], transcript: [], title: "", updated_at: null, project: null, project_dir: null });
    sessions.set(id, data);
  }
  return sessions.get(id);
}
function saveSessionSync(id) {
  const s = sessions.get(id);
  if (!s || !s.history) return;
  s.updated_at = new Date().toISOString();
  store.writeJsonAtomic(sessFile(id), s);
}

function saveSession(id) {
  if (deletedSessions.has(id)) return Promise.resolve(false);
  const previous = sessionSaveQueues.get(id) || Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    if (deletedSessions.has(id)) return false;
    const s = sessions.get(id);
    if (!s || !s.history) return false;
    s.updated_at = new Date().toISOString();
    await store.writeJsonAtomicAsync(sessFile(id), s);
    return true;
  });
  const queued = pending.finally(() => {
    if (sessionSaveQueues.get(id) === queued) sessionSaveQueues.delete(id);
  });
  sessionSaveQueues.set(id, queued);
  return queued;
}

// 任务跑一半崩了 / 用户直接退出 App，这一轮的过程就全没了——中途也存，最多每 5 秒一次。
// 每个会话串行保存，序列化与磁盘 I/O 交给 worker，避免堵住桌面主线程。
const sessSaveAt = new Map();
function autosaveSession(id, minGapMs = 5000) {
  const now = Date.now();
  if (now - (sessSaveAt.get(id) || 0) < minGapMs) return;
  sessSaveAt.set(id, now);
  void saveSession(id).catch((e) => console.warn(`[会话] 中途存盘失败（${id}）：${e.message}`));
}

// IM 会话跟网页会话分开存（data/im-sessions/<键>.json），重启不丢上下文
// IM 模块暂时禁用：给个空壳顶位，下面 /im/* 路由和状态查询都还在引用它。
// 空壳的方法全是 no-op，被误调也不会崩——真要恢复 IM，把 require 的注释去掉即可
const imSessions = { get: () => null, save: () => {}, clear: () => {}, list: () => [] };
// const imSessions = createImSessionStore({ dir: dataPath("data", "im-sessions") });

/** 包装 emit：把事件同时记录到 transcript（文本增量合并，跳过噪音事件），顺便中途存盘 */
// ---------- Goal 目标模式 ----------
// 用户给一个目标，先拆成可验收的标准，跑完一轮就对着标准验收，没达标自动再跑（最多 GOAL_MAX_ROUNDS 轮）。
// 验收宁严勿宽：拿不准一律算未达成——目标卡上打了勾就必须是真的
const GOAL_MAX_ROUNDS = 3;

async function goalFileInventory(sess) {
  try {
    if (!sess.project_dir) return "（对话未绑定项目目录，无法验收成果）";
    if (sess.dir) safePath(sess.dir, sess.project_dir);
    const dir = safePath(".", sess.project_dir);
    const { isTaskArtifactPath } = require("./lib/workspace-scope");
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const names = entries.filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== sess.dir && !isTaskArtifactPath(e.name + "/")).slice(0, 40);
    if (!names.length) return "（成果文件夹是空的）";
    return (await Promise.all(names.map(async (entry) => {
      try { const st = await fs.promises.stat(safePath(entry.name, sess.project_dir)); return `${entry.name}（${st.isDirectory() ? "目录" : st.size + " 字节"}）`; }
      catch { return entry.name; }
    }))).join("\n");
  } catch { return "（读取成果文件夹失败）"; }
}

async function readGoalFilePrefix(file, maxBytes) {
  const handle = await fs.promises.open(file, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return { text: buffer.toString("utf8", 0, offset), size: stat.size, truncated: stat.size > maxBytes };
  } finally {
    await handle.close();
  }
}

/** 摘录最近改动的成果文件开头给验收员，最多 5 个；单文件读取量有上限。 */
async function goalFileSnippets(sess) {
  try {
    const files = await recentGoalFiles(sess);
    return (await Promise.all(files.map(async (f) => {
      let head = "";
      try { head = (await readGoalFilePrefix(f.p, 4096)).text; } catch { head = "（读取失败）"; }
      return `--- ${f.n}（共 ${f.size} 字节，以下是开头）---\n${head}`;
    }))).join("\n\n");
  } catch { return ""; }
}

/** Only inspect project files recorded as changed by this conversation. */
async function recentGoalFiles(sess) {
  try {
    if (!sess.project_dir) return [];
    if (sess.dir) safePath(sess.dir, sess.project_dir);
    const { isTaskArtifactPath } = require("./lib/workspace-scope");
    const TEXT_EXT = /\.(html?|js|mjs|css|md|txt|json|py|ts|jsx|tsx|csv|svg)$/i;
    const changed = new Set((sess.transcript || []).flatMap(entry => (entry.events || [])
      .filter(event => event.type === "files" && Array.isArray(event.changed)).flatMap(event => event.changed)));
    const files = await Promise.all([...changed]
      .filter(n => typeof n === "string" && TEXT_EXT.test(n) && !isTaskArtifactPath(n) && !(sess.dir && n.startsWith(sess.dir + "/")))
      .map(async n => {
        try { const p = safePath(n, sess.project_dir); const st = await fs.promises.stat(p); return st.isFile() ? { n, p, mtime: st.mtimeMs, size: st.size } : null; }
        catch { return null; }
      }));
    return files.filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, 5);
  } catch { return []; }
}

/** 验收员的「动手」环节：对成果文件做机器实测——JS 语法（node --check）、JSON 能否解析、
 *  HTML 是否写完整（截断/标签不配对）。只做只读检查，绝不执行成果代码。
 *  桌面版里 process.execPath 是 Electron 二进制，必须 ELECTRON_RUN_AS_NODE 才是纯 node */
async function goalFileChecks(sess) {
  const { execFile } = require("child_process");
  const checkOne = async (f) => {
    if (/\.(js|mjs|cjs)$/i.test(f.n)) {
      return new Promise((resolve) => {
        execFile(process.execPath, ["--check", f.p], { timeout: 8000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }, (err, _o, stderr) => {
          resolve(err ? `✗ ${f.n} JS 语法检查未通过：${String(stderr || err.message).slice(0, 200)}` : `✓ ${f.n} JS 语法检查通过`);
        });
      });
    } else if (/\.json$/i.test(f.n)) {
      try {
        const file = await readGoalFilePrefix(f.p, 1024 * 1024);
        if (file.truncated) return `⚠ ${f.n} 超过 1 MB，未自动校验 JSON`;
        JSON.parse(file.text);
        return `✓ ${f.n} JSON 格式合法`;
      } catch (e) { return `✗ ${f.n} JSON 解析失败：${String(e.message).slice(0, 120)}`; }
    } else if (/\.html?$/i.test(f.n)) {
      try {
        const file = await readGoalFilePrefix(f.p, 1024 * 1024);
        if (file.truncated) return `⚠ ${f.n} 超过 1 MB，未自动校验 HTML`;
        const t = file.text;
        const probs = [];
        if (/<html[\s>]/i.test(t) && !/<\/html>/i.test(t)) probs.push("有 <html> 没有 </html>，疑似写到一半被截断");
        const so = (t.match(/<script[\s>]/gi) || []).length, sc = (t.match(/<\/script>/gi) || []).length;
        if (so !== sc) probs.push(`<script> 开闭不配对（${so} 开 ${sc} 闭）`);
        return probs.length ? `✗ ${f.n} 结构异常：${probs.join("；")}` : `✓ ${f.n} HTML 结构完整（html/script 标签配对）`;
      } catch { return null; }
    }
    return null;
  };
  try { return (await Promise.all((await recentGoalFiles(sess)).map(checkOne))).filter(Boolean).join("\n"); }
  catch { return ""; }
}

function parseJsonLoose(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** 把目标拆成 3~6 条可验收标准。失败就用目标原文当唯一标准，绝不让任务卡在拆解上 */
async function deriveGoalCriteria(sessLLM, goalText, total) {
  try {
    const r = await sessLLM.chat({
      system: '你是验收标准拆解器。把用户的目标拆成 3~6 条具体、可客观核验的验收标准（每条都能对着成果文件/事实判真假，不写"尽量""良好"这种没法验收的词）。只输出 JSON：{"criteria":["标准1","标准2"]}，不要其它任何文字。',
      history: [{ role: "user", content: String(goalText).slice(0, 2000) }],
      tools: [],
      signal: AbortSignal.timeout(30000),
    });
    if (r.usage) { total.prompt += r.usage.prompt; total.completion += r.usage.completion; total.calls++; }
    const j = parseJsonLoose(r.text);
    const list = (j && Array.isArray(j.criteria) ? j.criteria : []).map((c) => String(c).trim()).filter(Boolean).slice(0, 6);
    if (list.length) return list;
  } catch {}
  return [String(goalText).slice(0, 200)];
}

/** 对着验收标准验一轮。只认成果文件清单和收尾汇报，拿不准算 false；验收调用挂了就全部保持原状 */
async function verifyGoal(sess, sessLLM, finalText, total) {
  const goal = sess.goal;
  const undone = goal.criteria.map((c, i) => ({ i, c })).filter((x) => !x.c.done);
  if (!undone.length) return;
  const [inventory, snippets, checks] = await Promise.all([
    goalFileInventory(sess), goalFileSnippets(sess), goalFileChecks(sess),
  ]);
  try {
    const r = await sessLLM.chat({
      system: '你是验收员。根据成果文件清单和执行汇报，逐条判断验收标准是否已达成。证据不足一律 false，宁可漏判不可错判。【自动体检】是机器实测结果（不是模型自述）：标 ✗ 的文件说明有语法错误或没写完整，涉及它的标准一律 false。只输出 JSON：{"results":[{"i":0,"done":true},{"i":1,"done":false}]}，i 是标准编号。',
      history: [{ role: "user", content:
        `【目标】${goal.text}\n\n【待验收标准】\n${undone.map((x) => `${x.i}. ${x.c.text}`).join("\n")}\n\n【成果文件清单】\n${inventory}\n\n` +
        (snippets ? `【成果文件内容摘录】\n${snippets}\n\n` : "") +
        (checks ? `【自动体检（机器实测）】\n${checks}\n\n` : "") +
        `【执行汇报】\n${String(finalText || "（无）").slice(0, 3000)}` }],
      tools: [],
      signal: AbortSignal.timeout(45000),
    });
    if (r.usage) { total.prompt += r.usage.prompt; total.completion += r.usage.completion; total.calls++; }
    const j = parseJsonLoose(r.text);
    for (const it of (j && Array.isArray(j.results) ? j.results : [])) {
      const c = goal.criteria[it.i];
      if (c && it.done === true) c.done = true;
    }
  } catch {}
  if (goal.criteria.every((c) => c.done)) goal.status = "done";
}

/**
 * 把任务事件翻译成桌面宠物的表情。只认深度 0 的事件——专家子代理的动静太密，
 * 宠物跟着抽风反而看不出主线在干什么。纯 node 模式下 global.__wbPet 不存在，整个是空操作。
 */
function petSay(ev, taskId = null) {
  const pet = global.__wbPet;
  // 运行中错误/上限仍可能进入收尾或重试，不提前显示完成/出错并触发 idle 定时器。
  const P = pet && {
    setState: (name, text) => pet.setState(activeRuns.size && (name === "error" || name === "done") ? "working" : name, text, { tokens: null, taskId }),
    alertAsk: (question) => pet.alertAsk(question),
    clearAsk: (working) => pet.clearAsk(working),
  };
  if (!P) return;
  try {
    switch (ev.type) {
      case "ask_user": P.alertAsk(ev.question); break;             // 跳 + 通知 + Dock 弹，最高一档
      case "ask_answer": P.clearAsk(true); break;
      case "tool_use": P.setState("working", "正在用 " + (ev.name || "工具")); break;
      case "expert_start": P.setState("working", `${ev.expert || "专家"} 接手了：${String(ev.task || "").slice(0, 40)}`); break;
      case "sleep": P.setState("sleep", ev.note); break;
      case "failover": P.setState("working", ev.note); break;
      case "limit": P.setState("error", ev.note); break;
      case "error": P.setState("error", String(ev.message || "任务出错了").slice(0, 80)); break;
      default: break;
    }
  } catch {}
}

// agent 的 stats 被整个专家树共享；只读取最终 total，不再累计 usage 事件或 expert_done。
// cached 已包含在 prompt 内。calls=0 表示没有服务商 usage，必须显示 null。
function petFinish(total, runState, runFailed) {
  const pet = global.__wbPet;
  if (!pet) return;
  const remaining = activeRuns.values().next().value;
  if (remaining) {
    pet.setState("working", "其他任务仍在进行", { tokens: null, taskId: remaining.requestId || null });
    return;
  }
  const sum = total.prompt + total.completion;
  const tokens = total.calls > 0 && Number.isSafeInteger(sum) && sum >= 0 ? sum : null;
  const stopped = runState.ctrl.signal.aborted || runState.stopped;
  pet.setState(runFailed ? "error" : stopped ? "idle" : "done",
    runFailed ? String(runFailed).slice(0, 80) : stopped ? "任务已停止或尚未完成" : "任务完成",
    { tokens, taskId: runState.requestId || null });
}

function recordingEmit(send, events, sessionId, transcriptEntry) {
  return (ev) => {
    send(ev);
    if (!(ev.depth > 0)) petSay(ev, activeRuns.get(sessionId)?.requestId || sessionId);
    if (ev.type === "text") {
      if (ev.depth > 0) return;
      const last = events[events.length - 1];
      if (last && last.type === "text") last.delta += ev.delta;
      else events.push({ type: "text", delta: ev.delta });
    } else if (ev.type === "text_reset") {
      // 断流重试撤稿：把已录的那半段从录像里剪掉，历史回放才不会留着一段病句 + 重复。
      // 剪录像而不是存一条 text_reset 事件，回放端就完全不用懂这件事；续流的 textOffset
      // 也跟着自动对上（录像就是唯一事实来源）。跨事件回退：半段可能横跨多条已合并的 text
      if (ev.depth > 0) return;
      let left = Math.max(0, Number(ev.chars) || 0);
      while (left > 0 && events.length) {
        const last = events[events.length - 1];
        if (!last || last.type !== "text") break; // 只回退连续的正文尾巴，不越过工具卡
        if (last.delta.length > left) { last.delta = last.delta.slice(0, last.delta.length - left); left = 0; }
        else { left -= last.delta.length; events.pop(); }
      }
    } else if (ev.type === "files") {
      // 产出卡片得能活过一次重开：历史回放全靠这条事件重建。以前它不在存盘清单里，
      // 于是任务当场看得见成果卡，退出再进来那片卡就凭空消失了。
      // 但整份清单最多 500 条、每批工具跑完就来一次，原样存会把会话文件撑爆——
      // 只留这一批真正变更的那几条（回放时 renderFiles 被 isReplaying 挡住，用不到全量）
      const chg = ev.changed || [];
      if (chg.length) events.push({ type: "files", changed: chg, files: (ev.files || []).filter((f) => chg.includes(f.name)) });
    } else if (ev.type === "usage") {
      // usage 事件既要进 events 数组供前端显示，也要写入 transcript 条目的 _usage 字段，供历史统计与崩溃恢复使用
      events.push(ev);
      if (transcriptEntry) {
        if (!transcriptEntry._usage) transcriptEntry._usage = { ...ev };
        else {
          transcriptEntry._usage.prompt += ev.prompt || 0;
          transcriptEntry._usage.completion += ev.completion || 0;
          transcriptEntry._usage.cached = (transcriptEntry._usage.cached || 0) + (ev.cached || 0);
          transcriptEntry._usage.calls += ev.calls || 0;
          transcriptEntry._usage.elapsed_ms += ev.elapsed_ms || 0;
        }
      }
    } else if (["tool_use", "tool_result", "parallel", "delegation", "team_start", "team_progress", "team_done", "expert_skills", "expert_start", "expert_done", "git_status", "error", "limit", "auto_continue", "failover", "sleep", "trim", "compact", "interject", "sources", "ask_user", "ask_answer", "milestones"].includes(ev.type)) {
      events.push(ev);
      // 一步走完就是个存盘点：跑了半小时的任务不该因为一次崩溃从头再来
      if (sessionId && (ev.type === "tool_result" || ev.type === "git_status")) autosaveSession(sessionId);
    }
  };
}

const app = express();
app.use(desktopAccess.middleware);
app.use(express.json({ limit: "60mb" }));
// 首页重定向到加载动画页
app.get("/", (_req, res) => res.redirect("/loading.html"));

// 热补丁里的前端资源要盖住包内同名文件。
// ⚠️ 这一行必须排在下面那个 express.static 前面：express.static 是「先命中先返回」，
// 顺序反过来补丁就永远轮不到。appPath() 的补丁感知只对精确文件路径生效，
// 而这里挂的是整个目录，所以必须单独再挂一层。
try {
  const patchPublic = require("./patch-loader").patchPublicDir();
  if (patchPublic) {
    console.log(`[补丁] 前端资源覆盖已挂载: ${patchPublic}`);
    app.use(express.static(patchPublic));
  }
} catch {}

app.use(express.static(appPath("public")));

// 静态文件 URL 把项目写入路径，子资源也继承归属；不再跟随全局活动项目。
function projectStatic(dir) {
  const serve = express.static(dir, { extensions: ["html"] });
  return (req, res, next) => {
    try {
      const target = safePath(decodeURIComponent(req.path).replace(/^\/+/, ""), dir);
      // express.static 还会补 index.html / .html；这些实际读取目标也必须过真实路径边界。
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) safePath(path.join(target, "index.html"), dir);
      else if (!path.extname(target)) safePath(target + ".html", dir);
      serve(req, res, next);
    } catch (e) { res.status(400).json({ error: e.message }); }
  };
}
const staticByDir = new Map();
app.use("/workspace-project/:project", (req, res, next) => {
  try {
    const dir = fileWorkspace({ query: { project: req.params.project } });
    let handler = staticByDir.get(dir);
    if (!handler) { handler = projectStatic(dir); staticByDir.set(dir, handler); }
    handler(req, res, next);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// 旧链接必须显式带项目，再跳转到固定 URL，避免切项目后同名文件变成另一份。
app.use("/workspace", (req, res) => {
  try {
    if (!req.query.project) throw new Error("文件链接缺少项目归属，请从对应项目的成果面板打开。");
    fileWorkspace(req);
    const query = new URLSearchParams(req.query); query.delete("project");
    res.redirect(307, "/workspace-project/" + encodeURIComponent(req.query.project) + req.path + (query.size ? "?" + query.toString() : ""));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
let runtime; // MCP 启动后创建

app.get("/api/info", (_req, res) => {
  // 版本号必须用 effectiveVersion()，否则打了补丁后界面仍显示 package.json 的基础版本
  const patchLoader = require("./patch-loader");
  res.json({
    version: patchLoader.effectiveVersion(),
    provider: llm.provider,
    model: llm.model,
    skills: runtime ? runtime.getSkills().map((s) => s.name) : [],
    experts: experts.map((e) => e.name),
    mcp_tools: mcpManager.toolDefs().length,
    agent_plugins_spec: require("./plugins").SPEC_VERSION,
  });
});

// An explicit, invalid project must fail closed, never fall back to the active one.
function fileWorkspace(req) {
  const name = req.query?.project ?? req.body?.project;
  if (name == null) return getWorkspaceDir(); // legacy unscoped clients
  ensureProjects();
  const project = config.projects.find(p => p.name === name);
  if (!project?.dir) throw new Error("指定项目不存在，未访问其他项目文件。");
  return project.dir;
}
app.get("/api/files", async (req, res) => {
  try { res.json(await outputFiles(fileWorkspace(req))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// 助理身份：界面一进来就要拿它画头像，所以单开一个轻接口，不用为了个名字去拉整份设置
app.get("/api/assistant", (_req, res) => res.json(config.assistant));

// ---------- 应用内设置（模型 + IM），保存到 config.json 并热生效 ----------
app.get("/api/settings", (req, res) => {
  // 过滤掉被禁用供应商的模型
  const disabledProviders = config.disabled_providers || [];
  const providerNames = { gpt: 'GPT', claude: 'Claude', grok: 'Grok', gemini: 'Gemini', custom: '国模' };
  const disabledPrefixes = disabledProviders.map(p => `${providerNames[p]} - `);
  const filteredModels = (config.models || []).filter(m => {
    const modelName = String(m.name || '');
    return !disabledPrefixes.some(prefix => modelName.startsWith(prefix));
  });

  res.json({
    workspace_dir: getWorkspaceDir(),
    models: filteredModels,
    active_model: config.active_model,
    // 当前真正会被请求的 base_url。必须跟 llm.js/createLLM 的挑选逻辑一致：
    // 它是从 config.models 里按 active_model 找条目（找不到就取第一条），
    // 而不是看 active_provider——这两者可以不一致，看错了会把「是不是 DoCode 平台」判反。
    active_base_url: activeBaseUrl(),
    model_health: healthSummary(),
    model_follow_last: !!config.model_follow_last,
    last_picked_model: config.last_picked_model || "",
    assist_model: config.assist_model || "",
    theme: config.theme || "dark",
    skin: config.skin || "default",
    active_provider: config.active_provider || "gpt",
    disabled_providers: disabledProviders,
    gpt_api_key: config.gpt_api_key || "",
    claude_api_key: config.claude_api_key || "",
    grok_api_key: config.grok_api_key || "",
    gemini_api_key: config.gemini_api_key || "",
    custom_api_key: config.custom_api_key || "",
    available_gpt_models: config.available_gpt_models || [],
    available_claude_models: config.available_claude_models || [],
    available_grok_models: config.available_grok_models || [],
    available_gemini_models: config.available_gemini_models || [],
    available_custom_models: config.available_custom_models || [],
    gpt_model: config.gpt_model || "",
    claude_model: config.claude_model || "",
    grok_model: config.grok_model || "",
    gemini_model: config.gemini_model || "",
    custom_model: config.custom_model || "",
    gpt_base_url: config.gpt_base_url || "",
    claude_base_url: config.claude_base_url || "",
    grok_base_url: config.grok_base_url || "",
    gemini_base_url: config.gemini_base_url || "",
    custom_base_url: config.custom_base_url || "https://docode.cc/v1",
    agent: {
      max_steps: config.agent.max_steps,
      auto_delegate: config.agent.auto_delegate !== false,
      git_auto_sync: config.agent.git_auto_sync !== false,
      tool_timeout_ms: config.agent.tool_timeout_ms,
      max_runtime_ms: config.agent.max_runtime_ms || 1800000,
      auto_continue_rounds: config.agent.auto_continue_rounds || 0,
      llm_timeout_ms: config.agent.llm_timeout_ms || 300000,
      llm_retry_count: config.agent.llm_retry_count || 5,
      // 所有用户都使用配置值，不再限制
      max_context_chars: config.agent.max_context_chars || 8000000,
      max_tokens_budget: config.agent.max_tokens_budget || 0,
      failover_model: config.agent.failover_model || "",
    },
    remote_control: {
      enabled: config.remote_control?.enabled === true,
      public_url: String(config.remote_control?.public_url || "").trim(),
    },
    pet: {
      enabled: (config.pet || {}).enabled === true, // 默认没有宠物：得用户在对话里开口要，或来这儿手动打开
      character: (config.pet || {}).character === undefined ? "yaya3d" : ["cat", "spider", "judy", "fox", "muyu", "yaya", "yaya3d", "photo"].includes(config.pet.character) ? config.pet.character : "cat",
      scale: (config.pet || {}).scale || 1,
      opacity: (config.pet || {}).opacity || 1,
      notify: (config.pet || {}).notify !== false,
      voice_assets: require('./lib/pet-yaya-voice-status')(),
      voice_enabled: (config.pet || {}).voice_enabled === true,
      voice_volume: Number.isFinite((config.pet || {}).voice_volume) ? Math.max(0, Math.min(1, config.pet.voice_volume)) : .7,
      has_photo: !!petPhotoPath(),
      available: !!global.__wbPet, // 纯 node 模式没有桌面窗口，前端要如实说明
    },
    persona: config.persona || "",
    assistant: config.assistant,
    wallpaper: config.wallpaper || "",
    wallpaperOpacity: config.wallpaperOpacity ?? 0.85,
    glassEffect: config.glassEffect === true,
    search: {
      provider: (config.search || {}).provider || "jina",
      jina_key: (config.search || {}).jina_key || (config.search || {}).api_key || "",
      tavily_key: (config.search || {}).tavily_key || "",
      brave_key: (config.search || {}).brave_key || "",
    },
    im: {
      feishu: (config.im || {}).feishu || { app_id: "", app_secret: "", verification_token: "" },
      qq: (config.im || {}).qq || { app_id: "", app_secret: "" },
      wecom_app: (config.im || {}).wecom_app || { corp_id: "", agent_id: "", secret: "", token: "", aes_key: "" },
      wechat_mp: (config.im || {}).wechat_mp || { app_id: "", app_secret: "", token: "", aes_key: "" },
      // iLink 的 bot_token 是扫码换来的长期凭证，不回给前端（前端只需要知道连没连上，状态走 /im/status）
      wechat_ilink: { bot_id: ((config.im || {}).wechat_ilink || {}).ilink_bot_id || "" },
      wecom_bot_webhook: (config.im || {}).wecom_bot_webhook || "",
      dingtalk_webhook: (config.im || {}).dingtalk_webhook || "",
      dingtalk_secret: (config.im || {}).dingtalk_secret || "",
      webhook_secret: (config.im || {}).webhook_secret || "",
      session_idle_hours: +(config.im || {}).session_idle_hours || 0,
    },
    media: {
      image: { base_url: "https://docode.cc/v1", api_key: "", model: "", models: [], ...((config.media || {}).image || {}) },
      video: { base_url: "", api_key: "", model: "", ...((config.media || {}).video || {}) },
      tts: { base_url: "", api_key: "", model: "", voice: "", ...((config.media || {}).tts || {}) },
      vision: { base_url: "", api_key: "", model: "", models: [], ...((config.media || {}).vision || {}) },
    },
    security: config.security,
    shortcuts: config.shortcuts,
    context_config: config.context_config || {
      gpt: { size: '1m', threshold: 60 },
      claude: { size: '1m', threshold: 60 },
      gemini: { size: '1m', threshold: 60 },
      grok: { size: '256k', threshold: 60 },
      custom: { size: '1m', threshold: 60 }
    },
  });
});

app.post("/api/settings", async (req, res) => {
  try {
    const b = req.body || {};
    if (b.glassEffect !== undefined && typeof b.glassEffect !== "boolean") throw new Error("glassEffect 必须为布尔值");
    if (b.agent?.git_auto_sync !== undefined && typeof b.agent.git_auto_sync !== "boolean") throw new Error("git_auto_sync 必须为布尔值");
    if (Array.isArray(b.models)) {
      for (const m of b.models) {
        if (!m.name || !m.model) throw new Error("每个模型需要 name 和 model 字段");
        m.provider = m.provider === "anthropic" ? "anthropic" : "openai";
      }
      config.models = b.models;
    }
    if (b.active_model !== undefined) {
      if (!config.models.some((m) => m.name === b.active_model)) throw new Error("active_model 不在模型列表中");
      config.active_model = b.active_model;

      // 如果当前有激活的项目，同时保存到项目配置中
      const currentProject = config.projects?.find((p) => p.name === config.active_project);
      if (currentProject) {
        currentProject.active_model = b.active_model;
      }
    }
    if (typeof b.model_follow_last === "boolean") config.model_follow_last = b.model_follow_last;
    if (b.agent) {
      if (b.agent.max_steps) config.agent.max_steps = Math.max(1, Math.min(200, +b.agent.max_steps));
      if (b.agent.tool_timeout_ms) config.agent.tool_timeout_ms = Math.max(5000, +b.agent.tool_timeout_ms);
      if (b.agent.max_runtime_ms) config.agent.max_runtime_ms = Math.max(60000, +b.agent.max_runtime_ms);
      if (b.agent.auto_delegate !== undefined) config.agent.auto_delegate = b.agent.auto_delegate !== false;
      if (b.agent.git_auto_sync !== undefined) config.agent.git_auto_sync = b.agent.git_auto_sync !== false;
      if (b.agent.auto_continue_rounds !== undefined) config.agent.auto_continue_rounds = Math.max(0, Math.min(20, Math.round(+b.agent.auto_continue_rounds) || 0));
      if (b.agent.llm_timeout_ms) config.agent.llm_timeout_ms = Math.max(30000, +b.agent.llm_timeout_ms);
      if (b.agent.llm_retry_count !== undefined) config.agent.llm_retry_count = Math.max(1, Math.min(10, Math.round(+b.agent.llm_retry_count) || 5));
      // 下限 2 万字符：再小连最近几步的工具原文都留不住，agent 会失忆式反复重做
      // 上限 800 万字符（≈ 2M tokens 英文口径），与 agent.js 的 DEFAULT_MAX_CONTEXT_CHARS 一致
      if (b.agent.max_context_chars) config.agent.max_context_chars = Math.max(20000, Math.min(8000000, +b.agent.max_context_chars));
      if (b.agent.max_tokens_budget !== undefined) config.agent.max_tokens_budget = Math.max(0, Math.round(+b.agent.max_tokens_budget) || 0);
      if (b.agent.failover_model !== undefined) {
        const fm = String(b.agent.failover_model || "").trim();
        if (fm && !config.models.some((m) => m.name === fm)) throw new Error("备用渠道不在模型列表中");
        config.agent.failover_model = fm; // 空串 = 关闭自动换道（默认）
      }
    }
    if (b.remote_control) {
      config.remote_control = config.remote_control || {};
      if (typeof b.remote_control.enabled === "boolean") config.remote_control.enabled = b.remote_control.enabled;
      // Quick Tunnel 地址由 cloudflared 返回，客户端不能伪造或手动写入。
      if (config.remote_control.enabled !== true) {
        stopCloudflareTunnel();
        stopRemoteProxy();
        config.remote_control.public_url = "";
      }
    }
    if (b.pet) {
      config.pet = config.pet || {};
      if (config.pet.character === undefined) config.pet.character = "yaya3d";
      if (typeof b.pet.enabled === "boolean") config.pet.enabled = b.pet.enabled;
      if (typeof b.pet.notify === "boolean") config.pet.notify = b.pet.notify;
      if (typeof b.pet.voice_enabled === "boolean") config.pet.voice_enabled = b.pet.voice_enabled;
      if (b.pet.voice_volume !== undefined) config.pet.voice_volume = Math.max(0, Math.min(1, Number(b.pet.voice_volume) || 0));
      if (b.pet.character !== undefined) config.pet.character = ["cat", "spider", "judy", "fox", "muyu", "yaya", "yaya3d", "photo"].includes(b.pet.character) ? b.pet.character : "cat";
      if (b.pet.scale !== undefined) config.pet.scale = Math.max(0.6, Math.min(2, Number(b.pet.scale) || 1));
      if (b.pet.opacity !== undefined) config.pet.opacity = Math.max(0.25, Math.min(1, Number(b.pet.opacity) || 1));
      if (global.__wbPet) try { global.__wbPet.applyConfig({ ...config.pet, enabled: config.pet.enabled === true }); } catch {}
    }
    if (b.persona !== undefined) config.persona = String(b.persona).slice(0, 4000);
    if (b.theme !== undefined) config.theme = String(b.theme);
    if (b.skin !== undefined) config.skin = String(b.skin);
    if (typeof b.glassEffect === "boolean") config.glassEffect = b.glassEffect;
    // 壁纸蒙版透明度：跟前端滑块同一个区间，越界值夹回来而不是拒收
    if (b.wallpaperOpacity !== undefined) {
      config.wallpaperOpacity = Math.max(0.7, Math.min(0.95, Number(b.wallpaperOpacity) || 0.85));
    }
    if (b.wallpaper !== undefined) {
      const wallpaper = String(b.wallpaper);
      console.log('[壁纸] 接收到壁纸数据，长度:', wallpaper.length);

      // 预设壁纸：以 /assets/wallpapers/ 开头，直接存 URL，不转存
      if (wallpaper && wallpaper.startsWith('/assets/wallpapers/')) {
        console.log('[壁纸] 使用预设壁纸:', wallpaper);
        // 删除旧的上传壁纸文件（预设的不删）
        if (config.wallpaper && config.wallpaper.startsWith('/api/wallpaper/')) {
          const oldFile = config.wallpaper.replace('/api/wallpaper/', '');
          const oldPath = dataPath('wallpapers', oldFile);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
            console.log('[壁纸] 删除旧上传壁纸:', oldPath);
          }
        }
        config.wallpaper = wallpaper;
      }
      // 用户上传：data:image/ 开头，转存到 data/wallpapers/
      else if (wallpaper && wallpaper.startsWith('data:image/')) {
        // 保存 base64 图片到本地文件
        try {
          const base64Data = wallpaper.split(',')[1];
          const ext = wallpaper.match(/data:image\/(\w+);/)?.[1] || 'png';
          const filename = `wallpaper-${Date.now()}.${ext}`;
          const filepath = dataPath('wallpapers', filename);
          console.log('[壁纸] 保存路径:', filepath);
          fs.mkdirSync(path.dirname(filepath), { recursive: true });
          fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
          console.log('[壁纸] 保存成功');
          // 删除旧壁纸文件
          if (config.wallpaper && config.wallpaper.startsWith('/api/wallpaper/')) {
            const oldFile = config.wallpaper.replace('/api/wallpaper/', '');
            const oldPath = dataPath('wallpapers', oldFile);
            if (fs.existsSync(oldPath)) {
              fs.unlinkSync(oldPath);
              console.log('[壁纸] 删除旧壁纸:', oldPath);
            }
          }
          config.wallpaper = `/api/wallpaper/${filename}`;
          console.log('[壁纸] 配置已更新:', config.wallpaper);
        } catch (err) {
          console.error('[壁纸] 保存失败:', err);
          config.wallpaper = '';
        }
      }
      // 清除壁纸
      else if (wallpaper === '') {
        console.log('[壁纸] 删除壁纸请求');
        if (config.wallpaper && config.wallpaper.startsWith('/api/wallpaper/')) {
          const oldFile = config.wallpaper.replace('/api/wallpaper/', '');
          const oldPath = dataPath('wallpapers', oldFile);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
            console.log('[壁纸] 已删除:', oldPath);
          }
        }
        config.wallpaper = '';
      }
    }
    if (b.active_provider !== undefined) config.active_provider = String(b.active_provider);
    if (Array.isArray(b.disabled_providers)) {
      config.disabled_providers = b.disabled_providers.filter(p => ["gpt", "claude", "grok", "gemini", "custom"].includes(p));
    }
    if (b.active_provider !== undefined) {
      const provider = String(b.active_provider);
      if (!["gpt", "claude", "grok", "gemini", "custom"].includes(provider)) throw new Error("active_provider 只能用于普通对话模型");
      config.active_provider = provider;
    }
    for (const p of ["gpt", "claude", "grok", "gemini", "custom"]) {
      if (b[`${p}_api_key`] !== undefined) {
        config[`${p}_api_key`] = String(b[`${p}_api_key`]).trim();
      }
      if (b[`${p}_model`] !== undefined) config[`${p}_model`] = String(b[`${p}_model`]).trim();
      if (b[`${p}_base_url`] !== undefined) config[`${p}_base_url`] = String(b[`${p}_base_url`]).trim();
      if (Array.isArray(b[`available_${p}_models`])) {
        config[`available_${p}_models`] = b[`available_${p}_models`].map((x) => String(x)).filter(Boolean);
      }
    }
    if (b.assistant) {
      if (b.assistant.name !== undefined) {
        const n = String(b.assistant.name).replace(/\s+/g, " ").trim();
        if (n.length > 24) throw new Error("助理名字最多 24 个字");
        config.assistant.name = n || ASSISTANT_DEFAULT.name; // 清空就退回默认，别让它变成没名字的空气
      }
      // 头像的校验规则和用户头像完全一样（emoji 或 ≤256KB 的 data URI），共用一处免得两边规则跑偏
      if (b.assistant.avatar !== undefined) config.assistant.avatar = normalizeAssistantAvatar(b.assistant.avatar) || ASSISTANT_DEFAULT.avatar;
    }
    if (b.search) {
      config.search = config.search || {};
      if (b.search.provider !== undefined) {
        if (!["jina", "tavily", "brave"].includes(b.search.provider)) throw new Error("搜索 provider 仅支持 jina / tavily / brave");
        config.search.provider = b.search.provider;
      }
      for (const k of ["jina_key", "tavily_key", "brave_key"]) {
        if (b.search[k] !== undefined) config.search[k] = String(b.search[k]).trim();
      }
    }
    let wsSkipped = null; // 有任务在跑时工作目录不动，但其余设置照存，最后在响应里说明
    if (b.workspace_dir !== undefined && b.workspace_dir !== getWorkspaceDir()) {
      // Fix C 完成后：修改工作目录只影响新任务的默认目录，不影响正在运行的任务
      config.workspace_dir = setWorkspaceDir(b.workspace_dir);
      // 输入框旁的快速切换是临时的（新任务会切回项目目录）；设置中心改路径才算改默认，同步进当前项目
      if (b.workspace_permanent === true) {
        ensureProjects();
        const ap = config.projects.find((p) => p.name === config.active_project);
        if (ap) ap.dir = config.workspace_dir;
      }
    }
    config.im = config.im || {};
    if (b.im) {
      if (b.im.feishu) Object.assign((config.im.feishu = config.im.feishu || {}), pick(b.im.feishu, ["app_id", "app_secret", "verification_token", "doc_app_id", "doc_app_secret"]));
      if (b.im.qq) Object.assign((config.im.qq = config.im.qq || {}), pick(b.im.qq, ["app_id", "app_secret"]));
      if (b.im.wecom_app) Object.assign((config.im.wecom_app = config.im.wecom_app || {}), pick(b.im.wecom_app, ["corp_id", "agent_id", "secret", "token", "aes_key"]));
      if (b.im.wechat_mp) Object.assign((config.im.wechat_mp = config.im.wechat_mp || {}), pick(b.im.wechat_mp, ["app_id", "app_secret", "token", "aes_key"]));
      if (b.im.wecom_bot_webhook !== undefined) config.im.wecom_bot_webhook = b.im.wecom_bot_webhook;
      if (b.im.dingtalk_webhook !== undefined) config.im.dingtalk_webhook = String(b.im.dingtalk_webhook).trim();
      if (b.im.dingtalk_secret !== undefined) config.im.dingtalk_secret = String(b.im.dingtalk_secret).trim();
      if (b.im.webhook_secret !== undefined) config.im.webhook_secret = b.im.webhook_secret;
      if (b.im.session_idle_hours !== undefined) config.im.session_idle_hours = Math.max(0, Math.min(720, +b.im.session_idle_hours || 0));
    }
    if (b.media) {
      config.media = config.media || {};
      for (const kind of ["image", "video", "tts", "vision"]) {
        if (b.media[kind]) {
          const c = (config.media[kind] = config.media[kind] || {});
          for (const k of ["base_url", "api_key", "model", "voice"]) {
            if (b.media[kind][k] !== undefined) c[k] = String(b.media[kind][k]).trim();
          }
          if (["image", "vision"].includes(kind) && Array.isArray(b.media[kind].models)) c.models = b.media[kind].models.map(x => String(x).trim()).filter(Boolean);
        }
      }
    }
    if (b.security) {
      const sec = security.getSecurity(config);
      for (const k of ["gateway", "delete_protect", "runtime_node", "runtime_python"]) {
        if (typeof b.security[k] === "boolean") sec[k] = b.security[k];
      }
      if (b.security.permission_mode && ["auto", "ask", "deny"].includes(b.security.permission_mode)) sec.permission_mode = b.security.permission_mode;
      if (typeof b.security.batch_delete_threshold === "number") sec.batch_delete_threshold = Math.max(1, Math.min(999, Math.round(b.security.batch_delete_threshold)));
      if (typeof b.security.approval_timeout_s === "number") sec.approval_timeout_s = Math.max(10, Math.min(3600, Math.round(b.security.approval_timeout_s)));
      config.security = sec; // 下方统一 saveConfig；不增加可绕过保护的名单保存入口
    }
    if (b.shortcuts !== undefined) config.shortcuts = b.shortcuts;
    // 上下文配置
    if (b.context_config) {
      config.context_config = config.context_config || {};
      const providers = ['gpt', 'claude', 'gemini', 'grok', 'custom'];
      providers.forEach(provider => {
        if (b.context_config[provider]) {
          config.context_config[provider] = {
            size: b.context_config[provider].size || '1m',
            threshold: Math.max(60, Math.min(80, parseInt(b.context_config[provider].threshold) || 60))
          };
        }
      });
    }
    if (b.shortcuts && typeof b.shortcuts === "object") {
      config.shortcuts = {};
      for (const [k, v] of Object.entries(b.shortcuts)) {
        if (typeof v === "string" && v.length < 60) config.shortcuts[k] = v;
      }
      if (global.__wbRegisterShortcuts) global.__wbRegisterShortcuts(config.shortcuts); // 桌面版重注册全局快捷键
    }
    if (b.remote_control?.enabled === true) {
      const livePort = global.__wbServer?.address?.()?.port;
      const targetPort = desktopAccess.enabled() ? desktopAccess.port() : (livePort || Number(process.env.PORT) || config.server?.port || 3800);
      const tunnelPort = await ensureRemoteProxy(targetPort);
      startCloudflareQuickTunnel(tunnelPort).catch(e => {
        cloudflareTunnelStarting = false;
        cloudflareTunnelState = { status: "error", url: "", error: e.message || "cloudflared 启动失败" };
        remoteControlToken = "";
      });
    }
    llmInner = createLLM(config); // 模型热切换
    memory.setEmbedder(createEmbedder(config));
    memory.ensureVectors().catch(() => {});
    saveConfig();
    if (b.im && b.im.feishu && imBridge) {
      imBridge.startFeishuWs(true).catch((e) => console.warn("[飞书] 长连接重启失败:", e.message)); // 飞书配置变更后重建长连接
    }
    if (b.im && b.im.qq && imBridge) {
      imBridge.startQQ(true).catch((e) => console.warn("[QQ] 长连接重启失败:", e.message));
    }
    res.json({ ok: true, provider: llm.provider, model: llm.model, workspace_dir: getWorkspaceDir(), ...(wsSkipped ? { workspace_skipped: wsSkipped } : {}) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- 远程控制绑定二维码 ----------
app.get("/api/remote-control/status", (req, res) => {
  const authorized = remoteAuthorized(req);
  if (authorized) { remoteLastSeenAt = Date.now(); remoteRequestCount++; }
  const remoteConnected = !!remoteLastSeenAt && Date.now() - remoteLastSeenAt < 15000;
  res.json({ enabled: config.remote_control?.enabled === true, ...cloudflareTunnelState, url: cloudflareTunnelState.url || config.remote_control?.public_url || "", computer_online: cloudflareTunnelState.status === "online", remote_connected: remoteConnected, remote_last_seen_at: remoteLastSeenAt || null, remote_request_count: remoteRequestCount });
});

function remoteAuthorized(req) {
  const supplied = req.get("x-closecode-remote-token") || (req.path.endsWith("/events") ? String(req.query?.token || "") : "");
  return !!remoteControlToken && supplied === remoteControlToken;
}
function requireRemoteAuth(req, res) {
  if (config.remote_control?.enabled !== true) { res.status(403).json({ error: "远程控制未开启" }); return false; }
  if (!remoteAuthorized(req)) { res.status(401).json({ error: "远程控制令牌无效或已失效" }); return false; }
  remoteLastSeenAt = Date.now(); remoteRequestCount++;
  return true;
}
function remoteSessionSummary(id, s) {
  const remoteTask = [...remoteTasks.values()].find(task => task.sessionId === id);
  const displayTranscript = remoteTranscriptForDisplay(s.transcript);
  return { id, title: s.title || "未命名对话", project: s.project || null, project_dir: s.project_dir || null, updated_at: s.updated_at || null, running: activeRuns.has(id) || !!remoteTask && ["queued", "running"].includes(remoteTask.status), source: s.transcript?.some(e => e.source === "remote") ? "remote" : "local", messages: (s.transcript || []).length, event_count: displayTranscript.reduce((n, e) => n + (e.events?.length || 0), 0) };
}
function listRemoteSessions() {
  const files = fs.existsSync(SESS_DIR) ? fs.readdirSync(SESS_DIR).filter(name => name.endsWith(".json")) : [];
  const ids = new Set([...files.map(name => name.slice(0, -5)), ...sessions.keys()]);
  return [...ids].map(id => [id, getSession(id)]).filter(([, s]) => s && (s.transcript?.length || s.title)).map(([id, s]) => remoteSessionSummary(id, s)).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, 100);
}
function remoteTaskEmit(task, event) {
  const recorded = { at: Date.now(), ...event };
  task.events.push(recorded);
  if (task.events.length > 500) task.events.shift();
  if (task.sessionId) {
    const s = getSession(task.sessionId);
    const entry = s.transcript?.[s.transcript.length - 1];
    if (entry?.type === "assistant") {
      if (event.type === "text") {
        const last = entry.events[entry.events.length - 1];
        if (last?.type === "text") last.delta += String(event.delta || "");
        else entry.events.push({ type: "text", delta: String(event.delta || "") });
      } else if (event.type !== "status") entry.events.push(event);
      autosaveSession(task.sessionId, 1000);
    }
  }
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of task.clients) { try { client.write(line); } catch {} }
}
function runRemoteTask(task, message) {
  task.status = "running"; remoteTaskEmit(task, { type: "status", status: task.status });
  const ctrl = new AbortController(); task.controller = ctrl;
  const session = getSession(task.sessionId);
  const history = Array.isArray(session.history) ? session.history : [];
  if (!history.length || history[history.length - 1]?.role !== "user" || history[history.length - 1]?.content !== message) {
    history.push({ role: "user", content: message });
    session.history = history;
  }
  Promise.resolve().then(async () => {
    const r = await remoteRuntime.runTask({
      history, mode: "craft", taskLabel: "远程控制任务", workspace: (config.projects || []).find(p => p.name === task.project)?.dir || getWorkspaceDir(),
      baseDir: "远程控制", authorizationUser: "remote-control", stopSignal: ctrl.signal,
      emit: event => remoteTaskEmit(task, event),
    });
    task.status = ctrl.signal.aborted ? "cancelled" : "completed";
    task.result = r?.finalText || "";
    task.usage = r?.usage || null;
    const s = getSession(task.sessionId);
    const entry = s.transcript?.[s.transcript.length - 1];
    if (entry?.type === "assistant" && task.result && !entry.events.some(ev => ev.type === "text" && String(ev.delta || "").trim())) {
      entry.events.push({ type: "text", delta: task.result });
    }
    remoteTaskEmit(task, { type: "done", status: task.status, result: task.result, usage: task.usage, session_id: task.sessionId });
    s.updated_at = new Date().toISOString(); saveSessionSync(task.sessionId);
  }).catch(error => {
    task.status = ctrl.signal.aborted ? "cancelled" : "failed";
    task.error = error.message || String(error);
    const s = getSession(task.sessionId); const entry = s.transcript?.[s.transcript.length - 1];
    remoteTaskEmit(task, { type: "error", status: task.status, message: task.error, session_id: task.sessionId });
    s.updated_at = new Date().toISOString(); saveSessionSync(task.sessionId);
  }).finally(() => { task.finishedAt = Date.now(); task.controller = null; });
}
app.get("/remote/pc-context", (req, res) => {
  if (!requireRemoteAuth(req, res)) return;
  res.json(pcRemoteContext);
});
app.get("/remote/projects", (req, res) => {
  if (!requireRemoteAuth(req, res)) return;
  ensureProjects();
  res.json((config.projects || []).map(p => ({ name: p.name, dir: p.dir, active: p.name === config.active_project })));
});
app.get("/remote/sessions", (req, res) => {
  if (!requireRemoteAuth(req, res)) return;
  res.json(listRemoteSessions());
});
app.post("/api/remote-control/pc-context", (req, res) => {
  const addr = String(req.socket.remoteAddress || "");
  const local = req.desktopAccessUser || addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  if (!local) return res.status(403).json({ error: "仅允许本机工作台写入" });
  pcRemoteContext = { project: String(req.body?.project || ""), session_id: String(req.body?.session_id || ""), updated_at: Date.now() };
  res.json({ ok: true });
});
app.get("/api/remote-control/pc-sessions", (req, res) => {
  const addr = String(req.socket.remoteAddress || "");
  const local = req.desktopAccessUser || addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  if (!local) return res.status(403).json({ error: "仅允许本机工作台读取" });
  const remoteConnected = !!remoteLastSeenAt && Date.now() - remoteLastSeenAt < 15000;
  res.json({ connected: remoteConnected, current: pcRemoteContext, sessions: listRemoteSessions().filter(s => s.id.startsWith("s_remote_")) });
});
app.get("/remote/sessions/:id", (req, res) => {
  if (!requireRemoteAuth(req, res)) return;
  if (!/^[\w-]+$/.test(req.params.id)) return res.status(400).json({ error: "会话标识无效" });
  const s = getSession(req.params.id);
  if (!s || (!s.transcript?.length && !s.title)) return res.status(404).json({ error: "会话不存在" });
  res.json({ ...remoteSessionSummary(req.params.id, s), transcript: remoteTranscriptForDisplay(s.transcript) });
});
app.post("/remote/tasks", (req, res) => {
  if (!requireRemoteAuth(req, res)) return;
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "任务内容不能为空" });
  if (message.length > 20000) return res.status(400).json({ error: "任务内容过长" });
  if (!remoteRuntime) return res.status(503).json({ error: "智能体尚未完成初始化" });
  const id = "remote_" + randomUUID();
  ensureProjects();
  const requestedSession = String(req.body?.session_id || "").trim();
  let sessionId = requestedSession;
  let session = requestedSession ? getSession(requestedSession) : null;
  if (sessionId && (!session || !session.transcript?.some(e => e.source === "remote"))) return res.status(400).json({ error: "只能继续手机远程创建的对话" });
  const project = String(req.body?.project || session?.project || config.active_project || "默认项目");
  if (!(config.projects || []).some(p => p.name === project)) return res.status(400).json({ error: "指定项目不存在" });
  if (!session) {
    sessionId = "s_remote_" + randomUUID().replace(/-/g, "");
    session = { user: undefined, title: message.slice(0, 24), title_manual: false, project, project_dir: (config.projects || []).find(p => p.name === project)?.dir || null, history: [], transcript: [], updated_at: new Date().toISOString() };
    sessions.set(sessionId, session);
  }
  session.project = project;
  session.transcript.push({ type: "user", text: message, mode: "craft", source: "remote" }, { type: "assistant", events: [], requestId: id, source: "remote" });
  saveSessionSync(sessionId);
  const task = { id, sessionId, message, project, status: "queued", createdAt: Date.now(), events: [], clients: new Set(), result: "", error: "" };
  remoteTasks.set(id, task);
  remoteTaskEmit(task, { type: "status", status: "queued" });
  runRemoteTask(task, message);
  res.status(202).json({ ok: true, task_id: id, status: task.status });
});
app.get("/remote/tasks", (req, res) => {
  if (!requireRemoteAuth(req, res)) return;
  res.json([...remoteTasks.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map(task => ({ id: task.id, message: task.message, status: task.status, created_at: task.createdAt, finished_at: task.finishedAt || null, result: task.result, error: task.error })));
});
app.get("/remote/tasks/:id", (req, res) => {
  if (!requireRemoteAuth(req, res)) return;
  const task = remoteTasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  res.json({ id: task.id, message: task.message, status: task.status, created_at: task.createdAt, finished_at: task.finishedAt || null, result: task.result, error: task.error, events: task.events });
});
app.post("/remote/tasks/:id/cancel", (req, res) => {
  if (!requireRemoteAuth(req, res)) return;
  const task = remoteTasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  if (task.controller) task.controller.abort();
  res.json({ ok: true, status: task.status });
});
app.get("/remote/tasks/:id/events", (req, res) => {
  if (!remoteAuthorized(req)) return res.status(401).end("远程控制令牌无效或已失效");
  const task = remoteTasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: "任务不存在" });
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  for (const event of task.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  task.clients.add(res);
  const timer = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 15000);
  req.on("close", () => { clearInterval(timer); task.clients.delete(res); });
});

app.get("/api/remote-control/qrcode", async (req, res) => {
  try {
    if (config.remote_control?.enabled !== true) return res.status(403).json({ error: "远程控制未开启" });
    const baseUrl = String(config.remote_control?.public_url || "").trim();
    if (!baseUrl) return res.status(400).json({ error: "请先配置远程控制 HTTPS 地址" });
    const url = baseUrl + "/remote-control.html?token=" + encodeURIComponent(remoteControlToken);
    const QRCode = require("qrcode");
    const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 280 });
    res.json({ ok: true, url, data_url: dataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message || "二维码生成失败" });
  }
});

// 地址限制为 HTTP(S)，拒绝凭据、查询参数和片段；本地 Ollama 地址仍可使用。
function normalizeModelBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("请输入有效的模型请求地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("模型请求地址仅支持不含凭据、查询参数或片段的 HTTP(S) URL");
  return url.toString().replace(/\/+$/, "");
}
app.post("/api/models/fetch", async (req, res) => {
  try {
    const { api_key, provider, purpose } = req.body || {};
    if (!String(api_key || "").trim()) return res.status(400).json({ error: "API Key 必填" });
    const baseUrl = normalizeModelBaseUrl(req.body.base_url);
    const anthropic = provider === "claude" || provider === "anthropic";
    const headers = anthropic
      ? { "x-api-key": api_key.trim(), "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
      : { "Authorization": "Bearer " + api_key.trim(), "Content-Type": "application/json" };
    const response = await fetch(baseUrl + "/models", { method: "GET", headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = "HTTP " + response.status;
      try { message = JSON.parse(text).error?.message || message; } catch {}
      return res.status(response.status).json({ error: message });
    }
    const data = await response.json();
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
    const models = rows.map(x => typeof x === "string" ? x : x.id || x.model || x.name || "").filter(Boolean);
    if (!models.length) return res.status(400).json({ error: "模型列表为空，请检查地址与 Key 权限" });
    res.json({ ok: true, models, provider: provider || "gpt", purpose: purpose || "chat" });
  } catch (error) {
    res.status(400).json({ error: error.message || "拉取失败" });
  }
});

// ---------- 首次开箱引导：没有 API Key 时，什么都干不了，得先把这一步走完 ----------
// 只回布尔值，绝不把 key 原文吐给前端（设置页要改 key 走 /api/settings）
function isLocalModel(m) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(m.base_url || "");
}
function hasKey(m) {
  return isLocalModel(m) || !!String(m.api_key || "").trim();
}

/** 发一条最小的真实请求验活。返回 null = 通过，返回字符串 = 人话版失败原因。
 *  刻意不走 createLLM：它会把工具 schema 一起发过去，这里只想知道"这个 key 认不认"。 */
async function probeModel(m) {
  const { modelProvider, modelEndpoint } = require("./lib/model-protocol");
  const anthropic = modelProvider(m) === "anthropic";
  const url = modelEndpoint(m.base_url, anthropic ? "anthropic" : "openai");
  const headers = anthropic
    ? { "Content-Type": "application/json", "x-api-key": m.api_key || "", "anthropic-version": "2023-06-01" }
    : { "Content-Type": "application/json", Authorization: `Bearer ${m.api_key || "ollama"}` };
  const body = anthropic
    ? { model: m.model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] }
    : { model: m.model, max_tokens: 8, stream: false, messages: [{ role: "user", content: "ping" }] };
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (r.ok) return null;
    const txt = (await r.text()).slice(0, 300);
    if (r.status === 401 || r.status === 403) return "这个 Key 上游不认（HTTP " + r.status + "），检查有没有复制全、是不是这家服务商的 Key";
    if (r.status === 402) return "Key 有效但余额不足 / 未开通付费，去服务商控制台充值后再试";
    if (r.status === 404) return `模型名「${m.model}」在这家服务商不存在（HTTP 404），去 设置 → 模型 改成它支持的名字`;
    if (r.status === 429) return "被限流了（429），等一会儿再试，或换个渠道";
    return `上游返回 HTTP ${r.status}：${txt}`;
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/timeout|abort/i.test(msg)) return "连不上（30 秒超时）。国外服务商在国内直连经常打不通，挂代理或换国产渠道";
    return "连不上：" + msg.slice(0, 200);
  }
}

app.get("/api/onboarding", (_req, res) => {
  const models = (config.models || []).map((m) => ({
    name: m.name,
    model: m.model,
    base_url: m.base_url || "",
    local: isLocalModel(m),
    has_key: hasKey(m),
  }));
  const wanted = String(config.active_model || "").trim();
  const active = wanted
    ? (config.models || []).find((m) => m.name === wanted)
    : (config.models || [])[0];
  res.json({
    // 当前选中的模型没 key = 一句话都发不出去，必须弹引导
    needs_setup: !active || !hasKey(active),
    active_model: config.active_model,
    workspace_dir: getWorkspaceDir(),
    models,
    any_key: models.some((m) => m.has_key && !m.local),
    search: { provider: (config.search || {}).provider || "jina", has_key: !!searchProviderKey(config.search || {}, (config.search || {}).provider || "jina") },
  });
});

// 填 key → 真发一条最小请求验活 → 通过才落盘。不验就存等于把坑留到用户第一次提问时才炸
app.post("/api/onboarding", async (req, res) => {
  try {
    const b = req.body || {};
    const entry = (config.models || []).find((m) => m.name === b.model);
    if (!entry) throw new Error("没有这个模型：" + b.model);
    const key = String(b.api_key || "").trim();
    if (!key && !isLocalModel(entry)) throw new Error("API Key 不能为空");

    if (b.skip_test !== true) {
      const bad = await probeModel({ ...entry, api_key: key || entry.api_key });
      if (bad) return res.json({ ok: false, error: bad });
    }

    if (key) entry.api_key = key;
    config.active_model = entry.name;
    // Fix C 完成后：修改工作目录只影响新任务的默认目录，不影响正在运行的任务
    if (b.workspace_dir) {
      config.workspace_dir = setWorkspaceDir(b.workspace_dir);
      ensureProjects();
      const ap = config.projects.find((p) => p.name === config.active_project);
      if (ap) ap.dir = config.workspace_dir;
    }
    llmInner = createLLM(config);
    memory.setEmbedder(createEmbedder(config));
    memory.ensureVectors().catch(() => {});
    saveConfig();
    res.json({ ok: true, active_model: config.active_model, model: llm.model, workspace_dir: getWorkspaceDir() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 直连所配搜索服务商测活（不走 DDG 回退，测的就是这家 key 能不能用）
app.get("/api/search/test", async (_req, res) => {
  try {
    const cfg = config.search || {};
    const provider = (cfg.provider || "jina").toLowerCase();
    const fn = SEARCH_PROVIDERS[provider];
    if (!fn) return res.json({ ok: false, error: `未知 provider: ${provider}` });
    const key = searchProviderKey(cfg, provider);
    if (!key) return res.json({ ok: false, error: `${provider} 未填 API Key` });
    const items = await fn(key, "OpenAI", 3);
    if (!items.length) return res.json({ ok: false, error: `${provider} 返回 0 条结果` });
    res.json({ ok: true, provider, sample: (items[0].title || items[0].url || "").slice(0, 60) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---------- 安全中心：审计 / 审批 / 系统授权 ----------
app.get("/api/security/audit", (req, res) => res.json(security.auditList(Math.min(1000, +req.query.limit || 100))));
app.post("/api/security/audit/clear", (_req, res) => {
  security.auditClear();
  res.json({ ok: true });
});
app.get("/api/security/audit/export", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="closecode-audit-${new Date().toISOString().slice(0, 10)}.log"`);
  res.send(security.auditExport());
});
app.get("/api/security/approvals", (req, res) =>
  res.json({ items: security.listApprovals(req.desktopAccessUser), mode: security.permissionMode(config.security), session_allow: [] })
);
app.get("/api/security/directory-grants", (req, res) => {
  res.json({ items: security.listDirectoryGrants(req.desktopAccessUser) });
});
app.delete("/api/security/directory-grants/:id", (req, res) => {
  if (!security.revokeDirectoryGrant(req.params.id, req.desktopAccessUser)) return res.status(404).json({ ok: false, error: "授权不存在" });
  res.json({ ok: true });
});
/**
 * 批准/拒绝一条审批。scope：once 只这一次 / session 本次运行期间同类不再问 / always 永久写进放行名单。
 * always 要落盘——「一直允许」点完重启又来问，等于没这个按钮；落盘的规则在安全中心看得见、删得掉。
 */
app.post("/api/security/approvals/:id", (req, res) => {
  const body = req.body || {};
  const scope = body.scope === undefined ? "once" : body.scope;
  if (!["once", "session", "always"].includes(scope) || typeof body.allow !== "boolean") return res.status(400).json({ ok: false, error: "审批参数无效" });
  const r = security.resolveApproval(req.params.id, body.allow, scope, req.desktopAccessUser);
  if (!r.ok) return res.status(r.status || 400).json(r);
  if (r.ok && body.allow && scope === "always" && r.ruleKey) {
    const sec = security.getSecurity(config);
    const list = Array.isArray(sec.cmd_allow) ? sec.cmd_allow : [...(security.DEFAULTS.cmd_allow || [])];
    if (!list.includes(r.ruleKey)) {
      list.push(r.ruleKey);
      sec.cmd_allow = list;
      saveConfig();
    }
  }
  res.json(r);
});
app.get("/api/security/modes", (_req, res) =>
  res.json({ modes: security.PERMISSION_MODES, current: security.permissionMode(config.security) })
);
app.post("/api/security/mode", (req, res) => {
  const mode = String((req.body || {}).mode || "");
  if (!security.PERMISSION_MODES[mode]) return res.status(400).json({ error: "未知的权限档位" });
  security.getSecurity(config).permission_mode = mode; // 走 getSecurity 补默认值，别把别的字段挤掉
  saveConfig();
  security.audit("权限档位", `切换到「${security.PERMISSION_MODES[mode].label}」`, "放行");
  res.json({ ok: true, mode });
});
app.post("/api/security/session-allow/clear", (_req, res) => {
  security.clearSessionAllow();
  res.json({ ok: true });
});
app.get("/api/security/system", (_req, res) => {
  res.json({
    platform: process.platform,
    desktop: !!process.versions.electron,
    fulldisk: security.checkFullDisk(),
    accessibility: security.checkAccessibility(),
    automation: "unchecked", // 主动探测会触发系统弹窗，改为用户点「检测/授权」时才查
  });
});
app.post("/api/security/system/check-automation", async (_req, res) => {
  res.json({ automation: await security.checkAutomation() });
});
app.post("/api/security/system/open", (req, res) => {
  res.json({ ok: security.openPrefPane((req.body || {}).pane) });
});
// 桌面版窗口全屏切换（Web 版由前端 requestFullscreen 兜底）
app.post("/api/app/fullscreen", (_req, res) => {
  if (global.__wbWin) {
    try {
      global.__wbWin.setFullScreen(!global.__wbWin.isFullScreen());
      return res.json({ ok: true });
    } catch {}
  }
  res.json({ ok: false });
});

// 检查更新：项目是 git 仓库且配了远程时真实比对，否则如实说明（不装样子）
app.post("/api/app/update-check", (_req, res) => {
  const version = (() => { try { return require("./patch-loader").effectiveVersion(); } catch { return "?"; } })();
  const { spawnSync } = require("child_process");
  const git = (...args) => spawnSync("git", args, { cwd: __dirname, encoding: "utf8", timeout: 30000 });
  if (git("rev-parse", "--is-inside-work-tree").status !== 0) {
    return res.json({ ok: false, version, reason: "本地部署版未配置更新源（项目还不是 git 仓库）" });
  }
  if (!String(git("remote").stdout || "").trim()) {
    return res.json({ ok: false, version, reason: "未配置远程仓库（git remote），无法在线检查更新" });
  }
  const f = git("fetch", "--quiet");
  if (f.status !== 0) return res.json({ ok: false, version, reason: "拉取远程失败：" + String(f.stderr || "").trim().slice(0, 120) });
  const behind = git("rev-list", "--count", "HEAD..@{upstream}");
  if (behind.status !== 0) return res.json({ ok: false, version, reason: "当前分支未设置上游分支（git branch -u）" });
  res.json({ ok: true, version, behind: parseInt(behind.stdout, 10) || 0 });
});

// ---------- MCP 连接器管理 ----------
app.get("/api/mcp", (_req, res) => {
  const view = (s, plugin) => {
    const client = mcpManager.clients.get(s.name);
    const failure = mcpManager.failures.find((f) => f.name === s.name);
    return {
      name: s.name,
      command: s.command || "",
      args: s.args || [],
      env: s.env || {},
      url: s.url || "",
      // 请求头里常有 token，界面上只说有几个，不回传值
      header_keys: Object.keys(s.headers || {}),
      transport: s.transport || (s.command ? "stdio" : "streamable-http"),
      plugin, // 插件带来的：界面上只读，不许当成 config 里的条目存回去
      error: failure ? failure.error : "",
      connected: !!client,
      tools: client ? client.tools.map((t) => ({ name: t.name, description: (t.description || "").slice(0, 200) })) : [],
    };
  };
  // config.json 里配的 + 插件 mcp.json 里声明的，一起列出来，
  // 否则「已注入 N 个工具」的 N 里有一半找不到对应的卡片，用户以为是幻觉。
  let fromPlugins = [];
  try { fromPlugins = pluginsMgr.pluginMcpServers(); } catch { /* 插件坏了不该让连接器页打不开 */ }
  const servers = (config.mcp_servers || []).map((s) => view(s, ""))
    .concat(fromPlugins.map((s) => view(s, s.plugin)));
  res.json({ servers, total_tools: mcpManager.toolDefs().length });
});

/** 一条连接器配置规整成后端认的形状；stdio 看 command，远程看 url */
function normalizeMcpServer(s, i, prevByName = new Map()) {
  const at = `第 ${i + 1} 个连接器`;
  const name = String(s.name || "").trim();
  if (!name) throw new Error(`${at}缺少 name`);
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`${at}的 name「${name}」只能用字母、数字、- 和 _（工具名要按 mcp__服务器__工具 拼）`);
  const url = String(s.url || "").trim();
  const command = String(s.command || "").trim();
  if (!command && !url) throw new Error(`${at}要么填 command（本地进程），要么填 url（远程 Streamable HTTP）`);
  if (url) {
    let u;
    try { u = new URL(url); } catch { throw new Error(`${at}的 url 不是合法地址：${url}`); }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`${at}的 url 只支持 http/https`);
    // 请求头里多半是 Authorization，GET 只回 header_keys 不回值；
    // 前端原样存回来时没带 headers，就沿用原来那份，别把令牌洗没了。
    const prev = prevByName.get(name);
    const headers = s.headers && typeof s.headers === "object"
      ? Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [String(k), String(v)]))
      : (prev && prev.headers) || {};
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
    if (Object.keys(headers).length && u.protocol === "http:" && !local) {
      throw new Error(`${at}带了请求头（多半是令牌）却走明文 http，令牌会在路上被看光——请改成 https`);
    }
    return { name, transport: "streamable-http", url, headers };
  }
  return {
    name,
    transport: "stdio",
    command,
    args: Array.isArray(s.args) ? s.args.map(String) : [],
    env: s.env && typeof s.env === "object" ? Object.fromEntries(Object.entries(s.env).map(([k, v]) => [String(k), String(v)])) : {},
  };
}

app.post("/api/mcp", async (req, res) => {
  try {
    const list = (req.body || {}).servers;
    if (!Array.isArray(list)) throw new Error("需要 servers 数组");
    const prevByName = new Map((config.mcp_servers || []).map((s) => [s.name, s]));
    const next = list.map((s, i) => normalizeMcpServer(s, i, prevByName));
    const dup = next.map((s) => s.name).find((n, i, a) => a.indexOf(n) !== i);
    if (dup) throw new Error(`连接器名字重复：${dup}`);

    config.mcp_servers = next;
    saveConfig();

    // 插件带来的服务器也要一起重启：只重启 config 里的会把插件连接器整批打没，
    // 而它们不在 config 里，重启前根本救不回来（旧版就是这个 bug）。
    let fromPlugins = [];
    try { fromPlugins = pluginsMgr.pluginMcpServers(); } catch { /* 插件坏了不该拖累连接器保存 */ }
    const servers = [...config.mcp_servers, ...fromPlugins];
    mcpManager.stop([...mcpManager.clients.keys(), ...mcpManager.failures.map((f) => f.name), ...servers.map((s) => s.name)]);
    await mcpManager.startAll(servers); // 失败的单独在日志告警，不阻塞其他
    res.json({
      ok: true,
      total_tools: mcpManager.toolDefs().length,
      connected: [...mcpManager.clients.keys()],
      failures: mcpManager.failures,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- 项目（多工作空间，仿官方「项目」：每个项目一个独立工作目录，成果互不混淆） ----------
/**
 * 项目自带的「指令」和挂载的专家/技能/连接器。
 * 指令不是装饰：切到这个项目之后，它会进系统提示词（见 accountedRuntime），
 * 否则用户在弹窗里写一大段项目背景，agent 一个字都看不见。
 */
function projectMeta(body) {
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 30) : []);
  return {
    instructions: String(body.instructions || "").slice(0, 4000),
    connectors: arr(body.connectors),
    experts: arr(body.experts),
    skills: arr(body.skills),
    // dir 由外层处理（新建时用传入的或自动生成，编辑时不可改），这里只负责挂载配置的字段
  };
}
function activeProject() {
  ensureProjects();
  return config.projects.find((p) => p.name === config.active_project) || null;
}

/**
 * 组装进系统提示词的项目上下文：指令 + 挂载清单。
 * 挂载在弹窗里勾了才有；勾过但后来被删掉的专家/技能/连接器要过滤掉，不然提示词里指着空气让 agent 用。
 */
function projectContextOf(p) {
  if (!p) return "";
  const parts = [];
  if (p.instructions) parts.push(p.instructions);
  const alive = (names, pool) => (names || []).filter((n) => pool.includes(n));
  const exps = alive(p.experts, experts.map((e) => e.name));
  if (exps.length) parts.push(`本项目挂载的专家：${exps.join("、")}。相应领域的子任务优先 delegate_to_expert 委派给他们。`);
  let skillCatalog = [];
  try { skillCatalog = skillsMgr.loadSkills(); } catch {}
  const sks = [...new Set((p.skills || []).map(name=>skillsMgr.resolveSkill(name,skillCatalog)?.name).filter(Boolean))];
  if (sks.length) parts.push(`本项目挂载的技能：${sks.join("、")}。做对应任务前先 use_skill 加载，按技能里的规范执行。`);
  const conns = alive(p.connectors, (config.mcp_servers || []).map((s) => s.name));
  if (conns.length) parts.push(`本项目挂载的连接器：${conns.join("、")}。涉及外部系统时优先用这些连接器提供的工具。`);
  // 项目目录里的 AGENTS.md / CLAUDE.md 是写给 agent 看的项目规范（pi / Claude Code 的通行惯例），
  // 用户既然放了就自动带上，不用再往项目指令里手抄一遍
  try {
    for (const fname of ["AGENTS.md", "CLAUDE.md"]) {
      if (!p.dir) break;
      const fp = path.join(p.dir, fname);
      if (!fs.existsSync(fp)) continue;
      const txt = fs.readFileSync(fp, "utf8").trim().slice(0, 50000);
      if (txt) parts.push(`项目目录里的 ${fname}（项目既定规范，必须遵守）：\n${txt}`);
      break;
    }
  } catch {}
  return parts.join("\n\n");
}

function ensureProjects() {
  if (!Array.isArray(config.projects) || !config.projects.length) {
    config.projects = [{ name: "默认项目", dir: getWorkspaceDir() }];
    config.active_project = "默认项目";
  }
  if (!config.projects.some((p) => p.name === config.active_project)) config.active_project = config.projects[0].name;
}
/**
 * config.json 是唯一一份存着所有 API Key 的文件，还不入 git——写坏了就是全丢。
 * 所以全应用只留这一个写入口，走原子改名 + .bak。
 */
function saveConfig() {
  try {
    store.writeJsonAtomic(CONFIG_PATH, config, { pretty: true });
  } catch (err) {
    console.error("saveConfig 写入失败:", err);
  }
}

// ================= Token 统计（本地 JSON 文件存储） =================
const TOKEN_STATS_FILE = dataPath("token_stats.json");

// 读取 Token 统计数据
function readTokenStats() {
  try {
    if (fs.existsSync(TOKEN_STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_STATS_FILE, "utf8"));
      return data;
    }
  } catch (err) {
    console.warn("[Token统计] 读取失败:", err);
  }
  return { daily: {}, total: { prompt: 0, completion: 0, cached: 0, calls: 0 } };
}

// 保存 Token 统计数据
function saveTokenStats(data) {
  try {
    fs.writeFileSync(TOKEN_STATS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[Token统计] 保存失败:", err);
  }
}

// 获取今天的日期字符串
function todayDateStr() {
  return new Date().toISOString().split("T")[0];
}

// 获取 Token 统计
app.get("/api/token-stats", (_req, res) => {
  const stats = readTokenStats();
  const today = todayDateStr();

  // 返回今日和历史统计
  res.json({
    daily: stats.daily[today] || { date: today, prompt: 0, completion: 0, cached: 0, calls: 0 },
    total: stats.total || { prompt: 0, completion: 0, cached: 0, calls: 0 }
  });
});

// 记录 Token 使用（累加）
app.post("/api/token-stats", (req, res) => {
  const { prompt = 0, completion = 0, cached = 0, calls = 0 } = req.body;

  try {
    const stats = readTokenStats();
    const today = todayDateStr();

    // 初始化今日数据
    if (!stats.daily[today]) {
      stats.daily[today] = { date: today, prompt: 0, completion: 0, cached: 0, calls: 0 };
    }

    // 累加今日统计
    stats.daily[today].prompt += prompt;
    stats.daily[today].completion += completion;
    stats.daily[today].cached += cached;
    stats.daily[today].calls += calls;

    // 累加历史总计
    if (!stats.total) {
      stats.total = { prompt: 0, completion: 0, cached: 0, calls: 0 };
    }
    stats.total.prompt += prompt;
    stats.total.completion += completion;
    stats.total.cached += cached;
    stats.total.calls += calls;

    // 清理超过 30 天的旧数据（保持文件精简）
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffStr = cutoffDate.toISOString().split("T")[0];
    Object.keys(stats.daily).forEach(date => {
      if (date < cutoffStr) {
        delete stats.daily[date];
      }
    });

    saveTokenStats(stats);
    res.json({ success: true });
  } catch (err) {
    console.error("[Token统计] 记录失败:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= 检查更新 =================
app.get("/api/check-update", async (_req, res) => {
  try {
    const currentVersion = require("./patch-loader").effectiveVersion();
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";

    // 请求云端更新信息
    const response = await fetch("https://close.codes/api/agents", {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error("云端接口响应失败:", response.status, response.statusText);
      return res.json({ hasUpdate: false, error: `服务器响应失败 (${response.status})` });
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      console.error("云端接口返回非 JSON 格式:", contentType);
      return res.json({ hasUpdate: false, error: "更新服务暂时不可用" });
    }

    const result = await response.json();

    if (!result.success || !Array.isArray(result.data)) {
      console.error("云端接口返回数据格式错误:", result);
      return res.json({ hasUpdate: false, error: "获取更新信息失败" });
    }

    // 筛选当前平台的最新版本
    const platformUpdates = result.data.filter(item => item.platform === platform);
    if (platformUpdates.length === 0) {
      return res.json({ hasUpdate: false, message: "当前平台暂无更新" });
    }

    // 按版本号排序，取最新的
    const latest = platformUpdates.sort((a, b) => {
      const versionA = a.version.split('.').map(Number);
      const versionB = b.version.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (versionA[i] !== versionB[i]) return versionB[i] - versionA[i];
      }
      return 0;
    })[0];

    // 对比版本号
    const current = currentVersion.split('.').map(Number);
    const remote = latest.version.split('.').map(Number);
    let hasUpdate = false;

    for (let i = 0; i < 3; i++) {
      if (remote[i] > current[i]) {
        hasUpdate = true;
        break;
      } else if (remote[i] < current[i]) {
        break;
      }
    }

    res.json({
      hasUpdate,
      currentVersion,
      latestVersion: latest.version,
      platform: latest.platform,
      filename: latest.filename,
      fileSize: latest.file_size,
      downloadUrl: `https://niuma.docode.cc/api/agents/${latest.id}/download`,
      downloadCount: latest.download_count,
      updatedAt: latest.updated_at,
    });
  } catch (err) {
    console.error("检查更新失败:", err);
    res.json({ hasUpdate: false, error: err.message || "检查更新失败" });
  }
});

app.get("/api/projects", (_req, res) => {
  ensureProjects();
  res.json({ projects: config.projects, active: config.active_project });
});

app.post("/api/projects", (req, res) => {
  try {
    ensureProjects();
    // Fix C 完成后：新建项目并切换不会影响正在运行的任务（它们使用已 pin 住的 workspace）
    // 所以不再需要 workspaceBusy() 检查
    const name = String((req.body || {}).name || "").trim();
    if (!name) throw new Error("缺少项目名");
    if (name.length > 30) throw new Error("项目名太长（最多 30 字）");
    if (config.projects.some((p) => p.name === name)) throw new Error("同名项目已存在");
    let dir = String((req.body || {}).dir || "").trim();
    if (!dir) dir = dataPath("projects", name.replace(/[/\\:*?"<>|]/g, "_"));
    const real = setWorkspaceDir(dir); // 建目录并切换过去
    config.projects.push({ name, dir: real, ...projectMeta(req.body || {}), created_at: new Date().toISOString() });
    config.active_project = name;
    config.workspace_dir = real;
    saveConfig();
    res.json({ ok: true, projects: config.projects, active: name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/projects/switch", (req, res) => {
  try {
    ensureProjects();
    const p = config.projects.find((x) => x.name === (req.body || {}).name);
    if (!p) return res.status(404).json({ error: "项目不存在" });
    if (p.name === config.active_project) {
      // 切到自己：目录没变，不用惊动正在跑的任务
      return res.json({ ok: true, active: p.name, dir: p.dir, active_model: config.active_model });
    }

    // Fix C 完成后：每个会话都有独立的 workspace（sess.project_dir），
    // 切换全局默认项目不会影响正在运行的任务，所以不再需要 workspaceBusy() 检查。
    // 正在运行的任务继续使用它们已经 pin 住的 workspace，新任务使用新的默认项目目录。

    // 保存当前项目的模型选择
    const currentProject = config.projects.find((x) => x.name === config.active_project);
    if (currentProject) {
      currentProject.active_model = config.active_model;
    }

    // 切换到新项目
    config.workspace_dir = setWorkspaceDir(p.dir);
    config.active_project = p.name;

    // 恢复新项目的模型选择（如果有保存的话）
    if (p.active_model) {
      config.active_model = p.active_model;
    }

    saveConfig();
    res.json({ ok: true, active: p.name, dir: p.dir, active_model: config.active_model });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 新任务回到当前项目自己的目录：输入框里临时切过的文件夹不带进下一个任务
app.post("/api/workspace/reset", (_req, res) => {
  try {
    // 工作目录是全局的：有任务在跑时重置会把它的写入目录半路拽走，产出散落两处。跳过，等空闲再说
    if (activeRuns.size) return res.json({ ok: false, busy: true, workspace_dir: getWorkspaceDir() });
    ensureProjects();
    const ap = config.projects.find((p) => p.name === config.active_project) || config.projects[0];
    if (ap && ap.dir && ap.dir !== getWorkspaceDir()) {
      config.workspace_dir = setWorkspaceDir(ap.dir);
      saveConfig();
    }
    res.json({ ok: true, workspace_dir: getWorkspaceDir() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 改项目：名字之外的东西（指令、挂载的专家/技能/连接器）都能改，改完立即对新任务生效
app.patch("/api/projects/:name", (req, res) => {
  ensureProjects();
  const p = config.projects.find((x) => x.name === req.params.name);
  if (!p) return res.status(404).json({ error: "项目不存在" });
  Object.assign(p, projectMeta({ ...p, ...(req.body || {}) }));
  const rename = String((req.body || {}).name || "").trim();
  if (rename && rename !== p.name) {
    if (config.projects.some((x) => x.name === rename)) return res.status(400).json({ error: "同名项目已存在" });
    if (config.active_project === p.name) config.active_project = rename;
    p.name = rename;
  }
  saveConfig();
  res.json({ ok: true, project: p, projects: config.projects, active: config.active_project });
});

// 只从列表移除，不删磁盘文件
app.delete("/api/projects/:name", (req, res) => {
  ensureProjects();
  if (config.projects.length <= 1) return res.status(400).json({ error: "至少保留一个项目" });
  const i = config.projects.findIndex((p) => p.name === req.params.name);
  if (i < 0) return res.status(404).json({ error: "项目不存在" });
  const target = config.projects[i];
  // 检查全部运行任务的固定工作区，不能使用当前活动项目推断归属。
  const scope = require("./lib/workspace-scope");
  for (const [id, run] of activeRuns) {
    const sess = sessions.get(id);
    const workspace = run.workspace || sess?.project_dir;
    let belongs = run.project === target.name || sess?.project === target.name;
    try { belongs ||= !!workspace && scope.same(workspace, target.dir); }
    catch { return res.status(409).json({ error: "运行任务的工作区无法核对，暂不能移除项目" }); }
    if (belongs) return res.status(409).json({ error: "项目内有任务运行中，暂不能移除" });
  }
  config.projects.splice(i, 1);
  if (config.active_project === req.params.name) {
    const p0 = config.projects[0];
    config.active_project = p0.name;
    try {
      config.workspace_dir = setWorkspaceDir(p0.dir);
    } catch {}
  }
  saveConfig();
  res.json({ ok: true, projects: config.projects, active: config.active_project });
});

// ---------- 自定义项目模板（落盘到 data/project-templates.json，不进 config，避免和项目列表互相牵连） ----------
const PROJ_TPL_FILE = dataPath("data", "project-templates.json");
function readProjTemplates() {
  const list = store.readJson(PROJ_TPL_FILE, []);
  return Array.isArray(list) ? list : [];
}
function writeProjTemplates(list) {
  store.writeJsonAtomic(PROJ_TPL_FILE, list, { pretty: true });
}
/** 只收下这四个字段，其余一律丢掉——模板会被塞进项目表单，别让前端往里夹带东西 */
function tplMeta(body) {
  const tt = String((body || {}).tt || "").trim();
  if (!tt) throw new Error("缺少模板名称");
  if (tt.length > 20) throw new Error("模板名称太长（最多 20 字）");
  const ins = String((body || {}).ins || "").trim();
  if (!ins) throw new Error("缺少项目指令");
  return {
    ic: String((body || {}).ic || "").trim().slice(0, 4) || "⭐",
    tt,
    dd: String((body || {}).dd || "").trim().slice(0, 60),
    ins,
  };
}

app.get("/api/project-templates", (_req, res) => {
  res.json({ templates: readProjTemplates() });
});

app.post("/api/project-templates", (req, res) => {
  try {
    const list = readProjTemplates();
    const t = tplMeta(req.body);
    if (list.some((x) => x.tt === t.tt)) throw new Error("同名模板已存在");
    const item = { ...t, id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, created_at: new Date().toISOString() };
    list.push(item);
    writeProjTemplates(list);
    res.json({ ok: true, templates: list, template: item });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/project-templates/:id", (req, res) => {
  try {
    const list = readProjTemplates();
    const t = list.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: "模板不存在" });
    const next = tplMeta({ ...t, ...(req.body || {}) });
    if (list.some((x) => x.id !== t.id && x.tt === next.tt)) throw new Error("同名模板已存在");
    Object.assign(t, next);
    writeProjTemplates(list);
    res.json({ ok: true, templates: list, template: t });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 只能删自定义模板。内置模板写在前端常量里、这个文件里根本没有它们的记录，
// 所以按 id 找不到就是 404 —— 内置的删不掉是结构决定的，不是靠前端不显示按钮
app.delete("/api/project-templates/:id", (req, res) => {
  const list = readProjTemplates();
  const i = list.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "模板不存在，或是内置模板（不可移除）" });
  list.splice(i, 1);
  writeProjTemplates(list);
  res.json({ ok: true, templates: list });
});

// ---------- 资料库·灵感（跨项目共享：参考文件 + 灵感笔记，agent 可用 library_* 工具读取） ----------
const LIB_DIR = dataPath("data", "library");
const NOTES_FILE = dataPath("data", "inspirations.json");
function readNotes() {
  const list = store.readJson(NOTES_FILE, []);
  return Array.isArray(list) ? list : [];
}
function writeNotes(notes) {
  store.writeJsonAtomic(NOTES_FILE, notes, { pretty: true });
}
function libSafe(name) {
  const base = path.basename(String(name || ""));
  if (!base || base.startsWith(".")) throw new Error("文件名不合法");
  return path.join(LIB_DIR, base);
}

app.get("/api/library", (_req, res) => {
  let files = [];
  try {
    files = fs
      .readdirSync(LIB_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => {
        const st = fs.statSync(path.join(LIB_DIR, e.name));
        return { name: e.name, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {}
  res.json({ files, notes: readNotes() });
});

app.post("/api/library/upload", (req, res) => {
  try {
    const { name, data_b64 } = req.body || {};
    if (!name || !data_b64) return res.status(400).json({ error: "缺少 name 或 data_b64" });
    fs.mkdirSync(LIB_DIR, { recursive: true });
    fs.writeFileSync(libSafe(name), Buffer.from(data_b64, "base64"));
    res.json({ ok: true, name: path.basename(name) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/library/file/:name", (req, res) => {
  try {
    const p = libSafe(req.params.name);
    if (!fs.existsSync(p)) return res.status(404).send("文件不存在");
    res.download(p);
  } catch (e) {
    res.status(400).send(e.message);
  }
});

app.delete("/api/library/file/:name", (req, res) => {
  try {
    fs.rmSync(libSafe(req.params.name), { force: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/library/note", (req, res) => {
  const text = String((req.body || {}).text || "").trim();
  if (!text) return res.status(400).json({ error: "内容为空" });
  const notes = readNotes();
  notes.unshift({ id: "n_" + Date.now() + "_" + Math.floor(Math.random() * 1e4), text: text.slice(0, 2000), at: new Date().toISOString() });
  writeNotes(notes.slice(0, 200));
  res.json({ ok: true });
});

app.delete("/api/library/note/:id", (req, res) => {
  writeNotes(readNotes().filter((n) => n.id !== req.params.id));
  res.json({ ok: true });
});

// ---------- 长期记忆 ----------
// 手写区（memory.md，全局共享）+ 条目区（agent 用 remember 自己记的）
app.get("/api/memory", (req, res) => {
  res.json({ content: memory.manual(), items: memory.list(), shared_tag: memory.SHARED, limits: { max_text: memory.MAX_TEXT, max_items: memory.MAX_PER_SCOPE } });
});
app.post("/api/memory", (req, res) => {
  memory.saveManual((req.body || {}).content || "");
  res.json({ ok: true });
});
app.post("/api/memory/item", (req, res) => {
  const b = req.body || {};
  const r = memory.add({ text: b.text, shared: !!b.shared, source: "user" });
  res.status(r.ok ? 200 : 400).json(r);
});
app.delete("/api/memory/item/:id", (req, res) => {
  res.json({ ok: true, removed: memory.remove(req.params.id) });
});

// ---------- 工作空间：原生文件夹选择（桌面版）与打开文件夹 ----------
app.post("/api/pick-folder", async (_req, res) => {
  try {
    const { dialog } = require("electron");
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "选择工作空间文件夹" });
    if (result.canceled || !result.filePaths.length) return res.json({ canceled: true });
    res.json({ path: result.filePaths[0] });
  } catch {
    res.status(501).json({ error: "仅桌面版支持系统文件夹选择，Web 版请直接输入路径" });
  }
});
/** 用系统程序打开文件/文件夹（跨平台：macOS open / Windows explorer / Linux xdg-open） */
function openWithSystem(target) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  require("child_process").exec(`${opener} "${target}"`);
}
app.post("/api/open-workspace", (_req, res) => {
  openWithSystem(getWorkspaceDir());
  res.json({ ok: true });
});

// ================= 飞书：扫码授权（借本机 lark-cli 的设备码流程，larksuite/cli，MIT） =================
// 说明一句免得误解：机器人「收消息」必须有应用的 app_id + app_secret，这是飞书的设计，扫码替代不了。
// 扫码解决的是另一半——把「你本人」的身份授权出来，之后读日历/文档/邮件是以你的身份调的。
const LARK_TMP = path.join(require("os").tmpdir(), "closecode-lark");
function larkRun(args, { timeout = 60000, cwd } = {}) {
  return new Promise((resolve) => {
    const child = require("child_process").execFile(
      "lark-cli", args,
      { timeout, cwd: cwd || LARK_TMP, env: { ...process.env, PATH: shellPath() }, maxBuffer: 4 << 20 },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: stdout || "", stderr: stderr || "" }),
    );
    child.on("error", () => {});
  });
}
function larkJson(s) { try { return JSON.parse(String(s).trim()); } catch { return null; } }

app.get("/api/feishu/lark-cli", async (_req, res) => {
  fs.mkdirSync(LARK_TMP, { recursive: true });
  const v = await larkRun(["--version"], { timeout: 15000 });
  if (!v.ok) return res.json({ installed: false, install_cmd: "npx @larksuite/cli@latest install" });
  const version = (v.stdout.match(/[\d.]+/) || [""])[0];
  const cfg = larkJson((await larkRun(["config", "show"], { timeout: 15000 })).stdout.split("\n\nConfig file path")[0]);
  // 只回布尔和非敏感字段，app_secret 一个字节都不出后端
  res.json({
    installed: true, version,
    configured: !!(cfg && cfg.appId),
    app_id: (cfg && cfg.appId) || "",
    brand: (cfg && cfg.brand) || "",
    has_secret: !!(cfg && cfg.appSecret),
    users: (cfg && cfg.users) || "",
  });
});

// 把 lark-cli 里已经配好的应用凭证搬进 CloseCode 的飞书通道，省掉手动复制两串东西
app.post("/api/feishu/lark-cli/import", async (_req, res) => {
  fs.mkdirSync(LARK_TMP, { recursive: true });
  const r = await larkRun(["config", "show"], { timeout: 15000 });
  const cfg = larkJson(r.stdout.split("\n\nConfig file path")[0]);
  if (!cfg || !cfg.appId || !cfg.appSecret) {
    return res.status(400).json({ error: "lark-cli 还没配置应用凭证，先跑 lark-cli config init" });
  }
  config.im = config.im || {};
  config.im.feishu = Object.assign(config.im.feishu || {}, { app_id: cfg.appId, app_secret: cfg.appSecret });
  saveConfig();
  if (imBridge) imBridge.startFeishuWs(true).catch((e) => console.warn("[飞书] 长连接重启失败:", e.message));
  res.json({ ok: true, app_id: cfg.appId }); // secret 不回前端
});

// 反向：把 CloseCode 里填好的凭证写进 lark-cli，这样才能开始扫码（设备码流程需要一个已绑定的应用）
app.post("/api/feishu/lark-cli/bind", (_req, res) => {
  const f = (config.im || {}).feishu || {};
  if (!f.app_id || !f.app_secret) return res.status(400).json({ error: "先在上面填好 App ID / App Secret 并保存" });
  fs.mkdirSync(LARK_TMP, { recursive: true });
  // secret 走 stdin，不进进程参数表（ps 能看到 argv）
  const child = require("child_process").execFile(
    "lark-cli", ["config", "init", "--app-id", f.app_id, "--app-secret-stdin", "--brand", "feishu", "--lang", "zh"],
    { timeout: 60000, cwd: LARK_TMP, env: { ...process.env, PATH: shellPath() } },
    (err, stdout, stderr) => {
      if (res.headersSent) return;
      if (err) return res.status(400).json({ error: ((stderr || stdout || err.message) + "").slice(0, 300) });
      res.json({ ok: true });
    },
  );
  child.on("error", (e) => { if (!res.headersSent) res.status(400).json({ error: "lark-cli 没装或调不起来：" + e.message }); });
  try { child.stdin.end(f.app_secret + "\n"); } catch {}
});

// 设备码流程：start 拿二维码 → 用户在飞书里扫 → 后台那条 --device-code 自己会跑完 → status 变 ok
let larkQr = null; // { device_code, url, expires_at, state, error, child }
app.post("/api/feishu/qr/start", async (req, res) => {
  fs.mkdirSync(LARK_TMP, { recursive: true });
  if (larkQr && larkQr.child) { try { larkQr.child.kill(); } catch {} }
  const domains = String((req.body && req.body.domains) || "im,docs,drive,calendar,task");
  const r = await larkRun(["auth", "login", "--no-wait", "--json", "--domain", domains], { timeout: 60000 });
  const j = larkJson(r.stdout);
  if (!j || !j.verification_url || !j.device_code) {
    const msg = (r.stderr || r.stdout || "").slice(0, 300);
    return res.status(400).json({ error: /config init|app.?id/i.test(msg)
      ? "lark-cli 还没绑定应用：先在上面填好 App ID / App Secret 并「写入 lark-cli」，或自己跑 lark-cli config init"
      : "拿不到授权链接：" + (msg || "lark-cli 没有返回内容") });
  }
  // 出二维码：写进临时目录再读成 data URI，前端直接 <img>，不落工作区
  const png = "qr-" + Date.now() + ".png";
  await larkRun(["auth", "qrcode", j.verification_url, "-o", png, "--size", "256"], { timeout: 20000 });
  let dataUri = null;
  try {
    dataUri = "data:image/png;base64," + fs.readFileSync(path.join(LARK_TMP, png)).toString("base64");
    fs.unlinkSync(path.join(LARK_TMP, png));
  } catch {}

  // 阻塞式轮询交给后台子进程，前端只问我们自己的 status
  const child = require("child_process").execFile(
    "lark-cli", ["auth", "login", "--device-code", j.device_code, "--json"],
    { timeout: (j.expires_in || 600) * 1000 + 15000, cwd: LARK_TMP, env: { ...process.env, PATH: shellPath() } },
    (err, stdout, stderr) => {
      if (!larkQr || larkQr.device_code !== j.device_code) return; // 已被新的一轮顶掉
      if (err) { larkQr.state = "error"; larkQr.error = ((stderr || stdout || err.message) + "").slice(0, 300); }
      else { larkQr.state = "ok"; larkQr.result = larkJson(stdout) || {}; }
    },
  );
  child.on("error", (e) => { if (larkQr) { larkQr.state = "error"; larkQr.error = e.message; } });
  larkQr = { device_code: j.device_code, url: j.verification_url, expires_at: Date.now() + (j.expires_in || 600) * 1000, state: "pending", child };
  res.json({ ok: true, url: j.verification_url, qr: dataUri, expires_in: j.expires_in || 600 });
});

app.get("/api/feishu/qr/status", async (_req, res) => {
  if (!larkQr) return res.json({ state: "idle" });
  if (larkQr.state === "pending" && Date.now() > larkQr.expires_at) {
    larkQr.state = "error"; larkQr.error = "二维码超时失效，重新点一次生成";
  }
  if (larkQr.state !== "ok") return res.json({ state: larkQr.state, error: larkQr.error || null });
  const who = larkJson((await larkRun(["whoami"], { timeout: 15000 })).stdout) || {};
  res.json({ state: "ok", identity: who.identity || "", app_id: who.appId || "", user: larkQr.result && larkQr.result.user_name || "" });
});

app.post("/api/feishu/qr/cancel", (_req, res) => {
  if (larkQr && larkQr.child) { try { larkQr.child.kill(); } catch {} }
  larkQr = null;
  res.json({ ok: true });
});

// ---- 缓存清理：界面缓存(Electron chromium) + 各项目 .tmp 临时脚本；不动会话记录/工作区文件/登录态 ----
const CHROMIUM_CACHE_DIRS = ["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "blob_storage", "Shared Dictionary"];
function wbUserDataDir() {
  if (process.versions.electron) {
    try { return require("electron").app.getPath("userData"); } catch {}
  }
  const home = require("os").homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "DoCode");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "DoCode");
  return path.join(home, ".config", "DoCode");
}
function dirSize(p) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(p)) {
      const fp = path.join(p, e);
      try {
        const st = fs.lstatSync(fp); // lstat：.tmp/node_modules 软链绝不能跟进去统计/删除
        if (st.isSymbolicLink()) continue;
        n += st.isDirectory() ? dirSize(fp) : st.size;
      } catch {}
    }
  } catch {}
  return n;
}
function cacheTmpDirs() {
  const set = new Set([path.join(getWorkspaceDir(), ".tmp")]);
  for (const p of config.projects || []) if (p && p.dir) set.add(path.join(p.dir, ".tmp"));
  return [...set];
}
function cacheStats() {
  const ud = wbUserDataDir();
  const ui = CHROMIUM_CACHE_DIRS.reduce((n, d) => n + dirSize(path.join(ud, d)), 0);
  const tmp = cacheTmpDirs().reduce((n, d) => n + dirSize(d), 0);
  return { ui, tmp, total: ui + tmp };
}
// ---------- 数据备份与恢复 ----------
// 备份包含模型配置、会话、记忆、用量和审计记录，按敏感数据处理。
// 工作空间成果文件不进备份（可能巨大，且用户自己看得见摸得着）。备份放项目根 backups/，
// 用系统 tar（mac/linux 自带，win10+ 也有），不为这事拖第三方压缩依赖。
const BACKUP_DIR = dataPath("backups");
const BACKUP_ENTRIES = ["data", "config.json", "schedules.json", "experts.json"];

// 备份里包含 config.json（含 API Key）和本地运行数据，按敏感数据处理。
// 本地工作台为单用户模式。
function backupAllowed() { return true; }

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^wb-backup-[\w.-]+\.tar\.gz$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch { return []; }
}

function makeBackup(tag) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const name = `wb-backup-${stamp}${tag ? "-" + tag : ""}.tar.gz`;
    const entries = BACKUP_ENTRIES.filter((e) => fs.existsSync(dataPath(e)));
    if (!entries.length) return reject(new Error("没有可备份的数据"));
    require("child_process").execFile(
      "tar", ["-czf", path.join(BACKUP_DIR, name), "-C", DATA_DIR, ...entries],
      { timeout: 300000 },
      (err) => (err ? reject(new Error(err.code === "ENOENT" ? "系统里没有 tar 命令（macOS/Linux/Windows 10 1803+ 都自带；更老的 Windows 请先升级系统）" : "tar 打包失败：" + err.message)) : resolve(name))
    );
  });
}

/** 校验名字必须来自现有备份列表，杜绝路径注入 */
function backupFile(name) {
  const hit = listBackups().find((b) => b.name === name);
  return hit ? path.join(BACKUP_DIR, hit.name) : null;
}

app.get("/api/backup", (req, res) => {
  if (!backupAllowed(req, res)) return;
  res.json({ list: listBackups(), covers: BACKUP_ENTRIES });
});
app.post("/api/backup", async (req, res) => {
  if (!backupAllowed(req, res)) return;
  try {
    const name = await makeBackup("");
    security.audit("数据备份", `已创建备份 ${name}`, "放行");
    res.json({ ok: true, name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/backup/download/:name", (req, res) => {
  if (!backupAllowed(req, res)) return;
  const p = backupFile(req.params.name);
  if (!p) return res.status(404).json({ error: "备份不存在" });
  res.download(p);
});
app.delete("/api/backup/:name", (req, res) => {
  if (!backupAllowed(req, res)) return;
  const p = backupFile(req.params.name);
  if (!p) return res.status(404).json({ error: "备份不存在" });
  fs.unlinkSync(p);
  res.json({ ok: true });
});
app.post("/api/backup/restore", async (req, res) => {
  if (!backupAllowed(req, res)) return;
  const p = backupFile(String((req.body || {}).name || ""));
  if (!p) return res.status(404).json({ error: "备份不存在" });
  try {
    // 恢复前先把现状自动备一份——恢复错了还能回来，这一步绝不省
    const safety = await makeBackup("before-restore");
    await new Promise((resolve, reject) =>
      require("child_process").execFile("tar", ["-xzf", p, "-C", DATA_DIR], { timeout: 300000 },
        (err) => (err ? reject(new Error(err.code === "ENOENT" ? "系统里没有 tar 命令（macOS/Linux/Windows 10 1803+ 都自带）" : "tar 解包失败：" + err.message)) : resolve()))
    );
    security.audit("数据恢复", `已从 ${path.basename(p)} 恢复（恢复前现状已存为 ${safety}）`, "放行");
    res.json({ ok: true, safety, restart_required: true, note: "已恢复到磁盘。内存里还是旧数据，重启应用后完全生效。" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/backup/restart", (req, res) => {
  if (!backupAllowed(req, res)) return;
  if (!process.versions.electron) return res.status(400).json({ error: "非桌面版：请手动重启服务进程" });
  res.json({ ok: true });
  // 先把响应发出去再重启，不然前端只看到断线
  setTimeout(() => {
    try {
      const { app: eApp, BrowserWindow } = require("electron");

      // ⚠️ 顺序很关键，踩过的坑写在这里：
      // 以前是 relaunch() + exit(0) 两行完事，结果新进程起来后 3800 端口还被旧进程占着，
      // server.js 在 require 阶段就 EADDRINUSE 抛出 —— 主进程活着、托盘图标建好了，
      // 但窗口是 show:false 且后面的代码全没跑到，于是「点了重启，程序只缩在托盘里」。
      // 更糟的是 confirmPatch() 也没机会执行，哨兵留在磁盘上，下次启动直接把好补丁拉黑。
      // 所以必须先把端口和连接放掉，确认干净了再拉新进程。

      // 1. 先销毁窗口：close 钩子会 preventDefault 藏到托盘，destroy 绕过它
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.destroy(); } catch {}
      }

      // 2. 关掉 HTTP 服务器并踢掉 keep-alive 连接。closeAllConnections 是 Node 18.2+，
      //    没有它的话 SSE 长连接能把 close 回调拖到几十秒后才响应
      const srv = global.__wbServer;
      const done = () => {
        // 3. 端口确实放开了，再登记并拉起新进程
        eApp.relaunch();
        eApp.exit(0);
      };
      if (srv) {
        try { if (srv.closeAllConnections) srv.closeAllConnections(); } catch {}
        try { srv.close(done); } catch { done(); }
        // close 回调万一不回来（还有连接挂着），1.5 秒后照样走
        setTimeout(done, 1500);
      } else {
        done();
      }
    } catch (e) {
      console.warn("[重启] 失败:", e.message);
      // 兜底：上面任何一步炸了也得把应用换掉，否则用户卡在「点了没反应」
      try { const { app: eApp } = require("electron"); eApp.relaunch(); eApp.exit(0); } catch {}
    }
  }, 600);
});

// ---------- 重启 AGENT ----------
app.post("/api/restart-agent", (req, res) => {
  if (!process.versions.electron) {
    return res.status(400).json({ success: false, error: "非桌面版：无法重启" });
  }

  res.json({ success: true });

  // 延迟执行重启逻辑，确保响应先发送给客户端
  setTimeout(() => {
    try {
      const { app: eApp, BrowserWindow } = require("electron");

      // 1. 销毁所有窗口
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.destroy(); } catch {}
      }

      // 2. 关闭 HTTP 服务器
      const srv = global.__wbServer;
      const done = () => {
        eApp.relaunch();
        eApp.exit(0);
      };

      if (srv) {
        try { if (srv.closeAllConnections) srv.closeAllConnections(); } catch {}
        try { srv.close(done); } catch { done(); }
        setTimeout(done, 1500);
      } else {
        done();
      }
    } catch (e) {
      console.warn("[重启 AGENT] 失败:", e.message);
      try {
        const { app: eApp } = require("electron");
        eApp.relaunch();
        eApp.exit(0);
      } catch {}
    }
  }, 600);
});

// ---------- 记忆搬家：导出 / 从其它 agent 导入 ----------
// 导出成一份人能读的 Markdown（手写区 + 条目区），到哪都能用。
// 导入支持两路：① 扫描本机已知的其它 agent 记忆文件（Claude Code / Codex / Claude Cowork），
// 只读扫描白名单里的路径，绝不接受任意路径；② 粘贴任意文本（腾讯 WorkBuddy 等没有固定
// 路径的，从它界面里复制出来贴进来就行）。解析是确定性的，不烧 token。
app.get("/api/memory/export", (req, res) => {
  const items = memory.list();
  const lines = [
    "# CloseCode 记忆导出",
    "",
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "## 背景说明（手写区，全局共享）",
    "",
    memory.manual() || "（空）",
    "",
    "## 记忆条目",
    "",
    ...(items.length
      ? items.map((it) => `- [${it.scope === memory.SHARED ? "共享" : it.scope}] ${it.text}`)
      : ["（还没有条目）"]),
    "",
  ];
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="closecode-memory-${new Date().toISOString().slice(0, 10)}.md"`);
  res.send(lines.join("\n"));
});

/** 本机其它 agent 的记忆文件白名单扫描（找得到才列出来，路径不存在就静默跳过） */
function memoryImportSources() {
  const home = require("os").homedir();
  const out = [];
  const push = (label, p, mode) => {
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size > 0 && st.size < 2 * 1024 * 1024) out.push({ label, path: p, size: st.size, mode });
    } catch {}
  };
  push("Claude Code 全局记忆（~/.claude/CLAUDE.md）", path.join(home, ".claude", "CLAUDE.md"), "manual");
  try {
    for (const d of fs.readdirSync(path.join(home, ".claude", "projects"))) {
      push(`Claude Code 项目记忆（${d.replace(/^-/, "").slice(0, 48)}）`, path.join(home, ".claude", "projects", d, "memory", "MEMORY.md"), "items");
    }
  } catch {}
  push("Codex 全局记忆（~/.codex/AGENTS.md）", path.join(home, ".codex", "AGENTS.md"), "manual");
  push("Claude Cowork 记忆（~/.cowork/CLAUDE.md）", path.join(home, ".cowork", "CLAUDE.md"), "manual");
  push("Claude Cowork 记忆（应用目录）", path.join(home, "Library", "Application Support", "Claude Cowork", "CLAUDE.md"), "manual");
  if (process.env.APPDATA) push("Claude Cowork 记忆（应用目录）", path.join(process.env.APPDATA, "Claude Cowork", "CLAUDE.md"), "manual");
  return out;
}

app.get("/api/memory/import/scan", (_req, res) => res.json({ sources: memoryImportSources() }));

app.post("/api/memory/import", (req, res) => {
  const b = req.body || {};
  let content = "", label = "粘贴的内容";
  if (b.path) {
    const hit = memoryImportSources().find((s) => s.path === String(b.path));
    if (!hit) return res.status(400).json({ error: "只能导入扫描列表里的文件（防任意路径读取）" });
    try { content = fs.readFileSync(hit.path, "utf8"); } catch (e) { return res.status(500).json({ error: "读取失败：" + e.message }); }
    label = hit.label;
  } else {
    content = String(b.text || "");
  }
  content = content.trim();
  if (!content) return res.status(400).json({ error: "没有可导入的内容" });
  const mode = b.mode === "manual" ? "manual" : "items";
  if (mode === "manual") {
    // 成段的背景/规范：整段并入手写区，加来源标头，去重靠人眼（手写区本来就是人编辑的）
    const cur = memory.manual();
    if (cur.includes(content.slice(0, 200))) return res.json({ ok: true, added: 0, skipped: 1, note: "内容已在背景说明里，跳过" });
    memory.saveManual((cur ? cur + "\n\n" : "") + `## 导入自 ${label}（${new Date().toISOString().slice(0, 10)}）\n\n` + content);
    return res.json({ ok: true, added: 1, mode });
  }
  // 条目模式：逐行解析 markdown 列表（- / * / 数字.），[标题](链接) 压成 标题，跳过标题行和短行
  let added = 0, skipped = 0;
  const lines = content.split(/\r?\n/).slice(0, 500);
  for (const raw of lines) {
    let t = raw.trim();
    if (!t || /^#{1,6}\s/.test(t) || /^[-*_]{3,}$/.test(t)) continue; // 标题、分隔线
    t = t.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "");
    t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // markdown 链接压成文字
    t = t.replace(/\*\*/g, "").trim();
    if (t.length < 4) continue;
    const r = memory.add({ text: t, shared: !!b.shared, source: "user" });
    if (r.ok) added++; else skipped++;
  }
  security.audit("记忆导入", `${label}：导入 ${added} 条，跳过 ${skipped} 条`, "放行");
  res.json({ ok: true, added, skipped, mode });
});

app.get("/api/cache", (_req, res) => res.json(cacheStats()));
app.post("/api/cache/clear", async (_req, res) => {
  const before = cacheStats();
  if (process.versions.electron) {
    // 桌面版走官方 API：HTTP 缓存/代码缓存/着色器缓存；Cookie 与 localStorage（登录态、主题）不动
    try {
      const ses = require("electron").session.defaultSession;
      await ses.clearCache();
      try { await ses.clearCodeCaches({}); } catch {}
      try { await ses.clearStorageData({ storages: ["shadercache", "cachestorage"] }); } catch {}
    } catch (e) { console.warn("[缓存] Electron 清理失败:", e.message); }
  }
  const ud = wbUserDataDir();
  for (const d of CHROMIUM_CACHE_DIRS) {
    const dir = path.join(ud, d);
    try {
      for (const e of fs.readdirSync(dir)) {
        try { fs.rmSync(path.join(dir, e), { recursive: true, force: true }); } catch {} // 被占用就跳过
      }
    } catch {}
  }
  for (const dir of cacheTmpDirs()) {
    try {
      for (const e of fs.readdirSync(dir)) {
        const fp = path.join(dir, e);
        try {
          if (fs.lstatSync(fp).isSymbolicLink()) fs.unlinkSync(fp); // node_modules 软链只解链，下次 runNode 自动重建
          else fs.rmSync(fp, { recursive: true, force: true });
        } catch {}
      }
    } catch {}
  }
  const after = cacheStats();
  res.json({ ok: true, freed: Math.max(0, before.total - after.total), before: before.total, after: after.total });
});

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

app.get("/api/skills", (_req, res) =>
  // plugin 字段标出技能来自哪个 Agent Plugins 插件（本地技能没有这个字段），界面据此禁用编辑/删除
  res.json((runtime ? runtime.getSkills() : []).map((s) => ({ name: s.name, description: s.description, plugin: s.plugin || "", builtin:!!s.builtin })))
);
// 技能管理：getSkills 每次现读磁盘，增删改/安装即热生效，无需重启
const skillsMgr = require("./skills");
app.get("/api/skills/:name", (req, res) => {
  const s = skillsMgr.getSkillFull(req.params.name);
  if (!s) return res.status(404).json({ error: "技能不存在" });
  res.json(s);
});
app.post("/api/skills", (req, res) => {
  try {
    const { name, description, content, original_name } = req.body || {};
    if (!String(name || "").trim()) throw new Error("技能名不能为空");
    if (!String(content || "").trim()) throw new Error("技能内容不能为空");
    res.json(skillsMgr.saveSkill({ name, description, content, original_name }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete("/api/skills/:name", (req, res) => {
  try {
    res.json({ ok: skillsMgr.deleteSkill(req.params.name) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/skills/install", async (req, res) => {
  try {
    const installed = await skillsMgr.installFromGitHub((req.body || {}).url);
    res.json({ ok: true, installed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/skills/install-zip", async (req, res) => {
  try {
    const installed = await skillsMgr.installFromZip((req.body || {}).data);
    res.json({ ok: true, installed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- 默认技能：不随仓库打包，点一下从上游装 ----
app.get("/api/skills/defaults/list", (_req, res) => res.json(skillsMgr.listDefaultSkills()));
app.post("/api/skills/defaults/install", async (req, res) => {
  try {
    const { names, force } = req.body || {};
    const results = await skillsMgr.ensureDefaultSkills({
      only: Array.isArray(names) && names.length ? names : null,
      force: !!force, // 「重新下载」要真的重下，不然点了没反应
    });
    res.json({ ok: true, results });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Agent Plugins 1.0.0 插件 ----
const pluginsMgr = require("./plugins");
app.get("/api/plugins", (_req, res) => {
  const list = pluginsMgr.loadPlugins().map((p) => ({
    ok: p.ok,
    name: p.name,
    error: p.error || "",
    warnings: p.warnings || [],
    version: p.manifest?.version || "",
    description: p.manifest?.description || "",
    license: p.manifest?.license || "",
    author: p.manifest?.author?.name || "",
    homepage: p.manifest?.homepage || "",
    repository: p.manifest?.repository || "",
    skills: (p.skills || []).map((s) => ({ name: s.name, description: s.description })),
    mcp_servers: (p.mcpServers || []).map((s) => ({ name: s.name, transport: s.transport })),
    bytes: p.ok ? skillsMgr.dirSize(p.dir) : 0,
    source: pluginsMgr.pluginSource(p.name), // 有来源才给「更新」按钮
  }));
  res.json({ spec: pluginsMgr.SPEC_VERSION, plugins: list, mcp: mcpManager.status() });
});
app.post("/api/plugins/install", async (req, res) => {
  try {
    const info = await pluginsMgr.installPluginFromGitHub((req.body || {}).url);
    // 插件带的 MCP 服务器要现起才能用；技能是每次任务现读磁盘的，不用管
    const started = await startPluginMcp(info.name);
    res.json({ ok: true, installed: info, mcp_started: started });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/plugins/:name/update", async (req, res) => {
  try {
    const name = req.params.name;
    // 旧的先停干净：重装会把目录整个换掉，老进程留着还指着已经删掉的文件
    mcpManager.stopPlugin(name);
    const info = await pluginsMgr.updatePlugin(name);
    const started = await startPluginMcp(info.name);
    res.json({ ok: true, updated: info, mcp_started: started });
  } catch (e) {
    // 更新失败也得把停掉的服务器捞回来，不然用户点一下「更新」反而把能用的搞没了
    try { await startPluginMcp(req.params.name); } catch { /* 插件目录可能已经没了 */ }
    res.status(400).json({ error: e.message });
  }
});
app.delete("/api/plugins/:name", (req, res) => {
  try {
    // 先停进程再删目录：目录一删就查不出它带过哪些服务器，子进程会一直挂到重启应用
    const stopped = mcpManager.stopPlugin(req.params.name);
    const ok = pluginsMgr.removePlugin(req.params.name);
    if (!ok) return res.json({ ok: false, note: "没有这个插件" });
    res.json({
      ok: true,
      mcp_stopped: stopped,
      note: stopped.length ? `插件已卸载，同时停掉了它带的 ${stopped.length} 个 MCP 服务器` : "插件已卸载",
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** 只起某个插件里还没连上的 MCP 服务器（装完立刻可用，不用重启） */
async function startPluginMcp(pluginName) {
  const want = pluginsMgr.pluginMcpServers().filter((s) => s.plugin === pluginName && !mcpManager.clients.has(s.name));
  if (!want.length) return [];
  await mcpManager.startAll(want);
  return want.filter((s) => mcpManager.clients.has(s.name)).map((s) => s.name);
}

// 文件上传到工作空间（输入框 ＋ 按钮）
app.post("/api/upload", async (req, res) => {
  try {
    const { name, data_b64 } = req.body || {};
    if (typeof name !== "string" || !name || typeof data_b64 !== "string" || !data_b64) return res.status(400).json({ error: "缺少 name 或 data_b64" });

    // 显式项目不存在时拒绝，不能静默上传到另一个活动项目。
    const baseDir = fileWorkspace(req);

    const p = safePath(path.basename(name), baseDir);
    await require("./lib/task-git").writeTaskUpload({ workspace: baseDir, file: path.relative(baseDir, p), bytes: Buffer.from(data_b64, "base64") });
    res.json({ ok: true, name: path.basename(name) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
// 专家管理：增删改就地改 experts 数组（runtime 闭包同一引用，热生效）+ 持久化 experts.json
// 一个专家 = 头像 + 名字 + 花名 + 说明 + 绑定技能 + 默认提示词 的智能体，用户可自建。
const EXPERT_FIELDS = ["name", "alias", "avatar", "category", "tags", "description", "skills", "system"];
function publicExpert(e, catalog = skillsMgr.loadSkills()) {
  return {
    name: e.name,
    alias: e.alias || "",
    avatar: e.avatar || "🧑‍💼",
    category: e.category || "未分类",
    tags: Array.isArray(e.tags) ? e.tags : [],
    description: e.description || "",
    skills: Array.isArray(e.skills) ? e.skills.map(name=>skillsMgr.resolveSkill(name,catalog)?.name || name) : [],
    system: e.system || "",
    missing_skills: (e.skills || []).filter(name => !skillsMgr.resolveSkill(name, catalog)),
    builtin: !!e.builtin,
  };
}
app.get("/api/experts", (_req, res) => {
  const catalog = skillsMgr.loadSkills();
  res.json(experts.map(e => publicExpert(e, catalog)));
});
app.post("/api/experts", (req, res) => {
  const b = req.body || {};
  const n = String(b.name || "").trim();
  if (!n || !String(b.system || "").trim()) return res.status(400).json({ error: "专家名称与角色设定（提示词）不能为空" });
  if (n === "delegate_to_expert" || n.length > 20) return res.status(400).json({ error: "专家名称不合法（≤20 字）" });
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 12) : []);
  const idx = experts.findIndex((e) => e.name === (b.original_name || n));
  // 改名时要保证新名字没被别人占着
  if (experts.some((e, i) => e.name === n && i !== idx)) return res.status(400).json({ error: "同名专家已存在" });
  const entry = {
    name: n,
    alias: String(b.alias || "").trim().slice(0, 12),
    avatar: String(b.avatar || "🧑‍💼").trim().slice(0, 8) || "🧑‍💼",
    category: String(b.category || "未分类").trim().slice(0, 12) || "未分类",
    tags: arr(b.tags),
    description: String(b.description || "").trim(),
    skills: arr(b.skills),
    system: String(b.system).trim(),
  };
  if (idx >= 0) {
    entry.builtin = !!experts[idx].builtin; // 内置标记只由 experts.json 决定，接口改不动
    experts.splice(idx, 1, entry);
    // 改了名字的话，团队成员名单要跟着改，否则团里挂着一个不存在的人
    if (b.original_name && b.original_name !== n) {
      for (const t of expertTeams) t.members = t.members.map((m) => (m === b.original_name ? n : m));
    }
  } else experts.push(entry);
  saveExperts();
  res.json({ ok: true, expert: publicExpert(entry) });
});
app.delete("/api/experts/:name", (req, res) => {
  const idx = experts.findIndex((e) => e.name === req.params.name);
  if (idx < 0) return res.status(404).json({ error: "专家不存在" });
  const [gone] = experts.splice(idx, 1);
  for (const t of expertTeams) t.members = t.members.filter((m) => m !== gone.name); // 顺手把团里的他摘掉
  saveExperts();
  res.json({ ok: true });
});

// 专家团 = 智能体团队：把若干专家编成一队，一次委派整队按顺序接力完成
app.get("/api/expert-teams", (_req, res) =>
  res.json(
    expertTeams.map((t) => ({
      name: t.name,
      avatar: t.avatar || "👥",
      description: t.description || "",
      members: (t.members || []).filter((m) => experts.some((e) => e.name === m)),
    }))
  )
);
app.post("/api/expert-teams", (req, res) => {
  const b = req.body || {};
  const n = String(b.name || "").trim();
  if (!n || n.length > 20) return res.status(400).json({ error: "团队名称不合法（1~20 字）" });
  const members = [...new Set((Array.isArray(b.members) ? b.members : [])
    .map((m) => String(m).trim())
    .filter((m) => experts.some((e) => e.name === m)))];
  if (members.length < 2) return res.status(400).json({ error: "一个团至少要有 2 位专家（成员必须是已存在的专家）" });
  const idx = expertTeams.findIndex((t) => t.name === (b.original_name || n));
  if (expertTeams.some((t, i) => t.name === n && i !== idx)) return res.status(400).json({ error: "同名专家团已存在" });
  const entry = {
    name: n,
    avatar: String(b.avatar || "👥").trim().slice(0, 8) || "👥",
    description: String(b.description || "").trim(),
    members: [...new Set(members)].slice(0, 8), // 接力式执行，人多了会把时间预算耗光
  };
  if (idx >= 0) expertTeams.splice(idx, 1, entry);
  else expertTeams.push(entry);
  saveExperts();
  res.json({ ok: true, team: entry });
});
app.delete("/api/expert-teams/:name", (req, res) => {
  const idx = expertTeams.findIndex((t) => t.name === req.params.name);
  if (idx < 0) return res.status(404).json({ error: "专家团不存在" });
  expertTeams.splice(idx, 1);
  saveExperts();
  res.json({ ok: true });
});

// ===== 桌面宠物：自定义形象（自己或朋友的照片）=====
// 存进 data/ 而不是 public/：一来不污染仓库（data/ 已 gitignore），二来跟着备份一起走。
const PET_PHOTO_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
function petPhotoPath() {
  for (const ext of [".png", ".jpg", ".webp", ".gif"]) {
    const p = dataPath("data", "pet-avatar" + ext);
    if (fs.existsSync(p)) return p;
  }
  return "";
}
function clearPetPhoto() {
  for (const ext of [".png", ".jpg", ".webp", ".gif"]) {
    try { fs.unlinkSync(dataPath("data", "pet-avatar" + ext)); } catch {}
  }
}
app.post("/api/pet/avatar", (req, res) => {
  try {
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]+)$/.exec(String((req.body || {}).data_url || ""));
    if (!m) return res.status(400).json({ error: "只收 png / jpg / webp / gif 图片" });
    const buf = Buffer.from(m[2], "base64");
    // 前端已经压到 320px 见方再传，这里只兜底：3MB 以上不像压过，多半是直接甩了张原图
    if (!buf.length || buf.length > 3 * 1024 * 1024) return res.status(400).json({ error: "图片太大（压缩后应小于 3MB）" });
    fs.mkdirSync(dataPath("data"), { recursive: true });
    clearPetPhoto(); // 换形象先清旧的，免得两个扩展名同时躺着分不清用哪个
    fs.writeFileSync(dataPath("data", "pet-avatar" + PET_PHOTO_EXT[m[1]]), buf);
    config.pet = { ...(config.pet || {}), character: "photo", enabled: true }; // 特地传了张照片 = 想要它出现
    saveConfig();
    if (global.__wbPet) try { global.__wbPet.applyConfig({ ...config.pet, enabled: config.pet.enabled === true }); } catch {}
    res.json({ ok: true, size: buf.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/pet/avatar", (_req, res) => {
  clearPetPhoto();
  const cur = config.pet || {};
  config.pet = { ...cur, character: cur.character === "photo" || cur.character === undefined ? "yaya3d" : cur.character };
  saveConfig();
  if (global.__wbPet) try { global.__wbPet.applyConfig({ ...config.pet, enabled: config.pet.enabled === true }); } catch {}
  res.json({ ok: true });
});

/**
 * 桌面宠物工具的落地实现（tools.js 的 desktop_pet 通过 global.__wbPetTool 调进来）。
 *
 * 为什么放在 server.js：改宠物要同时动三样东西——config.json（持久化）、data/pet-avatar.png（形象）、
 * 还有 Electron 主进程里那个活着的窗口。这三样的把手都在这个文件里，tools.js 只管把参数递过来。
 * 纯 node 模式没有桌面窗口，整个工具会如实报错而不是假装成功。
 */
global.__wbPetTool = {
  async run(input, baseDir, workspace) {
    const P = global.__wbPet;
    const action = String((input || {}).action || "create").toLowerCase();
    if (!P) {
      return {
        content: "桌面宠物只在桌面版里有（用 `npm run app` 启动的那种）。当前跑的是纯服务端模式（npm start），没有桌面窗口可以挂宠物。请如实告诉用户这一点，别假装做好了。",
        isError: true,
      };
    }
    const cur = config.pet || {};
    const nowInfo = () => {
      const current = config.pet || {};
      const names = { cat: "内置小猫", spider: "Q版蜘蛛侠", judy: "Q版兔朱迪", fox: "绘本小狐狸", muyu: "Q版木鱼", yaya: "芽芽小机灵·2D", yaya3d: "芽芽小机灵·3D", photo: "用户上传的照片" };
      const character = current.character === undefined || (current.character === "photo" && !petPhotoPath()) ? "yaya3d" : current.character;
      const name = Object.prototype.hasOwnProperty.call(names, character) ? names[character] : names.cat;
      return `当前状态：宠物${current.enabled === true ? "已显示" : "未显示"}，形象=${name}，大小=${Math.round((current.scale || 1) * 100)}%。`;
    };

    if (action === "status") return { content: nowInfo(), isError: false };

    if (action === "hide") {
      config.pet = { ...cur, enabled: false };
      saveConfig();
      try { P.applyConfig({ ...config.pet, enabled: false }); } catch {}
      return { content: "桌面宠物已收起。用户想让它回来的话，再叫一声就行（或者去 设置 → 人设 里打开）。", isError: false };
    }

    if (action === "show") {
      config.pet = { ...cur, enabled: true };
      saveConfig();
      try { P.applyConfig({ ...config.pet, enabled: true }); } catch {}
      return { content: "桌面宠物已经站到桌面右下角了。" + nowInfo(), isError: false };
    }

    if (action === "remove") {
      clearPetPhoto();
      config.pet = { ...cur, enabled: false, character: cur.character === "photo" || cur.character === undefined ? "yaya3d" : cur.character };
      saveConfig();
      try { P.applyConfig({ ...config.pet, enabled: false }); } catch {}
      return { content: "宠物已经撤掉，上传的照片也从本机删干净了。", isError: false };
    }

    if (action !== "create") return { content: `不认识的 action「${action}」，只支持 create / show / hide / remove / status。`, isError: true };

    // ---- create：把一张图做成宠物形象 ----
    const raw = String((input || {}).image || "").trim();
    if (!raw) {
      return {
        content: "做宠物得先有张图。请让用户在输入框里上传一张照片（人像、宠物照、表情包都行），拿到文件名后把它作为 image 参数再调一次。",
        isError: true,
      };
    }
    // 用户上传的图落在工作空间根目录，agent 自己产出的图在本次对话的成果子目录里，两处都找
    if (!workspace) return { content: "未绑定项目目录，拒绝读取宠物源图。", isError: true };
    const wsRoot = workspace;
    let abs = "";
    for (const cand of [baseDir ? path.resolve(baseDir, raw) : "", path.resolve(wsRoot, raw), path.resolve(wsRoot, path.basename(raw))]) {
      if (!cand) continue;
      try {
        const checked = safePath(cand, wsRoot);
        if (fs.existsSync(checked) && fs.statSync(checked).isFile()) { abs = checked; break; }
      } catch {} // 包括指向其他项目的 junction/symlink
    }
    if (!abs) return { content: `工作空间里找不到「${raw}」。先用 list_files 看看用户上传的图到底叫什么名字。`, isError: true };
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(abs)) return { content: `「${path.basename(abs)}」看着不是图片。支持 png / jpg / webp / gif / bmp。`, isError: true };

    let buf, note = "";
    try {
      // 用 Electron 自带的 nativeImage 裁切缩放，不引任何图像库。GIF 只取第一帧（宠物本来就自带动效，
      // 再叠一层 GIF 动画会打架），这点必须跟用户说清楚，不能让他以为动图没生效是 bug。
      const { nativeImage } = require("electron");
      let img = nativeImage.createFromPath(abs);
      if (img.isEmpty()) return { content: `「${path.basename(abs)}」解码失败，可能是文件损坏或者根本不是图片。`, isError: true };
      const sz = img.getSize();
      const side = Math.min(sz.width, sz.height);
      if (sz.width !== sz.height) {
        img = img.crop({ x: Math.round((sz.width - side) / 2), y: Math.round((sz.height - side) / 2), width: side, height: side });
        note += `原图 ${sz.width}×${sz.height} 不是正方形，已按中心裁成方图；`;
      }
      img = img.resize({ width: 320, height: 320, quality: "best" });
      if (/\.gif$/i.test(abs)) note += "GIF 只取了第一帧（宠物自己带呼吸/跳跃动效）；";
      buf = img.toPNG();
      if (!buf || !buf.length) throw new Error("编码 PNG 失败");
    } catch (e) {
      return { content: "处理图片失败：" + e.message, isError: true };
    }

    fs.mkdirSync(dataPath("data"), { recursive: true });
    clearPetPhoto();
    fs.writeFileSync(dataPath("data", "pet-avatar.png"), buf);
    const scale = Math.max(0.6, Math.min(2, Number((input || {}).scale) || Number(cur.scale) || 1));
    config.pet = { ...cur, enabled: true, character: "photo", scale };
    saveConfig();
    try { P.applyConfig({ ...config.pet, enabled: true }); } catch {}
    try { P.setState("done", "新形象上岗"); } catch {}
    return {
      content: `已经用「${path.basename(abs)}」做好桌面宠物，它现在站在桌面右下角。${note}\n` +
        "它会实时显示你在干什么：干活时头顶转圈、有问题要问时跳起来并弹系统通知、任务完成撒花。\n" +
        "点它一下开关主窗口，拖动换位置，右键有菜单（回到右下角 / 免打扰 / 收起）。\n" +
        "照片只存在用户本机的 data/ 目录，没有上传到任何服务器。",
      isError: false,
    };
  },
};
// 在访达/资源管理器里定位到这个文件（不是打开文件本身，是打开它所在的文件夹并选中它）
app.post("/api/files/reveal", (req, res) => {
  try {
    // Fix C: 支持跨项目文件定位，通过 project 字段指定项目
    const baseDir = fileWorkspace(req);
    const p = safePath(String((req.body || {}).name || ""), baseDir); // 越界一律抛错，跟下载走同一道门
    if (!fs.existsSync(p)) return res.status(404).json({ error: "文件不存在" });
    let revealed = false;
    try {
      const { shell } = require("electron");
      if (shell && shell.showItemInFolder) { shell.showItemInFolder(p); revealed = true; }
    } catch {}
    if (!revealed) openWithSystem(path.dirname(p)); // 纯 node 模式：退而求其次，打开所在文件夹
    res.json({ ok: true, revealed });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/files/download/:name", (req, res) => {
  try {
    // Fix C: 支持跨项目文件下载，通过 ?project= 参数指定项目
    const baseDir = fileWorkspace(req);
    const p = safePath(req.params.name, baseDir);
    if (!fs.existsSync(p)) return res.status(404).send("文件不存在");
    res.download(p);
  } catch (e) {
    res.status(400).send(e.message);
  }
});

// 应用内预览：按正确 Content-Type 内联返回（HTML/图片/PDF 可直接在 iframe/img 中显示）
app.get("/api/files/view/:name", (req, res) => {
  try {
    // Fix C: 支持跨项目文件访问，通过 ?project= 参数指定项目
    const baseDir = fileWorkspace(req);
    const p = safePath(req.params.name, baseDir);
    if (!fs.existsSync(p)) return res.status(404).send("文件不存在");
    // 隔离预览由可信主文档读取原文，禁止重定向；直接导航仍保留相对资源的项目路径。
    if (/\.(html?|svg)$/i.test(p) && req.query.project && req.query.raw !== "1") {
      const relative = path.relative(baseDir, p).split(path.sep).map(encodeURIComponent).join("/");
      return res.redirect(307, "/workspace-project/" + encodeURIComponent(req.query.project) + "/" + relative);
    }
    res.sendFile(p);
  } catch (e) {
    res.status(400).send(e.message);
  }
});

// 壁纸图片访问接口
app.get("/api/wallpaper/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    // 只允许访问壁纸文件
    if (!/^wallpaper-\d+\.(png|jpg|jpeg|gif|webp)$/.test(filename)) {
      return res.status(400).send("无效的文件名");
    }
    const filepath = dataPath('wallpapers', filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).send("壁纸文件不存在");
    }
    res.sendFile(filepath);
  } catch (e) {
    res.status(400).send(e.message);
  }
});

// 对话里的内联图表「存为文件」：内容是前端已经渲染过的东西，落盘到工作目录就能进成果面板、
// 能下载、能被后续回合当素材继续用。扩展名白名单挡住"顺手写个 .sh/.command 再让我打开"的路子。
const SAVE_EXT_OK = /\.(svg|png|jpe?g|html?|md|markdown|txt|csv|json)$/i;
app.post("/api/files/save", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const content = req.body?.content;
    if (!name || typeof content !== "string") return res.status(400).json({ error: "缺少 name 或 content" });
    if (!SAVE_EXT_OK.test(name)) return res.status(400).json({ error: "不支持保存这种类型的文件" });
    const workspace = fileWorkspace(req);
    const p = safePath(name, workspace);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const b64 = content.match(/^data:[^;]+;base64,(.*)$/s);
    await fs.promises.writeFile(p, b64 ? Buffer.from(b64[1], "base64") : content);
    res.json({ ok: true, name, files: await outputFiles(workspace) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- 本地部署预览：把工作目录当静态站点跑在一个独立端口上 ----
// 应用内 iframe 预览走 /api/files/view，够看长相；但真正的网页要有自己的 origin 才对
// （相对路径引资源、fetch、localStorage、手机上开来看）。这里起一个只监听本机的静态服务器。
let previewServers = new Map(); // 项目名 -> { srv, port, dir, lanOpen }
function lanAddress() {
  const nets = require("os").networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}
function previewState(projectName = config.active_project || "默认项目") {
  const ps = previewServers.get(projectName);
  if (!ps) return { running: false, project: projectName };
  const lan = ps.lanOpen ? lanAddress() : null;
  return {
    running: true,
    project: projectName,
    port: ps.port,
    dir: ps.dir,
    lan_open: !!ps.lanOpen,
    url: `http://127.0.0.1:${ps.port}/`,
    lan_url: lan ? `http://${lan}:${ps.port}/` : null,
  };
}
app.get("/api/preview/status", (req, res) => {
  try { fileWorkspace(req); res.json(previewState(req.query.project)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/preview/start", (req, res) => {
  const projectName = req.body?.project ?? config.active_project ?? "默认项目";
  let dir;
  try { dir = fileWorkspace(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  // lan=true 才对局域网开放：开了手机能扫，但同一个 Wi-Fi 下的人也能翻整个工作目录，所以默认关
  const lanOpen = !!(req.body && req.body.lan);
  // open=文件名：服务就绪后用系统默认浏览器打开它
  const openName = req.body && req.body.open ? String(req.body.open).replace(/^\/+/, "") : null;
  const done = (st) => {
    if (openName) openWithSystem(st.url + encodeURIComponent(openName));
    res.json(st);
  };
  // 已经在跑且参数一致：不用重起，但该开的浏览器还是得开。
  // （这里以前是直接 return，把 open 一起吞了——而「在浏览器打开」按钮只在服务已启动时才出现，
  //   必然走这条分支，所以那个按钮点了从来没反应过。）
  const existing = previewServers.get(projectName);
  if (existing && existing.dir === dir && existing.lanOpen === lanOpen) return done(previewState(projectName));
  if (existing) { try { existing.srv.close(); } catch {} previewServers.delete(projectName); }
  const site = express();
  site.use(projectStatic(dir));
  // 端口 0 = 让系统分配空闲端口，避免和用户本机其它服务撞车
  const srv = site.listen(0, lanOpen ? "0.0.0.0" : "127.0.0.1", () => {
    previewServers.set(projectName, { srv, port: srv.address().port, dir, lanOpen });
    done(previewState(projectName));
  });
  srv.on("error", (e) => {
    if (!res.headersSent) res.status(500).json({ error: "本地预览服务起不来：" + e.message });
  });
});
app.post("/api/preview/stop", (req, res) => {
  try { fileWorkspace(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  const projectName = req.body?.project ?? config.active_project ?? "默认项目";
  const existing = previewServers.get(projectName);
  if (existing) { try { existing.srv.close(); } catch {} previewServers.delete(projectName); }
  res.json({ running: false, project: projectName });
});

// 用系统默认程序打开（Word/PPT/Excel 等交给本机 Office/WPS）
app.post("/api/files/open/:name", (req, res) => {
  try {
    // Fix C: 支持跨项目文件打开，通过 ?project= 参数指定项目
    const baseDir = fileWorkspace(req);
    const p = safePath(req.params.name, baseDir);
    if (!fs.existsSync(p)) return res.status(404).json({ error: "文件不存在" });
    openWithSystem(p);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, message, mode, regen, project, testMode, testConfig, delegation, requestId } = req.body || {};
  if (!sessionId || !message) return res.status(400).json({ error: "缺少 sessionId 或 message" });
  if (requestId != null && (typeof requestId !== "string" || !/^[\w-]{1,128}$/.test(requestId))) return res.status(400).json({ error: "requestId 不合法" });

  // 测试模式：不保存会话
  if (testMode && testConfig) {
    const testController = new AbortController();
    const abortTest = () => testController.abort();
    res.once('close', abortTest);
    const testStartTime = Date.now();
    console.log(`[模型测试] 收到测试请求: ${testConfig.model}, base_url: ${testConfig.base_url}`);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const beforeAgentCall = Date.now();
      console.log(`[模型测试] 调用runSimpleTest, 准备耗时: ${beforeAgentCall - testStartTime}ms`);

      const stream = await runSimpleTest(message, testConfig, testController.signal);

      const afterAgentCall = Date.now();
      console.log(`[模型测试] agent.runSimpleTest返回, API调用耗时: ${afterAgentCall - beforeAgentCall}ms`);

      let chunkIndex = 0;
      for await (const chunk of stream) {
        if (testController.signal.aborted) break;
        chunkIndex++;
        const chunkTime = Date.now();
        if (chunkIndex === 1) {
          console.log(`[模型测试] 首个chunk返回, 总耗时: ${chunkTime - testStartTime}ms`);
        }
        if (!res.destroyed && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
        }
      }

      const testEndTime = Date.now();
      console.log(`[模型测试] 测试完成, 共${chunkIndex}个chunk, 总耗时: ${testEndTime - testStartTime}ms`);

      if (!res.destroyed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
      }
    } catch (err) {
      if (testController.signal.aborted) return;
      const errorTime = Date.now();
      console.error(`[模型测试] 测试失败: ${err.message}, 耗时: ${errorTime - testStartTime}ms`);
      if (!res.destroyed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        res.end();
      }
    } finally {
      res.off('close', abortTest);
      testController.abort();
    }
    return;
  }

  let selectedDelegation;
  try { selectedDelegation = validateDelegation(delegation, { mode: mode || "craft", experts, teams: expertTeams }); }
  catch (error) { return res.status(400).json({ error: error.message }); }

  if (activeRuns.has(sessionId)) {
    return res.status(409).json({ code: "SESSION_RUNNING", error: "该会话已有任务在运行，可用「插队」把补充说明注入当前任务。" });
  }
  if (deletedSessions.has(sessionId)) return res.status(404).json({ error: "任务已删除，请新建会话" });
  if (renamingSessions.has(sessionId)) return res.status(409).json({ error: "标题正在保存，请稍后重试" });

  const sess = getSession(sessionId);
  let pinned;
  try {
    ensureProjects();
    pinned = require("./lib/workspace-scope").bindSessionProject(sess, project, config.projects, config.active_project);
  } catch (error) { return res.status(409).json({ error: error.message }); }
  const pinnedWorkspace = pinned.workspace;
  const pinnedProjectContext = pinned.project ? projectContextOf(pinned.project) || "" : "";

  require("./lib/chat-sse").openChatStream(res);
  // 客户端可能中途断开（刷新页面/断网/电脑睡眠），任务照跑：
  // 主连接断了就不再写它，事件继续发给 /api/chat/stream 续流进来的订阅者
  const runState = { ctrl: new AbortController(), interject: [], asks: new Map(), subscribers: new Set(), events: null, requestId };
  const send = (event) => {
    if (event.type === "files") event = { ...event, project: sess.project };
    const line = `data: ${JSON.stringify(event)}\n\n`;
    if (!res.destroyed && !res.writableEnded) { try { res.write(line); } catch {} }
    for (const sub of runState.subscribers) { try { sub.write(line); } catch {} }
  };

  const sessLLM = llmForSession(sess); // 本对话生效的模型（含专家子代理、标题、记账）
  if (regen) {
    // 重新生成：回滚掉最后一轮（用户消息及其后的所有内容），下面会把同一条消息重新入队
    const lastUser = sess.history.map((h) => h.role).lastIndexOf("user");
    if (lastUser >= 0) sess.history.splice(lastUser);
    if (sess.transcript.length && sess.transcript[sess.transcript.length - 1].type === "assistant") sess.transcript.pop();
    if (sess.transcript.length && sess.transcript[sess.transcript.length - 1].type === "user") sess.transcript.pop();
  }
  // 截断兜底标题要先去掉「【任务类型：X】」这个给模型看的前缀，不然起标题失败时历史列表全是它
  if (!sess.title) sess.title = message.replace(/^\s*【任务类型：[^】]*】\s*/, "").slice(0, 24);
  // 上一轮的 user 还孤零零躺在历史末尾 = 那次任务一个字都没跑出来（用户秒停、开局就报错），
  // 消息却已经先落盘了。这时直接再 push 一条就会留下并排的两条 user，而严格校验角色交替的
  // 渠道（Grok / Claude / 多数中转网关）见到它就整条请求 400 —— 历史是落盘的，于是这个会话
  // 之后每次请求都 400，等于被这条坏消息永久废掉。所以就地并进上一条，不再新增：
  //   · 又发了同一句话（最常见：以为没发出去，重发一次）→ 什么都不做，那条已经在历史里了；
  //   · 换了说法 → 接在后面，两句都留着，一个字不丢。
  const tail = sess.history[sess.history.length - 1];
  if (tail && tail.role === "user") {
    if (String(tail.content) !== message) tail.content = `${tail.content}\n\n${message}`;
    console.warn("[chat] 上一轮任务没有产生任何回复，本条消息已并入上一条用户消息（避免历史里出现并排的两条 user）");
  } else {
    sess.history.push({ role: "user", content: message });
  }
  sess.transcript.push({ type: "user", text: message, mode, delegation: selectedDelegation });
  const asstEvents = [];
  const transcriptEntry = { type: "assistant", events: asstEvents, requestId };
  sess.transcript.push(transcriptEntry);
  autosaveSession(sessionId, 0); // 先把用户这句话落盘，后面再崩至少问题还在

  // Fix C：为本次运行 pin 一个绝对工作目录，后续 runTask → executeTool 的所有文件操作都走它，
  // 不再读全局 workspaceDir（那个会被项目切换改掉，导致任务写到一半时文件落点突变）
  runState.workspace = pinnedWorkspace; // 挂在 runState 上供后续环节取用
  runState.project = sess.project;

  runState.events = asstEvents; // 续流端点靠它补发已记录的事件
  activeRuns.set(sessionId, runState);
  persistRunning();
  const emitFn = recordingEmit(send, asstEvents, sessionId, transcriptEntry);
  const total = { prompt: 0, completion: 0, calls: 0, elapsed_ms: 0 };
  // 首轮对话：并行起一个真正的短标题（拿消息前 24 个字截断当标题太丑）。
  // 跟任务并行跑，任务收尾时基本已就绪，不给任务加等待；花的 token 记进同一笔账
  let titleP = null;
  // 每个对话固定一个辅助目录，存放一次性测试、截图和进度；正式成果写入项目目录。
  let taskBaseDir = null;
  if (!sess.dir) {
    const d = new Date();
    const stamp = String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    const slug = String(sess.title || message).replace(/https?:\/\/\S+/g, "").replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 12) || "对话";
    let dir = `任务_${stamp}_${slug}`;
    for (let i = 2; fs.existsSync(path.join(pinnedWorkspace, dir)) || assignedDirs.has(dir); i++) dir = `任务_${stamp}_${slug}_${i}`;
    assignedDirs.add(dir);
    sess.dir = dir; // 存进会话，后续轮次/重启都落同一个文件夹
  }
  taskBaseDir = sess.dir;
  if (taskBaseDir) send({ type: "dir", dir: taskBaseDir }); // 成果面板标「本对话」用；不进回放记录
  // Goal 模式：第一次用目标消息建目标（拆成验收标准）；已有进行中的目标就直接接着冲
  const goalMode = mode === "goal";
  let runFailed = null; // 整跑是否以异常收场（记进模型健康账本）
  let gitFailure = false;
  const taskRuntime = runtime; // Settings may rebuild the global runtime during this task.
  // Available before Git preflight too: legacy files require a real user's consent.
  const askUser = ({ askId, timeoutMs }) => new Promise(resolve => {
    if (runState.ctrl.signal.aborted) return resolve(null);
    const done = value => {
      clearTimeout(timer);
      runState.asks.delete(askId);
      runState.ctrl.signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    const onAbort = () => done(null);
    runState.ctrl.signal.addEventListener("abort", onAbort, { once: true });
    done.expiresAt = Date.now() + timeoutMs;
    runState.asks.set(askId, done);
  });
  if (global.__wbPet) try { global.__wbPet.setState("working", sess.title || String(message).slice(0, 40), { tokens: null, taskId: requestId }); } catch {}
  try {
    await taskRuntime.withTaskGit({ workspace: pinnedWorkspace, mode: mode || "craft", emit: emitFn,
      projectContext: pinnedProjectContext, stopSignal: runState.ctrl.signal, askUser }, async gitArgs => {
      try {
        if (!sess.title_manual && sess.transcript.filter((e) => e.type === "user").length === 1) {
          titleP = sessLLM
            .chat({
              system: "你给任务起标题。只输出 6~14 个字的中文短标题概括这个任务，不要引号、标点、任何前后缀。",
              history: [{ role: "user", content: String(message).slice(0, 500) }],
              tools: [],
              signal: AbortSignal.timeout(20000),
            })
            .then((r) => {
              if (r && r.usage) { total.prompt += r.usage.prompt || 0; total.completion += r.usage.completion || 0; total.calls += 1; }
              return r && r.text ? String(r.text) : null;
            })
            .catch(() => null);
        }
        if (goalMode && (!sess.goal || sess.goal.status !== "active")) {
          const criteria = await deriveGoalCriteria(sessLLM, message, total);
          sess.goal = { text: String(message).slice(0, 500), criteria: criteria.map((t) => ({ text: t, done: false })), status: "active", round: 0 };
          autosaveSession(sessionId, 0);
        }
        if (sess.goal) send({ type: "goal", goal: sess.goal }); // 目标卡状态直播；不进回放记录（回放时从会话里取）
        let taskStopped = null;
        // 外层：目标轮（普通消息只走一轮；goal 模式没达标自动再跑，最多 GOAL_MAX_ROUNDS 轮）
        let nextDelegation = selectedDelegation;
        let lastFinal = "";
        let roundStopped = null; // 本目标轮里任务被强制收尾的原因（超时/上限/手停）；有它就不再自动开新轮
        for (let goalRound = 0; ; goalRound++) {
          roundStopped = null;
          // 进行中的目标注入任务上下文：不放进 projectContext（会破坏缓存），而是作为系统消息插入历史
          let goalMsg = null;
          if (sess.goal && sess.goal.status === "active") {
            goalMsg = `## 本对话的目标（Goal 模式）\n目标：${sess.goal.text}\n验收标准（打勾的已达成，别重做）：\n` +
              sess.goal.criteria.map((c, i) => `${i + 1}. [${c.done ? "✓" : " "}] ${c.text}`).join("\n") +
              `\n交付物必须能通过未达成的验收标准。`;
          }
          // 内层：任务收尾瞬间可能还有没被 agent 循环消化的插队消息 → 追加为新一轮，直到清空
          for (;;) {
            // Goal 消息临时插入历史开头，任务结束后不保存（下一轮会重新生成最新状态）
            const taskHistory = goalMsg
              ? [{ role: "user", content: goalMsg }, ...sess.history]
              : sess.history;

            const turnDelegation = nextDelegation;
            if (nextDelegation.type !== "none") nextDelegation = { type: "auto" }; // 点名只执行一次，续跑按剩余任务判断
            const r = await taskRuntime.runTask({
              delegation: turnDelegation,
              taskLabel: sess.title || String(message).slice(0, 24),
              baseDir: taskBaseDir,
              workspace: pinnedWorkspace,
              llmOverride: sessLLM,
              history: taskHistory,
              emit: gitArgs.emit,
              gitScope: gitArgs.gitScope,
              mode: ["ask", "plan", "craft"].includes(mode) ? mode : "craft",
              authorizationUser: req.desktopAccessUser,
              sessionId, // 后台进程按会话登记，切项目/收尾时才知道该清理谁
              projectContext: gitArgs.projectContext,
              stopSignal: runState.ctrl.signal,
              getInterject: () => runState.interject.splice(0),
              askUser,
            });
            if (r && r.usage) {
              total.prompt += r.usage.prompt;
              total.completion += r.usage.completion;
              total.cached = (total.cached || 0) + (r.usage.cached || 0);
              total.calls += r.usage.calls;
              total.elapsed_ms += r.usage.elapsed_ms;
            }
            if (r && r.finalText) lastFinal = r.finalText;
            if (r && r.stopped) { roundStopped = r.stopped; taskStopped = r.stopped; }
            const leftover = runState.interject.splice(0);
            if (!leftover.length || runState.ctrl.signal.aborted) break;
            for (const m of leftover) {
              sess.history.push({ role: "user", content: m });
              emitFn({ type: "interject", text: m });
            }
          }
          // 没有进行中的目标 / 用户已手动停止 → 不验收不加轮
          if (!sess.goal || sess.goal.status !== "active" || runState.ctrl.signal.aborted) break;
          await verifyGoal(sess, sessLLM, lastFinal, total);
          sess.goal.round = (sess.goal.round || 0) + 1;
          send({ type: "goal", goal: sess.goal });
          autosaveSession(sessionId, 0);
          if (!goalMode || sess.goal.status === "done" || goalRound + 1 >= GOAL_MAX_ROUNDS) break;
          // 这轮是被超时/上限硬切断的：同样的条件再跑一轮大概率原样再撞，别把用户的时间和钱烧在死循环里
          if (roundStopped) {
            emitFn({ type: "interject", text: `【目标验收】这轮任务被强制收尾（${roundStopped}），暂停自动补跑。解决后可以直接说「继续」接着冲目标。` });
            break;
          }
          // 没达标 → 把未达成项作为下一轮指令，接着冲（进回放记录，回放时能看懂为什么又跑了一轮）
          const unmet = sess.goal.criteria.filter((c) => !c.done).map((c) => "· " + c.text).join("\n");
          const fb = `【目标验收 · 第 ${sess.goal.round} 轮】以下验收标准还没达成：\n${unmet}\n只补这些未达成项，别重做已达成的部分。`;
          sess.history.push({ role: "user", content: fb });
          emitFn({ type: "interject", text: fb });
        }
        runState.stopped = taskStopped || (sess.goal?.status === "active" ? "目标验收尚未完成" : null);
        return { stopped: runState.stopped, usage: total };
      } finally {
        // Failed model runs also enter Git finalization; do not accept new
        // interjections that can no longer be consumed by this task.
        runState.finishing = true;
      }
    });
  } catch (e) {
    runFailed = e.message;
    gitFailure = e.gitTask === true;
    // 抛错前模型可能已经消耗过 token，agent.js 会把 usage 挂在错误对象上
    if (e && e.usage && !gitFailure) {
      total.prompt += e.usage.prompt || 0;
      total.completion += e.usage.completion || 0;
      total.cached = (total.cached || 0) + (e.usage.cached || 0);
      total.calls += e.usage.calls || 0;
      total.elapsed_ms += e.usage.elapsed_ms || 0;
    }
    const streak = gitFailure ? 0 : (modelFailStreak.get(sessLLM.provider) || 0) + 1;
    if (!gitFailure) modelFailStreak.set(sessLLM.provider, streak);
    let emsg = e.message;
    if (streak >= 2) {
      emsg += `\n\n💡 模型「${sessLLM.provider}」已连续失败 ${streak} 次，多半是这个模型/渠道本身不可用：可以点输入框旁的模型按钮给本对话单独换一个，或到 设置 → 模型 换全局默认。`;
    }
    send({ type: "error", message: emsg });
    asstEvents.push({ type: "error", message: emsg });
  } finally {
    // 标题调用也计入本次任务；等待其真实 usage 落账后才发布完成牌。
    if (titleP) {
      const t = await titleP;
      const clean = t && t.replace(/[\r\n"“”「」『』]/g, "").trim().slice(0, 20);
      if (clean && !sess.title_manual) { sess.title = clean; send({ type: "title", title: clean }); }
    }
  }
  try {
    if (total.calls > 0) modelFailStreak.delete(sessLLM.provider); // 有成功调用就算这个模型活着，清连挂计数
    // 健康账本：异常收场记一败；正常收场且真调过模型记一胜（秒停等一次没调的不记，记了是噪声）
    try {
      if (runFailed && !gitFailure) recordModelHealth(sessLLM.provider, false, runFailed);
      else if (total.calls > 0) recordModelHealth(sessLLM.provider, true);
    } catch (e) { console.warn(`[模型] 健康状态保存失败：${e.message}`); }

    try { await saveSession(sessionId); }
    catch (e) { console.warn(`[会话] 任务收尾存盘失败（${sessionId}）：${e.message}`); }
    // Keep the session busy until persistence and the final file snapshot are complete.
    let files = [];
    try { files = await outputFiles(runState.workspace); }
    catch (e) { console.warn(`[文件] 任务收尾刷新文件列表失败（${sessionId}）：${e.message}`); }
    send({ type: "files", files, changed: [] });
    send({ type: "done" });
  } finally {
    activeRuns.delete(sessionId);
    persistRunning();
    try { petFinish(total, runState, runFailed); } catch {}
    if (!res.destroyed && !res.writableEnded) { try { res.end(); } catch {} }
    for (const sub of runState.subscribers) { try { sub.end(); } catch {} }
    runState.subscribers.clear();
  }
});

// 插队：往正在运行的任务里注入一条补充消息（agent 在下一个安全间隙读到并继续）
app.post("/api/chat/interject", (req, res) => {
  const { sessionId, message } = req.body || {};
  const text = String(message || "").trim();
  const run = activeRuns.get(sessionId);
  if (!run) return res.status(409).json({ ok: false, error: "该会话没有正在运行的任务" });
  if (!text) return res.status(400).json({ ok: false, error: "消息为空" });
  if (run.finishing) return res.status(409).json({ ok: false, error: "本轮正在提交/推送，请等本轮结束后再发送。" });
  run.interject.push(text);
  res.json({ ok: true, queued: run.interject.length });
});

// 撤回插队消息：只要还没被 getInterject() 取走就能撤
app.post("/api/chat/interject/cancel", (req, res) => {
  const { sessionId, message } = req.body || {};
  const text = String(message || "").trim();
  const run = activeRuns.get(sessionId);
  if (!run) return res.status(409).json({ ok: false, error: "该会话没有正在运行的任务" });
  if (!text) return res.status(400).json({ ok: false, error: "消息为空" });
  // 从后往前找最后一条相同的消息并删除（用户可能发了多条一样的）
  const idx = run.interject.lastIndexOf(text);
  if (idx === -1) return res.status(404).json({ ok: false, error: "该消息已执行或不在队列中" });
  run.interject.splice(idx, 1);
  res.json({ ok: true, remaining: run.interject.length });
});

// ask_user 的回答通道：agent 弹的问题，用户点选/输入后从这里回填给正在等待的那次工具调用
app.post("/api/chat/answer", (req, res) => {
  const { sessionId, askId, answer } = req.body || {};
  const run = activeRuns.get(sessionId);
  if (!run) return res.status(409).json({ ok: false, error: "该会话没有正在运行的任务" });
  const owner = getSession(sessionId).user;
  const resolve = run.asks && run.asks.get(String(askId || ""));
  if (!resolve) return res.status(404).json({ ok: false, error: "这个问题已过期或已回答过" });
  const text = String(answer || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ ok: false, error: "回答为空" });
  resolve(text);
  res.json({ ok: true });
});

// 正在运行任务的会话列表：前端刷新后靠它找回后台任务，断流后靠它判断任务是否还活着
app.get("/api/chat/running", (_req, res) => res.json([...activeRuns.keys()]));

// 单会话运行状态：SSE 断开后，前端不能把“暂时没接上流”误判成任务结束。
app.get("/api/chat/running/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[\w-]+$/.test(id)) return res.status(400).json({ error: "会话标识无效" });
  res.setHeader("Cache-Control", "no-store");
  const run = activeRuns.get(id);
  const sess = sessions.get(id) || getSession(id);
  if (!run) return res.json({ running: false });
  res.json({ running: true, finishing: run.finishing === true, requestId: run.requestId || null });
});

// 断点续流：把 transcript 里已记录的事件从 from 序号补发，然后接上直播（页面刷新/断网重连后无缝接回）。
// textOffset 处理最后一条还在增长的合并文本：客户端已看过前 textOffset 个字符，只补后半段。
// slice 到加入订阅是同步完成的，中间不会漏事件也不会重复。
app.get("/api/chat/stream/:id", (req, res) => {
  const run = activeRuns.get(req.params.id);
  const sess = getSession(req.params.id);
  const last = sess.transcript?.[sess.transcript.length - 1];
  // A failed POST may never have reached us; do not replay the previous turn as its result.
  if (req.query.requestId && req.query.requestId !== (run ? run.requestId : last?.requestId)) return res.status(409).json({ error: "该任务与请求的回合不一致" });
  const events = run?.events || (last?.type === "assistant" ? last.events : null);
  if (!events) return res.status(404).json({ error: "该会话没有可续接的任务" });
  require("./lib/chat-sse").openChatStream(res);
  const from = Math.max(0, parseInt(req.query.from, 10) || 0);
  const textOffset = Math.max(0, parseInt(req.query.textOffset, 10) || 0);
  events.slice(from).forEach((ev, i) => {
    const out = i === 0 && textOffset && ev.type === "text" ? { type: "text", delta: String(ev.delta).slice(textOffset) } : ev;
    try { res.write(`data: ${JSON.stringify(out)}\n\n`); } catch {}
  });
  // A task can finish while the client is disconnected; replay its final events too.
  if (!run) return res.end(`data: ${JSON.stringify({ type: "done", requestId: last?.requestId, status: last?.status || "interrupted" })}\n\n`);
  run.subscribers.add(res);
  res.on("close", () => run.subscribers.delete(res));
});

// 手工标题只允许修改已有空闲会话；检查到落盘之间保持同步，避免与新任务启动交错。
app.patch("/api/session/:id/title", async (req, res) => {
  const id = req.params.id;
  if (deletedSessions.has(id)) return res.status(404).json({ error: "任务不存在" });
  if (!/^[\w-]+$/.test(id)) return res.status(404).json({ error: "任务不存在" });
  const cached = sessions.get(id);
  if (!fs.existsSync(sessFile(id)) && !(cached && (cached.updated_at || cached.title || cached.transcript?.length))) {
    return res.status(404).json({ error: "任务不存在" });
  }
  const s = getSession(id);
  // activeRuns 是唯一运行状态权威，包括停止后的收尾阶段；管理员也不能绕过。
  if (activeRuns.has(id)) return res.status(409).json({ error: "任务运行中，暂不能重命名" });
  if (renamingSessions.has(id)) return res.status(409).json({ error: "标题正在保存，请稍后重试" });
  const body = req.body;
  if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).some(k => k !== "title") || typeof body.title !== "string") {
    return res.status(400).json({ error: "只允许提交 title 字符串" });
  }
  const title = body.title.trim();
  if (!title || [...title].length > 100 || /[\u0000-\u001f\u007f]/u.test(title)) {
    return res.status(400).json({ error: "标题须为 1–100 个字符，不能包含控制字符" });
  }
  const previous = { ...s };
  renamingSessions.add(id);
  s.title = title;
  s.title_manual = true;
  try { await saveSession(id); }
  catch (e) {
    // saveSession stamps updated_at before writing. A failed rename must restore
    // the complete in-memory snapshot, including that timestamp, so a retry sees
    // exactly the same session as before the failed title change.
    for (const key of Object.keys(s)) delete s[key];
    Object.assign(s, previous);
    console.warn("[会话] 标题保存失败：", e.message);
    return res.status(500).json({ error: "标题保存失败，请重试" });
  } finally {
    renamingSessions.delete(id);
  }
  res.json({ ok: true, title: s.title });
});

// 旧版远程会话把完整 finalText 再追加在流式正文后；仅在读取时修复副本，不改动磁盘历史。
// 去重必须有 done.result 这条来源证据，不能对任意相邻/相同文本做盲目裁剪。
function remoteTranscriptForDisplay(transcript) {
  return (transcript || []).map(entry => {
    if (entry.type !== "assistant" || entry.source !== "remote" || !Array.isArray(entry.events)) return entry;
    const events = entry.events.slice();
    const doneIndex = events.findLastIndex(ev => ev.type === "done" && typeof ev.result === "string" && ev.result.length > 0);
    if (doneIndex < 0) return entry;
    const result = events[doneIndex].result;
    const textIndexes = [];
    let streamed = "";
    for (let i = 0; i < doneIndex; i++) {
      const ev = events[i];
      if (ev.type === "text") {
        textIndexes.push(i);
        streamed += String(ev.delta || "");
      }
    }
    // 只修复“已知最终结果被重复一次”的旧记录：完整流式结果 + done.result。
    // 正常的分片流即使包含相同词，也不会满足这个精确证据条件。
    if (textIndexes.length === 0 || streamed !== result + result) return entry;
    const lastIndex = textIndexes[textIndexes.length - 1];
    const last = events[lastIndex];
    const nextDelta = String(last.delta || "").slice(0, Math.max(0, String(last.delta || "").length - result.length));
    if (nextDelta) events[lastIndex] = { ...last, delta: nextDelta };
    else events.splice(lastIndex, 1);
    return { ...entry, events };
  });
}

// 历史会话回放
app.get("/api/session/:id", async (req, res) => {
  if (deletedSessions.has(req.params.id)) return res.status(404).json({ error: "任务不存在" });
  const s = getSession(req.params.id);

  // 获取当前模型类型的上下文配置
  const { historyChars, compactHistoryStandalone, ctxBudget } = require("./agent");
  const contextConfig = config.context_config || {};
  res.set('Cache-Control', 'no-store');
  const contextModel = (typeof req.query.model === 'string' && req.query.model) || s.model || config.active_model;
  const activeModel = String(contextModel || '').toLowerCase();

  // 根据模型名判断类型
  let provider = 'custom';
  if (activeModel.includes('gpt')) provider = 'gpt';
  else if (activeModel.includes('claude')) provider = 'claude';
  else if (activeModel.includes('grok')) provider = 'grok';
  else if (activeModel.includes('gemini')) provider = 'gemini';

  // 计算该模型类型的上下文预算（传入会话模型名）
  const budgetChars = ctxBudget(config, contextModel);
  const providerConfig = contextConfig[provider] || {};
  const thresholdPercent = providerConfig.threshold || 60;
  const thresholdChars = Math.floor(budgetChars * (thresholdPercent / 100));

  // 检查是否需要自动压缩
  const usedChars = historyChars(s.history || []);
  let compressed = false;

  if (usedChars > thresholdChars && s.history && s.history.length > 0) {
    try {
      console.log(`[会话加载] ${req.params.id} 上下文超限 (${usedChars}/${thresholdChars} chars)，自动压缩中...`);

      // 执行压缩
      const stats = { prompt: 0, completion: 0, cached: 0, calls: 0 };
      compressed = await compactHistoryStandalone(s.history, {...config, active_model: contextModel}, llmInner, {
        emit: (event) => {
          if (event.type === 'compact') {
            console.log(`[会话加载] 已压缩 ${event.removed} 条历史记录`);
          }
        },
        stats,
        force: false
      });

      if (compressed) {
        await saveSession(req.params.id);
        const newUsedChars = historyChars(s.history);
        console.log(`[会话加载] 压缩完成，上下文从 ${usedChars} 降至 ${newUsedChars} chars`);
      }
    } catch (err) {
      console.warn(`[会话加载] 自动压缩失败:`, err.message);
      // 压缩失败不影响返回，继续返回原始数据
    }
  }

  // 重新计算压缩后的字符数
  const finalUsedChars = historyChars(s.history || []);

  res.json({
    transcript: remoteTranscriptForDisplay(s.transcript),
    dir: s.dir || null,
    model: s.model || null,
    goal: s.goal || null,
    project: s.project || null,
    project_dir: s.project_dir || null,
    pending_asks: [...(activeRuns.get(req.params.id)?.asks || [])].map(([id, resolve]) => ({ id, expires_at: resolve.expiresAt })),
    compressed, // 标记是否进行了自动压缩
    context: {
      used_chars: finalUsedChars,
      budget_chars: budgetChars,
      threshold_chars: thresholdChars,
      threshold_percent: thresholdPercent, // 压缩阈值百分比
      used_tokens_estimate: Math.ceil(finalUsedChars / 4),
      budget_tokens_estimate: Math.ceil(budgetChars / 4),
      percentage: Math.min(100, Math.round((finalUsedChars / budgetChars) * 100)),
    },
  });
});

// 归档目标：目标卡上点 ✕。已达成/不想要了都走这里，不删记录只改状态
app.post("/api/session/:id/goal", async (req, res) => {
  if (deletedSessions.has(req.params.id)) return res.status(404).json({ error: "任务不存在" });
  const s = getSession(req.params.id);
  if (!s.goal) return res.status(400).json({ error: "该对话没有目标" });
  if ((req.body || {}).action === "close") {
    s.goal.status = "closed";
    try { await saveSession(req.params.id); }
    catch { return res.status(500).json({ error: "目标保存失败，请重试" }); }
  }
  res.json({ ok: true, goal: s.goal });
});

// ---------- 内置评测（界面版）：spawn 子进程跑 eval/run.js ----------
// 子进程隔离是刚需：评测会 setWorkspaceDir 到自己的沙盒目录，进程内跑会把主应用的工作空间劫走
const evalState = { running: false, lines: [], startedAt: 0, model: "", exit: null };
function evalSummaryBrief(j) {
  if (!j) return null;
  // 兼容两代格式：v3 有 repeat/pass1_avg/attempts，旧格式按 k=1 折算，前端只走一条代码路径
  return {
    at: j.at, model: j.model, model_id: j.model_id, score_pct: j.score_pct,
    repeat: j.repeat || 1,
    pass1_avg: j.pass1_avg != null ? j.pass1_avg : (j.tasks ? Math.round((j.full_pass / j.tasks) * 100) : 0),
    flaky_tasks: j.flaky_tasks || [], fail_code_counts: j.fail_code_counts || {},
    baseline: j.baseline || null,
    tasks: j.tasks, full_pass: j.full_pass, checks_passed: j.checks_passed, checks_total: j.checks_total,
    tokens_total: j.tokens_total, avg_prompt_per_call: j.avg_prompt_per_call || 0,
    commit: j.commit || "", judge: j.judge || null, human: j.human || null,
    results: (j.results || []).map((r) => {
      const k = r.k || 1;
      const passes = r.passes != null ? r.passes : (r.passed === r.total ? 1 : 0);
      return {
        id: r.id, name: r.name, level: r.level || 1, kind: r.kind || "",
        passed: r.passed, total: r.total, elapsed_s: r.elapsed_s,
        k, passes, pass_rate: r.pass_rate != null ? r.pass_rate : +(passes / k).toFixed(3),
        flaky: !!r.flaky, fail_codes: r.fail_codes || [],
        attempts: (r.attempts || []).map((a) => ({ n: a.n, passed: a.passed, total: a.total, elapsed_s: a.elapsed_s, fail_code: a.fail_code || null })),
        tool_calls: r.tool_calls || 0, tool_errors: r.tool_errors || 0,
        judge: r.judge ? (r.judge.dims ? { passed: r.judge.passed, total: r.judge.total } : (r.judge.score ? { score: r.judge.score, verdict: r.judge.verdict || "" } : null)) : null,
        human: r.human || null,
        failed: (r.checks || []).filter((c) => !c.ok).map((c) => c.name),
      };
    }),
  };
}
function evalHistory(limit = 20) {
  const out = [];
  try {
    const root = dataPath("eval", "runs");
    for (const d of fs.readdirSync(root).sort().reverse()) {
      const j = store.readJson(path.join(root, d, "results.json"), null);
      if (j) out.push({ dir: d, ...evalSummaryBrief(j) });
      if (out.length >= limit) break;
    }
  } catch {}
  return out;
}
app.post("/api/eval/start", (req, res) => {
  if (evalState.running) return res.status(409).json({ error: "已有一轮评测在跑，等它结束" });
  const model = String((req.body || {}).model || config.active_model);
  if (!(config.models || []).some((m) => m.name === model)) return res.status(400).json({ error: `模型「${model}」不在列表里` });
  const args = [appPath("eval", "run.js"), "--model", model];
  const only = String((req.body || {}).task || "").trim();
  if (only) args.push("--task", only);
  const judge = String((req.body || {}).judge || "").trim();
  if (judge && !(config.models || []).some((m) => m.name === judge)) return res.status(400).json({ error: `评委模型「${judge}」不在列表里` });
  if (judge) args.push("--judge", judge);
  const repeat = Math.max(1, Math.min(5, Math.round(+(req.body || {}).repeat) || 1));
  if (repeat > 1) args.push("--repeat", String(repeat));
  evalState.running = true; evalState.lines = []; evalState.startedAt = Date.now(); evalState.model = model; evalState.exit = null;
  const child = require("child_process").spawn(process.execPath, args, {
    cwd: appPath(),
    env: { ...process.env, CLOSECODE_HOME: DATA_DIR, ELECTRON_RUN_AS_NODE: "1" }, // execPath 是 Electron，不加就弹新应用实例
  });
  let buf = "";
  const onData = (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trimEnd(); buf = buf.slice(i + 1);
      if (line) { evalState.lines.push(line); if (evalState.lines.length > 400) evalState.lines.shift(); }
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => { evalState.running = false; evalState.exit = code; });
  child.on("error", (e) => { evalState.running = false; evalState.exit = -1; evalState.lines.push("评测进程启动失败: " + e.message); });
  res.json({ ok: true, model });
});
app.get("/api/eval/status", (_req, res) => {
  res.json({ running: evalState.running, model: evalState.model, startedAt: evalState.startedAt, exit: evalState.exit, lines: evalState.lines });
});
app.get("/api/eval/history", (_req, res) => {
  const bl = store.readJson(dataPath("eval", "baseline.json"), null);
  res.json({ runs: evalHistory(), baseline: bl ? { at: bl.at, commit: bl.commit || "", model: bl.model || "", source_dir: bl.source_dir || "" } : null });
});
// 钉基线：把某次跑批的各题通过率写进 eval/baseline.json，之后每次跑批自动逐题对比、退步点名
app.post("/api/eval/baseline", (req, res) => {
  const dir = String((req.body || {}).dir || "");
  if (!/^[\w.-]+$/.test(dir)) return res.status(400).json({ error: "目录名不合法" });
  const j = store.readJson(dataPath("eval", "runs", dir, "results.json"), null);
  if (!j) return res.status(404).json({ error: "没有这次评测的记录" });
  const bl = {
    at: j.at, commit: j.commit || "", model: j.model, repeat: j.repeat || 1,
    pass1_avg: j.pass1_avg != null ? j.pass1_avg : (j.tasks ? Math.round((j.full_pass / j.tasks) * 100) : 0),
    score_pct: j.score_pct, source_dir: dir,
    tasks: Object.fromEntries((j.results || []).map((r) => {
      const k = r.k || 1;
      const passes = r.passes != null ? r.passes : (r.passed === r.total ? 1 : 0);
      return [r.id, { pass_rate: r.pass_rate != null ? r.pass_rate : +(passes / k).toFixed(3) }];
    })),
  };
  fs.mkdirSync(dataPath("eval"), { recursive: true });
  fs.writeFileSync(dataPath("eval", "baseline.json"), JSON.stringify(bl, null, 2));
  res.json({ ok: true, baseline: { at: bl.at, commit: bl.commit, model: bl.model, source_dir: dir } });
});
// 单次评测完整明细：每题 checks、AI 评委理由、人工分、最终回复摘录、产物清单
app.get("/api/eval/run/:dir", (req, res) => {
  const dir = String(req.params.dir || "");
  if (!/^[\w.-]+$/.test(dir)) return res.status(400).json({ error: "目录名不合法" });
  const j = store.readJson(dataPath("eval", "runs", dir, "results.json"), null);
  if (!j) return res.status(404).json({ error: "没有这次评测的记录" });
  res.json({ dir, ...j });
});
// 人工打分：写回该次评测的 results.json，与机器分 / AI 评委分并列保存，互不覆盖
app.post("/api/eval/human", (req, res) => {
  const b = req.body || {};
  const dir = String(b.dir || "");
  if (!/^[\w.-]+$/.test(dir)) return res.status(400).json({ error: "目录名不合法" });
  const file = dataPath("eval", "runs", dir, "results.json");
  const j = store.readJson(file, null);
  if (!j) return res.status(404).json({ error: "没有这次评测的记录" });
  const r = (j.results || []).find((x) => x.id === String(b.task_id || ""));
  if (!r) return res.status(404).json({ error: "没有这道题" });
  const score = Math.round(+b.score);
  if (!(score >= 1 && score <= 5)) return res.status(400).json({ error: "分数须是 1-5 的整数" });
  r.human = { score, comment: String(b.comment || "").slice(0, 500), by: "", at: new Date().toISOString() };
  const scored = (j.results || []).filter((x) => x.human && x.human.score);
  j.human = { scored: scored.length, avg: +(scored.reduce((s, x) => s + x.human.score, 0) / scored.length).toFixed(2) };
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  res.json({ ok: true, task_id: r.id, human: j.human });
});

// 给单个对话指定模型（null = 跟随全局默认）。只影响这一个对话，不动全局 active_model
app.post("/api/session/:id/model", async (req, res) => {
  if (deletedSessions.has(req.params.id)) return res.status(404).json({ error: "任务不存在" });
  const name = (req.body || {}).model;
  const s = getSession(req.params.id);
  if (name === null || name === undefined || name === "") {
    delete s.model;
  } else {
    if (!Array.isArray(config.models) || !config.models.some((m) => m.name === name)) {
      return res.status(400).json({ error: `模型「${name}」不在模型列表里` });
    }
    s.model = String(name);
    // 记住这次手动选择：开了「新对话沿用上次选的模型」时，下个新对话默认就用它
    if (config.last_picked_model !== s.model) { config.last_picked_model = s.model; saveConfig(); }
  }
  try { await saveSession(req.params.id); }
  catch { return res.status(500).json({ error: "模型选择保存失败，请重试" }); }
  res.json({ ok: true, model: s.model || null });
});

// 助理模式没有会话 id（消息走 IM 的 local 通道），模型选择只能挂在配置上：选完就存，
// 刷新页面、离开助理页再回来都还是它。不存的话标签会自己弹回全局默认，
// 而下面真正跑任务用的又是标签上那个——那就成了另一种「标签说一套、实际跑一套」
app.post("/api/assist/model", (req, res) => {
  const name = (req.body || {}).model;
  if (name === null || name === undefined || name === "") {
    delete config.assist_model;
  } else {
    if (!Array.isArray(config.models) || !config.models.some((m) => m.name === name)) {
      return res.status(400).json({ error: `模型「${name}」不在模型列表里` });
    }
    config.assist_model = String(name);
  }
  saveConfig();
  res.json({ ok: true, model: config.assist_model || null });
});

// 删除会话（内存 + 磁盘一起删）
app.delete("/api/session/:id", async (req, res) => {
  const id = req.params.id;
  if (deletedSessions.has(id)) return res.status(404).json({ error: "任务不存在" });
  if (!/^[\w-]+$/.test(id)) return res.status(404).json({ error: "任务不存在" });
  const cached = sessions.get(id);
  if (!fs.existsSync(sessFile(id)) && !cached) return res.status(404).json({ error: "任务不存在" });
  const s = getSession(id);
  if (activeRuns.has(id)) return res.status(409).json({ error: "任务运行中，暂不能删除" });
  if (renamingSessions.has(id)) return res.status(409).json({ error: "标题正在保存，请稍后重试" });
  deletedSessions.add(id);
  try {
    await sessionSaveQueues.get(id)?.catch(() => {});
    await fs.promises.unlink(sessFile(id));
  }
  catch (e) {
    if (e.code !== "ENOENT") {
      deletedSessions.delete(id);
      return res.status(500).json({ error: "删除失败，请重试" });
    }
  }
  sessions.delete(id);
  sessSaveAt.delete(id);
  res.json({ ok: true });
});

// 停止正在运行的任务：中断当前模型调用，agent 循环在下一个检查点收尾
app.post("/api/chat/stop", (req, res) => {
  const run = activeRuns.get((req.body || {}).sessionId);
  if (!run) return res.json({ ok: false, error: "该会话没有正在运行的任务" });
  run.ctrl.abort();
  res.json({ ok: true });
});

let scheduler;

// ---------- 定时任务管理 API ----------
app.get("/api/schedules", (_req, res) => res.json(scheduler.list()));
// 运行记录。只看 last_result 的话，昨天跑挂今天跑好就查无此事
app.get("/api/schedules/runs", (req, res) => res.json(scheduler.runs(Math.min(+req.query.limit || 100, 300))));
app.post("/api/schedules", (req, res) => {
  try {
    res.json(scheduler.add(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.patch("/api/schedules/:id", (req, res) => {
  try {
    const t = scheduler.update(req.params.id, req.body || {});
    if (!t) return res.status(404).json({ error: "任务不存在" });
    res.json(t);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.delete("/api/schedules/:id", (req, res) => res.json({ ok: scheduler.remove(req.params.id) }));
// 批量：一条条点太慢，但批量删是不可逆的，所以要求前端明确传 action
app.post("/api/schedules/bulk", (req, res) => {
  const { ids, action } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "没选中任何任务" });
  if (!["enable", "disable", "delete"].includes(action)) return res.status(400).json({ error: "未知操作" });
  let n = 0;
  for (const id of ids) {
    if (action === "delete") n += scheduler.remove(id) ? 1 : 0;
    else n += scheduler.toggle(id, action === "enable") ? 1 : 0;
  }
  res.json({ ok: true, count: n });
});
app.post("/api/schedules/:id/toggle", (req, res) =>
  res.json({ ok: scheduler.toggle(req.params.id, !!(req.body || {}).enabled) })
);
app.post("/api/schedules/:id/catchup", (req, res) =>
  res.json({ ok: scheduler.setCatchUp(req.params.id, !!(req.body || {}).catch_up) })
);
app.post("/api/schedules/:id/run", async (req, res) => {
  const item = scheduler.list().find((t) => t.id === req.params.id);
  if (!item) return res.status(404).json({ error: "任务不存在" });
  if (item.running) return res.status(409).json({ error: "这个任务正在跑，等它跑完再点" });
  try {
    // 传 id 不传对象：list() 给出去的是副本，拿副本去跑的话执行结果写在副本上，存不下来
    const reply = await scheduler.runOne(item.id, "手动");
    res.json({ ok: true, reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function trackedRuntime(baseRuntime, source) {
  return {
    ...baseRuntime,
    runTask: async (args) => {
      const { modelName, ...rest } = args || {};
      const runLLM = modelName ? llmForSession({ model: modelName }) : llm;
      const pinnedWorkspace = rest.workspace || getWorkspaceDir();
      const pinnedProject = (config.projects || []).find(p => p.dir && require("./lib/workspace-scope").same(p.dir, pinnedWorkspace));
      return baseRuntime.runTask({
        taskLabel: source === "im" ? "IM 对话" : source === "schedule" ? "定时任务" : source,
        baseDir: path.resolve(pinnedWorkspace) === dataPath("workspace") ? source === "im" ? "IM_对话" : source === "schedule" ? "定时任务" : null : null,
        projectContext: pinnedProject ? projectContextOf(pinnedProject) : "",
        ...rest, workspace: pinnedWorkspace,
        ...(modelName ? { llmOverride: runLLM } : {}),
      });
    },
  };
}
async function main() {
  // config.json 里配的 + Agent Plugins 插件 mcp.json 里声明的，一起起。
  // 插件那边坏一条只跳过一条（规范要求的失败隔离），不影响 config 里的服务器。
  let pluginServers = [];
  try {
    pluginServers = pluginsMgr.pluginMcpServers();
  } catch (e) {
    console.warn("[插件] MCP 配置读取失败:", e.message);
  }
  // MCP 连接不挡启动：窗口秒开，连接器在后台就绪（agent 每次跑任务都是现取 toolDefs，
  // 晚几秒连上也不丢工具）。首个定时 tick 在 +20s，届时早已连完。
  mcpManager
    .startAll([...(config.mcp_servers || []), ...pluginServers])
    .then(() => console.log(`MCP 工具就绪: ${mcpManager.toolDefs().length} 个`))
    .catch((e) => console.warn("[MCP] 启动失败:", e.message));
  const badPlugins = pluginsMgr.loadPlugins().filter((p) => !p.ok);
  for (const p of badPlugins) console.warn(`[插件] ${p.name} 装不上: ${p.error}`);
  runtime = createAgentRuntime({ config, llm, mcpManager, experts, expertTeams });
  remoteRuntime = trackedRuntime(runtime, "remote");

  scheduler = createScheduler({
    runtime: trackedRuntime(runtime, "schedule"),
    onResult: (item, text) =>
      notify.pushBots(config, `【CloseCode·定时任务】${item.name}\n${(text || "").slice(0, 800)}`),
  });

  // IM 远程指挥路由（飞书/QQ 长连接 · 企业微信与公众号回调 · 通用 webhook）- 暂时禁用
  // imBridge = createImRouter({ config, runtime: trackedRuntime(runtime, "im"), sessions: imSessions, outputFiles, saveConfig });
  // app.use(imBridge.router);
  // imBridge
  //   .startFeishuWs()
  //   .then((s) => { if (s.state !== "off") console.log(`飞书长连接: ${s.state}`); })
  //   .catch((e) => console.warn("[飞书] 长连接启动失败:", e.message));
  // imBridge
  //   .startQQ()
  //   .then((s) => { if (s.configured) console.log(`QQ 长连接: ${s.state}`); })
  //   .catch((e) => console.warn("[QQ] 长连接启动失败:", e.message));
  // imBridge
  //   .startIlink()
  //   .then((s) => { if (s.configured) console.log(`微信 iLink 长轮询: ${s.state}`); })
  //   .catch((e) => console.warn("[微信iLink] 长轮询启动失败:", e.message));

  // IM 模块空壳（暂时禁用 IM 功能，但保留前端接口不让它报错）
  imBridge = {
    router: require("express").Router(),
    startFeishuWs: async () => ({ state: "off" }),
    startQQ: async () => ({ configured: false }),
    startIlink: async () => ({ configured: false })
  };
  // 空壳路由：前端还在查这些接口，不能让它 404
  imBridge.router.get("/im/status", (_req, res) => res.json({
    feishu_ws: { state: "off" },
    qq: { configured: false },
    wecom_app: { configured: false },
    wechat_mp: { configured: false },
    wechat_ilink: { configured: false }
  }));
  imBridge.router.get("/im/log", (_req, res) => res.json([]));
  imBridge.router.get("/im/progress", (_req, res) => res.json(null));
  imBridge.router.post("/im/local", (_req, res) => res.json({ error: "IM 功能已禁用" }));
  imBridge.router.post("/im/task", (_req, res) => res.json({ error: "IM 功能已禁用" }));
  imBridge.router.post("/im/feishu/test", (_req, res) => res.json({ error: "IM 功能已禁用" }));
  imBridge.router.post("/im/qq/test", (_req, res) => res.json({ error: "IM 功能已禁用" }));
  imBridge.router.post("/im/wechat/test", (_req, res) => res.json({ error: "IM 功能已禁用" }));
  imBridge.router.post("/im/wechat/qrcode", (_req, res) => res.json({ error: "IM 功能已禁用" }));
  imBridge.router.get("/im/wechat/qrcode-status", (_req, res) => res.json({ error: "IM 功能已禁用" }));
  imBridge.router.post("/im/wechat/disconnect", (_req, res) => res.json({ error: "IM 功能已禁用" }));
  app.use(imBridge.router);

  // 兜底：任何路由里没接住的异常都变成 JSON，别甩一整页 HTML 堆栈给前端
  // （前端一律 r.json()，甩 HTML 的话界面只会显示「加载失败」，真正的原因谁也看不见）
  app.use((err, req, res, next) => {
    console.error(`[${req.method} ${req.path}]`, err.message);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.message || "服务器内部错误" });
  });

  sweepInterruptedRuns(); // 上次没善终的任务先标注中断，再开门迎客

  // 端口配置：支持环境变量、配置文件、开发/生产模式自动切换
  const isDev = !desktopAccess.enabled();

  // 优先级：环境变量 PORT > 配置文件 server.port > 开发/生产默认端口
  let port;
  if (desktopAccess.enabled()) {
    port = desktopAccess.port();
  } else if (process.env.PORT) {
    port = +process.env.PORT;
  } else if (config.server && config.server.port) {
    port = config.server.port;
  } else {
    // 根据环境自动选择默认端口：开发环境4000，生产环境3800
    port = isDev ? 4000 : 3800;
  }

  console.log(`[环境] ${isDev ? "开发模式" : "生产模式"}, 端口: ${port}`);
  // 默认监听 0.0.0.0，支持局域网及本机同时访问
  const host = desktopAccess.enabled() ? "127.0.0.1" : (process.env.HOST || config.server?.host || "127.0.0.1");
  const server = app.listen(port, host, () => {
    global.__wbServer = server; // 重启时要主动关掉它清空事件循环，见 /api/backup/restart
    console.log(`CloseCode 已启动:`);
    console.log(`  > 本地访问:   http://localhost:${port}`);
    if (host === "0.0.0.0") {
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === "IPv4" && !net.internal) {
            console.log(`  > 局域网访问: http://${net.address}:${port}`);
          }
        }
      }
    } else if (host !== "127.0.0.1" && host !== "localhost") {
      console.log(`  > 网络访问:   http://${host}:${port}`);
    }
    console.log(`服务端初始化 ${Date.now() - BOOT_T0}ms`);
    console.log(`模型: ${llm.provider} / ${llm.model}`);
    console.log(`技能: ${runtime.getSkills().map((s) => s.name).join(", ") || "无"}`);
    console.log(`专家团: ${experts.map((e) => e.name).join(", ") || "无"}`);
    console.log(`MCP 工具: ${mcpManager.toolDefs().length} 个`);
    const okPlugins = pluginsMgr.loadPlugins().filter((p) => p.ok);
    if (okPlugins.length) console.log(`Agent Plugins: ${okPlugins.map((p) => p.name).join(", ")}`);
    console.log(`工作目录: ${getWorkspaceDir()}`);
    // 配置持久化的是开关，不复用上次已经失效的公网地址；重启后重新创建临时 Tunnel。
    if (config.remote_control?.enabled === true) {
      config.remote_control.public_url = "";
      cloudflareTunnelState = { status: "starting", url: "", error: "" };
      saveConfig();
      Promise.resolve().then(async () => {
        try {
          const tunnelPort = await ensureRemoteProxy(port);
          startCloudflareQuickTunnel(tunnelPort).catch(e => {
            cloudflareTunnelStarting = false;
            cloudflareTunnelState = { status: "error", url: "", error: e.message || "远程控制通道启动失败" };
            remoteControlToken = "";
          });
        } catch (e) {
          cloudflareTunnelState = { status: "error", url: "", error: e.message || "远程控制通道启动失败" };
          config.remote_control.public_url = "";
          saveConfig();
        }
      });
    }
  });
  desktopAccess.guardUpgrades(server);
  server.on("error", (e) => {
    if (desktopAccess.enabled()) {
      console.error("桌面服务监听失败:", e.code || "UNKNOWN");
      process.exit(1);
    }
    if (e.code === "EADDRINUSE") {
      console.error(`端口 ${port} 已被占用（可能 Web 版已在运行），本进程不再重复启动服务，窗口将连接已运行的实例。`);
    } else {
      throw e;
    }
  });
}

process.on("SIGINT", () => {
  stopCloudflareTunnel();
  stopRemoteProxy();
  mcpManager.stopAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopCloudflareTunnel();
  stopRemoteProxy();
  mcpManager.stopAll();
  process.exit(0);
});

main().catch((e) => {
  console.error("启动失败:", e);
  process.exit(1);
});
