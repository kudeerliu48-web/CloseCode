
// ================= 主题和配色 =================
// 应用主题
function applyTheme(theme) {
  const t = (theme && (theme === "dark" || theme === "light" || theme === "system")) ? theme : (localStorage.getItem("wb-theme") || (window.settingsCache && window.settingsCache.theme) || "system");
  const media = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = t === "dark" || (t === "system" && media && media.matches);
  const effective = isDark ? "dark" : "light";
  document.documentElement.dataset.theme = effective;
  document.documentElement.setAttribute("data-theme", effective);

  // 根据主题切换 logo
  const brandLogo = document.getElementById("brand-logo");
  if (brandLogo) {
    brandLogo.src = isDark ? "/assets/logos/docode1.webp" : "/assets/logos/docode2.webp";
  }
}

// 壁纸蒙版透明度。0.7 = 蒙版较淡、壁纸清楚；0.95 = 蒙版厚、内容清楚。
// 存的是「蒙版的 opacity」而不是「壁纸的透明度」，两者方向相反，界面文案已按用户直觉写。
const WALLPAPER_OPACITY_DEFAULT = 0.85;

let currentWallpaperOpacity = WALLPAPER_OPACITY_DEFAULT;

/**
 * 应用壁纸蒙版透明度。
 */
function applyWallpaperOpacity(opacity) {
  const v = Math.max(0.7, Math.min(0.95, Number(opacity) || WALLPAPER_OPACITY_DEFAULT));
  currentWallpaperOpacity = v;
  document.documentElement.style.setProperty("--wallpaper-opacity", String(v));

  const overlay = document.getElementById('wallpaper-overlay');
  if (overlay) overlay.style.opacity = String(v);

  // 侧边栏蒙版比主区再厚一点：那儿是密集小字，透太多最先读不清
  const sideOverlay = document.querySelector('#sidebar-overlay');
  if (sideOverlay) sideOverlay.style.opacity = String(Math.min(0.97, v + 0.05));
}

// 应用壁纸
function applyWallpaper(wallpaper) {
  const body = document.body;
  const aside = document.querySelector('aside');

  if (wallpaper) {
    body.style.backgroundImage = `url(${wallpaper})`;
    // Reuse the browser-parsed URL, never interpolate it into a stylesheet.
    document.documentElement.style.setProperty('--glass-wallpaper', body.style.backgroundImage);
    document.documentElement.dataset.wallpaper = 'true';
    body.style.backgroundSize = 'cover';
    body.style.backgroundPosition = 'center';
    body.style.backgroundRepeat = 'no-repeat';
    body.style.backgroundAttachment = 'fixed';

    // 给侧边栏也应用壁纸背景
    if (aside) {
      aside.style.backgroundImage = `url(${wallpaper})`;
      aside.style.backgroundSize = 'cover';
      aside.style.backgroundPosition = 'center';
      aside.style.backgroundRepeat = 'no-repeat';
      aside.style.backgroundAttachment = 'fixed';
    }

    // 添加蒙版效果到 body
    if (!document.getElementById('wallpaper-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'wallpaper-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--wb-bg);
        opacity: ${currentWallpaperOpacity};
        pointer-events: none;
        z-index: -1;
      `;
      body.appendChild(overlay);
    }

    // 添加蒙版效果到侧边栏（更深的透明度）
    if (aside && !aside.querySelector('#sidebar-overlay')) {
      const sideOverlay = document.createElement('div');
      sideOverlay.id = 'sidebar-overlay';
      sideOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--wb-bg-side);
        opacity: ${Math.min(0.97, currentWallpaperOpacity + 0.05)};
        pointer-events: none;
        z-index: 0;
      `;
      aside.style.position = 'relative';
      aside.insertBefore(sideOverlay, aside.firstChild);
      // 确保侧边栏内容在蒙版之上
      Array.from(aside.children).forEach(child => {
        if (child.id !== 'sidebar-overlay') {
          child.style.position = 'relative';
          child.style.zIndex = '1';
        }
      });
    }
  } else {
    body.style.backgroundImage = '';
    document.documentElement.style.removeProperty('--glass-wallpaper');
    delete document.documentElement.dataset.wallpaper;
    if (aside) {
      aside.style.backgroundImage = '';
      aside.style.position = '';
      const sideOverlay = aside.querySelector('#sidebar-overlay');
      if (sideOverlay) sideOverlay.remove();
      Array.from(aside.children).forEach(child => {
        child.style.position = '';
        child.style.zIndex = '';
      });
    }
    const overlay = document.getElementById('wallpaper-overlay');
    if (overlay) overlay.remove();
  }
  // 壁纸挂上/摘掉都要重算一次可读性补偿：摘掉壁纸后描边必须撤，否则纯色背景上文字发虚
  applyWallpaperOpacity(currentWallpaperOpacity);
}

// 应用配色
function applySkin(skin) {
  console.log("applySkin called with:", skin);
  document.documentElement.setAttribute('data-skin', skin);
  const root = document.documentElement;

  if (skin === 'blue') {
    root.style.setProperty('--wb-bg', '#0a1929');
    root.style.setProperty('--wb-bg-2', '#0d2137');
    root.style.setProperty('--wb-accent', '#1976d2');
    root.style.setProperty('--wb-border', '#1e3a5f');
  } else if (skin === 'purple') {
    root.style.setProperty('--wb-bg', '#1a0b2e');
    root.style.setProperty('--wb-bg-2', '#251243');
    root.style.setProperty('--wb-accent', '#7c3aed');
    root.style.setProperty('--wb-border', '#3d2066');
  } else if (skin === 'green') {
    root.style.setProperty('--wb-bg', '#05201a');
    root.style.setProperty('--wb-bg-2', '#0a2e25');
    root.style.setProperty('--wb-accent', '#10b981');
    root.style.setProperty('--wb-border', '#134e3a');
  } else {
    // 恢复默认（移除自定义样式，让 CSS 变量生效）
    root.style.removeProperty('--wb-bg');
    root.style.removeProperty('--wb-bg-2');
    root.style.removeProperty('--wb-accent');
    root.style.removeProperty('--wb-border');
  }
}

// ================= 基础状态 =================
let sessionId = null;
let currentMode = "craft";
let settingsCache = null;
let projects = [];
let activeProject = "默认项目"; // 必须在任何 renderHistory() 调用前声明（初始化就会用到）
let assistant = { name: "CloseCode", avatar: "🤖" }; // 助理名字和头像来自本地设置
let isReplaying = false; // 回放历史任务中：事件照走一遍渲染，但不许它去动"当前"的文件面板和预览
const runningSessions = new Map(); // sessionId -> { ui } 正在跑任务的会话（服务端锁按会话，跨会话可并行）
const sessionDirs = new Map(); // sessionId -> 该对话在默认工作空间下的成果子文件夹（成果面板标「本对话」）
const sessionModels = new Map(); // sessionId -> 该对话指定的模型名（没有 = 跟随全局默认）
const sessionGoals = new Map(); // sessionId -> 该对话的目标状态（Goal 模式的目标卡）
let pendingModel; // 新对话还没发首条消息就选了模型：先记着，会话建好后再落到服务端
// 助理模式（🤖 助理页）没有会话 id，模型另存一份，服务端落在 config.assist_model 里。
// inAssistMode 由 app-03.js 的 openPageView/closeAssistView 维护——那边的 pageKind 是 let，
// 在这个文件里读它会撞暂时性死区，所以状态放这边声明、那边赋值
let assistModel;
let inAssistMode = false;
const sessionQueues = new Map();   // sessionId -> [{text, mode}] 同一会话内追加的消息才排队
const curBusy = () => !!(sessionId && runningSessions.has(sessionId));
const qOf = (sid) => { let q = sessionQueues.get(sid); if (!q) { q = []; sessionQueues.set(sid, q); } return q; };
const SESS_KEY = "wb_sessions";
let sessions = JSON.parse(localStorage.getItem(SESS_KEY) || "[]");

// 上下文百分比显示
const contextIndicator = document.getElementById("context-indicator");
const contextPercentage = document.getElementById("context-percentage");
let currentContextTokens = 0;
let contextRequestId = 0;
let cachedTranscript = null; // 缓存当前会话的transcript
let cachedSessionId = null; // 缓存的会话ID

// 把占比清回 0%（切会话/切项目/新建任务时立刻调用）。
// 不清就会留着上一条对话的数字：新建的项目一条消息都没发过，头上却挂着 43%。
function resetContextIndicator(title = "当前无会话") {
  contextRequestId++;
  currentContextTokens = 0;
  cachedTranscript = null;
  cachedSessionId = null;
  if (!contextPercentage) return;
  if (contextIndicator) {
    contextIndicator.style.color = "var(--wb-text-3)";
    contextIndicator.title = title;
  }
  contextPercentage.textContent = "0%";
  contextPercentage.style.color = "var(--wb-text-3)";
}

// 更新上下文百分比显示。
// ⚠️ 数字一律由后端给：真正决定「还能聊多久」的是发给模型的 history（压缩后会变小），
// 而前端手上的 transcript 是完整回放日志、永不缩小。早先前端自己按
// `transcript.length * 1.3 / 200000` 估，于是压缩过好几轮、实际只占几个百分点的会话
// 照样显示 96%，用户以为要撞上限了。
async function updateContextIndicator() {
  if (!contextPercentage) return;

  if (!sessionId) return resetContextIndicator("当前无会话");

  // 请求发出后用户可能又切走了：拿这一刻的 sid 对比，晚到的响应一律丢掉，
  // 否则旧会话的百分比会盖到新会话头上（切得快时必现）。
  const sid = sessionId;
  const requestId = ++contextRequestId;
  const model = currentSessModel() || settingsCache?.active_model || '';
  const stale = () => sid !== sessionId || requestId !== contextRequestId;

  let ctx;
  try {
    const data = await fetch("/api/session/" + encodeURIComponent(sid) + '?model=' + encodeURIComponent(model), {cache: 'no-store'}).then(r => {
      if (!r.ok) throw new Error('上下文读取失败');
      return r.json();
    });
    if (stale()) return;
    cachedSessionId = sid;
    cachedTranscript = data.transcript || [];
    ctx = data.context;
  } catch {
    if (stale()) return;
    return resetContextIndicator("上下文用量读取失败");
  }

  // 老版本后端没有 context 字段：不显示比瞎猜一个数字好
  if (!ctx || typeof ctx.percentage !== "number") return resetContextIndicator("上下文用量不可用");

  currentContextTokens = ctx.used_tokens_estimate || 0;
  const percentage = ctx.percentage;
  const thresholdPercent = ctx.threshold_percent || 60;

  let color = "var(--wb-text-3)";
  if (percentage >= 80) color = "#f44336";
  else if (percentage >= thresholdPercent) color = "#ff9800";
  else if (percentage >= 40) color = "#ffc107";

  contextPercentage.style.color = color;
  contextPercentage.textContent = `${percentage}%`;
  if (contextIndicator) {
    contextIndicator.style.color = color;
    contextIndicator.title =
      `约 ${currentContextTokens.toLocaleString()} / ${(ctx.budget_tokens_estimate || 0).toLocaleString()} tokens` +
      `\n超过 ${thresholdPercent}% 会自动压缩早期对话，不必手动新建会话`;
  }
}

const chatCol = document.getElementById("chat-col");
const chatScroll = document.getElementById("chat-scroll");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const mask = document.getElementById("modal-mask");
const modalBox = document.getElementById("modal-box");
const mTitle = document.getElementById("m-title");
const mBody = document.getElementById("m-body");

// 页面加载完成后，滚动到最后一条消息
window.addEventListener('load', () => {
  // 等待 DOM 完全渲染和历史记录加载完成
  setTimeout(() => {
    chatStick = true;
    chatScroll.scrollTop = chatScroll.scrollHeight;
    updateContextIndicator(); // 初始化上下文百分比显示
  }, 300);

  // 启动时自动检查更新（延迟3秒，避免阻塞页面加载）
  setTimeout(() => {
    checkForUpdatesOnStartup();
  }, 3000);
});

function saveSessions() {
  localStorage.setItem(SESS_KEY, JSON.stringify(sessions.slice(0, 50)));
  updateContextIndicator(); // 更新上下文百分比显示
}
async function syncRemoteSessions() {
  try {
    const response = await fetch("/api/remote-control/pc-sessions", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const remote = Array.isArray(payload) ? payload : (payload.sessions || []);
    const connected = Array.isArray(payload) ? remote.length > 0 : payload.connected === true;
    let changed = false;
    for (const item of remote) {
      const existing = sessions.find(s => s.id === item.id);
      if (existing) {
        const wasRunning = existing.remote_running === true;
        if (existing.title !== item.title || existing.updated_at !== item.updated_at || existing.project !== item.project || existing.source !== "remote" || wasRunning !== !!item.running || existing.remote_event_count !== (item.event_count || 0)) {
          Object.assign(existing, { title:item.title, updated_at:item.updated_at, project:item.project, source:"remote", remote_running:!!item.running, remote_event_count:item.event_count || 0 });
          existing.remote_finished = wasRunning && !item.running;
          changed = true;
        }
      }
      else { sessions.push({ id:item.id, title:item.title, project:item.project || "默认项目", updated_at:item.updated_at, source:"remote", remote_running:!!item.running, remote_event_count:item.event_count || 0, at:Date.now() }); changed = true; }
    }
    const indicator = document.getElementById("remote-mobile-status");
    if (indicator) { indicator.style.display = "inline-flex"; indicator.dataset.connected = connected ? "true" : "false"; indicator.style.color = connected ? "var(--wb-ok)" : "var(--wb-text-3)"; indicator.querySelector("#remote-mobile-label").textContent = connected ? "手机已连接" : "手机未连接"; indicator.title = connected ? "手机远程连接中，点击打开智能体设置" : "手机远程未连接，点击打开智能体设置"; }
    if (changed) {
      sessions.sort((a,b) => new Date(b.updated_at || b.at || 0) - new Date(a.updated_at || a.at || 0));
      saveSessions();
      if (typeof renderHistory === "function") renderHistory();

    }
  } catch {}
}
async function syncRemoteContext() {
  try {
    await fetch("/api/remote-control/pc-context", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ project: activeProject || "", session_id: sessionId || "" }) });
  } catch {}
}
const remoteReplayState = window.__remoteReplayState || (window.__remoteReplayState = { key: "", owner: 0, generation: 0, inFlight: false });
function remoteTranscriptEventCount(transcript) { return (transcript || []).reduce((n, entry) => n + (entry.events?.length || 0), 0); }
function remoteReplayBegin() {
  const generation = ++remoteReplayState.generation;
  remoteReplayState.owner = generation;
  return generation;
}
function remoteReplayIsCurrent(sid, generation) { return sessionId === sid && remoteReplayState.owner === generation; }
async function syncCurrentRemoteTranscript() {
  const sid = sessionId;
  const current = sessions.find(s => s.id === sid && s.source === "remote");
  if (!current || current.remote_event_count == null || remoteReplayState.inFlight) return;
  const key = sid + ":" + current.remote_event_count;
  if (remoteReplayState.key === key) return;
  const generation = remoteReplayBegin();
  remoteReplayState.inFlight = true;
  try {
    const data = await fetch("/api/session/" + encodeURIComponent(sid), { cache:"no-store" }).then(r => r.json());
    if (!remoteReplayIsCurrent(sid, generation)) return;
    const transcript = data.transcript || [];
    const count = remoteTranscriptEventCount(transcript);
    const actualKey = sid + ":" + count;
    if (remoteReplayState.key === actualKey && remoteReplayState.owner === generation) return;
    remoteReplayState.key = actualKey;
    const currentSession = sessions.find(s => s.id === sid);
    if (currentSession) currentSession.remote_event_count = count;
    if (!runningSessions.has(sid)) {
      chatCol.innerHTML = "";
      let ui = null; isReplaying = true;
      try { for (const entry of transcript) { if (entry.type === "user") ui = createTurnUI(entry.text, entry.mode, sid, entry.delegation); else if (entry.type === "assistant" && ui) { for (const ev of entry.events || []) ui.handleEvent(ev); ui.finish(); } } } finally { isReplaying = false; }
      scrollBottom(true);
    }
  } catch {} finally { if (remoteReplayState.owner === generation) remoteReplayState.inFlight = false; }
}
setInterval(syncRemoteSessions, 3000);
setInterval(syncRemoteContext, 3000);
setInterval(syncCurrentRemoteTranscript, 3000);
setTimeout(syncRemoteSessions, 1200);
setTimeout(syncRemoteContext, 1500);
const remoteMobileStatus = document.getElementById("remote-mobile-status");
remoteMobileStatus?.addEventListener("click", () => { if (typeof openModal === "function") openModal("settings", "agent"); });
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
/** 助理头像 HTML：始终显示 logo */
function assistantAvatarHtml() {
  const theme = document.documentElement.dataset.theme || "dark";
  const logoSrc = theme === "dark" ? "/assets/logos/docode1.webp" : "/assets/logos/docode2.webp";
  return `<img src="${logoSrc}" alt="CloseCode" style="width:100%;height:100%;object-fit:contain;">`;
}
/** 助理身份变了，把界面上所有露脸的地方一次性刷新（品牌位、侧栏、历史气泡头像） */
function applyAssistantIdentity() {
  document.title = assistant.name;
  document.querySelector(".brand .name").textContent = assistant.name;
  // 不再更新 .brand .mark，保持 logo 图片
  const abIc = document.getElementById("ab-ic");
  if (abIc) {
    abIc.innerHTML = `<span class="ab-ava">${assistantAvatarHtml()}</span>`;
  }
  // 更新所有助理消息的头像为 logo
  document.querySelectorAll(".a-msg .avatar").forEach(el => {
    el.innerHTML = assistantAvatarHtml();
    el.className = "avatar"; // 移除 emo 类
  });
  const h1 = document.querySelector("#empty h1");
  if (h1) h1.textContent = "CloseCode 让工作更简单";
}
// 生成回复时用户往上翻，就不再往下拽（能安心看历史）；翻回底部附近才恢复跟随
let chatStick = true;
chatScroll.addEventListener("scroll", () => {
  chatStick = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 80;
  document.getElementById("to-bottom").classList.toggle("show", !chatStick);
});
let scrollRaf = 0;
function scrollBottom(force) {
  if (force) chatStick = true;
  if (!chatStick || scrollRaf) return;
  // 事件流密集时每个事件都设 scrollTop 会逐次强制布局；合并到每帧一次
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (chatStick) chatScroll.scrollTop = chatScroll.scrollHeight;
  });
}
document.getElementById("to-bottom").onclick = () => scrollBottom(true);

// ================= Markdown 渲染（先转义防注入） =================
// 模型偶尔输出「裸语言名 + 无围栏代码」（DeepSeek 常见）：识别后补成 ``` 围栏再走正常渲染
function repairBareCode(str) {
  const LANG = /^(text|plaintext|javascript|js|typescript|ts|python|py|bash|sh|shell|zsh|json|html|xml|svg|css|scss|sql|yaml|yml|java|go|rust|cpp|csharp|ruby|php|swift|kotlin|jsx|tsx|markdown|md)$/i;
  // 「像代码/命令/文件树/日志」的行（文本已 HTML 转义）：缩进、注释、树形符、路径、标记符号、常见命令与语法开头
  const CODE = /^(\s+\S|[│├└─┌┬┴┼]|\/[\w.]|\/\/|#|&lt;|&gt;|["']|\{|\}|\(|\)|\[|`|[■□▶◆●]|[-*]\s|\d+[.)]\s|(const|let|var|function|import|export|from|class|def|async|await|print|python3?|node|npm|npx|pnpm|pip3?|git|cd|ls|cat|curl|wget|brew|docker|ffmpeg|mkdir|cp|mv|echo|source|ssh|chmod)\s|return\b|if\s*\(|for\s*\(|while\s*\(|console\.|\$|[A-Za-z_$][\w$.]*\s*[=({:.]|-{2,})/;
  const lines = str.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (LANG.test(t)) {
      // 语言名后允许隔 1-2 个空行再开始代码
      let j = i + 1, blanks = 0;
      while (j < lines.length && lines[j].trim() === "" && blanks < 2) { j++; blanks++; }
      if (j < lines.length && CODE.test(lines[j])) {
        const buf = [];
        while (j < lines.length) {
          const cur = lines[j];
          if (cur.trim() === "") {
            // 空行后若还是代码行则把空行收进块内，否则代码块到此结束
            let k = j + 1;
            while (k < lines.length && lines[k].trim() === "") k++;
            if (k < lines.length && CODE.test(lines[k])) { while (j < k) buf.push(lines[j++]); continue; }
            break;
          }
          if (!CODE.test(cur)) break;
          buf.push(cur); j++;
        }
        if (buf.length >= 1) {
          out.push("```" + t.toLowerCase(), ...buf, "```");
          i = j - 1;
          continue;
        }
      }
    }
    out.push(l);
  }
  return out.join("\n");
}

function renderMd(src) {
  if (!src) return "";
  // 先把正文里的 <svg> 抠出来换成占位符（在 esc 之前——它们要当图渲染，不能被转义成文字）
  const { text: pre, figs } = SvgFig.extractSvgFigures(src);
  let s = esc(pre);
  const codeBlocks = [];
  const pushCode = (lang, code) => {
    codeBlocks.push(`<div class="code-wrap"><div class="code-head"><span>${esc(lang || "")}</span><a class="code-copy" title="复制代码">复制</a></div><pre><code>${code.replace(/\n$/, "")}</code></pre></div>`);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  };
  const extract = (str) => str.replace(/```(\w*)[^\S\n]*\n?([\s\S]*?)```/g, (_, lang, code) => pushCode(lang, code));
  s = extract(s);
  s = repairBareCode(s);
  s = extract(s);
  // 未闭合围栏（流式输出中 / 模型忘了闭合）：从 ``` 到文末也按代码块渲染
  s = s.replace(/(^|\n)```(\w*)[^\S\n]*\n?([\s\S]*)$/, (_, pre, lang, code) => pre + pushCode(lang, code));
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = s.split("\n");
  const out = [];
  let listType = null, inQuote = false, para = [], tableRows = null;
  const flushPara = () => { if (para.length) { out.push("<p>" + para.join("<br>") + "</p>"); para = []; } };
  const closeList = () => { if (listType) { out.push(listType === "ul" ? "</ul>" : "</ol>"); listType = null; } };
  const closeQuote = () => { if (inQuote) { out.push("</blockquote>"); inQuote = false; } };
  const closeTable = () => {
    if (!tableRows) return;
    const [head, ...rest] = tableRows;
    out.push('<div class="md-table-wrap"><table><thead><tr>' + head.map(c => `<th>${c}</th>`).join("") + "</tr></thead><tbody>"
      + rest.map(r => "<tr>" + r.map(c => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody></table></div>");
    tableRows = null;
  };
  for (let raw of lines) {
    const line = raw.replace(/\s+$/, "");
    let m;
    // 表格：| a | b | 行；分隔行 |---|---| 跳过
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      if (cells.every(c => /^:?-{3,}:?$/.test(c))) continue;
      flushPara(); closeList(); closeQuote();
      (tableRows = tableRows || []).push(cells);
      continue;
    }
    closeTable();
    // 代码块／SVG 占位符独立成块，不并进段落（<div> 不能进 <p>）
    if (/^\s*\x00(?:CODE|SVG)\d+\x00\s*$/.test(line)) {
      flushPara(); closeList(); closeQuote();
      out.push(line.trim());
      continue;
    }
    if ((m = line.match(/^(?:&gt;)\s?(.*)$/))) {
      flushPara(); closeList();
      if (!inQuote) { out.push("<blockquote>"); inQuote = true; }
      out.push("<p>" + (m[1] || "") + "</p>");
      continue;
    }
    closeQuote();
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara(); closeList();
      out.push(`<h${m[1].length}>${m[2]}</h${m[1].length}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line)) {
      flushPara(); closeList(); out.push("<hr>");
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara();
      if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
      out.push("<li>" + m[1] + "</li>");
    } else if ((m = line.match(/^\s*\d+[.、]\s+(.*)$/))) {
      flushPara();
      if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
      out.push("<li>" + m[1] + "</li>");
    } else if (line.trim() === "") {
      flushPara(); closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara(); closeList(); closeQuote(); closeTable();
  return out
    .join("\n")
    .replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[+i])
    .replace(/\x00SVG(\d+)\x00/g, (_, i) => figs[+i]);
}

// 【任务类型：X】跟「（已上传文件：×××）」一样，是发给模型的协议前缀，不是用户自己写的话。
// 气泡和任务历史标题里一律洗掉；原文照旧发给模型，「复制我的输入」复制的也还是原文
function stripSceneTag(t) { return String(t == null ? "" : t).replace(/^\s*【任务类型：[^】]*】\s*/, ""); }

// ================= 回合渲染（实时流式与历史回放共用） =================
function createTurnUI(userText, turnMode, forSid, delegation = { type: "auto" }) {
  const turnSid = forSid !== undefined ? forSid : sessionId; // 本回合归属的会话：后台任务的事件不许影响用户已切走的界面
  const turnProject = sessions.find(s => s.id === turnSid)?.project || (turnSid === sessionId ? activeProject : "");
  const turn = document.createElement("div");
  turn.className = "turn";
  turn.dataset.project = turnProject;

  const createdAt = new Date();
  const timeStr = createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = createdAt.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  turn.innerHTML = `<div class="u-msg">
      <button class="u-copy" title="复制我的输入">⧉</button>
      <div class="bubble"></div>
    </div>
    <div class="a-msg">
      <div class="avatar">${assistantAvatarHtml()}</div>
      <div class="a-msg-content">
        <div class="msg-time">${dateStr} ${timeStr}</div>
        <div class="body"></div>
      </div>
    </div>`;
  // 「（已上传文件：×××）」是给模型看的附件标记，气泡里渲染成附件行，别按原文糊用户脸上（老会话的旧格式一并美化）
  const attNames = [];
  const bodyText = stripSceneTag(userText).replace(/（已上传文件：([^）]+)）/g, (_, names) => {
    for (const n of String(names).split("、")) if (n.trim()) attNames.push(n.trim());
    return "";
  }).trim();
  let bubbleHtml = hlTokens(bodyText, "tk-b");
  if (attNames.length) bubbleHtml += `<div class="bubble-attach">${attNames.map(n => `<span>📎 ${esc(n)}</span>`).join("")}</div>`;
  turn.querySelector(".bubble").innerHTML = bubbleHtml;
  turn.querySelector(".u-copy").onclick = (e) => {
    navigator.clipboard?.writeText(userText).then(() => {
      e.target.textContent = "✓"; setTimeout(() => { e.target.textContent = "⧉"; }, 1200);
    }).catch(() => toast("❌ 复制失败"));
  };
  // 只有"正在看的会话"的回合才上屏；后台会话的回合先游离着更新，切回来时再接上
  if (turnSid === sessionId) {
    document.getElementById("empty")?.remove();
    chatCol.appendChild(turn);
  }
  // 新回合出现后，旧回合的「重新生成」按钮全部撤掉（只允许重生成最后一轮）
  chatCol.querySelectorAll(".turn-actions [data-a=regen]").forEach(b => { if (!turn.contains(b)) b.remove(); });
  const body = turn.querySelector(".body");
  turn._userText = userText;
  turn._mode = turnMode;
  turn._delegation = { ...delegation };
  const teamCards = new Map(), expertCards = new Map();
  let currentText = null;

  // 执行过程折叠区（仿官方「已完成 12s ›」）：过程卡片都收进去，正文文本在外面
  let procWrap = null, procBody = null, procTimer = null;
  const t0 = Date.now();
  // 长跑徽章：步数/续跑轮次/产出件数实时挂在「运行中」计时旁，长任务不再只有一个转圈
  let liveStep = 0, liveRound = 0, liveRoundTotal = 0, liveOuts = 0, liveShellStatus = "";
  const outputNames = new Set();
  const liveBadge = () => (liveStep ? ` · 第 ${liveStep} 步` : "") + (liveRound ? ` · 续跑 ${liveRound}/${liveRoundTotal} 轮` : "") + (liveOuts ? ` · 产出 ${liveOuts} 件` : "") + (liveShellStatus ? " · " + liveShellStatus : "");
  const fmtDur = (ms) => { const s = Math.max(1, Math.round(ms / 1000)); return s < 60 ? s + "s" : Math.floor(s / 60) + "m" + (s % 60) + "s"; };
  const ensureProc = () => {
    if (!procBody) {
      procWrap = document.createElement("div");
      procWrap.className = "proc-wrap open";
      procWrap.innerHTML = `<div class="proc-head"><span class="spinner"></span><span class="pt">运行中…</span><span class="arrow">›</span></div><div class="proc-body"></div>`;
      procBody = procWrap.querySelector(".proc-body");
      procWrap.querySelector(".proc-head").onclick = () => procWrap.classList.toggle("open");
      // 追加（不是 prepend）：开场白留在折叠区上方可见，仿官方「先说在做什么 → 过程收起 → 结论在外」
      body.appendChild(procWrap);
      procTimer = setInterval(() => {
        const pt = procWrap.querySelector(".pt");
        if (pt) pt.textContent = `运行中 ${fmtDur(Date.now() - t0)}` + liveBadge();
      }, 1000);
    }
    return procBody;
  };

  const ensureText = () => {
    if (!currentText) {
      currentText = document.createElement("div");
      currentText.className = "a-text";
      currentText._raw = "";
      // 过程区一旦出现，后续文字都算"过程叙述"进折叠区；finish() 会把最后一段（最终结论）提出来
      (procBody || body).appendChild(currentText);
    }
    return currentText;
  };
  const appendText = (delta) => {
    const el = ensureText();
    el._raw += delta;
    // 流式回复不逐字重排版：每 100ms 渲一次全文。长回复从 O(n²) 次 Markdown 重解析
    // 降到每秒 10 次，打字机效果看不出差别，但滚动和输入不再卡
    if (el._pend) return;
    el._pend = true;
    setTimeout(() => {
      el._pend = false;
      el.innerHTML = renderMd(el._raw);
      if (turnSid === sessionId) scrollBottom(); // 后台并行会话的增量不许滚动当前看的对话
    }, 100);
  };

  function handleEvent(ev) {
    if (ev.type === "step_start") {
      if (ev.depth > 0) return;
      liveStep = ev.step || liveStep;
      body.querySelector(".thinking-hint")?.remove();
      const hint = document.createElement("div");
      hint.className = "thinking-hint";
      hint.style.cssText = "font-size: 13px;color:var(--wb-text-3);margin:6px 0;display:flex;align-items:center;gap:6px";
      hint.innerHTML = `<span class="spinner"></span> 第 ${ev.step} 步 · 思考规划中…`;
      // 首步的提示放正文（此时还没有过程区，别为它建一个）；后续步的提示进过程区
      (procBody || body).appendChild(hint);
      currentText = null;
    } else if (ev.type === "status") {
      if (ev.name === "run_shell" && ev.id) {
        const card = (body._openCards || []).find(c => c._tid === ev.id);
        if (!card) return;
        let state = card.querySelector(".tool-live-status");
        if (!state) {
          state = document.createElement("div");
          state.className = "tool-live-status";
          state.setAttribute("role", "status");
          card.appendChild(state);
        }
        state.textContent = ev.text || "";
        liveShellStatus = ev.phase === "approval" ? "Shell 等待审批" : ev.phase === "stopping" ? "Shell 正在停止" : "Shell 执行中";
        if (ev.output) {
          let output = card.querySelector(".tool-live-output");
          if (!output) {
            output = document.createElement("div");
            output.className = "tool-live-output";
            card.appendChild(output);
          }
          output.textContent = String(ev.output).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").slice(-2000);
          output.scrollTop = output.scrollHeight;
        }
        return;
      }
      // 运行状态直播（重试中/模型长时间没输出）：复用思考提示那一行，别让界面看起来像卡死
      let hint = body.querySelector(".thinking-hint");
      if (!hint) {
        hint = document.createElement("div");
        hint.className = "thinking-hint";
        hint.style.cssText = "font-size: 13px;color:var(--wb-text-3);margin:6px 0;display:flex;align-items:center;gap:6px";
        (procBody || body).appendChild(hint);
      }
      hint.innerHTML = `<span class="spinner"></span> ${esc(ev.text || "")}`;
    } else if (ev.type === "text") {
      if (ev.depth > 0) return;
      body.querySelector(".thinking-hint")?.remove();
      appendText(ev.delta);
    } else if (ev.type === "text_reset") {
      // 断流重试撤稿：模型输出到一半断流，重试前把已经显示出来的半段正文撤掉，
      // 否则重试生成的完整段会拼在半段后面，用户看到同一段话说两遍（前半段还常是截断的病句）。
      // 正文的唯一事实来源是 _raw（每 100ms 整体重渲一次 Markdown），所以撤稿就是把
      // _raw 的尾巴截掉再重渲——不用碰 DOM，截断的半个代码块/表格也能跟着复原
      if (ev.depth > 0 || !currentText) return;
      const el = currentText;
      const chars = Math.max(0, Number(ev.chars) || 0);
      el._raw = el._raw.slice(0, Math.max(0, el._raw.length - chars));
      el.innerHTML = renderMd(el._raw);
    } else if (ev.type === "git_status") {
      let card = body.querySelector(".task-git-status");
      if (!card) { card = document.createElement("div"); card.className = "task-git-status"; card.setAttribute("role", "status"); card.setAttribute("aria-live", "polite"); body.appendChild(card); }
      card.dataset.status = ev.status;
      card.textContent = "Git · " + (ev.message || "") + (ev.branch ? "\n分支：" + ev.branch : "") + (ev.commit ? " · " + ev.commit : "");
      // Do not let the generic completion label imply a failed push succeeded.
      turn._gitIncomplete = ["failed", "blocked", "not_pushed"].includes(ev.status);
    } else if (ev.type === "delegation") {
      currentText = null;
      const note = document.createElement("div");
      note.className = "delegation-note";
      note.textContent = ev.targetType === "none" ? "👤 本轮不委派：主助手直接处理" :
        (ev.source === "auto" ? "🧭 自动匹配" : "📌 指定协作") + " · " + (ev.name || "") + " — " + (ev.reason || "");
      ensureProc().appendChild(note);
    } else if (ev.type === "team_start") {
      currentText = null;
      const card = document.createElement("div");
      card.className = "step-card team-card";
      card.innerHTML = '<div class="head"><span class="tag">👥 ' + esc(ev.team) + '</span><span class="team-state">等待成员执行</span></div><div class="team-members">' + (ev.members || []).map(esc).join(" → ") + '</div>';
      teamCards.set(ev.team, card);
      ensureProc().appendChild(card);
    } else if (ev.type === "team_progress" || ev.type === "team_done") {
      if (ev.type === "team_done" && ev.status !== "completed") turn._delegationIncomplete = true;
      const card = teamCards.get(ev.team);
      if (card) {
        const state = card.querySelector(".team-state");
        state.textContent = ev.type === "team_progress" ? "第 " + ev.index + "/" + ev.total + " 棒 · " + ev.expert :
          (ev.status === "completed" ? "✓ 已完成" : ev.status === "stopped" ? "⏹ 已中止" : "⚠ 执行失败") + " · " + ev.completed + "/" + ev.total + (ev.reason ? " · " + ev.reason : "");
        if (ev.status) card.dataset.status = ev.status;
      }
    } else if (ev.type === "expert_skills") {
      const note = document.createElement("div");
      note.className = "expert-skills-note";
      note.textContent = "🧰 " + ev.expert + " · 已加载：" + ((ev.loaded || []).join("、") || "无绑定技能") +
        ((ev.missing || []).length ? "；⚠ 缺失技能：" + ev.missing.join("、") : "") +
        ((ev.truncated || []).length ? "；长技能已截断，可用 use_skill 续读" : "");
      ensureProc().appendChild(note);
    } else if (ev.type === "expert_done") {
      if (["stopped", "failed"].includes(ev.status)) turn._delegationIncomplete = true;
      const card = expertCards.get(ev.expert);
      if (card) {
        card.querySelector(".desc").textContent = ev.status === "stopped" ? "⏹ 已中止：" + (ev.stopped || "") : ev.status === "failed" ? "⚠ 执行失败" : "✓ 本棒已完成";
        card.dataset.status = ev.status || "completed";
      }
    } else if (ev.type === "expert_start") {
      currentText = null;
      const banner = document.createElement("div");
      banner.className = "step-card";
      banner.innerHTML = `<div class="head"><span class="tag">👥 ${esc(ev.expert)}</span><span class="desc">专家接手子任务：${esc((ev.task || "").slice(0, 60))}</span></div>`;
      expertCards.set(ev.expert, banner);
      ensureProc().appendChild(banner);
    } else if (ev.type === "parallel") {
      // 这一批全是只读工具，同时开跑。说一句，免得用户看到好几张卡一起转以为卡住了
      const note = document.createElement("div");
      note.style.cssText = "font-size: 13px;color:var(--wb-text-3);margin:6px 0";
      note.textContent = `⚡ ${ev.count} 个只读工具并发执行（搜索/抓页面互不影响，一起跑更快）`;
      ensureProc().appendChild(note);
    } else if (ev.type === "tool_use") {
      body.querySelector(".thinking-hint")?.remove();
      currentText = null;
      const card = document.createElement("div");
      card.className = "step-card";
      const who = ev.expert ? `${esc(ev.expert)} · ` : "";
      card.innerHTML =
        `<div class="head"><span class="tag">⚙ ${who}${esc(ev.name)}</span>` +
        `<span class="desc">${esc(ev.purpose || "")}</span><span class="spinner"></span></div>` +
        `<pre>${esc(ev.input_preview || "")}</pre>`;
      card.querySelector(".head").onclick = () => card.classList.toggle("open");
      ensureProc().appendChild(card);
      // 未完成卡片入栈；专家的内层工具卡与协调者的委派卡按 depth 区分，防止张冠李戴
      card._depth = ev.depth || 0;
      card._tid = ev.id || "";
      (body._openCards = body._openCards || []).push(card);
    } else if (ev.type === "tool_result") {
      const stack = body._openCards || [];
      let card = null;
      // 只读工具是并发跑的，谁先回来不一定——认调用 id 才不会把 A 的结果贴到 B 的卡上
      if (ev.id) {
        const i = stack.findIndex((c) => c._tid === ev.id);
        if (i >= 0) card = stack.splice(i, 1)[0];
      }
      if (!card) {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i]._depth === (ev.depth || 0)) { card = stack.splice(i, 1)[0]; break; }
        }
      }
      if (!card) card = stack.pop();
      if (card) {
        card.querySelector(".tool-live-status")?.remove();
        card.querySelector(".tool-live-output")?.remove();
        if (ev.name === "run_shell") liveShellStatus = "";
        card.querySelector(".spinner")?.remove();
        const tag = document.createElement("span");
        tag.className = "tag " + (ev.isError ? "err" : "ok");
        tag.textContent = ev.isError ? "失败" : "完成";
        card.querySelector(".head").appendChild(tag);
        card.querySelector("pre").textContent += "\n\n── 执行结果 ──\n" + (ev.preview || "");
        if (ev.isError) card.classList.add("open");
      }
    } else if (ev.type === "limit") {
      currentText = null;
      const note = document.createElement("div");
      note.style.cssText = "font-size: 13px;color:var(--wb-err);margin:6px 0";
      note.textContent = `⏱ ${ev.note || "已达执行上限"}，任务强制收尾`;
      ensureProc().appendChild(note);
      procWrap?.classList.add("open");
      turn._limited = true;
    } else if (ev.type === "auto_continue") {
      currentText = null;
      liveRound = ev.round || 0; liveRoundTotal = ev.total || 0;
      const note = document.createElement("div");
      note.style.cssText = "font-size: 13px;color:var(--wb-text-3);margin:6px 0";
      note.textContent = `🔁 ${ev.note || "已达执行上限"}，任务未完，自动续跑第 ${ev.round}/${ev.total} 轮（按进度接着做，不重跑）`;
      ensureProc().appendChild(note);
      procWrap?.classList.add("open");
    } else if (ev.type === "sleep") {
      // 本机睡了一觉又醒了：任务时限已顺延，跟用户说一声免得对不上「怎么跑了这么久」
      currentText = null;
      const note = document.createElement("div");
      note.style.cssText = "font-size: 13px;color:var(--wb-text-3);margin:6px 0";
      note.textContent = `\u{1F4A4} ${ev.note || "检测到本机睡眠，任务时限已顺延"}`;
      ensureProc().appendChild(note);
    } else if (ev.type === "failover") {
      // 主模型挂起/持续报错、自动切到备用渠道——必须大声播报，绝不静默换模型
      currentText = null;
      const note = document.createElement("div");
      note.style.cssText = "font-size: 13px;color:var(--wb-err);margin:6px 0";
      note.textContent = `🔀 ${ev.note || "已切换到备用渠道"}`;
      ensureProc().appendChild(note);
      procWrap?.classList.add("open");
    } else if (ev.type === "trim") {
      // 历史太长，较早的工具原文被截短了。一条任务只留一行提示，累计数字滚动更新
      const proc = ensureProc();
      let note = proc.querySelector(".trim-note");
      if (!note) {
        note = document.createElement("div");
        note.className = "trim-note";
        note.style.cssText = "font-size: 13px;color:var(--wb-text-3);margin:6px 0";
        proc.appendChild(note);
      }
      note.textContent = `✂️ 历史过长，已截短较早的工具输出（约 ${Math.round((ev.chars || 0) / 1000)} 千字符），最近几步保留原文。可在 设置→智能体设置 调大上下文预算`;
    } else if (ev.type === "compact") {
      // 会话超长时后端自动把早期轮次压成一条摘要，这里留一行告知，免得用户觉得"它忘了前面"
      const proc = ensureProc();
      const note = document.createElement("div");
      note.style.cssText = "font-size: 13px;color:var(--wb-text-3);margin:6px 0";
      note.textContent = `🗜️ 会话较长，已把早前 ${ev.removed || 0} 条消息压缩成一条摘要（要点保留，原文在 data/compact-archive 有归档）`;
      proc.appendChild(note);
    } else if (ev.type === "usage") {
      // 插队会触发多轮 runTask、发多个 usage 事件 → 累加而不是覆盖
      if (!turn._usage) turn._usage = { ...ev };
      else {
        turn._usage.prompt += ev.prompt || 0;
        turn._usage.completion += ev.completion || 0;
        turn._usage.cached = (turn._usage.cached || 0) + (ev.cached || 0);
        turn._usage.calls += ev.calls || 0;
        turn._usage.elapsed_ms += ev.elapsed_ms || 0;
      }
      // usage 事件即记录真实 Token 用量；历史回放不重复统计。
      if (!isReplaying && typeof recordDailyTokens === "function") {
        recordDailyTokens(ev);
      }
    } else if (ev.type === "dir") {
      // 本对话的成果子文件夹（只发直播不进回放；回放/续接场景由 /api/session 的 dir 字段补上）
      if (ev.dir && sessionDirs.get(turnSid) !== ev.dir) {
        sessionDirs.set(turnSid, ev.dir);
        openDirs.add(ev.dir); // 第一次知道就默认展开；用户手动折叠后不再打扰
        if (turnSid === sessionId) renderFiles(filesCache);
      }
    } else if (ev.type === "goal") {
      // 目标卡状态直播（拆解完成/每轮验收后各推一次）；不进回放记录，回放由 /api/session 的 goal 字段补上
      if (ev.goal) {
        sessionGoals.set(turnSid, ev.goal);
        if (turnSid === sessionId) renderGoalCard();
      }
    } else if (ev.type === "title") {
      // 服务端给首轮任务起的短标题（截断标题太丑）；不进 transcript，回放不经过这里
      const s = sessions.find((x) => x.id === turnSid);
      if (s && ev.title) { s.title = ev.title; saveSessions(); renderHistory(); }
      if (turnSid === sessionId && ev.title) document.getElementById("session-title").textContent = ev.title;
    } else if (ev.type === "interject") {
      currentText = null;
      // 插队时前端已经放了「等待注入」占位（服务端按 FIFO 注入，转正最早那个就是它）
      const pend = body.querySelector(".interject-note.pending");
      if (pend) {
        pend.classList.remove("pending");
        pend.querySelector(".lb").textContent = "⚡ 插队补充";
      } else {
        const note = document.createElement("div");
        note.className = "interject-note";
        note.innerHTML = `<div class="lb">⚡ 插队补充</div>${esc(ev.text || "")}`;
        body.appendChild(note);
      }
    } else if (ev.type === "ask_user") {
      currentText = null;
      body.appendChild(makeAskCard(ev, turnSid));
    } else if (ev.type === "ask_answer") {
      const card = body.querySelector(`.ask-card[data-ask-id="${cssEsc(ev.ask_id || "")}"]`);
      if (card && card._mark) card._mark(ev.answer, ev.timeout);
      else if (card) card.classList.add("done");
    } else if (ev.type === "files") {
      // ev.changed 是服务端在任务开头打的快照上算出来的，历史回放也还原得出来；
      // 老版本存下来的记录里没有这个字段，退回本地 mtime 差异
      const turnOut = ev.changed
        ? (ev.files || []).filter(f => ev.changed.includes(f.name))
        : changedFiles(ev.files, ev.project || turnProject);
      // 同一文件可能被多个工具步骤反复修改；产出件数按本回合不同文件去重。
      for (const file of turnOut) if (file?.name) outputNames.add(file.name);
      liveOuts = outputNames.size;
      const outputProject = ev.project || turnProject;
      renderTurnOutputs(body, turnOut, outputProject); // 先算差异，autoPreviewNewHtml 里才会推进快照
      // 回放历史任务时这些是当时的文件列表：拿它去刷右侧面板会把现在的状态盖成旧的，
      // 自动预览更会莫名其妙弹出一个几天前的文件。产出卡片照摆，其余一律不动。
      if (!isReplaying) {
        snapshotFiles(ev.files, outputProject);
        if (outputProject !== activeProject) return;
        renderFiles(ev.files);
        // 这一回合真产出了东西才自动预览、才把文件面板弹出来。
        // 工作目录里本来就躺着一堆旧文件，拿"目录非空"当理由每次聊天都弹一次，
        // 只是白白挤掉聊天区——用户明确反馈过。
        // 另外：用户已经切到别的会话时，这个后台回合只推进快照，不许弹面板抢镜
        if (turnSid !== sessionId) { snapshotFiles(ev.files); return; }
        if (turnOut.length) {
          // 产出文件不再自动展开右侧面板或自动打开预览；用户点击文件/预览入口后再查看。
          autoPreviewNewHtml(ev.files, turnOut);
        } else {
          snapshotFiles(ev.files); // 没产出也要把基线推进，免得下一轮把旧文件误当成新的
        }
      }
    } else if (ev.type === "sources") {
      renderSources(body, ev.items || []);
    } else if (ev.type === "milestones") {
      // 里程碑时间线：agent 每更新一次 PROGRESS.md，这张卡就在过程区原地刷新打勾状态
      const proc = ensureProc();
      let card = proc.querySelector(".ms-card");
      if (!card) {
        card = document.createElement("div");
        card.className = "ms-card";
        proc.appendChild(card);
      }
      const items = ev.items || [];
      const doneN = items.filter((i) => i.done).length;
      card.innerHTML = `<div class="ms-head">📍 里程碑 ${doneN}/${items.length}${ev.file ? ` <span class="ms-file">${esc(ev.file)}</span>` : ""}</div>` +
        items.map((i) => `<div class="ms-item${i.done ? " done" : ""}">${i.done ? "✅" : "⬜"} ${esc(String(i.text || ""))}</div>`).join("");
    } else if (ev.type === "error") {
      currentText = null;
      const t = document.createElement("div");
      t.className = "a-text";
      t.style.color = "var(--wb-err)";
      t.textContent = "出错了：" + (ev.message || "");
      body.appendChild(t); // 错误必须留在正文可见，不进折叠区
    }
    if (turnSid === sessionId) scrollBottom(); // 已切走的会话在后台跑，别拽当前视图的滚动条
  }

  function finish() {
    const gitCard = body.querySelector(".task-git-status");
    if (gitCard && !["pushed", "failed", "blocked", "not_pushed", "skipped"].includes(gitCard.dataset.status)) {
      gitCard.dataset.status = "not_pushed";
      gitCard.textContent += "\n未收到 Git 完成确认，请核对本地与远程状态。";
      turn._gitIncomplete = true;
    }
    if (gitCard) body.appendChild(gitCard);
    // 中断/进程退出可能没有 done 事件，不能让回放卡永远停在“正在执行”。
    for (const card of teamCards.values()) if (!card.dataset.status) {
      card.dataset.status = "stopped";
      card.querySelector(".team-state").textContent = "⏹ 执行中断，未收到全队完成确认";
      turn._delegationIncomplete = true;
    }
    for (const card of expertCards.values()) if (!card.dataset.status) {
      card.dataset.status = "stopped";
      card.querySelector(".desc").textContent = "⏹ 未收到本棒完成确认";
      turn._delegationIncomplete = true;
    }
    body.querySelector(".thinking-hint")?.remove();
    // 回合结束后不允许再有任何转圈（含未收到结果的工具卡，统一标记中止）
    turn.querySelectorAll(".tool-live-status, .tool-live-output").forEach(el => el.remove());
    turn.querySelectorAll(".step-card .spinner").forEach(s => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "中止";
      s.closest(".head")?.appendChild(tag);
      s.remove();
    });
    turn.querySelectorAll(".spinner").forEach(s => s.remove());

    // 过程折叠区收尾：停计时、写「已完成 Xs」、默认折叠（出错/被截断则保持展开）
    if (procTimer) { clearInterval(procTimer); procTimer = null; }
    if (procWrap) {
      // 最后一段正文是最终结论 → 提出折叠区保持可见（开场白在上、结论在下、过程收起）
      const texts = procBody.querySelectorAll(":scope > .a-text");
      if (texts.length) body.appendChild(texts[texts.length - 1]);
      if (!procBody.childElementCount) {
        procWrap.remove();
      } else {
        const ms = (turn._usage && turn._usage.elapsed_ms) || Date.now() - t0;
        const n = procBody.querySelectorAll(".step-card").length;
        const pt = procWrap.querySelector(".pt");
        pt.textContent = `${(turn._delegationIncomplete || turn._gitIncomplete || (turn._taskStatus && turn._taskStatus !== "completed")) ? "已结束" : "已完成"} ${fmtDur(ms)}` + (n ? ` · ${n} 步` : "") + (liveRound ? ` · 续跑 ${liveRound} 轮` : "") + (liveOuts ? ` · 产出 ${liveOuts} 件` : "");
        // 出过错以前靠"保持展开"提示，结果一个四十步的任务只要中间错过一次就整片摊开，
        // 用户要往下滚半天才够得着结论。改成收起 + 标题挂红角标：信号一个字没少，点开就直达过程
        const marks = [];
        const nErr = procBody.querySelectorAll(".tag.err").length;
        if (nErr) marks.push(`${nErr} 步出错`);
        if (turn._limited) marks.push("未跑完");
        if (turn._delegationIncomplete) marks.push("专家协作未全部完成");
        if (turn._gitIncomplete) marks.push("Git 未完成同步");
        if (marks.length) {
          const chip = document.createElement("span");
          chip.className = "proc-warn";
          chip.textContent = "⚠ " + marks.join(" · ");
          pt.after(chip);
        }
        procWrap.classList.remove("open"); // 回合结束一律收起
      }
    }
    // 来源、产出卡片都是回合的结论物，挪到最后——否则会卡在中途正文和最终结论之间
    const srcBlock = body.querySelector(":scope > .src-block");
    if (srcBlock) body.appendChild(srcBlock);
    const outBlock = body.querySelector(":scope > .out-block");
    if (outBlock) body.appendChild(outBlock);
    addActionsBar();
    if (turnMode === "plan") renderPlanChecklist();
  }

  // 官方式回复操作条：复制 / 👍👎 / 重新生成 + 共消耗 tokens · 模型
  function addActionsBar() {
    if (turn.querySelector(".turn-actions")) return;
    const bar = document.createElement("div");
    bar.className = "turn-actions";
    bar.innerHTML =
      `<button class="ta-btn" data-a="copy" title="复制回复">${ic("copy")}</button>` +
      `<button class="ta-btn" data-a="regen" title="重新生成">${ic("refresh-cw")} 重新生成</button>` +
      `<span class="ta-meta"></span>`;
    const u = turn._usage;
    const meta = bar.querySelector(".ta-meta");
    if (u && (u.prompt || u.completion)) {
      meta.textContent = `共消耗 ✧ ${(u.prompt + u.completion).toLocaleString()} tokens · ${u.provider || ""}`;
      // 命中缓存那部分便宜约一个数量级。不写出来的话，长任务里"输入 160 万 token"
      // 看着像一笔巨款，实际可能九成是缓存读；反过来命中率掉到 0 也没人察觉
      const hit = u.cached ? Math.round((u.cached / Math.max(1, u.prompt)) * 100) : 0;
      meta.title =
        `输入 ${u.prompt.toLocaleString()} + 输出 ${u.completion.toLocaleString()} tokens · ${u.calls} 次模型调用` +
        (u.cached ? `\n其中命中缓存 ${u.cached.toLocaleString()}（${hit}%），这部分按约 1/10 计费` : "");
      if (hit) meta.textContent += ` · 缓存命中 ${hit}%`;
    } else if (u) {
      meta.textContent = `${u.provider || ""}`;
    }
    bar.querySelector("[data-a=copy]").onclick = async (e) => {
      // 复制"渲染后"的内容而不是 markdown 源码：贴到飞书/Word 里保留格式，
      // 贴到纯文本框里也不会出现 **、<br> 这类原始标记
      const parts = [...body.querySelectorAll(".a-text")].map(t => {
        const c = t.cloneNode(true);
        c.querySelectorAll(".code-head").forEach(h => { // 代码块的「复制」小工具条不进剪贴板
          const lang = h.querySelector("span")?.textContent || "";
          h.replaceWith(Object.assign(document.createElement("div"), { textContent: lang, style: "font-size:12px;color:#888" }));
        });
        return c;
      });
      const html = parts.map(c => c.innerHTML).join("<br>");
      // innerText 需要元素在文档里才有正确换行，挂到屏外拿完就删
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:-99999px;top:0;width:600px";
      parts.forEach(c => probe.appendChild(c));
      document.body.appendChild(probe);
      const plain = parts.map(c => c.innerText.trim()).filter(Boolean).join("\n\n");
      probe.remove();
      const done = () => { e.target.textContent = "✓"; setTimeout(() => { e.target.textContent = "⧉"; }, 1200); };
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          })]);
          return done();
        }
      } catch {}
      navigator.clipboard?.writeText(plain).then(done).catch(() => toast("❌ 复制失败"));
    };
    bar.querySelector("[data-a=regen]").onclick = () => {
      if (curBusy()) return;
      const text = turn._userText, mode = turn._mode;
      turn.remove();
      doSend(text, mode, true, turn._delegation);
    };
    body.appendChild(bar);
  }

  // Plan 模式：把执行计划解析成任务列表卡片
  function renderPlanChecklist() {
    const texts = body.querySelectorAll(".a-text");
    const raw = texts.length ? texts[texts.length - 1]._raw || "" : "";
    let steps = [...raw.matchAll(/^\s*\d+[.、)]\s+(.+)$/gm)].map(m => m[1]);
    if (steps.length < 2) steps = [...raw.matchAll(/^\s*[-*]\s+(.+)$/gm)].map(m => m[1]);
    steps = steps.map(s => s.replace(/\*\*/g, "").trim()).filter(s => s.length > 2).slice(0, 20);
    if (steps.length < 2) return;
    const card = document.createElement("div");
    card.className = "plan-list";
    card.innerHTML = `<div class="pl-head">📋 计划任务列表（${steps.length} 步）</div>`
      + steps.map(s => `<label class="pl-item"><input type="checkbox"> <span>${esc(s)}</span></label>`).join("")
      + `<button class="pl-run">▶ 切换 Craft 按此计划执行</button>`;
    card.querySelector(".pl-run").onclick = () => {
      setMode("craft");
      inputEl.value = "请严格按照以下计划执行，每完成一步简要汇报：\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
      syncInputHl();
      inputEl.focus();
      scrollBottom(true);
    };
    body.appendChild(card);
    if (turnSid === sessionId) scrollBottom();
  }
  /** 插队请求已被服务端受理但还没到注入间隙：先在对话里放个占位，用户立刻看得到自己说了什么 */
  function markPendingInterject(text) {
    const note = document.createElement("div");
    note.className = "interject-note pending";
    note.innerHTML = `<div class="lb">⚡ 已插队 · 等当前步骤结束后注入 <a href="#" class="cancel-interject" title="撤回这条消息">✕</a></div>${esc(text)}`;
    body.appendChild(note);
    note.querySelector(".cancel-interject").onclick = async (e) => {
      e.preventDefault();
      const resp = await fetch("/api/chat/interject/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: turnSid, message: text }),
      }).catch(() => null);
      if (resp && resp.ok) {
        note.remove();
        toast("已撤回插队消息"); // toast 在 app-02.js，函数声明挂全局；这个回调远晚于脚本加载才跑
      } else {
        const err = resp ? await resp.json().catch(() => ({})) : {};
        toast(err.error || "撤回失败（可能已执行）");
      }
    };
    if (turnSid === sessionId) scrollBottom();
  }
  const stats = () => ({
    dur: fmtDur((turn._usage && turn._usage.elapsed_ms) || Date.now() - t0),
    steps: turn.querySelectorAll(".step-card").length,
    rounds: liveRound,
    outs: outputNames.size,
  });
  return { handleEvent, finish, turn, sid: turnSid, markPendingInterject, stats };
}

// ================= 空状态（场景 tab + 分类胶囊，仿官方首页） =================
const SCENES = {
  "代码开发": ["💻 日常开发", "🌐 网站开发", "🤖 Agent 应用", "🛠 Skill 开发", "📚 技术文档", "🐛 Bug 修复", "⚡ 性能优化"],
  "日常办公": ["📄 文档处理", "📊 数据分析及可视化", "🔍 深度研究", "📽 幻灯片制作", "🗓 周报总结", "💹 金融服务"],
};
let sceneTag = null; // 选中的任务类型标签
function setSceneTag(label) {
  sceneTag = label;
  const box = document.getElementById("scene-tag-box");
  box.innerHTML = label ? `<span class="scene-tag">${esc(label)} <b onclick="setSceneTag(null)">✕</b></span>` : "";
  inputEl.focus();
}
function buildEmpty() {
  const tpl = document.createElement("div");
  tpl.className = "empty"; tpl.id = "empty";
  tpl.innerHTML = `<h1>CloseCode 让工作更简单</h1>
    <div class="scene-tabs">${Object.keys(SCENES).map((k, i) =>
      `<button class="${i === 0 ? "active" : ""}" data-scene="${k}">${["💻","⏱"][i]} ${k}</button>`).join("")}</div>
    <div class="chips" id="scene-chips"></div>`;
  const chipsEl = tpl.querySelector("#scene-chips");
  const renderChips = (scene) => {
    chipsEl.innerHTML = SCENES[scene].map(c => `<button>${c}</button>`).join("");
  };
  renderChips("代码开发"); // 默认显示代码开发
  tpl.querySelector(".scene-tabs").addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    tpl.querySelectorAll(".scene-tabs button").forEach(b => b.classList.toggle("active", b === e.target));
    renderChips(e.target.dataset.scene);
  });
  chipsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setSceneTag(b.textContent.trim());
  });
  return tpl;
}
chatCol.appendChild(buildEmpty());

// ================= @ 引用文件 / 调用技能 自动补全 =================
let filesCache = [], skillsCache = [], filesCacheProject = null;
function refreshSkillsCache() {
  fetch("/api/skills").then(r => r.json()).then(l => {
    skillsCache = l;
    // 技能列表更新后，如果正在显示技能菜单就刷新一下
    if (mentionState && mentionState.trigger === "/" && mentionMenu && mentionMenu.classList.contains("show")) {
      renderMentionMenu();
    }
  }).catch(() => {});
}
refreshSkillsCache(); // 页面加载时初始化
const mentionMenu = document.getElementById("mention-menu");
let mentionState = null; // {trigger:'@'|'/', start, query}

function detectMention() {
  const pos = inputEl.selectionStart;
  const before = inputEl.value.slice(0, pos);
  const m = before.match(/(?:^|[\s（(])([@/])([^\s@/]*)$/);
  if (!m) { mentionState = null; mentionMenu.classList.remove("show"); return; }
  mentionState = { trigger: m[1], query: m[2], start: pos - m[2].length - 1 };
  if (m[1] === "@") refreshFilesCache();
  renderMentionMenu();
}
// Fix C: 辅助函数 - 为文件API添加项目参数
// 切项目时同步清空上一项目的可操作入口，再异步拉新列表。
function resetProjectFileState() {
  filesFetchAt = 0;
  openDirs.clear();
  renderFiles([]);
  pvRequest++; pvCurrent = null; pvProject = null;
  disposeIsolatedPreviews(document.getElementById("pv-body"));
  document.getElementById("pv-body").replaceChildren();
  pvPanel.classList.remove("show");
  document.getElementById("files-panel").classList.remove("show");
  if (typeof pendingAttach !== "undefined") pendingAttach.length = 0;
  if (typeof attachChips !== "undefined") attachChips.innerHTML = "";
}

function fileApiUrl(endpoint, filename, project = activeProject) {
  const projectParam = `?project=${encodeURIComponent(project || "")}`;
  return endpoint + encodeURIComponent(filename) + projectParam;
}

async function refreshProjectFiles(project = activeProject) {
  try {
    const response = await fetch("/api/files?project=" + encodeURIComponent(project || ""));
    const files = await response.json();
    if (response.ok && Array.isArray(files) && activeProject === project) { renderFiles(files); snapshotFiles(files, project); }
  } catch {}
}
let filesFetchAt = 0;
function refreshFilesCache() {
  if (filesCacheProject === activeProject && Date.now() - filesFetchAt < 3000) return; // 每项目独立防抖
  if (filesCacheProject !== activeProject) { filesCache = []; filesCacheProject = activeProject; }
  filesFetchAt = Date.now();
  // Fix C: 传递当前项目参数，确保获取正确项目的文件列表
  const projectParam = `?project=${encodeURIComponent(activeProject || "")}`;
  const project = activeProject;
  fetch("/api/files" + projectParam).then(r => r.json()).then(f => {
    if (project !== activeProject || !Array.isArray(f)) return;
    filesCache = f || [];
    if (mentionState && mentionState.trigger === "@") renderMentionMenu();
  }).catch(() => {});
}
function renderMentionMenu() {
  const { trigger, query } = mentionState;
  let items = [];
  if (trigger === "@") {
    items = filesCache.filter(f => f.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 12).map(f => ({ label: `${fileIcon(f.name)} ${f.name}`, insert: "@" + f.name, sub: "工作空间文件" }));
    if (!items.length) items = [{ label: "（工作空间还没有文件，可点 ＋ 上传）", insert: null }];
  } else {
    items = skillsCache.filter(s => s.name.toLowerCase().includes(query.toLowerCase()) || s.description.includes(query))
      .slice(0, 12).map(s => ({ label: "📦 /" + s.name, insert: "/" + s.name, sub: s.description }));
    if (!items.length) items = [{ label: "（没有匹配的技能）", insert: null }];
  }
  mentionMenu.innerHTML = `<div class="mh">${trigger === "@" ? "引用工作空间文件" : "调用技能"}</div>` +
    items.map((it, i) => `<div class="mi ${i === 0 && it.insert ? "sel" : ""}" data-insert="${esc(it.insert || "")}">${it.label}${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ""}</div>`).join("");
  mentionMenu.classList.add("show");
  mentionMenu.querySelectorAll(".mi").forEach(mi => mi.onclick = () => applyMention(mi.dataset.insert));
}
function applyMention(insert) {
  if (!insert || !mentionState) { mentionMenu.classList.remove("show"); return; }
  const pos = inputEl.selectionStart;
  inputEl.value = inputEl.value.slice(0, mentionState.start) + insert + " " + inputEl.value.slice(pos);
  const newPos = mentionState.start + insert.length + 1;
  inputEl.setSelectionRange(newPos, newPos);
  mentionState = null;
  mentionMenu.classList.remove("show");
  inputEl.focus();
  syncInputHl();
}

// ---------- @文件 //技能 token 高亮：镜像层与 textarea 逐字对齐，只画底色不碰文字 ----------
const inputHl = document.getElementById("input-hl");
const resizeComposerInput = bindComposerAutoSize(inputEl, inputHl);
{
  const cs = getComputedStyle(inputEl);
  for (const p of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontFamily", "fontSize", "lineHeight", "letterSpacing"]) inputHl.style[p] = cs[p];
}
function hlTokens(text, cls) {
  // /token 只在命中已装技能时高亮（避免把 /Users/... 这类路径误当指令）；@token 一律高亮
  return esc(text).replace(/(^|[\s（(：:，,])(@[^\s@，。！？；：、（）()<>"']+|\/[^\s@/，。！？；：、（）()<>"']+)/g, (m, pre, tok) => {
    if (tok[0] === "/" && !skillsCache.some(s => tok.slice(1).toLowerCase() === String(s.name).toLowerCase())) return m;
    return pre + `<span class="${cls}">${tok}</span>`;
  });
}
function syncInputHl() {
  resizeComposerInput();
  inputHl.innerHTML = inputEl.value ? hlTokens(inputEl.value, "tk") + "\n" : "";
  inputHl.scrollTop = inputEl.scrollTop;
}
inputEl.addEventListener("input", syncInputHl);
inputEl.addEventListener("scroll", () => { inputHl.scrollTop = inputEl.scrollTop; });

inputEl.addEventListener("input", detectMention);
inputEl.addEventListener("click", detectMention);
inputEl.addEventListener("keydown", (e) => {
  if (mentionMenu.classList.contains("show")) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const sel = mentionMenu.querySelector(".mi.sel") || mentionMenu.querySelector(".mi[data-insert]:not([data-insert=''])");
      applyMention(sel ? sel.dataset.insert : null);
      return;
    }
    if (e.key === "Escape") { mentionMenu.classList.remove("show"); mentionState = null; }
  }
}, true);

// ================= 成果文件 =================
// ───────── AI 拿不准时的提问卡 ─────────
// 老版本是一行光秃秃的紫色胶囊按钮：只有选项名，没有「选它意味着什么」。
// 于是模型只能把代价一股脑塞进问题那一句里，用户读着累，选完还常常选错。
// 现在一条选项一行，上面是短语、下面是那句代价，键盘 1/2/3/4 直接选；
// 右上角挂倒计时——超时服务端会替他按默认继续，这件事得让他看见，不能闷着。
function makeAskCard(ev, turnSid) {
  const gitRecovery = ev.kind === "git_recovery";
  const opts = (ev.options || []).map((o) => (o && typeof o === "object" ? o : { label: String(o), detail: "" }));
  const card = document.createElement("div");
  card.className = "ask-card" + (gitRecovery ? " git-recovery" : "");
  card.dataset.askId = ev.ask_id || "";
  card.innerHTML =
    `<div class="ask-hd"><span class="ask-ic">${ic("circle-help")}</span><span class="ask-lb">${gitRecovery ? "Git · 确认接续本地成果" : ev.expert ? `专家「${esc(ev.expert)}」拿不准，想问你一句` : "有个岔路，想让你定一下"}</span><span class="ask-timer"></span></div>` +
    `<div class="ask-q">${esc(ev.question || "")}</div>` +
    `<div class="ask-opts"></div>` +
    (gitRecovery ? "" : `<div class="ask-free"><input type="text" placeholder="都不是？直接说你想要的…" maxlength="500"><button type="button">发送</button></div>`) +
    `<div class="ask-ans"></div>`;

  const timerEl = card.querySelector(".ask-timer");
  let tick = null;
  const stopTick = () => { if (tick) { clearInterval(tick); tick = null; } timerEl.textContent = ""; };

  let answered = false;
  const markAnswered = (text, timeout) => {
    if (answered) return;
    answered = true;
    card.classList.add("done");
    document.removeEventListener("keydown", onKey);
    stopTick();
    card.querySelector(".ask-lb").textContent = gitRecovery ? (timeout ? "Git · 未获确认，已停止" : "Git · 已收到你的选择") : (timeout ? "这个岔路我替你定了" : "这个岔路你定过了");
    card.querySelector(".ask-ans").innerHTML = timeout
      ? (gitRecovery ? "未获确认，本轮已停止；文件保留，未提交或推送。" : `<span class="ic">⏰</span>没等到回答，AI 按它认为最合理的默认继续了`)
      : `<span class="ic">✅</span>你选了 <b>${esc(text || "")}</b>`;
  };
  card._mark = markAnswered;

  const answerIt = async (text) => {
    text = String(text || "").trim();
    if (!text || card.classList.contains("done") || card.classList.contains("sending")) return;
    card.classList.add("sending"); // 送出到收到回执之间会有一小段，这期间再点/再按一次不许重复发
    const resp = await fetch("/api/chat/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: turnSid, askId: ev.ask_id, answer: text }),
    }).catch(() => null);
    card.classList.remove("sending");
    if (resp && resp.ok) markAnswered(text);
    else {
      const j = resp ? await resp.json().catch(() => null) : null;
      toast((j && j.error) || "没送出去：任务可能已经结束");
    }
  };

  const box = card.querySelector(".ask-opts");
  opts.forEach((o, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ask-opt";
    b.innerHTML =
      `<span class="kk">${i < 9 ? i + 1 : "·"}</span>` +
      `<span class="tx"><span class="lb">${esc(o.label)}</span>${o.detail ? `<span class="dt">${esc(o.detail)}</span>` : ""}</span>` +
      `<span class="go">↵</span>`;
    b.onclick = () => answerIt(o.label);
    box.appendChild(b);
  });

  const inp = card.querySelector(".ask-free input");
  if (inp) {
    card.querySelector(".ask-free button").onclick = () => answerIt(inp.value);
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); answerIt(inp.value); } };
  }
  // 数字键直选：手在键盘上就别再去够鼠标。焦点在输入框里时不抢——那时 1 就是要打个 1
  card.tabIndex = -1;
  const onKey = (e) => {
    if (card.classList.contains("done") || !document.body.contains(card)) { document.removeEventListener("keydown", onKey); return; }
    // 光标在任何输入框里，1 就是要打个 1（不只是本卡那个输入框——聊天框、改名框都算）
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (gitRecovery || e.metaKey || e.ctrlKey || e.altKey) return; // Git consent requires an explicit button activation.
    // 只有屏幕上最后一张还没答的提问卡吃数字键。不然上一张还在等回执时，
    // 这一张按下的 1 会被上一张抢走，答案安到了另一个问题头上
    const live = document.querySelectorAll(".ask-card:not(.done)");
    if (live.length && live[live.length - 1] !== card) return;
    const n = Number(e.key);
    if (n >= 1 && n <= opts.length) { e.preventDefault(); answerIt(opts[n - 1].label); }
  };
  document.addEventListener("keydown", onKey);

  if (isReplaying && !ev.pending) {
    // 历史回放里问题早就过期了，别让人白点，也别倒计时
    card.classList.add("done");
    card.querySelector(".ask-ans").innerHTML = `<span class="ic">·</span>这是历史记录里的提问`;
  } else if (ev.timeout_ms > 0) {
    const dead = Number(ev.expires_at) || Date.now() + Number(ev.timeout_ms);
    const paint = () => {
      const left = Math.max(0, Math.round((dead - Date.now()) / 1000));
      if (!left) { stopTick(); timerEl.textContent = "已超时"; timerEl.classList.add("hot"); return; }
      timerEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} ${gitRecovery ? "后停止，绝不自动确认" : "后按默认继续"}`;
      timerEl.classList.toggle("hot", left <= 30);
    };
    paint();
    tick = setInterval(paint, 1000);
  }
  return card;
}

function fileIcon(name) {
  if (/\.pptx?$/i.test(name)) return "📊";
  if (/\.docx?$/i.test(name)) return "📄";
  if (/\.xlsx?$/i.test(name)) return "📈";
  if (/\.(md|txt)$/i.test(name)) return "📝";
  if (/\.csv$/i.test(name)) return "🗂️";
  if (/\.html?$/i.test(name)) return "🌐";
  if (/\.pdf$/i.test(name)) return "📕";
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name)) return "🖼️";
  if (/\.(mp4|mov|webm|m4v)$/i.test(name)) return "🎬";
  return "📎";
}
function fmtSize(n) { return n > 1048576 ? (n/1048576).toFixed(1)+" MB" : n > 1024 ? (n/1024).toFixed(1)+" KB" : n+" B"; }
const openDirs = new Set(); // 记住展开状态，刷新列表不回弹
/** 在访达/资源管理器里打开文件所在的文件夹并选中它。按钮挂在文件行/卡片上，别冒泡触发预览 */
function revealFile(name, e, project = activeProject) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  // Fix C: reveal 请求传递项目参数
  const payload = { name, project: project || "" };
  fetch("/api/files/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    .then(r => r.json()).then(j => { if (j && j.error) toast(j.error); })
    .catch(() => toast("打不开所在位置"));
}
const revealBtn = (name) => `<span class="dl rv" data-rv="${esc(name)}" title="打开所在位置">📂</span>`;

function renderFiles(files) {
  const project = activeProject;
  filesCacheProject = project;
  filesCache = files || [];
  const el = document.getElementById("file-list");
  if (!files || !files.length) { el.innerHTML = '<div style="padding:10px;color:var(--wb-text-3);font-size: 13px">暂无成果文件</div>'; return; }
  const fileRow = (f, nested) =>
    `<div class="file-item${nested ? " nested" : ""}" style="cursor:pointer" data-name="${esc(f.name)}" title="${esc(f.name)}">
      <span>${fileIcon(f.name)}</span>
      <span style="min-width:0"><div class="name">${esc(f.name.split("/").pop())}</div><div class="meta">${fmtSize(f.size)}</div></span>
      ${revealBtn(f.name)}
      <a class="dl" href="${esc(fileApiUrl("/api/files/download/", f.name, project))}" download title="下载">⬇</a>
    </div>`;
  // 根目录文件（智能体产出）置顶按时间排；子目录归成可折叠分组
  const rootFiles = files.filter(f => !f.name.includes("/"));
  const groups = {};
  for (const f of files) {
    if (!f.name.includes("/")) continue;
    const dir = f.name.slice(0, f.name.lastIndexOf("/"));
    (groups[dir] = groups[dir] || []).push(f);
  }
  const curDir = sessionDirs.get(sessionId); // 当前对话的成果文件夹：置顶并标出来
  let html = rootFiles.map(f => fileRow(f, false)).join("");
  for (const dir of Object.keys(groups).sort((a, b) => (a === curDir ? -1 : b === curDir ? 1 : a.localeCompare(b, "zh")))) {
    const open = openDirs.has(dir);
    html += `<div class="dir-head${dir === curDir ? " mine" : ""}" data-dir="${esc(dir)}"><span>${open ? "▾" : "▸"}</span><span>📁</span><div class="name">${dir === curDir ? '<span class="mine-tag">本对话</span>' : ""}${esc(dir)}</div><span class="cnt">${groups[dir].length}</span><span class="opendir" data-opendir="${esc(dir)}" title="在 Finder 中打开这个文件夹">↗</span></div>`;
    if (open) html += groups[dir].sort((a, b) => a.name.localeCompare(b.name, "zh")).map(f => fileRow(f, true)).join("");
  }
  el.innerHTML = html;
  el.querySelectorAll(".dir-head").forEach(h => h.onclick = () => {
    openDirs.has(h.dataset.dir) ? openDirs.delete(h.dataset.dir) : openDirs.add(h.dataset.dir);
    renderFiles(filesCache);
  });
  el.querySelectorAll(".opendir").forEach(b => { b.onclick = (e) => {
    e.stopPropagation();
    fetch(fileApiUrl("/api/files/open/", b.dataset.opendir, project), { method: "POST" }).catch(() => {});
  }; });
  el.querySelectorAll("[data-rv]").forEach(b => { b.onclick = (e) => revealFile(b.dataset.rv, e, project); });
  el.querySelectorAll(".file-item").forEach(item => item.onclick = (e) => {
    if (e.target.closest(".dl")) return; // 下载/定位按钮不拦截
    e.preventDefault();
    previewFile(item.dataset.name, project);
  });
}
refreshProjectFiles();

// ================= 助理模式（IM 通道状态 + 最近消息） =================
const WS_STATE_TXT = { connected: "已连接", connecting: "连接中…", reconnecting: "重连中…", failed: "连接失败", idle: "已断开", off: "未启动", unknown: "未知" };
async function refreshImStatus() {
  try {
    const s = await fetch("/im/status").then(r => r.json());
    // 只数真在线的：飞书/QQ/微信长连接 connected，企微应用/公众号回调配置齐，企微群推送已配
    let n = 0;
    if (s.feishu.configured && s.feishu.ws.state === "connected") n++;
    if ((s.qq || {}).configured && s.qq.state === "connected") n++;
    if ((s.wechat_ilink || {}).configured && s.wechat_ilink.state === "connected") n++;
    if ((s.wecom_app || {}).configured && s.wecom_app.callback_ready) n++;
    if ((s.wechat_mp || {}).configured && s.wechat_mp.callback_ready) n++;
    if (s.wecom.configured) n++;
    const sub = document.getElementById("ab-sub");
    if (sub) sub.textContent = n ? `${n} 个通道在线` : "IM 远程指挥";
  } catch {}
}
// document.getElementById("ab-head").onclick = () => openAssistView(); // 已删除助理模式
refreshImStatus();
setInterval(refreshImStatus, 15000);

// ---------------- 文件预览 ----------------
const OFFICE_RE = /\.(docx?|pptx?|xlsx?)$/i;
const pvPanel = document.getElementById("preview-panel");
let pvCurrent = null, pvProject = null, pvRequest = 0;

function fileReadHttpError(status) {
  const detail = status === 403 ? "访问被安全校验拒绝，请从应用主窗口重试；不要关闭安全保护"
    : status === 401 ? "登录已失效，请重新登录"
    : status === 404 ? "文件不存在，请刷新成果列表并核对所属项目和文件路径"
    : "服务返回错误，请稍后重试";
  return new Error(`读取失败（HTTP ${status}）：${detail}`);
}
async function fetchFileResponse(url, options = {}) {
  let response;
  try { response = await fetch(url, options); }
  catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("网络请求失败：未收到可用的 HTTP 响应，请检查本地服务连接；若请求被浏览器策略或重定向拦截，请重新打开应用主窗口，不要关闭安全保护");
  }
  if (!response.ok) throw fileReadHttpError(response.status);
  return response;
}

// Only the trusted document fetches file contents. Blob frames have an opaque
// origin: scripts work, but cannot access the app DOM, storage or credentials.
const isolatedPreviews = new Map();
function disposeIsolatedPreviews(root) {
  for (const [owner, dispose] of isolatedPreviews) {
    if (owner === root || root.contains(owner)) dispose();
  }
}
async function createIsolatedPreviewFrame(url, { owner, svg = false, current = () => true, thumbnail = false } = {}) {
  const source = new URL(url, location.href);
  if (source.origin !== location.origin || source.username || source.password) throw new Error("仅支持本地文件预览");
  disposeIsolatedPreviews(owner);
  const controller = new AbortController();
  let blobUrl = null, frame = null, mounted = false, disposed = false, connected = owner.isConnected;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    observer.disconnect();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    isolatedPreviews.delete(owner);
  };
  const observer = new MutationObserver(() => {
    if (owner.isConnected) connected = true;
    else if (connected) dispose();
    if (frame && owner.contains(frame)) mounted = true;
    else if (mounted) dispose();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  isolatedPreviews.set(owner, dispose);
  try {
    source.searchParams.set("raw", "1");
    const response = await fetchFileResponse(source.href, { signal: controller.signal, credentials: "same-origin", redirect: "error" });
    const text = await response.text();
    if (disposed || !owner.isConnected || !current()) { dispose(); return null; }
    // Keep SVG as SVG (including foreignObject). No base URL is injected: local
    // authenticated assets are intentionally unavailable to opaque frames.
    blobUrl = URL.createObjectURL(new Blob([text], { type: svg ? "image/svg+xml" : "text/html" }));
    frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.referrerPolicy = "no-referrer";
    frame.title = "隔离预览（依赖本地资源的网页请用独立预览打开）";
    if (thumbnail) {
      frame.setAttribute("scrolling", "no");
      frame.tabIndex = -1;
      frame.setAttribute("aria-hidden", "true");
    }
    frame.src = blobUrl;
    return frame;
  } catch (error) {
    dispose();
    if (error.name === "AbortError") return null;
    throw error;
  }
}
window.addEventListener("pagehide", () => disposeIsolatedPreviews(document.documentElement));

async function previewFile(name, project = activeProject) {
  const request = ++pvRequest;
  disposeIsolatedPreviews(document.getElementById("pv-body"));
  if (OFFICE_RE.test(name)) {
    // Office 文件交给本机 Office/WPS 打开
    // Fix C: 文件打开请求传递项目参数
    await fetch(fileApiUrl("/api/files/open/", name, project), { method: "POST" });
    return;
  }
  pvCurrent = name; pvProject = project;
  document.getElementById("files-panel").classList.remove("show"); // 预览时收起文件列表，给聊天区留空间
  // 立刻亮预览面板再去异步拉内容：晚亮的话，自动预览的调用方同步检查时以为预览没开，
  // 会把成果文件面板弹回来，右侧双开互相盖字（用户反馈过）
  pvPanel.classList.add("show");
  document.getElementById("pv-body").innerHTML = `<div class="pv-text" style="color:var(--wb-text-3)">加载中…</div>`;
  document.getElementById("pv-name").textContent = name;
  // Fix C: 使用辅助函数添加项目参数
  document.getElementById("pv-dl").href = fileApiUrl("/api/files/download/", name, project);
  const body = document.getElementById("pv-body");
  const url = fileApiUrl("/api/files/view/", name, project) + "&t=" + Date.now();
  if (/\.(html?|svg)$/i.test(name)) {
    const current = () => request === pvRequest && pvCurrent === name && activeProject === project;
    try {
      const frame = await createIsolatedPreviewFrame(url, { owner: body, svg: /\.svg$/i.test(name), current });
      if (!frame || !current()) return;
      body.replaceChildren(frame);
      frame.title = "隔离预览：本地图片、样式或接口可能不可用，请用独立预览或系统程序打开";
    } catch (error) {
      if (!current()) return;
      body.innerHTML = `<div class="pv-text">预览失败：${esc(error.message)}</div>`;
    }
  } else if (/\.pdf$/i.test(name)) {
    body.innerHTML = '<div class="pv-text">PDF 请点右上角用系统程序打开或下载。</div>';
  } else if (/\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(name)) {
    body.innerHTML = `<img src="${url}">`;
  } else if (/\.(md|markdown)$/i.test(name)) {
    const text = await fetchFileResponse(url).then(r => r.text()).catch(error => "预览失败：" + error.message);
    if (request !== pvRequest || pvCurrent !== name || activeProject !== project) return;
    body.innerHTML = `<div class="pv-text a-text">${renderMd(text)}</div>`;
  } else if (/\.(txt|csv|json|js|cjs|css|xml|log|yml|yaml)$/i.test(name)) {
    const text = await fetchFileResponse(url).then(r => r.text()).catch(error => "预览失败：" + error.message);
    if (request !== pvRequest || pvCurrent !== name || activeProject !== project) return;
    body.innerHTML = `<div class="pv-text"><pre style="white-space:pre-wrap;word-break:break-all">${esc(text.slice(0, 100000))}</pre></div>`;
  } else {
    body.innerHTML = `<div class="pv-text" style="color:var(--wb-text-3)">该格式暂不支持应用内预览，可点右上 🗔 用系统程序打开，或 ⬇ 下载。</div>`;
  }
  pvPanel.classList.add("show");
  renderDeployBar();
}
document.getElementById("pv-close").onclick = () => { pvPanel.classList.remove("show"); pvCurrent = null; pvRequest++; disposeIsolatedPreviews(document.getElementById("pv-body")); document.getElementById("pv-body").replaceChildren(); };
document.getElementById("pv-sys").onclick = () => { if (pvCurrent) fetch(fileApiUrl("/api/files/open/", pvCurrent, pvProject), { method: "POST" }); };
document.getElementById("pv-rv").onclick = () => { if (pvCurrent) revealFile(pvCurrent, null, pvProject); };

// ---- 本地部署预览：iframe 里看长相够了，但真网页要有自己的 origin（相对路径/fetch/localStorage/手机上开）----
let previewSrv = { running: false, project: null };
async function renderDeployBar() {
  const bar = document.getElementById("pv-deploy");
  const project = pvProject, name = pvCurrent, request = pvRequest;
  const current = () => pvProject === project && pvCurrent === name && pvRequest === request;
  if (!name || !/\.html?$/i.test(name)) { bar.style.display = "none"; return; }
  bar.style.display = "";
  if (previewSrv.project !== project) {
    bar.innerHTML = "<span>正在检查本项目的预览服务…</span>";
    const state = await fetch("/api/preview/status?project=" + encodeURIComponent(project || "")).then(r => r.json()).catch(() => ({ running: false }));
    if (!current()) return;
    previewSrv = { ...state, project };
  }
  const state = previewSrv;
  const apply = (st) => { if (!current()) return; previewSrv = { ...st, project }; renderDeployBar(); };
  if (!state.running) {
    bar.innerHTML = '<span>这是个网页，要不要本地部署预览？（起一个本机服务，相对路径和 fetch 才正常）</span><button class="primary" id="pv-serve">本地部署预览</button>';
    bar.querySelector("#pv-serve").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "启动中…";
      const st = await startPreview(false, null, project);
      if (current() && !st.running) toast(st.error || "本地预览服务启动失败");
      apply(st);
    };
    return;
  }
  const url = state.url + encodeURIComponent(name);
  const lan = state.lan_url ? state.lan_url + encodeURIComponent(name) : null;
  bar.innerHTML = '<span>✅ 已本地部署</span><code>' + esc(url) + '</code>' +
    (lan ? '<span style="color:var(--wb-text-3)">手机同 Wi-Fi 可开</span><code>' + esc(lan) + '</code>' : '<button id="pv-lan" title="同一个 Wi-Fi 下的人都能翻你的工作目录，看完记得停">放开给手机看</button>') +
    '<button id="pv-open-br">在浏览器打开</button><button id="pv-serve-stop">停止</button>';
  bar.querySelector("#pv-open-br").onclick = async (e) => {
    e.target.disabled = true;
    const st = await startPreview(state.lan_open, name, project);
    e.target.disabled = false;
    if (current() && !st.running) toast(st.error || "本地预览服务没起来，打不开");
    apply(st);
  };
  const lanBtn = bar.querySelector("#pv-lan");
  if (lanBtn) lanBtn.onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "切换中…";
    const st = await startPreview(true, null, project);
    if (current() && !st.lan_url) toast(st.error || "这台机器没找到局域网地址（没连 Wi-Fi？）");
    apply(st);
  };
  bar.querySelector("#pv-serve-stop").onclick = async () => {
    const st = await fetch("/api/preview/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) }).then(r => r.json()).catch(() => ({ running: false }));
    apply(st);
  };
}
function startPreview(lan, open, project = pvProject || activeProject) {
  return fetch("/api/preview/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lan: !!lan, open: open || undefined, project }),
  }).then(r => r.json()).catch(() => ({ running: false, project }));
}

// 任务产出/更新 HTML 时，自动在右侧实时展示
const fileSnapshots = new Map(); // project => baseline; never compare different workspaces
function snapshotFiles(files, project = activeProject) {
  fileSnapshots.set(project, Object.fromEntries((files || []).map(f => [f.name, f.mtime])));
}
function changedFiles(files, project = activeProject) {
  const snapshot = fileSnapshots.get(project);
  if (!snapshot) { snapshotFiles(files, project); return []; }
  return (files || []).filter(f => snapshot[f.name] !== f.mtime);
}
function autoPreviewNewHtml(files, changed) {
  // 只自动识别明确的 HTML 文件；非 HTML 项目和 Markdown 不自动弹网页预览。
  // 预览面板由用户点击文件或预览入口打开，避免任务完成后抢占聊天区。
  changed = changed || changedFiles(files);
  const target = (changed || []).find(f => /\.html?$/i.test(f.name));
  if (target) {
    // 仅保留候选逻辑供显式调用方复用，不主动打开 previewFile。
    return target.name;
  }
  return null;
}

// 来源：这一回合真正打开过的网页。不是"模型说它参考了什么"，而是工具层记下来的实际访问记录，
// 所以点进去一定打得开，也能拿它反查结论是不是有出处。
function renderSources(body, items) {
  if (!items || !items.length) return;
  let block = body.querySelector(":scope > .src-block");
  if (!block) {
    block = document.createElement("div");
    block.className = "src-block";
    block.innerHTML = `<div class="src-hd"></div><div class="src-list"></div>`;
    block.querySelector(".src-hd").onclick = () => block.classList.toggle("open");
    body.appendChild(block);
  }
  const list = block.querySelector(".src-list");
  const seen = block._seen || (block._seen = new Set());
  for (const it of items) {
    const url = String(it && it.url || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const a = document.createElement("a");
    a.className = "src-item";
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    a.title = (it.title ? it.title + "\n" : "") + url;
    a.innerHTML = `<span class="n">${seen.size}</span><span class="t">${esc(it.title || hostOf(url))}</span><span class="n">${esc(hostOf(url))}</span>`;
    list.appendChild(a);
  }
  block.querySelector(".src-hd").textContent = `来源 (${seen.size})`;
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return String(u).slice(0, 30); } }

// 把本回合的产出做成卡片挂在对话里。右侧文件面板是"所有文件"，这里是"这次产出的"——
// 用户要的是聊完直接点开，而不是回头去面板里认哪个是刚才那个。
const OUT_CARD_MAX = 8;                                   // 一屏摆得下的量；超了只提示条数，别把对话冲垮
function renderTurnOutputs(body, changed, project = activeProject) {
  if (!body || !changed || !changed.length) return;
  let block = body.querySelector(":scope > .out-block");
  if (!block) {
    block = document.createElement("div");
    block.className = "out-block fold"; // 变更清单默认收起，想看再点开
    block.innerHTML = `<div class="out-grid"></div><div class="out-hd out-toggle"><span class="ar">▸</span> 查看所有变更 <span class="n"></span></div><div class="out-list"></div>`;
    body.appendChild(block);
    block.querySelector(".out-toggle").onclick = () => {
      const fold = block.classList.toggle("fold");
      block.querySelector(".ar").textContent = fold ? "▸" : "▾";
    };
  }
  const grid = block.querySelector(".out-grid");
  const list = block.querySelector(".out-list");
  for (const f of changed) {
    const isHtml = /\.html?$/i.test(f.name);
    const isImg = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(f.name);
    // 网页/图有缩略图；PPT/Word/Excel/PDF 这些要交到用户手上的成果出图标卡。
    // 以前它们只在收起的「查看所有变更」里躺着一行，做完一个 PPT，用户在对话里压根看不见它，
    // 只能自己去右侧面板翻。途中的脚手架（脚本、日志、PROGRESS.md）仍然只进清单，别把对话挡成一屏方框
    if (isHtml || isImg || isDeliverable(f.name)) {
      const base = f.name.split("/").pop();
      const same = grid.querySelector(`.out-card[data-name="${cssEsc(f.name)}"]`);
      // 同名同大小 = 同一件产出被拷成了两份（agent 常把任务子目录里的产出再往工作空间根目录复制一份）。
      // 卡片区只摆一张，否则用户看到的就是「同一张图显示了两遍」；两个路径在下面的变更清单里都还留着，信息不丢
      const twin = same || (f.size ? grid.querySelector(`.out-card[data-base="${cssEsc(base)}"][data-size="${f.size}"]`) : null);
      // gen_diagram 一次落两个文件：<名字>.svg 和 <名字>.png，同一张图的两种格式，不是两张图。
      // 文件名和大小都不一样，上面那条「同名同大小」的判重认不出来，用户看到的就是两张一模一样的图。
      // 这里按「同目录同主名 + 一个 svg 一个 png」并成一张卡，另一种格式挂到卡上留个下载入口
      const mate = twin ? null : pairedCard(grid, f.name);
      if (mate) {
        // PNG 当门面：缩略图直接渲染，插飞书/Word 用的也是它；SVG 退居「另一种格式」
        if (extOf(f.name) === "png") { const c = makeOutCard(f, false, project); attachAltFmt(c, mate.dataset.name); mate.replaceWith(c); }
        else attachAltFmt(mate, f.name);
      } else if (!twin) {
        if (grid.querySelectorAll(".out-card").length < OUT_CARD_MAX) grid.appendChild(makeOutCard(f, isHtml, project));
      } else if (!same && pathDepth(f.name) < pathDepth(twin.dataset.name)) {
        // 副本留路径最浅的那份：点「所在位置」多半是想去工作目录根，而不是任务子目录
        twin.replaceWith(makeOutCard(f, isHtml, project));
      }
    }
    if (!list.querySelector(`[data-name="${cssEsc(f.name)}"]`)) { // 同一文件改多次只记一行
      const row = document.createElement("div");
      row.className = "out-row";
      row.dataset.name = f.name;
      const nmHtml = f.name.includes("/")
        ? `<span class="dim">${esc(f.name.slice(0, f.name.lastIndexOf("/") + 1))}</span>${esc(f.name.split("/").pop())}`
        : esc(f.name);
      row.innerHTML = `<span class="ic">${fileIcon(f.name)}</span><span class="nm">${nmHtml}</span><span class="sz">${fmtSize(f.size)}</span>${revealBtn(f.name)}<a class="dl" href="${esc(fileApiUrl("/api/files/download/", f.name, project))}" download title="下载">⬇</a>`;
      row.querySelector("[data-rv]").onclick = (e) => revealFile(f.name, e, project);
      row.onclick = (e) => { if (e.target.closest("a") || e.target.closest(".rv")) return; previewFile(f.name, project); };
      list.appendChild(row);
    }
  }
  mergeFmtPairs(grid);
  markDupBasenames(grid);
  const cards = grid.querySelectorAll(".out-card").length;
  grid.dataset.count = cards === 1 || cards === 2 ? String(cards) : "";
  block.querySelector(".out-hd .n").textContent = `(${list.querySelectorAll(".out-row").length})`;
}

// 「交到用户手上的成果」：点开就能用的东西，不包括干活途中的脚手架
const DELIVER_RE = /\.(pdf|pptx?|docx?|xlsx?|csv|md|txt|mp4|mov|webm|m4v|zip)$/i;
const SCAFFOLD_RE = /^(PROGRESS|TODO|NOTES?|README)\.(md|txt)$/i;
function isDeliverable(name) {
  const base = String(name || "").split("/").pop();
  return DELIVER_RE.test(base) && !SCAFFOLD_RE.test(base);
}

function pathDepth(n) { return String(n || "").split("/").length; }
function extOf(n) { const m = String(n || "").match(/\.([^./]+)$/); return m ? m[1].toLowerCase() : ""; }

// 卡片区里找「同一张图的另一种格式」那张卡：同目录、同主名，一个 svg 一个 png
function pairedCard(grid, name) {
  const ext = extOf(name);
  if (ext !== "svg" && ext !== "png") return null;
  const stem = name.replace(/\.[^./]+$/, "");
  const want = ext === "svg" ? "png" : "svg";
  return [...grid.querySelectorAll(".out-card")].find(c => c.dataset.stem === stem && extOf(c.dataset.name) === want) || null;
}

// 把另一种格式挂到这张卡上：下载键拆成两个，各自标格式。
// 不能光把 SVG 藏掉——藏了用户想要矢量图就只能回右侧文件面板里翻，那是把一个 bug 换成另一个。
// 两个键都是「图标 + 格式名」：之前本体那个键是纯图标、挂上来的那个是纯文字且没有 class，
// 一个被挤进 30px 的方框里、一个是条裸链接，用户看到的就是两个长得不一样的下载键
function attachAltFmt(card, alt) {
  if (!card || !alt || card.dataset.alt === alt) return;
  card.dataset.alt = alt;
  const acts = card.querySelector(".out-acts");
  if (!acts) return;
  acts.querySelectorAll(".oa-alt").forEach((el) => el.remove()); // 重新挂之前先清掉上一次挂的
  const self = acts.querySelector("a[download]:not(.oa-alt)");
  if (!self) return;
  const fmt = (n) => extOf(n).toUpperCase();
  self.className = "oa-ico oa-fmt";
  self.title = "下载 " + fmt(card.dataset.name);
  self.innerHTML = ic("download") + `<span class="tx">${fmt(card.dataset.name)}</span>`;
  const a = document.createElement("a");
  a.className = "oa-ico oa-fmt oa-alt";
  a.href = fileApiUrl("/api/files/download/", alt, card.dataset.project);
  a.setAttribute("download", "");
  a.title = "下载 " + fmt(alt) + "（" + alt + "）";
  a.innerHTML = ic("download") + `<span class="tx">${fmt(alt)}</span>`;
  acts.appendChild(a);
}

// 收尾统一收敛：上面「同名副本留路径最浅那份」那条会把已经并好的卡整张换掉，
// 挂在旧卡上的「另一种格式」就跟着没了，同一张图又变回并排两张
function mergeFmtPairs(grid) {
  const all = () => [...grid.querySelectorAll(".out-card")];
  for (const c of all()) {
    if (!c.isConnected) continue;
    const ext = extOf(c.dataset.name);
    if (ext !== "png" && ext !== "svg") continue;
    const want = ext === "png" ? "svg" : "png";
    const mate = all().find((o) => o !== c && o.dataset.stem === c.dataset.stem && extOf(o.dataset.name) === want);
    if (!mate) continue;
    const front = ext === "png" ? c : mate; // PNG 当门面：缩略图渲染得出来，插飞书/Word 用的也是它
    const back = front === c ? mate : c;
    attachAltFmt(front, back.dataset.name);
    back.remove();
  }
}

function makeOutCard(f, isHtml, project = activeProject) {
  const url = fileApiUrl("/api/files/view/", f.name, project) + "&t=" + Date.now();
  // 渲染得出来的画缩略图，画不出来的（PPT/Word/Excel/PDF/视频）摆一个大号文件图标——
  // 别给它一个 <img> 拉不出图的空框，那看着像坏了
  const thumb = isHtml || /\.svg$/i.test(f.name)
    ? `<div class="ph">加载中…</div>`
    : /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(f.name)
      ? `<img src="${url}" alt="">`
      : `<div class="ph">${fileIcon(f.name)}</div>`;
  const card = document.createElement("div");
  card.className = "out-card";
  card.dataset.project = project || "";
  card.dataset.name = f.name;
  card.dataset.base = f.name.split("/").pop();      // 判重按「文件名 + 大小」，光看全路径认不出复制出来的副本
  card.dataset.stem = f.name.replace(/\.[^./]+$/, ""); // 去掉扩展名的全路径：认 svg / png 是同一张图用
  if (f.size) card.dataset.size = String(f.size);
  card.title = f.name;
  const openHint = OFFICE_RE.test(f.name) ? "点击用系统程序打开" : "点击预览";
  card.innerHTML = `<div class="out-thumb">${thumb}</div>
    <div class="out-info"><div class="out-name">${esc(f.name.split("/").pop())}</div>
      <div class="out-meta">${fmtSize(f.size)} · ${openHint}</div></div>
    <div class="out-acts">
      <button class="oa-main" data-a="${isHtml ? "br" : "pv"}">${isHtml ? ic("globe") : ic("file-text")}<span class="tx">${isHtml ? "在浏览器打开" : "预览"}</span></button>
      <button class="oa-ico" data-a="rv" title="打开所在位置">${ic("folder-open")}</button>
      <a class="oa-ico" href="${esc(fileApiUrl("/api/files/download/", f.name, project))}" download title="下载">${ic("download")}</a></div>`;
  if (isHtml || /\.svg$/i.test(f.name)) {
    const thumbBody = card.querySelector(".out-thumb");
    const current = () => card.isConnected && card.dataset.name === f.name && card.dataset.project === (project || "");
    createIsolatedPreviewFrame(url, { owner: thumbBody, svg: /\.svg$/i.test(f.name), current, thumbnail: true }).then(frame => {
      if (frame && current()) thumbBody.replaceChildren(frame);
    }).catch(() => {
      if (current()) thumbBody.innerHTML = `<div class="ph">${fileIcon(f.name)}</div>`;
    });
  }
  card.onclick = (e) => {
    if (e.target.closest("a")) return;
    if (e.target.closest('[data-a="rv"]')) return revealFile(f.name, e, project);
    if (e.target.closest('[data-a="br"]')) {
      e.stopPropagation();
      startPreview(previewSrv.project === project && previewSrv.lan_open, f.name, project).then(st => {
        if (st.running) { if (pvProject === project) previewSrv = st; } else toast(st.error || "本地预览服务没起来，打不开");
      });
      return;
    }
    previewFile(f.name, project);
  };
  return card;
}

// 同名但内容不同的两件产出（a/report.html 和 b/report.html）：卡片上只写文件名，用户根本分不出谁是谁，
// 给这类卡片补上所在目录。内容相同的副本上面已经并成一张卡了，走不到这里
function markDupBasenames(grid) {
  const byBase = {};
  grid.querySelectorAll(".out-card").forEach(c => {
    (byBase[c.dataset.base] = byBase[c.dataset.base] || []).push(c);
  });
  Object.keys(byBase).forEach(b => {
    if (byBase[b].length < 2) return;
    byBase[b].forEach(c => {
      const nm = c.querySelector(".out-name");
      if (!nm || nm.querySelector(".dim")) return;
      const path = c.dataset.name;
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "./";
      nm.innerHTML = `<span class="dim">${esc(dir)}</span>` + nm.innerHTML;
    });
  });
}
// 文件名进 CSS 属性选择器要转义（含空格、中文括号、引号的名字很常见）
function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"); }
document.getElementById("toggle-files").onclick = () => {
  const fp = document.getElementById("files-panel");
  fp.classList.toggle("show");
  // 预览和成果文件面板互斥：右侧只留一个。双开把聊天区挤没，窄窗下两个浮层还互相盖字
  if (fp.classList.contains("show") && pvPanel.classList.contains("show")) {
    pvPanel.classList.remove("show"); pvCurrent = null;
  }
};
document.getElementById("fp-close").onclick = () => document.getElementById("files-panel").classList.remove("show");
// 侧栏开关：窄窗走浮层抽屉 side-open，宽窗走常规折叠 side-collapsed。
// 阈值用 matchMedia 跟 CSS 里的 900px 断点对齐，避免两边各写一个数字后改一处漏一处；
// resize 里读 .matches 也比每次读 innerWidth 少一次强制布局。
const NARROW_MQ = window.matchMedia("(max-width: 900px)");
function isNarrowLayout() { return NARROW_MQ.matches; }
function toggleSidebar() {
  if (isNarrowLayout()) document.body.classList.toggle("side-open");
  else document.body.classList.toggle("side-collapsed");
}
document.getElementById("toggle-side").onclick = toggleSidebar;
// 从窄屏拉宽时抽屉要收掉，否则 aside 变回常驻栏后 side-open 的 fixed 定位会盖在聊天区上
NARROW_MQ.addEventListener("change", (e) => { if (!e.matches) document.body.classList.remove("side-open"); });
document.querySelector(".main").addEventListener("click", () => {
  if (document.body.classList.contains("side-open")) document.body.classList.remove("side-open");
}, true);
document.getElementById("open-ws").onclick = (e) => { e.preventDefault(); fetch("/api/open-workspace", { method: "POST" }); };

// ================= 下拉菜单通用 =================
function setupPicker(btnId, menuId) {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  btn.onclick = (e) => { e.stopPropagation(); closeAllMenus(menu); menu.classList.toggle("show"); };
  return menu;
}
function closeAllMenus(except) {
  document.querySelectorAll(".picker-menu").forEach(m => { if (m !== except) m.classList.remove("show"); });
}
document.addEventListener("click", () => closeAllMenus());

// ================= 模型选择（输入卡片右下角，仿官方 Auto ▾） =================
const modelMenu = setupPicker("model-btn", "model-menu");

// 渲染模型选择器（供切换项目时调用）
function renderModelPicker() {
  if (settingsCache) {
    updateModelLabel();
    renderModelMenu();
  }
}

async function refreshSettingsCache() {
  settingsCache = await fetch("/api/settings").then(r => r.json()).catch(() => null);
  if (settingsCache && settingsCache.error) settingsCache = null; // 未登录时 401 JSON，不当配置用
  if (settingsCache) {
    // 首次拿到配置时给还没动过的新对话套上「沿用上次模型」；之后的刷新不再动，免得盖掉用户手动清掉的选择
    if (!refreshSettingsCache._inited) { refreshSettingsCache._inited = true; if (sessionId === null && !pendingModel) pendingModel = defaultPendingModel(); }
    updateModelLabel();
    document.getElementById("ws-label").textContent = settingsCache.workspace_dir.split(/[\\/]/).pop() || "工作空间";
    renderModelMenu();
    renderWsMenu();
    if (typeof syncDelegationControl === "function") syncDelegationControl();

    applyGlassEffect(settingsCache.glassEffect);

    // 应用保存的主题和配色
    // 注意：这里不能把 settingsCache.theme 直接传进去。getTheme() 的优先级是「本机 localStorage
    // 优先于服务端配置」，而传参会绕过这个优先级、让服务端值反压本机值——两边不一致时就会出现
    // 「界面已经是日间、个性化里却勾着夜间」。不传参，让 applyTheme 自己按 getTheme() 决定
    if (settingsCache.theme && typeof applyTheme === 'function') {
      applyTheme();
    }
    if (settingsCache.skin && typeof applySkin === 'function') {
      applySkin(settingsCache.skin);
    }
    // 透明度要在 applyWallpaper 之前定下来：蒙版是在那里首次创建的，
    // 晚一步就会先按默认值画一帧再跳到用户设的值，看着像闪一下
    if (typeof applyWallpaperOpacity === 'function') {
      currentWallpaperOpacity = Math.max(0.7, Math.min(0.95,
        Number(settingsCache.wallpaperOpacity ?? WALLPAPER_OPACITY_DEFAULT) || WALLPAPER_OPACITY_DEFAULT));
    }
    if (settingsCache.wallpaper !== undefined && typeof applyWallpaper === 'function') {
      applyWallpaper(settingsCache.wallpaper);
    }
  }
}
// 这个选择器只管「当前对话」用哪个模型，不动全局默认（全局默认在 设置 → 模型 里改）。
// 每个对话可以各选各的：切换对话时标签跟着换，别的对话完全不受影响
function currentSessModel() {
  if (inAssistMode) return assistModel;
  return sessionId === null ? pendingModel : sessionModels.get(sessionId);
}
// 「新对话沿用上次手动选的模型」（设置 → 模型 里的开关）：算出新对话该预选谁。
// 直接写进 pendingModel 让标签立刻显示出来——用户发消息前就看得见用的是哪个，绝不静默换模型
function defaultPendingModel() {
  const s = settingsCache;
  if (s && s.model_follow_last && s.last_picked_model && s.last_picked_model !== s.active_model
      && (s.models || []).some(m => m.name === s.last_picked_model)) return s.last_picked_model;
  return undefined;
}
function formatModelLabel(name) {
  if (!name) return "模型";
  const str = String(name).trim();
  const parts = str.split(" - ");
  if (parts.length >= 2) {
    const prov = parts[0].trim().toLowerCase();
    const model = esc(parts.slice(1).join(" - ").trim());

    // Settings and both model pickers share the same theme-aware provider assets.
    const icon = providerIcon(prov) || `<span class="picker-model-prov">${esc(parts[0].trim())}</span><span class="picker-model-sep">-</span>`;
    return `${icon}<span class="picker-model-name">${model}</span>`;
  }
  return `<span class="picker-model-name">${esc(str)}</span>`;
}

function updateModelLabel() {
  if (!settingsCache) return;
  const ov = currentSessModel();
  const activeName = ov || settingsCache.active_model || "";
  const btnLabel = document.getElementById("model-label");
  if (btnLabel) {
    btnLabel.innerHTML = formatModelLabel(activeName);
  }
  renderModelMenu();
  // 助理页顶栏那个选择器（页面开着才有）跟输入框这个显示同一个值，别让两处对不上
  const al = document.getElementById("im-model-label");
  if (al) {
    al.innerHTML = formatModelLabel(activeName);
    renderModelMenu(document.getElementById("im-model-menu"));
  }
}
async function setSessionModel(name) { // name: 模型名；null = 跟随全局默认
  if (inAssistMode) { // 助理模式：存进配置，下次进来还是它
    try {
      const r = await fetch("/api/assist/model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: name }) }).then(x => x.json());
      if (r && r.error) return toast("⚠️ " + r.error);
      assistModel = name || undefined;
      if (settingsCache) settingsCache.assist_model = assistModel || "";
    } catch {}
    updateModelLabel();
    updateContextIndicator(); // 切换模型后更新上下文指示器
    return;
  }
  if (sessionId === null) {
    pendingModel = name || undefined;
    updateModelLabel();
    updateContextIndicator(); // 新对话切换模型也要更新
    return;
  }
  try {
    const r = await fetch("/api/session/" + encodeURIComponent(sessionId) + "/model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: name }) }).then(x => x.json());
    if (r && r.error) return toast("⚠️ " + r.error);
    if (name) sessionModels.set(sessionId, name); else sessionModels.delete(sessionId);
    if (name && settingsCache) settingsCache.last_picked_model = name; // 服务端也记了，这里同步本地缓存
  } catch {}
  updateModelLabel();
  updateContextIndicator(); // 切换模型后更新上下文指示器
}
// 模型健康小标：近 N 次任务的成败（服务端账本）。连挂 ≥2 标红——坏渠道一眼看出来，不用踩了才知道
function healthBadge(name) {
  const h = settingsCache && settingsCache.model_health && settingsCache.model_health[name];
  if (!h || !h.n) return "";
  let s = ` · 近${h.n}次任务${h.ok}成`;
  if (h.fail_streak >= 2) s += ` <span style="color:var(--wb-err)" title="${esc(h.last_fail || "")}">⚠连挂${h.fail_streak}</span>`;
  return s;
}

// ================= 启动时自动检查更新 =================
async function checkForUpdatesOnStartup() {
  // 只在 Electron 环境中检查
  if (typeof window.electronAPI === 'undefined' || !window.electronAPI.checkForUpdates) {
    console.log('[启动检查] 非 Electron 环境，跳过更新检查');
    return;
  }

  try {
    console.log('[启动检查] 开始检查更新...');

    // 先尝试检查热补丁
    if (window.electronAPI.checkForPatch) {
      const patchResult = await window.electronAPI.checkForPatch();
      if (patchResult.success && patchResult.updateInfo) {
        console.log('[启动检查] 发现热补丁更新:', patchResult.updateInfo);
        showUpdateDialog(patchResult.updateInfo, 'patch');
        return;
      }
    }

    // 检查完整更新
    const result = await window.electronAPI.checkForUpdates();

    if (result.success && result.updateInfo) {
      console.log('[启动检查] 发现新版本:', result.updateInfo);
      showUpdateDialog(result.updateInfo, 'full');
    } else if (result.upToDate) {
      console.log('[启动检查] 当前已是最新版本');
    } else {
      console.log('[启动检查] 检查更新失败:', result.error);
    }
  } catch (error) {
    console.error('[启动检查] 检查更新出错:', error);
  }
}

// 显示更新弹窗（与当前程序UI一致）
function showUpdateDialog(updateInfo, updateType) {
  // 创建弹框容器
  let overlay = document.getElementById('update-dialog-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'update-dialog-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.2s ease;
    `;
    document.body.appendChild(overlay);
  }

  // 获取当前版本
  const currentVersion = updateInfo.baseVersion || 'Unknown';
  const newVersion = updateInfo.version;
  const isPatch = updateType === 'patch';
  const sizeText = isPatch
    ? `${(updateInfo.size / 1024).toFixed(0)} KB`
    : `${((updateInfo.files?.[0]?.size || 0) / (1024 * 1024)).toFixed(2)} MB`;

  // 弹框 HTML
  overlay.innerHTML = `
    <div class="update-dialog-card" style="
      background: var(--wb-bg);
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 520px;
      width: 90%;
      overflow: hidden;
      transform: scale(0.9);
      transition: transform 0.2s ease;
      animation: updateSlideIn 0.3s ease forwards;
    " onclick="event.stopPropagation()">

      <!-- 顶部装饰 -->
      <div style="
        height: 4px;
        background: linear-gradient(90deg, #6366f1, #8b5cf6, #d946ef);
      "></div>

      <!-- 标题栏 -->
      <div style="
        padding: 24px 24px 16px;
        border-bottom: 1px solid var(--wb-border);
      ">
        <div style="
          display: flex;
          align-items: center;
          gap: 12px;
        ">
          <div style="
            width: 48px;
            height: 48px;
            border-radius: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
          ">🚀</div>
          <div style="flex: 1;">
            <div style="
              font-size: 18px;
              font-weight: 700;
              color: var(--wb-text);
              line-height: 1.2;
            ">发现新版本</div>
            <div style="
              font-size: 13px;
              color: var(--wb-text-3);
              margin-top: 4px;
            ">${isPatch ? '增量热补丁' : '完整更新包'}</div>
          </div>
        </div>
      </div>

      <!-- 更新内容 -->
      <div style="
        padding: 24px;
      ">
        <div style="
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(139, 92, 246, 0.05) 100%);
          padding: 20px;
          border-radius: 14px;
          border: 1px solid var(--wb-border);
        ">
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--wb-text-2); font-size: 14px;">当前版本</span>
              <span style="color: var(--wb-text); font-weight: 600; font-size: 14px;">${currentVersion}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--wb-text-2); font-size: 14px;">最新版本</span>
              <span style="color: var(--wb-brand); font-weight: 600; font-size: 14px;">${newVersion}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--wb-text-2); font-size: 14px;">更新大小</span>
              <span style="color: var(--wb-text); font-weight: 600; font-size: 14px;">${sizeText}</span>
            </div>
            ${isPatch ? `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--wb-text-2); font-size: 14px;">更新方式</span>
              <span style="color: var(--wb-ok); font-weight: 600; font-size: 14px;">无需重新安装</span>
            </div>
            ` : ''}
          </div>
        </div>

        <div style="
          margin-top: 16px;
          padding: 12px;
          background: var(--wb-bg-1);
          border-radius: 10px;
          font-size: 13px;
          color: var(--wb-text-2);
          line-height: 1.6;
        ">
          ${isPatch
            ? '💡 热补丁更新无需重新安装，下载后重启应用即可生效。'
            : '💡 完整更新包需要下载后手动安装，建议在空闲时进行更新。'}
        </div>
      </div>

      <!-- 底部按钮 -->
      <div style="
        padding: 16px 24px 24px;
        display: flex;
        gap: 12px;
      ">
        <button id="update-later-btn" style="
          flex: 1;
          height: 46px;
          border: 1px solid var(--wb-border);
          background: var(--wb-bg-1);
          color: var(--wb-text);
          font-size: 15px;
          font-weight: 600;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
        " onmouseover="this.style.background='var(--wb-bg-hover)'" onmouseout="this.style.background='var(--wb-bg-1)'">
          稍后提醒
        </button>
        <button id="update-now-btn" style="
          flex: 1;
          height: 46px;
          border: none;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          font-size: 15px;
          font-weight: 600;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(102, 126, 234, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(102, 126, 234, 0.3)'">
          立即更新
        </button>
      </div>
    </div>
  `;

  // 添加动画样式
  if (!document.getElementById('update-dialog-styles')) {
    const style = document.createElement('style');
    style.id = 'update-dialog-styles';
    style.textContent = `
      @keyframes updateSlideIn {
        from {
          opacity: 0;
          transform: scale(0.9) translateY(20px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // 关闭事件
  const close = () => {
    overlay.style.opacity = '0';
    const card = overlay.querySelector('.update-dialog-card');
    if (card) {
      card.style.transform = 'scale(0.9)';
      card.style.opacity = '0';
    }
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 200);
  };

  // 稍后提醒按钮
  overlay.querySelector('#update-later-btn').onclick = close;

  // 立即更新按钮
  overlay.querySelector('#update-now-btn').onclick = () => {
    close();
    // 跳转到更新页面
    if (typeof renderSettings === 'function') {
      renderSettings('update');
    }
  };

  // 显示弹框
  overlay.style.display = 'flex';
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
  });
}
