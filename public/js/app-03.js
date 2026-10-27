fetch("/api/assistant").then(r => r.json()).then(data => {
  assistant = { ...assistant, ...data };
  applyAssistantIdentity();
}).catch(() => {});
maybeOnboard();

// ================= 首次开箱：引导填模型 Key =================
// 先完成模型配置引导；界面只检查服务端返回的布尔值，不显示已存的 Key。
const ONB_TIPS = {
  "https://docode.cc/v1": 'DoCode 平台统一管理 API Key，无需单独配置。',
};
async function maybeOnboard() {
  const st = await fetch("/api/onboarding").then(r => r.json()).catch(() => null);
  if (!st || !st.needs_setup) return;
  if (sessionStorage.getItem("wb_onb_skipped")) return; // 本次窗口内跳过一次就别再烦人

  const sel = document.getElementById("onb-model");
  sel.innerHTML = st.models.map(m =>
    `<option value="${esc(m.name)}" data-url="${esc(m.base_url)}" data-local="${m.local ? 1 : 0}">${esc(m.name)} · ${esc(m.model)}${m.has_key ? "（已配）" : ""}</option>`
  ).join("");
  // 默认选中第一个还没配 key 的云端模型，用户十有八九就是要配它
  const first = st.models.find(m => !m.has_key && !m.local) || st.models[0];
  if (first) sel.value = first.name;
  document.getElementById("onb-dir").placeholder = st.workspace_dir || "留空就用默认目录";

  const keyEl = document.getElementById("onb-key");
  const tipEl = document.getElementById("onb-tip");
  const syncTip = () => {
    const opt = sel.selectedOptions[0];
    const local = opt.dataset.local === "1";
    tipEl.innerHTML = local
      ? "本地模型不需要 Key，确认 Ollama 已经在跑就行。"
      : (ONB_TIPS[opt.dataset.url] || "去这家服务商的控制台拿 API Key。");
    keyEl.disabled = local;
    keyEl.placeholder = local ? "本地模型不用填" : "粘贴 API Key";
  };
  sel.onchange = syncTip;
  syncTip();

  const err = document.getElementById("onb-err");
  const go = document.getElementById("onb-go");
  go.onclick = async () => {
    err.textContent = "";
    go.disabled = true;
    go.textContent = "正在验活…（发一条真实请求，可能要十几秒）";
    const r = await fetch("/api/onboarding", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: sel.value, api_key: keyEl.value.trim(), workspace_dir: document.getElementById("onb-dir").value.trim() || undefined }),
    }).then(r => r.json()).catch(() => ({ ok: false, error: "请求失败，服务没起来？" }));
    go.disabled = false;
    go.textContent = "验活并保存";
    if (!r.ok) { err.textContent = r.error || "验活没通过"; return; }
    document.getElementById("onb-mask").classList.remove("show");
    toast(`✅ 已接上 ${r.active_model}，可以开始干活了`);
    refreshSettingsCache(); // 输入卡片右下角的模型名/工作空间跟着刷新
  };
  document.getElementById("onb-skip").onclick = () => {
    sessionStorage.setItem("wb_onb_skipped", "1");
    document.getElementById("onb-mask").classList.remove("show");
    toast("跳过了。随时可以在 设置 → 模型 里补上 API Key");
  };
  document.getElementById("onb-mask").classList.add("show");
  setTimeout(() => keyEl.focus(), 60);
}

// ================= 主区页面视图（助理 / 专家广场 / 模板库，都占主区而不是弹窗） =================
// assistViewOn 保留原名：全站多处用它判断"当前不是在聊天"，改名会牵一大片。
let assistViewOn = false;
let pageKind = null;
let assistTimer = null;
const PAGE_VIEWS = {
  assist: { title: "🤖 助理模式", keepInput: true, render: () => renderAssistPage() },
  hub: { title: "🧩 专家 · 技能 · 连接器", wide: true, render: () => renderHubPage() },
  prompts: { title: "📚 参考模板库", wide: true, render: () => renderPromptPage() },
  proj: { title: "📂 项目", wide: true, render: () => renderProjPage() },
  autom: { title: "⏰ 自动化", wide: true, render: () => renderAutomPage() },
  lib: { title: "📚 资料库", wide: true, render: () => renderLibPage() },
  eval: { title: "🧪 评测", wide: true, render: () => renderEvalPage() },
};
function openPageView(kind) {
  const v = PAGE_VIEWS[kind];
  if (!v) return;
  if (pageKind === kind) { v.render(); return; } // 同页重进 = 刷新内容
  if (assistTimer) { clearInterval(assistTimer); assistTimer = null; }
  assistViewOn = true;
  pageKind = kind;
  inAssistMode = kind === "assist";
  sessionId = null;
  pendingModel = defaultPendingModel();
  // 助理模式的模型选择存在配置里，进页面时读回来。模型已经从列表里删掉了就退回全局默认——
  // 标签跟着一起退，不能标签还写着它、真跑起来却是别的
  if (inAssistMode) {
    const am = settingsCache && settingsCache.assist_model;
    assistModel = am && (settingsCache.models || []).some(m => m.name === am) ? am : undefined;
  }
  updateModelLabel();
  renderGoalCard();
  document.getElementById("session-title").textContent = v.title;
  document.querySelector(".input-wrap").style.display = v.keepInput ? "" : "none";
  if (kind === "assist") inputEl.placeholder = "直接给助理发消息，和 IM 里 @它 一样，任务在本机执行…";
  renderHistory();
  document.querySelectorAll(".side-nav .item").forEach(el => el.classList.toggle("active", el.dataset.view === kind || (kind === "assist" && el.id === "ab-head")));
  chatCol.classList.toggle("wide-page", !!v.wide);
  chatCol.innerHTML = '<div class="assist-page" id="assist-page"></div>';
  v.render();
}
function openAssistView() {
  if (pageKind === "assist") return;
  openPageView("assist");
  assistTimer = setInterval(async () => {
    if (pageKind !== "assist" || !document.getElementById("im-feed")) { clearInterval(assistTimer); assistTimer = null; return; }
    renderAssistFeed(await fetch("/im/log").then(r => r.json()).catch(() => []));
    updateAssistLive();
  }, 5000);
}
function closeAssistView() {
  if (!assistViewOn) return;
  assistViewOn = false;
  pageKind = null;
  inAssistMode = false;
  updateModelLabel(); // 离开助理页，标签立刻换回这个对话自己的模型
  if (assistTimer) { clearInterval(assistTimer); assistTimer = null; }
  document.querySelectorAll(".side-nav .item.active").forEach(el => el.classList.remove("active"));
  chatCol.classList.remove("wide-page");
  document.querySelector(".input-wrap").style.display = "";
  setMode(currentMode); // 还原当前模式的输入提示语
}
async function renderAssistPage() {
  const page = document.getElementById("assist-page");
  if (!page) return;
  const [s, log] = await Promise.all([
    fetch("/im/status").then(r => r.json()).catch(() => null),
    fetch("/im/log").then(r => r.json()).catch(() => []),
  ]);
  if (!s) { page.innerHTML = '<div class="ab-empty">状态读取失败</div>'; return; }
  const f = s.feishu;
  const fOk = f.configured && f.ws.state === "connected";
  const q = s.qq || { configured: false, state: "off" };
  const qOk = q.configured && q.state === "connected";
  // 微信侧靠腾讯回调，本地探不了活，只报配置齐不齐
  const wxChip = (c = {}) => !c.configured ? ["", "未配置"] : !c.callback_ready ? ["err", "缺回调配置"] : ["ok", "等腾讯回调"];
  const il = s.wechat_ilink || { configured: false, state: "off" };
  const ilOk = il.configured && il.state === "connected";
  const chip = (icon, name, cls, st) =>
    `<span class="im-chip"><span class="dot ${cls}"></span>${icon} ${name}${st ? " · " + st : ""}</span>`;
  // 官方的顶栏只列「已连接」的通道，没配的不刷存在感（要配去齿轮里配）
  const rows = [
    ["🕊️", "飞书", f.configured, fOk, WS_STATE_TXT[f.ws.state] || f.ws.state],
    ["🐧", "QQ", q.configured, qOk, WS_STATE_TXT[q.state] || q.state],
    ["💬", "微信", il.configured, ilOk, !il.configured ? "未扫码" : WS_STATE_TXT[il.state] || il.state],
    ["🏢", "企微应用", (s.wecom_app || {}).configured, wxChip(s.wecom_app)[0] !== "err" && (s.wecom_app || {}).configured, wxChip(s.wecom_app)[1]],
    ["🟢", "公众号", (s.wechat_mp || {}).configured, wxChip(s.wechat_mp)[0] !== "err" && (s.wechat_mp || {}).configured, wxChip(s.wechat_mp)[1]],
    ["💼", "企微群推送", s.wecom.configured, s.wecom.configured, "推送已配"],
  ];
  const conn = rows.filter((r) => r[2]);
  page.innerHTML = `
    <div class="im-head">
      <div class="im-strip" style="flex:1;border:0;padding:0;background:none">
        <b style="color:var(--wb-text-2);font-weight:500">已连接：</b>
        ${conn.length
          ? conn.map(([ic, nm, _c, ok, st]) => chip(ic, nm, ok ? "ok" : "err", ok ? "" : st)).join("")
          : '<span style="color:var(--wb-text-3)">还没有连接任何 IM 通道</span>'}
      </div>
      <div class="picker" id="im-model-picker">
        <button class="btn-plain" id="im-model-btn" title="助理页发消息用哪个模型（飞书 / QQ 等远程消息仍按全局默认跑）"><span id="im-model-label">模型</span> ▾</button>
        <div class="picker-menu down" id="im-model-menu"></div>
      </div>
      <button class="btn-plain" id="im-open-ws">📂 打开所在文件夹</button>
      <button class="btn-plain" id="im-cfg">⚙️ 设置</button>
    </div>
    <div class="im-feed" id="im-feed"></div>
    <div style="text-align:center;color:var(--wb-text-3);font-size: 13px;margin-top:8px">下方输入框直接对话，和在飞书/QQ/微信里 @机器人 一样，任务在这台电脑上执行。微信走扫码登录；企微应用与公众号得有公网 HTTPS 回调地址才能收消息。</div>`;
  setupPicker("im-model-btn", "im-model-menu");
  updateModelLabel(); // 顶栏每次重画都是新元素，标签和菜单当场填上
  page.querySelector("#im-cfg").onclick = () => openModal("settings", "im");
  page.querySelector("#im-open-ws").onclick = () => fetch("/api/open-workspace", { method: "POST" });
  renderAssistFeed(log);
}
// 助理模式下底部输入框发的消息走 local 通道（与 IM 消息同一条会话流），不新建任务。
// 连发多条时排队串行：两条并发 runTask 会交叉写同一份会话历史
let assistChain = Promise.resolve();
function sendAssistLocal(text) {
  // 模型在按下发送这一刻就定死：排队等前一条跑完期间用户可能已经离开助理页或又改了选择，
  // 到时候再读就跟他发的时候看到的标签对不上了
  const model = currentSessModel() || null;
  assistChain = assistChain.then(() => doAssistLocal(text, model)).catch(() => {});
  return assistChain;
}
async function doAssistLocal(text, model) {
  const feed = document.getElementById("im-feed");
  if (feed) {
    feed.insertAdjacentHTML("beforeend",
      `<div class="im-row usr"><div class="im-col" style="text-align:right"><div class="m">本地 · 用户</div><div class="im-b usr">${esc(text)}</div></div><div class="im-ava">🧑</div></div>` +
      `<div class="im-row bot" id="im-pending"><div class="im-ava">🤖</div><div class="im-col"><div class="im-b bot">执行中…</div></div></div>`);
    feed.scrollTop = feed.scrollHeight;
  }
  // 等结果期间把「执行中…」气泡变成实时进度（第几步、在用哪个工具），跟飞书状态消息同一份文案
  const liveT = setInterval(async () => {
    const el = document.querySelector("#im-pending .im-b");
    if (!el) return;
    const p = await fetch("/im/progress").then(r => r.json()).catch(() => null);
    if (p && p.local_assist && p.local_assist.text) el.textContent = "⏳ " + p.local_assist.text;
  }, 1500);
  try {
    // 模型标签上显示的是哪个就真用哪个：以前这里不带 model，助理页选了模型也是白选，
    // 跑的还是全局默认——标签说一套、实际跑一套，属于静默换模型
    await fetch("/im/local", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, model: model || null }) });
  } catch {}
  clearInterval(liveT);
  document.getElementById("im-pending")?.remove();
  const fresh = await fetch("/im/log").then(r => r.json()).catch(() => []);
  const f2 = document.getElementById("im-feed");
  if (f2) { f2._n = -1; renderAssistFeed(fresh); f2.scrollTop = f2.scrollHeight; }
}
// 远程会话（飞书等）有任务在跑时，助理页尾部挂一行实时进度——不用翻手机也知道它在干嘛
async function updateAssistLive() {
  const feed = document.getElementById("im-feed");
  if (!feed) return;
  const p = await fetch("/im/progress").then(r => r.json()).catch(() => null);
  const remote = p ? Object.entries(p).filter(([k, v]) => k !== "local_assist" && v && v.text) : [];
  let el = document.getElementById("im-remote-live");
  if (!remote.length) { el?.remove(); return; }
  const CH = { feishu: "🕊️ 飞书", qq: "🐧 QQ", wechat_ilink: "💬 微信", wecom_app: "🏢 企业微信", webhook: "🔗 Webhook" };
  const txt = remote.map(([k, v]) => `${CH[v.channel] || v.channel || k} · ${v.text}`).join("；");
  if (!el) {
    feed.insertAdjacentHTML("beforeend", `<div class="im-row bot" id="im-remote-live"><div class="im-ava">⏳</div><div class="im-col"><div class="im-b bot" style="color:var(--wb-text-2)"></div></div></div>`);
    el = document.getElementById("im-remote-live");
    if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120) feed.scrollTop = feed.scrollHeight;
  }
  el.querySelector(".im-b").textContent = "远程任务执行中 · " + txt;
}
function renderAssistFeed(log) {
  const feed = document.getElementById("im-feed");
  if (!feed) return;
  const CH_TXT = { feishu: "飞书", qq: "QQ", wechat_ilink: "微信", wecom_app: "企业微信", wechat_mp: "公众号", wecom: "企业微信", webhook: "Webhook", local: "本地" };
  const CH_ICON = { feishu: "🕊️", qq: "🐧", wechat_ilink: "💬", wecom_app: "🏢", wechat_mp: "🟢", local: "💻" };
  const n = (log || []).length;
  if (feed._n === n) return; // 没有新消息就不重绘，避免打断用户滚动/选中
  feed._n = n;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  feed.innerHTML = n
    ? log.slice().reverse().map(m => {
        if (m.dir === "error") return `<div class="im-b error">⚠ ${esc(m.text)}</div>`;
        const meta = `${CH_TXT[m.channel] || m.channel} · ${m.dir === "in" ? "用户" : "助理"} · ${m.ts.slice(11, 19)}`;
        if (m.dir === "in") {
          return `<div class="im-row usr"><div class="im-col" style="text-align:right"><div class="m">${meta}</div><div class="im-b usr">${esc(m.text)}</div></div><div class="im-ava">${CH_ICON[m.channel] || "🔗"}</div></div>`;
        }
        return `<div class="im-row bot"><div class="im-ava">🤖</div><div class="im-col"><div class="m">${meta}</div><div class="im-b bot a-text">${renderMd(m.text)}</div></div></div>`;
      }).join("")
    : '<div class="ab-empty">还没有对话。直接在下方输入框发条消息，或在飞书/微信里 @机器人。</div>';
  if (atBottom || feed._first === undefined) { feed.scrollTop = feed.scrollHeight; feed._first = 1; }
}


// ================= 项目页（主区：卡片广场 + 模板 + 新建/编辑弹窗） =================
// 官方 WorkBuddy 的「项目」不只是切目录：一个项目自带指令（背景/规范）和挂载的专家/技能/连接器。
// 指令会真的进系统提示词（服务端 projectContext），不是摆设。
const PROJ_TEMPLATES = [
  { ic: "📋", tt: "产品需求全流程", dd: "从需求规划、PRD 到研发测试验收", ins: "这是一个产品研发项目。输出遵守：需求先写用户故事和验收标准；PRD 用「背景/目标/方案/边界/里程碑」结构；技术方案要列出取舍理由；每个交付物开头放一段 3 句话内的摘要。" },
  { ic: "🐛", tt: "Bug 跟踪/测试验收", dd: "持续跟踪 Bug，统一测试用例和验收", ins: "这是一个测试与质量项目。报 Bug 必须带：复现步骤、期望结果、实际结果、影响范围、严重级别（P0-P3）。测试用例用表格：编号/前置条件/步骤/期望。验收结论只有「通过/不通过+原因」两种，不许写「基本可用」。" },
  { ic: "📦", tt: "项目交付", dd: "管理客户需求、计划、风险和周报", ins: "这是一个对客户的交付项目。所有对外文档开头都要有结论摘要；周报固定三段：本周进展/风险与阻塞/下周计划；风险必须写清楚影响和应对，不许只列现象；涉及排期变化要显式标出来。" },
  { ic: "📣", tt: "内容营销", dd: "选题、成稿、多平台分发一条线", ins: "这是一个内容营销项目。选题先给出目标人群和钩子；正文口语化、短句、多分段；每篇产出都附一条一句话摘要和 3 个候选标题；发布渠道不同措辞不同：公众号可长文，小红书要点化+emoji。" },
  { ic: "💻", tt: "全栈开发", dd: "前后端分离架构的 Web 应用开发", ins: "这是一个全栈开发项目。代码规范：前端用 Vue/React + TypeScript，后端用 Node.js/Python；API 统一 RESTful 风格；所有接口必须有错误处理和参数校验；数据库操作用事务保证一致性；关键函数必须写单元测试。" },
  { ic: "📱", tt: "移动应用开发", dd: "iOS/Android 原生或跨平台应用", ins: "这是一个移动应用开发项目。遵循平台设计规范：iOS 用 Human Interface Guidelines，Android 用 Material Design；性能优化必做：图片懒加载、列表虚拟滚动、接口缓存；适配不同屏幕尺寸和系统版本。" },
  { ic: "🤖", tt: "AI/机器学习", dd: "数据处理、模型训练、模型部署", ins: "这是一个 AI/机器学习项目。数据处理：清洗、标注、增强必须记录；模型训练：超参数、评估指标、训练曲线必须保存；模型部署：API 接口、推理延迟、资源占用必须监控；所有实验结果用 Markdown 表格整理。" },
  { ic: "🎨", tt: "UI/UX 设计", dd: "界面设计、交互原型、设计规范", ins: "这是一个 UI/UX 设计项目。设计交付物：原型图、视觉稿、切图资源、标注文档；遵循设计系统：颜色、字体、间距、圆角统一；交互说明：状态变化、动效时长、异常提示必须写清楚。" },
];

let customTemplates = [];
async function loadCustomTemplates() {
  try {
    const r = await fetch("/api/project-templates");
    const data = await r.json();
    customTemplates = data.templates || [];
  } catch (e) {
    console.error("加载自定义模板失败:", e);
    customTemplates = [];
  }
}

async function renderProjPage() {
  const page = document.getElementById("assist-page");
  if (!page) return;
  await refreshProjects();
  await loadCustomTemplates();
  const q = (page._q || "").toLowerCase();
  const mine = projects.filter(p => !q || p.name.toLowerCase().includes(q));
  const allTemplates = [...PROJ_TEMPLATES, ...customTemplates];
  page.innerHTML = `
    <div class="pg-hero"><h1>项目</h1><div class="sub">每个项目一个独立工作目录，自带指令与专属配置，任务历史按项目分组</div></div>
    <div class="hub-head">
      <button class="btn-brand" id="pj-new" style="padding:8px 16px">＋ 新建项目</button>
      <div class="hub-search" style="max-width:260px;margin-left:auto"><input id="pj-q" placeholder="搜索项目" value="${esc(page._q || "")}"></div>
    </div>
    <div class="hub-sec-title">我的项目</div>
    <div class="tpl-grid" style="margin-bottom:22px">${mine.map(p => `
      <div class="proj-card ${p.name === activeProject ? "active" : ""}" data-name="${esc(p.name)}">
        <div class="tt">📂 ${esc(p.name)} ${p.name === activeProject ? '<span class="badge">当前</span>' : ""}</div>
        <div class="dd">${p.instructions ? esc(p.instructions.slice(0, 60)) + (p.instructions.length > 60 ? "…" : "") : "还没有写项目指令"}</div>
        <div class="dd" title="${esc(p.dir)}">${p.created_at ? "添加于 " + esc(p.created_at.slice(0, 10)) : esc(p.dir)}</div>
        <div class="ops">
          <a class="link" data-act="open" href="#">${p.name === activeProject ? "去新建任务" : "切换到此项目"}</a>
          <a class="link" data-act="edit" href="#">编辑</a>
          ${projects.length > 1 ? `<button type="button" class="link danger" data-act="del" ${projectHasRunning(p.name) ? 'disabled title="项目内有任务运行中，暂不能移除"' : ''}>移除</button>` : ""}
        </div>
      </div>`).join("") || '<div class="hub-empty">没有匹配的项目</div>'}
    </div>
    <div class="hub-sec-title">从模版创建 <span class="sub">带着写好的项目指令开工</span></div>
    <div class="tpl-grid pj-tpl-grid">
      ${allTemplates.map((t, i) => `
        <div class="proj-card" data-tpl="${i}" ${t.id ? `data-custom-id="${esc(t.id)}"` : ""}>
          <div class="tt">${t.ic} ${esc(t.tt)}${t.id ? ' <span class="badge-custom">自定义</span>' : ''}</div>
          <div class="dd">${esc(t.dd)}</div>
          <div class="ops">
            <a class="link" data-act="use" href="#">用这个模版新建 →</a>
            ${t.id ? '<a class="link" data-act="edit-tpl" href="#">编辑</a>' : ''}
            ${t.id ? '<a class="link danger" data-act="del-tpl" href="#">移除</a>' : ''}
          </div>
        </div>`).join("")}
      <div class="proj-card pj-tpl-add" id="add-custom-tpl">
        <div class="plus">＋</div>
        <div class="tt">新增自定义模板</div>
        <div class="dd">写一套自己的项目指令存下来</div>
      </div>
    </div>`;
  page.querySelector("#pj-new").onclick = () => openProjEditor(null);
  const qEl = page.querySelector("#pj-q");
  qEl.oninput = () => { page._q = qEl.value; clearTimeout(page._t); page._t = setTimeout(renderProjPage, 200); };
  page.querySelector("#add-custom-tpl").onclick = () => openTemplateEditor(null);
  page.querySelectorAll(".proj-card[data-tpl]").forEach(el => el.onclick = async (e) => {
    e.preventDefault();
    const idx = +el.dataset.tpl;
    const tpl = allTemplates[idx];
    if (!tpl) return;
    const act = (e.target.closest("a[data-act]") || {}).dataset ? e.target.closest("a[data-act]").dataset.act : "use";
    // 内置模板没有 id：编辑/移除只对自定义的开放，内置的一律走"用这个模版新建"
    if ((act === "edit-tpl" || act === "del-tpl") && !tpl.id) return;
    if (act === "edit-tpl") return openTemplateEditor(tpl);
    if (act === "del-tpl") {
      const doDel = async () => {
        const r = await fetch("/api/project-templates/" + encodeURIComponent(tpl.id), { method: "DELETE" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (typeof toast === "function") toast("❌ " + (d.error || "移除失败"));
          return;
        }
        if (typeof toast === "function") toast("✅ 模板已移除");
        renderProjPage();
      };
      if (typeof showConfirmDialog === "function") {
        showConfirmDialog({ title: `移除模板「${tpl.tt}」？`, desc: "只删这条模板，已经用它建好的项目不受影响。", confirmText: "确认移除", cancelText: "取消", icon: "trash", danger: true, onConfirm: doDel });
      } else {
        if (confirm(`移除模板「${tpl.tt}」？`)) doDel();
      }
      return;
    }
    openProjEditor(null, tpl);
  });
  page.querySelectorAll(".proj-card[data-name]").forEach(el => el.onclick = async (e) => {
    e.preventDefault();
    const name = el.dataset.name;
    const act = e.target.closest("[data-act]")?.dataset.act || "open";
    const proj = projects.find(p => p.name === name);
    if (act === "edit") return openProjEditor(proj);
    if (act === "del") {
      if (projectHasRunning(name)) { toast("项目内有任务运行中，暂不能移除"); return; }
      const doDel = async () => { if (await removeProject(name)) renderProjPage(); };
      if (typeof showConfirmDialog === "function") {
        showConfirmDialog({
          title: `移除项目「${name}」？`,
          desc: "从项目列表中移除该项（实际磁盘目录和文件均不会被删除）。",
          confirmText: "确认移除",
          cancelText: "取消",
          icon: "trash",
          danger: true,
          onConfirm: doDel
        });
      } else {
        if (confirm(`把项目「${name}」从列表移除？（目录和文件不会删除）`)) doDel();
      }
      return;
    }
    if (name !== activeProject) {
      const resp = await fetch("/api/projects/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await resp.json().catch(() => ({}));
      // 任务已固定自己的项目目录；仍兼容旧服务端的 busy 返回。
      if (resp.status === 409 || (data && data.busy)) {
        if (typeof toast === "function") toast("⏳ " + (data.error || "有任务正在运行，暂时不能切换项目"));
        return;
      }
      if (!resp.ok) {
        if (typeof toast === "function") toast("❌ " + ((data && data.error) || "切换项目失败"));
        return;
      }
      activeProject = name;
      resetProjectFileState();
      // 换项目 = 换会话：占比先清零，别把旧项目的数字带进新项目（见 app-02 同处注释）
      sessionId = null;
      if (typeof resetContextIndicator === 'function') resetContextIndicator("正在切换项目…");
      refreshProjectFiles();

      // 恢复新项目的模型选择（从 localStorage 读取缓存）
      const savedModel = localStorage.getItem(`project_model_${name}`);
      if (savedModel) {
        // 有缓存：恢复缓存的模型
        try {
          await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active_model: savedModel })
          });
          await refreshSettingsCache();
          settingsCache.active_model = savedModel;
          if (typeof renderModelPicker === 'function') {
            renderModelPicker();
          }
        } catch (e) {
          console.error('[切换项目] 恢复模型失败:', e);
          await refreshSettingsCache();
        }
      } else {
        // 没有缓存：使用服务端返回的模型
        await refreshSettingsCache();
        if (data.active_model && data.active_model !== settingsCache.active_model) {
          settingsCache.active_model = data.active_model;
          if (typeof renderModelPicker === 'function') {
            renderModelPicker();
          }
        }
      }

      if (activeProject !== name) return;
      // 打开该项目的最新一条对话
      // 老会话可能没写 project 字段（或首尾带空格），跟 app-02 用同一套归一化，
      // 否则这里筛不到、白白新建一条空任务
      const normalizeProject = (p) => String(p || "默认项目").trim();
      const projectSessions = sessions.filter(s => normalizeProject(s.project) === normalizeProject(name));
      renderHistory(); // 先把新项目的列表画出来，下面才点得到 .hist-item
      if (projectSessions.length > 0) {
        // 按时间倒序排序，取最新的一条
        projectSessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        const latestSession = projectSessions[0];
        if (typeof loadSession === 'function') {
          loadSession(latestSession.id);
        } else {
          // 如果没有 loadSession 函数，使用点击历史记录的方式
          setTimeout(() => {
            if (activeProject !== name) return;
            const historyItem = document.querySelector(`.hist-item[data-id="${latestSession.id}"]`);
            if (historyItem) {
              historyItem.click();
            } else {
              // 找不到就退回新任务，别停在「没有会话但显示着旧占比」的中间态
              document.getElementById("new-task").click();
            }
          }, 100);
        }
      } else {
        // 如果没有历史对话，新建任务
        document.getElementById("new-task").click();
      }
    } else {
      // 如果点击的是当前项目，新建对话
      closeAssistView();
      document.getElementById("new-task").click();
    }
  });
}

/** 新建/编辑项目弹窗（proj 传 null = 新建；tpl 传模板预填指令） */
async function openProjEditor(proj, tpl) {
  await loadCustomTemplates();
  const allTemplates = [...PROJ_TEMPLATES, ...customTemplates];
  mask.classList.add("show");
  modalBox.classList.add("wide");
  mTitle.textContent = proj ? `编辑项目「${proj.name}」` : "新建项目";
  mBody.innerHTML = `<div class="proj-form">
    <div class="proj-form-field">
      <label>
        <span>📁 项目名称</span>
        <span class="cnt"><span id="pj-cnt">0</span>/15</span>
      </label>
      <input id="pj-name" maxlength="15" placeholder="例如：电商小程序重构 / 官方网站" value="${esc((proj || {}).name || (tpl || {}).tt || "")}">
    </div>

    <div class="proj-form-field">
      <label>
        <span>📂 本地工作目录</span>
        <span class="cnt">留空则自动在 data/projects/ 下创建</span>
      </label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="pj-dir" placeholder="留空则自动创建默认目录" value="${esc((proj || {}).dir || "")}" ${proj ? "readonly" : ""} style="flex:1">
        ${proj ? "" : '<button class="settings-action-btn secondary" id="pj-pick-dir" type="button" style="height:38px!important;padding:0 14px;"><span>📂</span> 浏览目录</button>'}
      </div>
    </div>

    <div class="proj-form-field">
      <label>
        <span>⚡ 背景指令模板</span>
        <span class="cnt">点击一键套用规范</span>
      </label>
      <div class="picks" id="pj-tpl-picks">
        ${allTemplates.map((t, i) => `<span class="pk" data-tpl="${i}" title="${esc(t.dd)}"><span style="font-size:16px">${t.ic}</span> <span>${esc(t.tt)}</span></span>`).join("")}
      </div>
    </div>

    <div class="proj-form-field">
      <label>
        <span>📝 项目系统指令与约束 (System Prompt)</span>
      </label>
      <textarea id="pj-ins" rows="4" placeholder="提供当前项目的背景信息、技术栈偏好和团队规范，让 AI Agent 的代码生成与回复更精准。">${esc((proj || {}).instructions || (tpl || {}).ins || "")}</textarea>
    </div>

    <div class="foot">
      <span class="hint">💡 设定好的项目指令将作为 Agent 的系统级上下文</span>
      <button class="settings-action-btn secondary" id="pj-cancel" type="button" style="height:38px;min-width:80px">取消</button>
      <button class="settings-action-btn primary" id="pj-ok" type="button" style="height:38px;min-width:96px">确认保存</button>
    </div>
  </div>`;
  const nameEl = mBody.querySelector("#pj-name"), cntEl = mBody.querySelector("#pj-cnt");
  const syncCnt = () => { cntEl.textContent = nameEl.value.length; };
  nameEl.oninput = syncCnt; syncCnt();

  const pickBtn = mBody.querySelector("#pj-pick-dir");
  if (pickBtn) {
    pickBtn.onclick = async () => {
      try {
        const resp = await fetch("/api/pick-folder", { method: "POST" });
        const data = await resp.json();
        if (data.canceled) return;
        if (data.error) return toast("❌ " + data.error);
        if (data.path) mBody.querySelector("#pj-dir").value = data.path;
      } catch (e) {
        toast("❌ 选择文件夹失败");
      }
    };
  }

  const insEl = mBody.querySelector("#pj-ins");
  // 模板改成 chip：点一下套用指令。已经写了内容再点也直接换，不问——
  // 模板就几个，点错了反手点回来就是，confirm 反而显得粗糙
  mBody.querySelector("#pj-tpl-picks").onclick = (e) => {
    const pk = e.target.closest(".pk");
    if (!pk) return;
    const t = allTemplates[+pk.dataset.tpl];
    if (!t) return;
    insEl.value = t.ins;
    mBody.querySelectorAll("#pj-tpl-picks .pk").forEach(x => x.classList.remove("on"));
    pk.classList.add("on");
    if (!nameEl.value.trim()) { nameEl.value = t.tt; syncCnt(); }
  };
  // 从模版卡片进来的（renderProjPage 里点"用这个模版新建"），把对应 chip 标成选中
  if (tpl) {
    // 自定义模板有 id，内置模板没有。用 id 或 tt 匹配，不能用 indexOf（对象引用不同）
    const i = allTemplates.findIndex(t => (tpl.id && t.id === tpl.id) || (t.tt === tpl.tt && t.ic === tpl.ic));
    if (i >= 0) mBody.querySelector(`#pj-tpl-picks .pk[data-tpl="${i}"]`)?.classList.add("on");
  }
  mBody.querySelector("#pj-cancel").onclick = () => mask.classList.remove("show");
  mBody.querySelector("#pj-ok").onclick = async () => {
    const name = nameEl.value.trim();
    if (!name) return toast("❌ 项目名称不能为空");
    const body = {
      name,
      instructions: insEl.value.trim(),
      dir: mBody.querySelector("#pj-dir").value.trim() || undefined,
    };
    const resp = proj
      ? await fetch("/api/projects/" + encodeURIComponent(proj.name), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return toast("❌ " + (data.error || "保存失败"));
    mask.classList.remove("show");
    toast(proj ? "✅ 项目已更新" : "✅ 项目已创建");
    // 先同步本窗口选中项，再开新任务；编辑已有项目不切换当前会话。
    if (!proj) await activateCreatedProject(data, name);
    else await refreshProjects().then(refreshSettingsCache);
    if (pageKind === "proj") renderProjPage();
  };
}

/** 新建/编辑自定义模板弹窗 */
function openTemplateEditor(tpl) {
  mask.classList.add("show");
  modalBox.classList.add("wide");
  mTitle.textContent = tpl ? `编辑模板「${tpl.tt}」` : "新增自定义模板";
  mBody.innerHTML = `<div class="proj-form">
    <div class="proj-form-field">
      <label>
        <span>🏷️ 模板名称</span>
        <span class="cnt"><span id="tpl-cnt">0</span>/20</span>
      </label>
      <input id="tpl-name" maxlength="20" placeholder="例如：后端开发 / 前端组件库" value="${esc((tpl || {}).tt || "")}">
    </div>

    <div class="proj-form-field">
      <label>
        <span>🎨 图标</span>
        <span class="cnt">一个 emoji 字符</span>
      </label>
      <input id="tpl-icon" maxlength="4" placeholder="⭐" value="${esc((tpl || {}).ic || "⭐")}">
    </div>

    <div class="proj-form-field">
      <label>
        <span>📄 描述</span>
        <span class="cnt"><span id="tpl-desc-cnt">0</span>/60</span>
      </label>
      <input id="tpl-desc" maxlength="60" placeholder="简短描述这个模板的用途" value="${esc((tpl || {}).dd || "")}">
    </div>

    <div class="proj-form-field">
      <label>
        <span>📝 项目系统指令</span>
      </label>
      <textarea id="tpl-ins" rows="6" placeholder="输入使用此模板创建项目时的默认系统指令...">${esc((tpl || {}).ins || "")}</textarea>
    </div>

    <div class="foot">
      <span class="hint">💡 自定义模板会保存到本地，可在创建项目时快速套用</span>
      <button class="settings-action-btn secondary" id="tpl-cancel" type="button" style="height:38px;min-width:80px">取消</button>
      <button class="settings-action-btn primary" id="tpl-ok" type="button" style="height:38px;min-width:96px">确认保存</button>
    </div>
  </div>`;

  const nameEl = mBody.querySelector("#tpl-name"), cntEl = mBody.querySelector("#tpl-cnt");
  const descEl = mBody.querySelector("#tpl-desc"), descCntEl = mBody.querySelector("#tpl-desc-cnt");
  const syncCnt = () => {
    cntEl.textContent = nameEl.value.length;
    descCntEl.textContent = descEl.value.length;
  };
  nameEl.oninput = syncCnt;
  descEl.oninput = syncCnt;
  syncCnt();

  mBody.querySelector("#tpl-cancel").onclick = () => mask.classList.remove("show");
  mBody.querySelector("#tpl-ok").onclick = async () => {
    const tt = nameEl.value.trim();
    if (!tt) return toast("❌ 模板名称不能为空");
    const ins = mBody.querySelector("#tpl-ins").value.trim();
    if (!ins) return toast("❌ 项目指令不能为空");

    const body = {
      ic: mBody.querySelector("#tpl-icon").value.trim() || "⭐",
      tt,
      dd: descEl.value.trim(),
      ins
    };

    const resp = tpl
      ? await fetch("/api/project-templates/" + encodeURIComponent(tpl.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/project-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return toast("❌ " + (data.error || "保存失败"));

    mask.classList.remove("show");
    toast(tpl ? "✅ 模板已更新" : "✅ 模板已创建");
    if (pageKind === "proj") renderProjPage();
  };
}

// ================= 自动化页（定时任务 + 运行记录 + 批量管理 + 模板） =================
const AUTOM_TEMPLATES = [
  { ic: "📰", tt: "每日 AI 新闻晨报", cron: "0 9 * * *", task: "搜索过去 24 小时内 AI 行业的重要新闻（新模型、产品、融资、政策），挑 5-8 条真实可查的，生成一份 Markdown 晨报，每条附来源链接。" },
  { ic: "🗒️", tt: "每周五工作周报", cron: "0 17 * * 5", task: "读取本周工作目录里新增/修改的成果文件，按「本周进展 / 问题与风险 / 下周计划」三段生成一份周报，进展要具体到产出物。" },
  { ic: "🛠️", tt: "每小时网站巡检", cron: "0 * * * *", task: "用 fetch_url 检查以下网址是否能正常打开、响应是否异常（先在这里填上你的网址）：https://example.com 。异常时写清楚状态码和现象。" },
  { ic: "🧹", tt: "每周清理临时文件", cron: "0 10 * * 1", task: "列出工作目录里超过 7 天没动过的 .tmp/.log/中间产物文件，汇总成清单报告（只报告，不要直接删除）。" },
];
const automState = { tab: "tasks", q: "", bulk: false, sel: new Set(), editing: null, showForm: false };
function buildCronFrom(root) {
  const freq = root.querySelector("#sf-freq").value;
  const t = (root.querySelector("#sf-time").value || "09:00").split(":");
  const m = +t[1] || 0, h = +t[0] || 9;
  switch (freq) {
    case "daily": return `${m} ${h} * * *`;
    case "workday": return `${m} ${h} * * 1-5`;
    case "weekly": return `${m} ${h} * * ${root.querySelector("#sf-dow").value}`;
    case "monthly": return `${m} ${h} ${root.querySelector("#sf-dom").value} * *`;
    case "hourly": return `${m} * * * *`;
    case "half-hour": return `*/30 * * * *`;
    case "custom": return root.querySelector("#sf-cron").value.trim();
  }
}
/** 反推：已有 cron 回填到表单（编辑时用；反推不出来就落到自定义档） */
function cronToForm(root, cron) {
  const set = (id, v) => { root.querySelector(id).value = v; };
  const m = (cron || "").match(/^(\d+) (\d+) (\S+) \* (\S+)$/);
  const time = m ? `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}` : "09:00";
  if (cron === "*/30 * * * *") set("#sf-freq", "half-hour");
  else if (/^\d+ \* \* \* \*$/.test(cron)) { set("#sf-freq", "hourly"); set("#sf-time", `09:${cron.split(" ")[0].padStart(2, "0")}`); }
  else if (m && m[3] === "*" && m[4] === "*") { set("#sf-freq", "daily"); set("#sf-time", time); }
  else if (m && m[3] === "*" && m[4] === "1-5") { set("#sf-freq", "workday"); set("#sf-time", time); }
  else if (m && m[3] === "*" && /^\d$/.test(m[4])) { set("#sf-freq", "weekly"); set("#sf-dow", m[4]); set("#sf-time", time); }
  else if (m && /^\d+$/.test(m[3]) && m[4] === "*") { set("#sf-freq", "monthly"); set("#sf-dom", m[3]); set("#sf-time", time); }
  else { set("#sf-freq", "custom"); set("#sf-cron", cron || ""); }
  root.querySelector("#sf-freq").onchange();
}
async function renderAutomPage() {
  const page = document.getElementById("assist-page");
  if (!page) return;
  const st = automState;
  if (st.tab === "runs") return renderAutomRuns(page);
  const list = await fetch("/api/schedules").then(r => r.json()).catch(() => []);
  const q = st.q.toLowerCase();
  const match = list.filter(t => !q || t.name.toLowerCase().includes(q) || t.task.toLowerCase().includes(q));
  const on = match.filter(t => t.enabled), off = match.filter(t => !t.enabled);
  const row = (t) => `
    <div class="at-row" data-id="${t.id}">
      ${st.bulk ? `<input type="checkbox" data-sel="${t.id}" ${st.sel.has(t.id) ? "checked" : ""}>` : ""}
      <span class="nm">${esc(t.name)}</span>
      <span class="meta" title="${esc(t.task)}">${esc(t.task.slice(0, 50))} · ${esc(cronToHuman(t.cron))}${t.last_run ? " · 上次 " + esc(t.last_run.slice(5, 16).replace("T", " ")) : ""}</span>
      <span class="st ${t.running ? "" : !t.enabled ? "" : t.last_result ? (/^出错/.test(t.last_result) ? "err" : "ok") : ""}">${t.running ? "执行中…" : !t.enabled ? "已暂停" : t.last_result ? (/^出错/.test(t.last_result) ? "上次失败" : "上次成功") : "待首跑"}</span>
      <span class="ops">
        <a class="link" data-act="run" href="#">立即执行</a>
        <a class="link" data-act="edit" href="#">编辑</a>
        <a class="link" data-act="toggle" href="#">${t.enabled ? "暂停" : "启用"}</a>
        <a class="link danger" data-act="del" href="#">删除</a>
      </span>
    </div>`;
  page.innerHTML = `
    <div class="hub-head">
      <div class="hub-tabs">
        <button class="active" data-tab="tasks">⏱️ 定时任务</button>
        <button data-tab="runs">📜 运行记录</button>
      </div>
      <div class="hub-search" style="max-width:240px"><input id="at-q" placeholder="搜索自动化" value="${esc(st.q)}"></div>
      <button class="btn-plain" id="at-bulk" style="${st.bulk ? "border-color:var(--wb-brand);color:var(--wb-brand)" : ""}">☑️ 批量管理</button>
      <button class="btn-plain" id="at-tpl">📋 从模版添加</button>
      <button class="btn-brand" id="at-new">＋ 添加自动化</button>
    </div>
    ${st.bulk ? `<div class="hub-bar" style="margin:0 0 8px">
      <a class="link" id="bk-all" href="#">全选</a>
      <span style="font-size: 13px;color:var(--wb-text-3)">已选 ${st.sel.size} 个</span>
      <a class="link" id="bk-en" href="#">批量启用</a>
      <a class="link" id="bk-dis" href="#">批量暂停</a>
      <a class="link danger" id="bk-del" href="#">批量删除</a>
    </div>` : ""}
    <div id="at-form-box"></div>
    ${on.length ? `<div class="at-group">启用中（${on.length}）</div>` + on.map(row).join("") : ""}
    ${off.length ? `<div class="at-group">已暂停（${off.length}）</div>` + off.map(row).join("") : ""}
    ${!match.length ? '<div class="hub-empty">还没有自动化任务。点右上角「＋ 添加自动化」或「从模版添加」建一个。</div>' : ""}`;
  page.querySelector('[data-tab="runs"]').onclick = () => { st.tab = "runs"; renderAutomPage(); };
  const qEl = page.querySelector("#at-q");
  qEl.oninput = () => { st.q = qEl.value; clearTimeout(page._t); page._t = setTimeout(renderAutomPage, 200); };
  page.querySelector("#at-bulk").onclick = () => { st.bulk = !st.bulk; st.sel.clear(); renderAutomPage(); };
  page.querySelector("#at-new").onclick = () => { st.editing = null; st.showForm = true; renderAutomForm(page.querySelector("#at-form-box")); };
  page.querySelector("#at-tpl").onclick = () => renderAutomTplPicker(page.querySelector("#at-form-box"));
  if (st.showForm) renderAutomForm(page.querySelector("#at-form-box"));
  page.querySelectorAll("input[data-sel]").forEach(cb => cb.onchange = () => {
    cb.checked ? st.sel.add(cb.dataset.sel) : st.sel.delete(cb.dataset.sel);
    renderAutomPage();
  });
  if (st.bulk) {
    page.querySelector("#bk-all").onclick = (e) => { e.preventDefault(); match.forEach(t => st.sel.add(t.id)); renderAutomPage(); };
    const bulk = async (action, confirmText) => {
      if (!st.sel.size) return toast("❌ 先勾选要操作的任务");
      if (confirmText && !confirm(confirmText)) return;
      const r = await fetch("/api/schedules/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...st.sel], action }) }).then(r => r.json()).catch(() => ({}));
      toast(r.ok ? `✅ 已处理 ${r.count} 个` : "❌ " + (r.error || "操作失败"));
      st.sel.clear();
      renderAutomPage();
    };
    page.querySelector("#bk-en").onclick = (e) => { e.preventDefault(); bulk("enable"); };
    page.querySelector("#bk-dis").onclick = (e) => { e.preventDefault(); bulk("disable"); };
    page.querySelector("#bk-del").onclick = (e) => { e.preventDefault(); bulk("delete", `确认删除选中的 ${st.sel.size} 个自动化任务？运行记录会一并清掉`); };
  }
  page.querySelectorAll(".at-row a[data-act]").forEach(a => a.onclick = async (e) => {
    e.preventDefault();
    const id = a.closest(".at-row").dataset.id;
    const t = list.find(x => x.id === id);
    const act = a.dataset.act;
    if (act === "edit") { st.editing = t; st.showForm = true; renderAutomForm(page.querySelector("#at-form-box")); window.scrollTo(0, 0); return; }
    if (act === "del") { if (!confirm(`确认删除「${t.name}」？`)) return; await fetch("/api/schedules/" + id, { method: "DELETE" }); }
    else if (act === "toggle") await fetch(`/api/schedules/${id}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !t.enabled }) });
    else if (act === "run") {
      a.textContent = "执行中…";
      const r = await fetch(`/api/schedules/${id}/run`, { method: "POST" }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      toast(!r || !r.ok ? "❌ " + (j.error || "执行失败") : "✅ 执行完成");
      refreshProjectFiles();
    }
    renderAutomPage();
  });
}
function renderAutomTplPicker(box) {
  automState.showForm = false;
  box.innerHTML = `<div class="tpl-grid" style="margin:4px 0 14px">${AUTOM_TEMPLATES.map((t, i) => `
    <div class="proj-card" data-i="${i}">
      <div class="tt">${t.ic} ${esc(t.tt)}</div>
      <div class="dd">${esc(cronToHuman(t.cron))} · ${esc(t.task.slice(0, 46))}…</div>
      <div class="ops"><a class="link" href="#">用这个模版 →</a></div>
    </div>`).join("")}</div>`;
  box.querySelectorAll(".proj-card").forEach(el => el.onclick = (e) => {
    e.preventDefault();
    automState.editing = null; automState.showForm = true;
    renderAutomForm(box, AUTOM_TEMPLATES[+el.dataset.i]);
  });
}
function renderAutomForm(box, tpl) {
  const ed = automState.editing;
  box.innerHTML = `<div style="border:1px solid var(--wb-border);border-radius:12px;padding:14px 16px;margin:4px 0 16px">
    <div style="font-weight:600;margin-bottom:10px">${ed ? `编辑「${esc(ed.name)}」` : "添加自动化"}</div>
    <input id="sf-name" placeholder="任务名（如：每日晨报）" value="${esc((ed || tpl || {}).name || (tpl || {}).tt || "")}">
    <div class="form-row">
      <select id="sf-freq">
        <option value="daily">每天</option>
        <option value="workday">工作日（周一到周五）</option>
        <option value="weekly">每周某天</option>
        <option value="monthly">每月某日</option>
        <option value="hourly">每小时</option>
        <option value="half-hour">每 30 分钟</option>
        <option value="custom">自定义 cron</option>
      </select>
      <select id="sf-dow" style="display:none">
        <option value="1">周一</option><option value="2">周二</option><option value="3">周三</option>
        <option value="4">周四</option><option value="5">周五</option><option value="6">周六</option><option value="0">周日</option>
      </select>
      <select id="sf-dom" style="display:none">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}">${i + 1} 日</option>`).join("")}</select>
      <input id="sf-time" type="time" value="09:00">
    </div>
    <input id="sf-cron" placeholder="cron 表达式：分 时 日 月 周" style="display:none">
    <textarea id="sf-task" rows="2" placeholder="要自动执行的任务描述，如：抓取今天的 AI 新闻生成晨报">${esc((ed || tpl || {}).task || "")}</textarea>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn-brand" id="sf-add">${ed ? "保存修改" : "添加"}</button>
      <button class="btn-plain" id="sf-cancel">收起</button>
    </div>
  </div>`;
  const freqEl = box.querySelector("#sf-freq");
  freqEl.onchange = () => {
    const v = freqEl.value;
    box.querySelector("#sf-dow").style.display = v === "weekly" ? "" : "none";
    box.querySelector("#sf-dom").style.display = v === "monthly" ? "" : "none";
    box.querySelector("#sf-cron").style.display = v === "custom" ? "" : "none";
    box.querySelector("#sf-time").style.display = ["hourly", "half-hour", "custom"].includes(v) ? "none" : "";
  };
  cronToForm(box, (ed || tpl || {}).cron || "0 9 * * *");
  box.querySelector("#sf-cancel").onclick = () => { automState.showForm = false; automState.editing = null; box.innerHTML = ""; };
  box.querySelector("#sf-add").onclick = async () => {
    const name = box.querySelector("#sf-name").value.trim();
    const task = box.querySelector("#sf-task").value.trim();
    const cron = buildCronFrom(box);
    if (!task) return toast("❌ 请填写任务描述");
    if (!cron) return toast("❌ 请完成时间设置");
    const resp = ed
      ? await fetch("/api/schedules/" + ed.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, cron, task }) })
      : await fetch("/api/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, cron, task }) });
    if (!resp.ok) return toast("❌ " + ((await resp.json()).error || "保存失败"));
    toast(ed ? "✅ 已保存" : "✅ 已添加");
    automState.showForm = false; automState.editing = null;
    renderAutomPage();
  };
}
async function renderAutomRuns(page) {
  const runs = await fetch("/api/schedules/runs?limit=100").then(r => r.json()).catch(() => []);
  const fmtMs = (ms) => ms >= 60000 ? Math.round(ms / 60000) + " 分" : Math.max(1, Math.round(ms / 1000)) + " 秒";
  page.innerHTML = `
    <div class="hub-head">
      <div class="hub-tabs">
        <button data-tab="tasks">⏱️ 定时任务</button>
        <button class="active" data-tab="runs">📜 运行记录</button>
      </div>
      <span style="font-size: 13px;color:var(--wb-text-3);margin-left:auto">最近 ${runs.length} 次执行，最新在前</span>
    </div>
    ${runs.length ? `<table class="at-runs">
      <tr><th>时间</th><th>任务</th><th>触发</th><th>耗时</th><th>结果</th></tr>
      ${runs.map(r => `<tr>
        <td style="white-space:nowrap">${esc((r.started_at || "").slice(5, 16).replace("T", " "))}</td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.trigger || "")}</td>
        <td style="white-space:nowrap">${r.ended_at ? fmtMs(r.ms) : "进行中…"}</td>
        <td>${r.ok === null ? "⏳" : r.ok ? "✅" : "❌"} ${esc((r.result || "").slice(0, 90))}${(r.result || "").length > 90 ? "…" : ""}</td>
      </tr>`).join("")}
    </table>` : '<div class="hub-empty">还没有运行记录。任务跑过之后（定时触发或手动执行）这里会留下每一次的流水。</div>'}`;
  page.querySelector('[data-tab="tasks"]').onclick = () => { automState.tab = "tasks"; renderAutomPage(); };
}

// ================= 资料库页（左侧文件树 + 右侧预览：MD 渲染 / CSV 表格 / HTML 真渲染） =================
const libState = { pick: null, q: "" }; // pick: {src:"lib"|"ws"|"notes", name}
function csvToTable(text) {
  // 迷你 CSV 解析（带引号转义）。行数封顶，别让一个 10 万行的表把页面卡死
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length && rows.length < 500; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some(x => x !== "")) rows.push(row); }
  if (!rows.length) return '<div class="ph">空表</div>';
  const [head, ...body] = rows;
  return `<table class="csv"><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr>` +
    body.map(r => `<tr>${head.map((_, i) => `<td>${esc(r[i] || "")}</td>`).join("")}</tr>`).join("") +
    `</table>${rows.length >= 500 ? '<div style="font-size: 13px;color:var(--wb-text-3);margin-top:6px">表太长，只显示前 500 行</div>' : ""}`;
}
// ================= 评测页：给模型跑基准，机器判分 =================
let evalArm = false; // 两段式确认：真实计费的操作不许一键就跑
let evalDetailDir = null;
const EV_FAIL_LABELS = { crash: "崩溃", timeout: "超时", max_steps: "步数用尽", loop_suspect: "疑似死循环", tool_error_storm: "工具连环报错", missing_artifact: "没交产物", wrong_output: "内容不对" };
async function renderEvalPage() {
  const page = document.getElementById("assist-page");
  if (!page) return;
  evalArm = false;
  evalDetailDir = null;
  if (!settingsCache) await refreshSettingsCache().catch(() => {});
  const models = (settingsCache && settingsCache.models) || [];
  const cur = (settingsCache && settingsCache.active_model) || "";
  const opts = (sel) => models.map((m) => `<option value="${esc(m.name)}" ${m.name === sel ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  page.innerHTML = `
    <div class="hub-head" style="flex-wrap:wrap;gap:8px">
      <div style="font-weight:700;font-size:15px">🧪 智能体评测</div>
      <label style="font-size:12px;color:var(--wb-text-3)">被测模型</label>
      <select id="ev-model" style="padding:6px 10px;border:1px solid var(--wb-line);border-radius:8px;background:var(--wb-card);color:var(--wb-text);font-size:13px">${opts(cur)}</select>
      <label style="font-size:12px;color:var(--wb-text-3)">每题次数</label>
      <select id="ev-repeat" title="重复跑才能看出稳定性：pass@1 均值看「能不能」，k 次全过看「稳不稳」。费用按次数翻倍" style="padding:6px 10px;border:1px solid var(--wb-line);border-radius:8px;background:var(--wb-card);color:var(--wb-text);font-size:13px">
        <option value="1">1 次 · 最快</option><option value="3">3 次 · 测稳定</option><option value="5">5 次 · 严格</option>
      </select>
      <label style="font-size:12px;color:var(--wb-text-3)">AI 评委</label>
      <select id="ev-judge" style="padding:6px 10px;border:1px solid var(--wb-line);border-radius:8px;background:var(--wb-card);color:var(--wb-text);font-size:13px"><option value="">不用（只机器判分）</option>${opts("")}</select>
      <button class="btn-brand" id="ev-start">开始评测</button>
      <span id="ev-state" style="font-size:13px;color:var(--wb-text-3)"></span>
    </div>
    <div style="font-size:13px;color:var(--wb-text-3);line-height:1.7;margin:0 0 10px">
      15 道分层任务（L1 基础 / L2 进阶 / L3 高难）把整个智能体当黑盒考（写代码 / 算表格 / 修 bug / 跨文件重构 / 日志管线…）。三条评分线互相独立：<b>机器判分</b>（跑代码、对数字、验结构，只认硬证据，失败自动归因成败因码）、<b>稳定性</b>（每题重复 k 次：pass@1 均值看能不能，k 次全过看稳不稳）、<b>AI 评委</b>（逐条质量维度只判 是/否，不打印象分）。跑完可「📌 设为基线」——之后每轮自动逐题对比，退步点名。
      <b>会真实调用所选模型计费</b>，费用随次数翻倍（DeepSeek 单次约几毛钱）。命令行同款：<code>npm run eval -- --repeat 3 --judge 评委名</code>
    </div>
    <pre id="ev-log" style="display:none;background:var(--wb-card);border:1px solid var(--wb-line);border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.8;max-height:320px;overflow:auto;white-space:pre-wrap;margin:0 0 14px"></pre>
    <div id="ev-detail"></div>
    <div class="side-label" style="margin:6px 0">历史成绩 · 点一行看每题明细 / 打人工分 / 设为基线</div>
    <div id="ev-hist" style="font-size:13px;color:var(--wb-text-3)">加载中…</div>`;
  document.getElementById("ev-start").onclick = async () => {
    const btn = document.getElementById("ev-start");
    if (!evalArm) {
      evalArm = true;
      btn.textContent = "确认开跑？真实计费 · 再点一次";
      btn.style.background = "var(--wb-err)";
      setTimeout(() => { if (evalArm && pageKind === "eval") { evalArm = false; btn.textContent = "开始评测"; btn.style.background = ""; } }, 6000);
      return;
    }
    evalArm = false; btn.textContent = "开始评测"; btn.style.background = "";
    const model = document.getElementById("ev-model").value;
    const judge = document.getElementById("ev-judge").value;
    const repeat = +document.getElementById("ev-repeat").value || 1;
    const body = { model, repeat };
    if (judge) body.judge = judge;
    const r = await fetch("/api/eval/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => null);
    if (!r || r.error) return toast("❌ " + ((r && r.error) || "启动失败"));
    toast("🧪 评测已开跑：" + model + (repeat > 1 ? `（每题 ${repeat} 次）` : "") + (judge ? "（评委 " + judge + "）" : ""));
    updateEvalView();
  };
  updateEvalView();
}
