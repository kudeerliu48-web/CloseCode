// ================= 工具函数 =================
// esc 函数在 app-01.js 里定义，这里需要一份（app-05.js 可能先加载）
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

// ================= 广场 Hub =================
async function renderHubMcp(box) {
  box.innerHTML = '<div class="hub-empty">加载中…</div>';
  const data = await fetch("/api/mcp").then(r => r.json()).catch(() => ({ servers: [], total_tools: 0 }));
  const list = data.servers
    .map((sv, i) => ({ sv, i }))
    .filter(({ sv }) => (!hubState.mine || sv.connected) && hubMatch(hubState.q, sv.name, sv.command, sv.url, (sv.args || []).join(" ")));
  // 原样存回去用的形状：远程的只回 name+url，请求头后端会沿用原来那份（GET 不回令牌）
  const isRemote = sv => sv.transport === "streamable-http" || (!sv.command && !!sv.url);
  const keep = sv => isRemote(sv)
    ? { name: sv.name, url: sv.url }
    : { name: sv.name, command: sv.command, args: sv.args, env: sv.env };
  // 插件声明的服务器归插件管：存回 config 会把它复制成一条我们自己的配置，卸载插件也删不掉了
  const ownServers = () => data.servers.filter(sv => !sv.plugin).map(keep);
  const save = async (servers) => {
    const msg = box.querySelector("#mcp-msg");
    if (msg) msg.textContent = "连接中…（npx 首次要下载包，最长约 1 分钟）";
    const resp = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ servers }) });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok) toast("❌ " + (d.error || "保存失败"));
    renderHubBody();
  };
  box.innerHTML = `
    <div class="hub-sec-title" style="margin-top:14px">已接入的外部工具
      <span class="sub">通过 MCP（本地 stdio / 远程 Streamable HTTP）给智能体接外部能力，当前 ${data.servers.length} 个服务器 · <b>${data.total_tools}</b> 个工具已注入，任务里可直接调用</span></div>
    <div class="card-grid">
      <div class="ex-card add" id="mcp-open-add">＋ 添加连接器</div>
      ${list.map(({ sv, i }) => `
        <div class="ex-card" data-mi="${i}">
          ${sv.plugin ? `<span class="flag">来自插件 ${esc(sv.plugin)}</span>` : ""}
          <div class="hd"><div class="av">${sv.connected ? "🔌" : "⚠️"}</div>
            <div class="nm"><span>${esc(sv.name)}</span><span class="al" style="color:var(${sv.connected ? "--wb-ok" : "--wb-err"})">${sv.connected ? `已连接 · ${sv.tools.length} 个工具` : "未连接"}</span></div></div>
          <div class="ds" style="font-family:var(--mono,ui-monospace,monospace);font-size: 12px;word-break:break-all">${isRemote(sv)
            ? `<b style="font-family:inherit;opacity:.6">远程 ·</b> ` + esc(sv.url) + ((sv.header_keys || []).length ? ` <span style="opacity:.7">（带 ${sv.header_keys.length} 个请求头：${esc(sv.header_keys.join("、"))}）</span>` : "")
            : `<b style="font-family:inherit;opacity:.6">本地 ·</b> ` + esc(sv.command) + " " + esc((sv.args || []).join(" "))}</div>
          <div class="tg">${sv.connected
            ? (sv.tools || []).slice(0, 8).map(t => `<i title="${esc(t.description || "")}">${esc(t.name)}</i>`).join("") + ((sv.tools || []).length > 8 ? `<i>…共 ${sv.tools.length} 个</i>` : "")
            : `<i style="color:var(--wb-err)">${esc(sv.error || "命令启动失败或握手超时，详见应用日志")}</i>`}</div>
          <div class="ops">${sv.plugin
            ? '<button disabled title="这条是插件声明的，要去「插件」页卸载整个插件">插件提供</button>'
            : '<button class="mcp-del">删除</button>'}</div>
        </div>`).join("")}
      ${list.length ? "" : `<div class="hub-empty">${hubState.mine ? "没有已连接的连接器" : "还没有连接器"}</div>`}
    </div>
    <div class="ex-editor" id="mcp-add-form" style="display:none">
      <div class="hub-sec-title">添加连接器
        <span class="sub">本地进程走 stdio；托管在别人服务器上的走 Streamable HTTP，填地址就行</span></div>
      <div class="row" style="gap:14px">
        <label style="display:flex;gap:5px;align-items:center;flex:none"><input type="radio" name="mcp-kind" value="stdio" checked style="width:auto">本地命令（stdio）</label>
        <label style="display:flex;gap:5px;align-items:center;flex:none"><input type="radio" name="mcp-kind" value="http" style="width:auto">远程地址（Streamable HTTP）</label>
      </div>
      <div class="row"><div style="flex:1 1 150px"><label>名称</label><input id="mcp-name" placeholder="filesystem"></div>
        <div class="mcp-f-stdio" style="flex:1 1 120px"><label>命令</label><input id="mcp-cmd" placeholder="npx"></div>
        <div class="mcp-f-stdio" style="flex:2 1 320px"><label>参数（空格分隔）</label><input id="mcp-args" placeholder="-y @modelcontextprotocol/server-filesystem /Users/你的用户名/Documents"></div>
        <div class="mcp-f-http" style="flex:2 1 320px;display:none"><label>地址</label><input id="mcp-url" placeholder="https://example.com/mcp"></div>
        <div class="mcp-f-http" style="flex:2 1 320px;display:none"><label>请求头（可选，每行 Key: Value）</label><input id="mcp-headers" placeholder="Authorization: Bearer 你的令牌"></div></div>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn-brand" id="mcp-add">添加并连接</button>
        <button id="mcp-cancel" style="padding:6px 14px">取消</button><span class="ab-empty" id="mcp-msg"></span></div>
    </div>`;
  const form = box.querySelector("#mcp-add-form");
  box.querySelector("#mcp-open-add").onclick = () => { form.style.display = ""; form.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
  box.querySelector("#mcp-cancel").onclick = () => { form.style.display = "none"; };
  box.querySelectorAll(".ex-card[data-mi]").forEach(card => {
    const sv = data.servers[+card.dataset.mi];
    const del = card.querySelector(".mcp-del");
    if (del) del.onclick = () => {
      if (!confirm(`删除连接器「${sv.name}」？`)) return;
      save(data.servers.filter(x => !x.plugin && x.name !== sv.name).map(keep));
    };
  });
  const kindOf = () => (box.querySelector('input[name="mcp-kind"]:checked') || {}).value || "stdio";
  box.querySelectorAll('input[name="mcp-kind"]').forEach(r => r.onchange = () => {
    const http = kindOf() === "http";
    box.querySelectorAll(".mcp-f-stdio").forEach(el => el.style.display = http ? "none" : "");
    box.querySelectorAll(".mcp-f-http").forEach(el => el.style.display = http ? "" : "none");
  });
  box.querySelector("#mcp-add").onclick = () => {
    const name = box.querySelector("#mcp-name").value.trim();
    if (!name) return toast("❌ 名称必填");
    if (kindOf() === "http") {
      const url = box.querySelector("#mcp-url").value.trim();
      if (!url) return toast("❌ 远程连接器要填地址");
      // 「Key: Value」按第一个冒号切，令牌里本身带冒号也不会被切坏
      const headers = {};
      box.querySelector("#mcp-headers").value.split(/[\n;]+/).map(s => s.trim()).filter(Boolean).forEach(line => {
        const at = line.indexOf(":");
        if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      });
      return save(ownServers().concat([{ name, url, headers }]));
    }
    const cmd = box.querySelector("#mcp-cmd").value.trim();
    const args = box.querySelector("#mcp-args").value.trim().split(/\s+/).filter(Boolean);
    if (!cmd) return toast("❌ 本地连接器要填命令");
    save(ownServers().concat([{ name, command: cmd, args, env: {} }]));
  };
}

// ================= 参考模板库（照着抄的提示词，点一下填进输入框） =================
// 每条都对应本地真实具备的能力（技能包 / 工具 / 专家团），不写做不到的画饼模板。
const PROMPT_TPLS = [
  { c: "网页", ic: "🖥️", t: "做一个工作台/仪表盘", d: "多卡片布局的单页应用，能直接双击打开",
    p: `做一个「__主题__工作台」单页网站：\n\n【内容】顶部标题栏 + 关键指标卡 4 个 + 主区域（__放什么__）+ 侧边__放什么__\n【数据】用我工作区里的 __文件名__；没有数据就先造 8 条像真的示例数据，并在页面上标注「示例数据」\n【技术】单文件 HTML，CSS/JS 全部内联，不依赖任何外部 CDN，断网也能打开\n【体验】移动端优先，深浅色都要好看；交互要有 hover/点击反馈\n\n做完把文件读回来自查一遍：有没有引用外部资源、有没有空的 onclick。` },
  { c: "网页", ic: "🎯", t: "做一个产品落地页", d: "首屏＋卖点＋FAQ＋行动召唤",
    p: `帮我做一个「__产品名__」的落地页（单文件 HTML）：\n\n首屏一句话说清「给谁解决什么问题」，别写形容词堆砌；\n三个核心卖点，每个配一句具体的场景说明（不要「高效」「智能」这种空词）；\n一段常见问题 FAQ（5 条）；\n底部行动召唤按钮。\n\n风格：__简洁克制 / 科技感 / 温暖__。CSS 内联，移动端优先。` },
  { c: "研究", ic: "🔍", t: "深度研究一个课题", d: "拆子问题→逐个查证→自我挑刺→带来源报告",
    p: `帮我深度研究「__课题__」：\n\n1) 先把它拆成 5 个以内的子问题，列出来给我看；\n2) 逐个联网检索并打开原文核对，不要只看搜索摘要；\n3) 写完初稿后自己找一轮反面证据，能推翻的结论就改掉；\n4) 输出研究报告：结论先行 → 论据 → 不确定的地方 → 来源清单（带链接和日期）。\n\n查不到的就写「未找到公开信息」，绝对不许编数字和来源。` },
  { c: "研究", ic: "⚖️", t: "竞品横向对比", d: "先定维度再逐条填表，出差异化建议",
    p: `帮我对比「__A__ / __B__ / __C__」：\n\n先定出 6-8 个对比维度（定价、目标用户、核心能力、部署方式、生态、短板…），列出来；\n逐条联网查证填表，每格标注信息来源和获取日期；查不到写「未公开」，不许推测；\n最后给：① 对比表 ② 各自最适合谁 ③ 如果我要做同类产品，切哪个缝隙。` },
  { c: "数据", ic: "📊", t: "数据文件变分析报告", d: "读数→算指标→画图→写结论",
    p: `读取工作区里的 __文件名__，做一份分析：\n\n1) 先告诉我这份数据有多少行、有哪些字段、有没有缺失或异常值；\n2) 算出这几个指标：__指标1__、__指标2__ 的环比/同比变化；\n3) 画 2-3 张图（趋势 + 构成），存成图片；\n4) 输出一份 Word 报告：结论写最前面，图表跟在对应结论后面。\n\n算不出来的指标直接说算不出来，别用估计值糊弄。` },
  { c: "数据", ic: "📈", t: "把结论做成图表", d: "指定图表类型，输出可直接用的图片",
    p: `把下面这组数据画成图：\n\n__粘贴数据__\n\n要求：__折线/柱状/饼图/散点__，中文标签不要乱码，坐标轴带单位，标题写结论不写「XX图」。\n生成图片存到工作区，并告诉我文件名。` },
  { c: "办公", ic: "🖼️", t: "材料整理成 PPT", d: "16:9，每页一个主题，标题写结论",
    p: `把 __工作区里的 XX 文件 / 下面这段内容__ 整理成一份 16:9 的 PPT：\n\n页数控制在 __10__ 页以内；\n每页一个主题，标题直接写结论（比如「获客成本降了 32%」而不是「获客成本分析」）；\n有数据的页配图表，没数据的页别硬凑图；\n最后一页是行动建议，具体到谁在什么时候做什么。` },
  { c: "办公", ic: "📝", t: "会议记录变纪要", d: "决议 / 待办 / 待议 三段式",
    p: `把下面这段会议记录整理成纪要：\n\n__粘贴记录__\n\n分三段：\n【结论与决议】已经拍板的事；\n【待办】谁 · 做什么 · 什么时候前完成（没说负责人就写「待认领」）；\n【待议】有争议或没结论的。\n\n原文里没说的一律不许补充推断。` },
  { c: "办公", ic: "🗓️", t: "写本周周报", d: "读工作区产出，自动汇总成周报",
    p: `帮我写这周的周报：\n\n先看看工作区里这周新增/修改了哪些文件，作为素材；\n补充这些我口述的进展：__…__\n\n格式：本周完成（带可验证的结果，不写「推进了」这种虚词）→ 下周计划 → 需要支持的事。\n控制在一页内。` },
  { c: "内容", ic: "✍️", t: "写一篇公众号文章", d: "先给选题角度再动笔",
    p: `写一篇关于「__主题__」的公众号文章：\n\n先给我 3 个不同的切入角度，我选一个你再动笔；\n目标读者是 __谁__，他们最关心 __什么__；\n开头 3 句话内必须让读者觉得「这说的是我」；\n中间要有具体的例子或数字，不要通篇讲道理；\n字数 __1500__ 字左右。` },
  { c: "内容", ic: "📮", t: "一条内容改成多平台版本", d: "同一个内核，不同平台的话术",
    p: `把下面这条内容改写成三个版本：\n\n__粘贴原文__\n\n① 公众号（正式、有结构、能读 3 分钟）\n② 小红书（口语、有情绪、带 emoji 和话题标签）\n③ 朋友圈（100 字内，一句话钩子）\n\n内核信息保持一致，别为了适配平台把事实改了。` },
  { c: "团队", ic: "👥", t: "整团派活（专家团接力）", d: "一句话把复杂任务交给一支团队",
    p: `请把下面这个任务整体委派给专家团「__团队名__」（用 delegate_to_team）：\n\n__任务描述，越具体越好：要什么、给谁看、什么格式、什么时候要__\n\n拿回结果后你自己核一遍：说生成的文件真的存在吗？数据有出处吗？没问题再交给我。` },
  { c: "团队", ic: "🧑‍💼", t: "指名派给某个专家", d: "点名让某位专家单独干",
    p: `请把这件事委派给专家「__专家名__」：\n\n__任务描述__\n\n它汇报完你要替我核一遍再转给我。` },
  { c: "自动化", ic: "⏰", t: "让它每天自动干一件事", d: "配合侧栏「自动化」建定时任务",
    p: `每天早上帮我做这件事（我待会去「自动化」里把它设成定时任务）：\n\n__要做什么__\n\n输出格式：__…__。如果当天没有值得说的变化，就明确回一句「今天无异常」，不要为了凑字数编内容。` },
];

function renderPromptPage() {
  const page = document.getElementById("assist-page");
  if (!page) return;
  const cats = ["全部", ...new Set(PROMPT_TPLS.map(t => t.c))];
  if (!renderPromptPage._cat) renderPromptPage._cat = "全部";
  const draw = () => {
    const cat = renderPromptPage._cat;
    const q = (page.querySelector("#tpl-q")?.value || "").trim().toLowerCase();
    const list = PROMPT_TPLS.filter(t =>
      (cat === "全部" || t.c === cat) &&
      (!q || (t.t + t.d + t.p).toLowerCase().includes(q)));
    page.querySelector("#tpl-grid").innerHTML = list.map((t, i) => `
      <div class="tpl-card${q && !(t.t + t.d).toLowerCase().includes(q) ? " open" : ""}" data-i="${PROMPT_TPLS.indexOf(t)}">
        <div class="hd"><span class="ic">${t.ic}</span><span class="tt">${esc(t.t)}</span><span class="ct">${esc(t.c)}</span><span class="chev">▶</span></div>
        <div class="dd">${esc(t.d)}</div>
        <pre>${esc(t.p)}</pre>
        <div class="ops"><button class="primary tpl-use">填进输入框</button><button class="tpl-copy">复制</button></div>
      </div>`).join("") || '<div class="hub-empty">没有匹配的模板</div>';
    page.querySelectorAll(".tpl-card").forEach(card => {
      const t = PROMPT_TPLS[+card.dataset.i];
      card.onclick = (e) => { if (e.target.closest("button")) return; card.classList.toggle("open"); };
      card.querySelector(".tpl-use").onclick = () => startTaskWith(t.p);
      card.querySelector(".tpl-copy").onclick = async (e) => {
        try { await navigator.clipboard.writeText(t.p); e.target.textContent = "已复制"; setTimeout(() => e.target.textContent = "复制", 1200); }
        catch { toast("❌ 复制失败，手动选中上面的文字吧"); }
      };
    });
  };
  page.innerHTML = `
    <div class="hub-head">
      <div class="hub-sec-title" style="margin:0">照着抄就行 <span class="sub">点卡片看全文；带 __下划线__ 的地方换成你的内容；「填进输入框」直接开一条新任务</span></div>
      <div class="hub-search" style="margin-left:auto"><input id="tpl-q" placeholder="搜模板…"></div>
    </div>
    <div class="hub-chips" style="margin:4px 0 14px">${cats.map(c =>
      `<span class="chip ${renderPromptPage._cat === c ? "active" : ""}" data-c="${esc(c)}">${esc(c)}</span>`).join("")}</div>
    <div class="tpl-grid" id="tpl-grid"></div>`;
  page.querySelectorAll(".chip[data-c]").forEach(c => c.onclick = () => {
    renderPromptPage._cat = c.dataset.c;
    page.querySelectorAll(".chip[data-c]").forEach(x => x.classList.toggle("active", x === c));
    draw();
  });
  page.querySelector("#tpl-q").oninput = draw;
  draw();
}

/**
 * 从广场里点「派活」/「填进输入框」：回到新任务并把提示词填进输入框。
 * 模板里的 __占位__ 直接选中第一个，用户接着打字就替换掉了；没有占位符就把光标放末尾。
 */
function startTaskWith(text, delegation) {
  document.getElementById("new-task").click();
  if (delegation) {
    setMode("craft");
    setPendingDelegation(delegation);
  }
  inputEl.value = text;
  inputEl.dispatchEvent(new Event("input"));   // 先让输入框按新内容撑高，否则下面的定位会被这次改高冲掉
  inputEl.focus();
  const m = /__[^_\n]*__/.exec(text);
  if (m) inputEl.setSelectionRange(m.index, m.index + m[0].length);
  else inputEl.setSelectionRange(text.length, text.length);
  // 长模板会把输入框滚到末尾，用户看不见开头。选区在开头就直接滚回顶部。
  inputEl.scrollTop = 0;
}

// ================= 定时任务（可视化，不写 cron） =================
function cronToHuman(cron) {
  const m = cron.match(/^(\d+) (\d+) (\S+) \* (\S+)$/);
  if (cron.startsWith("*/30")) return "每 30 分钟";
  if (m) {
    const time = `${m[2].padStart(2,"0")}:${m[1].padStart(2,"0")}`;
    if (m[3] === "*" && m[4] === "*") return `每天 ${time}`;
    if (m[4] === "1-5") return `工作日 ${time}`;
    if (m[3] === "*" && /^\d$/.test(m[4])) return `每周${"日一二三四五六"[+m[4]]} ${time}`;
    if (/^\d+$/.test(m[3])) return `每月 ${m[3]} 日 ${time}`;
  }
  if (/^(\d+) \* \* \* \*$/.test(cron)) return `每小时第 ${cron.split(" ")[0]} 分`;
  return cron;
}

// ================= 设置中心 =================
const SETTING_CATS = [
  ["models", "模型设置", "models"],
  ["usage", "Token 用量", "context"],
  ["skills", "技能管理", "skills"],
  ["agent", "智能体设置", "agent"],
  ["context", "上下文设置", "context"],
  ["persona", "个性化", "persona"],
  ["pet", "桌面宠物", "pet"],
  ["data", "数据管理", "data"],
];
function updateSettingsRange(slider) {
  const min = Number(slider.min), max = Number(slider.max);
  const progress = max > min ? (Number(slider.value) - min) / (max - min) * 100 : 0;
  slider.style.setProperty('--range-progress', `${Math.min(100, Math.max(0, progress)).toFixed(4)}%`);
}
async function renderSettings(active) {
  const settingsForm = mBody.querySelector("[data-autosave]");
  if (settingsForm?.flushAutosave && !await settingsForm.flushAutosave()) return;
  const s = await fetch("/api/settings").then(r => r.json());

  mBody.innerHTML = `<div class="settings-layout">
    <div class="settings-nav">${SETTING_CATS.map(([k, label, icon]) =>
      `<button type="button" class="cat ${k === active ? "active" : ""}" data-cat="${k}" ${k === active ? 'aria-current="page"' : ""}>
        <span class="cat-icon">${uiIcon(icon)}</span>
        <span class="cat-label">${label}</span>
      </button>`).join("")}</div>
    <div class="settings-pane" id="settings-pane"></div>
  </div>`;
  mBody.querySelector(".settings-nav").addEventListener("click", (e) => {
    const cat = e.target.closest(".cat");
    if (cat) renderSettings(cat.dataset.cat);
  });
  const pane = mBody.querySelector("#settings-pane");
  if (active === "models") renderModelsPane(pane, s);
  else if (active === "usage") renderUsagePane(pane);
  else if (active === "skills") renderSkillsPane(pane, s);
  else if (active === "agent") renderAgentPane(pane, s);
  else if (active === "context") renderContextPane(pane, s);
  else if (active === "persona") renderPersonaPane(pane, s);
  else if (active === "pet") renderPetPane(pane, s);
  else if (active === "data") renderDataPane(pane, s);
  else renderAgentPane(pane, s);
}
async function renderUsagePane(pane) {
  const empty = { prompt: 0, completion: 0, cached: 0, calls: 0 };
  const stats = await fetch("/api/token-stats").then(r => r.ok ? r.json() : null).catch(() => null);
  const daily = stats?.daily || empty;
  const total = stats?.total || empty;
  const card = (title, value) => `<div class="usage-cell"><div class="n">${value.toLocaleString()}</div><div class="l">${title}</div></div>`;
  pane.innerHTML = `<div class="card-item"><div class="t">今日 Token 用量</div><div class="usage-grid">${card("输入", daily.prompt)}${card("输出", daily.completion)}${card("缓存", daily.cached)}${card("请求次数", daily.calls)}</div></div><div class="card-item"><div class="t">累计 Token 用量</div><div class="usage-grid">${card("输入", total.prompt)}${card("输出", total.completion)}${card("缓存", total.cached)}${card("请求次数", total.calls)}</div></div>`;
}
async function saveSettings(patch, msgEl, { quiet = false } = {}) {
  const resp = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const data = await resp.json().catch(() => ({}));
  // workspace_skipped：有任务在跑，工作目录这一项没改（其余照存）。不提示的话用户会以为已经切过去了
  // 移除绿色提示语，改用 toast 提示
  if (msgEl) msgEl.textContent = resp.ok ? (data.workspace_skipped ? data.workspace_skipped : "") : (data.error || "保存失败");
  if (resp.ok) {
    await refreshSettingsCache();
    if (!quiet && typeof toast === 'function' && !data.workspace_skipped) {
      toast("✓ 已保存并生效");
    }
  }
  return resp.ok;
}
// 常见模型服务商地址预设；也可在输入框中填自定义地址。
const CHANNEL_PRESETS = [
  { label: "OpenAI", base: "https://api.openai.com/v1" },
  { label: "Anthropic Claude", base: "https://api.anthropic.com" },
  { label: "DeepSeek", base: "https://api.deepseek.com/v1" },
  { label: "通义 Qwen", base: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { label: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4" },
  { label: "Kimi", base: "https://api.moonshot.cn/v1" },
  { label: "Ollama 本地", base: "http://localhost:11434/v1" },
  { label: "DoCode", base: "https://docode.cc/v1" },
];
function renderModelsPane(pane, s) {
  const md = { image: {}, vision: {}, ...(s.media || {}) };
  // 生图模型独立于普通对话模型：当前对话继续使用 GPT/Claude/Gemini/Grok/国模，生图任务才调用 image 配置；视觉模型继续保留为独立能力。
  const providers = ['gpt', 'claude', 'grok', 'gemini', 'custom', 'vision', 'image'];
  const providerNames = { gpt: 'GPT', claude: 'Claude', grok: 'Grok', gemini: 'Gemini', custom: '国模', vision: '视觉', image: '生图' };
  const disabledProviders = s.disabled_providers || []; // 禁用的供应商列表
  const currentProvider = providers.includes(s.active_provider) ? s.active_provider : 'gpt';
  const image = md.image || {};
  const vision = md.vision || {};
  const isImageProvider = currentProvider === 'image';
  const isVisionProvider = currentProvider === 'vision';
  const mediaConfig = isImageProvider ? image : vision;
  const availableModels = (isImageProvider || isVisionProvider) ? (mediaConfig.models || []) : (s[`available_${currentProvider}_models`] || []);
  const selectedModel = (isImageProvider || isVisionProvider) ? (mediaConfig.model || '') : (s[`${currentProvider}_model`] || '');
  const currentApiKey = (isImageProvider || isVisionProvider) ? (mediaConfig.api_key || '') : (s[`${currentProvider}_api_key`] || '');
  const currentBaseUrl = (isImageProvider || isVisionProvider) ? (mediaConfig.base_url || 'https://docode.cc/v1') : (s[`${currentProvider}_base_url`] || 'https://docode.cc/v1');
  const isCurrentDisabled = isImageProvider || isVisionProvider ? false : disabledProviders.includes(currentProvider);

  pane.innerHTML = `
    <div class="card-item model-config-card" style="border:1px solid rgba(91,95,247,0.2);border-radius:14px;background:var(--wb-bg);box-shadow:0 4px 20px rgba(0,0,0,0.04);">
      <div class="t" style="margin-bottom:10px;font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">
        ${uiIcon("agent")} 选择 AI 模型供应商
      </div>
      <div class="provider-tab-group">
        ${providers.map(p => {
          const isDisabled = disabledProviders.includes(p);
          return `
          <button class="provider-tab ${p === currentProvider ? 'active' : ''} ${isDisabled ? 'disabled' : ''}" data-provider="${p}" type="button">
            <span class="provider-tab-mark">${providerIcon(p)}</span>
            <span>${providerNames[p]}</span>
            ${isDisabled ? '<span class="disabled-badge">已禁用</span>' : ''}
          </button>
        `;
        }).join('')}
      </div>
      ${isCurrentDisabled ? `<div class="model-disabled-notice">${uiIcon('warning', 'sm')} 当前供应商已被禁用，不会出现在对话页面的模型选择中</div>` : ''}


      <div class="t" style="margin-top:16px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px">
        请求地址
      </div>
      <div class="key-input-row" style="margin-top:6px">
        <div class="settings-select-wrap" style="flex:0 0 190px">
          <select id="mf-base-preset" class="settings-select" aria-label="请求地址预设">
            <option value="">选择常见服务商</option>
            ${CHANNEL_PRESETS.map(p => `<option value="${esc(p.base)}" ${p.base.replace(/\/+$/, "") === currentBaseUrl.replace(/\/+$/, "") ? "selected" : ""}>${esc(p.label)}</option>`).join("")}
            <option value="__custom__">自定义地址</option>
          </select>
        </div>
        <input id="mf-base-url" class="ui-input" type="url" inputmode="url" autocomplete="url" aria-label="模型请求地址" placeholder="https://api.example.com/v1" value="${esc(currentBaseUrl)}" style="height:38px;border-radius:9px;flex:1;min-width:0">
      </div>
      <div class="model-status-tip">拉取、保存和测试都会使用此地址；本地模型可填写 http://localhost:11434/v1。</div>

      <div class="t" style="margin-top:16px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px">
        ${uiIcon("key")} API Key 密钥 <span style="font-weight:normal;color:var(--wb-text-3);font-size:12px">(${providerNames[currentProvider]})</span>
      </div>
      <div class="key-input-row" style="margin-top:6px">
        <div class="key-field-wrap">
          <input id="mf-key" class="ui-input" type="password" placeholder="请输入 ${providerNames[currentProvider]} API Key" value="${esc(currentApiKey)}" style="height:38px;border-radius:9px;">
          <button class="key-toggle-btn" id="mf-key-toggle" type="button" title="显示/隐藏 Key">
            <svg class="i key-icon-show" style="width:16px;height:16px"><use href="#i-eye"></use></svg>
            <svg class="i key-icon-hide" style="width:16px;height:16px;display:none"><use href="#i-eye-off"></use></svg>
          </button>
        </div>
        <button class="settings-action-btn secondary" id="mf-refresh" type="button" style="height:38px;">
          <svg class="i" style="width:14px;height:14px" aria-hidden="true"><use href="#i-sparkles"></use></svg>
          <span>${isImageProvider ? '拉取生图模型' : '拉取模型'}</span>
        </button>
      </div>
      <div id="mf-status" class="model-status-tip"></div>

      <div class="t" style="margin-top:14px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px">
        ${uiIcon("settings")} ${isImageProvider ? '当前生图模型' : '当前调用模型'} <span style="color:var(--wb-text-3);font-size:12px;font-weight:normal">(${availableModels.length} 个可用)</span>
      </div>
      ${availableModels.length > 0 ? `
        <div class="model-select-wrap settings-select-wrap">
          <select id="mf-model" class="settings-select" aria-label="当前调用模型">
            ${availableModels.map(m => `<option value="${esc(m)}" ${m === selectedModel ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
        </div>
      ` : '<div class="model-empty-tip">暂无可用模型列表，请在上方输入 API Key 后点击「拉取模型」</div>'}

      <div class="model-footer-actions">
        <a class="settings-action-btn secondary" id="mf-get-key" href="https://docode.cc/register?aff=OVJT" target="_blank" rel="noopener noreferrer" style="height:38px;">
          <svg class="i" style="width:14px;height:14px"><use href="#i-external-link"></use></svg>
          <span>获取 Key</span>
        </a>
        ${availableModels.length > 0 ? `
        <button class="settings-action-btn" id="mf-model-test" type="button" style="height:38px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;border:none;">
          <svg class="i" style="width:14px;height:14px"><use href="#i-circle-check"></use></svg>
          <span>模型测试</span>
        </button>
        ` : ''}
        <div class="model-footer-right">
          ${isImageProvider ? '' : `<button class="settings-action-btn ${isCurrentDisabled ? 'success' : 'warning'}" id="mf-toggle-enable" type="button" style="height:38px;min-width:100px;padding:0 16px;display:flex;align-items:center;justify-content:center;">
            <span>${isCurrentDisabled ? '启用渠道' : '禁用渠道'}</span>
          </button>`}
          <span class="ok-msg" id="models-msg"></span>
          <button class="settings-action-btn primary" id="mf-save" type="button" style="height:38px;min-width:100px;">保存配置</button>
        </div>
      </div>
    </div>

    <style>
      .settings-pane:has(.model-config-card) {
        overflow-y: auto;
      }
      .model-config-card {
        padding: 18px 20px;
        margin-bottom: 0;
      }
      .model-welfare-notice {
        margin-top: 16px;
        padding: 16px;
        border: 1px solid var(--wb-border);
        border-radius: 12px;
        background: var(--wb-brand-weak);
      }
      .model-welfare-notice .t { display: flex; align-items: center; gap: 8px; }
      .model-welfare-notice p { margin: 8px 0 0; color: var(--wb-text-2); font-size: 13px; line-height: 1.8; }
      .provider-tab-group {
        display: flex;
        gap: 8px;
        margin-bottom: 2px;
        width: 100%;
      }
      .provider-tab {
        flex: 1;
        min-width: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 38px;
        padding: 0 5px;
        border: 1px solid var(--wb-border);
        border-radius: 9px;
        background: var(--wb-bg-1);
        color: var(--wb-text);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: none;
        white-space: nowrap;
      }
      .provider-tab:hover {
        background: var(--wb-bg-hover);
        border-color: var(--wb-brand);
        transform: translateY(-1.5px);
      }
      .provider-tab.active {
        background: var(--wb-brand);
        color: #ffffff;
        border-color: var(--wb-brand);
        box-shadow: 0 4px 12px rgba(91, 95, 247, 0.35);
        transform: translateY(-1px);
      }
      .provider-tab-mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 18px;
        width: 18px;
        height: 18px;
        color: currentColor;
      }
      .provider-tab-mark .model-provider-eye {
        display: block;
        width: 18px;
        height: 18px;
        color: currentColor;
        stroke: currentColor;
      }
      .provider-tab.active .provider-tab-mark .model-provider-eye {
        color: initial;
      }
      .provider-tab-mark .model-provider-eye .vision-eye-outline {
        stroke: url(#vision-eye-gradient);
      }
      .provider-tab-mark .model-provider-eye .vision-eye-pupil {
        fill: #a78bfa;
        stroke: #38bdf8;
      }
      .provider-tab-mark .ui-icon,
      .provider-tab-mark .model-provider-icon {
        width: 18px;
        height: 18px;
        object-fit: contain;
      }
      .provider-tab.disabled {
        opacity: 0.5;
        background: var(--wb-bg-side);
        cursor: default;
        position: relative;
      }
      .provider-tab.disabled:hover {
        transform: none;
        border-color: var(--wb-border);
        background: var(--wb-bg-side);
      }
      .disabled-badge {
        position: absolute;
        top: -6px;
        right: -6px;
        font-size: 10px;
        padding: 2px 6px;
        background: var(--wb-warn);
        color: #fff;
        border-radius: 4px;
        font-weight: 600;
        white-space: nowrap;
      }
      .model-disabled-notice {
        margin-top: 10px;
        padding: 10px 14px;
        background: rgba(255, 152, 0, 0.1);
        border: 1px solid var(--wb-warn);
        border-radius: 9px;
        color: var(--wb-warn);
        font-size: 13px;
        font-weight: 500;
      }
      #mf-refresh {
        border: 1px solid color-mix(in srgb, var(--wb-brand) 58%, #26306f);
        background: linear-gradient(180deg, color-mix(in srgb, var(--wb-brand) 14%, var(--wb-bg)), color-mix(in srgb, var(--wb-brand) 5%, var(--wb-bg)));
        box-shadow: inset 0 1px 0 rgba(255,255,255,.72), 0 2px 0 color-mix(in srgb, var(--wb-brand) 38%, #26306f), 0 4px 8px rgba(42,48,120,.14);
        transform: translateY(-1px);
        transition: transform .12s ease, box-shadow .12s ease, filter .18s ease;
      }
      #mf-refresh:hover { filter: brightness(1.04); transform: translateY(-2px); }
      #mf-refresh:active:not(:disabled) { transform: translateY(1px); box-shadow: inset 0 1px 2px rgba(30,35,90,.16), 0 1px 0 color-mix(in srgb, var(--wb-brand) 38%, #26306f); }
      html[data-theme="dark"] #mf-refresh { box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 2px 0 rgba(20,22,62,.9), 0 4px 9px rgba(0,0,0,.25); }
      .settings-action-btn.warning {
        background: var(--wb-warn);
        color: #fff;
        border: none;
      }
      .settings-action-btn.warning:hover {
        opacity: 0.9;
      }
      .settings-action-btn.success {
        background: var(--wb-ok);
        color: #fff;
        border: none;
      }
      .settings-action-btn.success:hover {
        opacity: 0.9;
      }
      .key-input-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .key-field-wrap {
        position: relative;
        flex: 1;
        display: flex;
        align-items: center;
      }
      .key-field-wrap input {
        width: 100%;
        padding-right: 36px;
        margin-bottom: 0;
      }
      .key-toggle-btn {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        background: transparent;
        border: none;
        padding: 4px;
        color: var(--wb-text-3);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: color 0.15s ease;
      }
      .key-toggle-btn:hover {
        color: var(--wb-text);
      }
      .model-status-tip {
        font-size: 12px;
        min-height: 16px;
        margin-top: 4px;
        color: var(--wb-text-3);
      }
      .model-select-wrap {
        margin-top: 6px;
        margin-bottom: 8px;
      }
      .model-empty-tip {
        color: var(--wb-text-3);
        font-size: 12.5px;
        padding: 10px 14px;
        background: var(--wb-bg-1);
        border: 1px dashed var(--wb-border);
        border-radius: 9px;
        margin-top: 6px;
        margin-bottom: 8px;
      }
      .model-footer-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px solid var(--wb-border);
      }
      .model-footer-right {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      @media (max-width: 640px) {
        .provider-tab-group { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
        .provider-tab { height: 40px; padding: 0 4px; font-size: 11px; }
        .provider-tab-mark { flex-basis: 16px; width: 16px; height: 16px; }
        .provider-tab-mark .model-provider-eye,
        .provider-tab-mark .ui-icon,
        .provider-tab-mark .model-provider-icon { width: 16px; height: 16px; }
        .model-footer-actions { flex-wrap: wrap; gap: 8px; }
        .model-footer-right { width: 100%; flex-wrap: wrap; gap: 8px; }
        .model-footer-right .ok-msg:empty { display: none; }
        .model-footer-actions > .settings-action-btn,
        .model-footer-right > .settings-action-btn { flex: 1; }
      }
    </style>
  `;

  const msg = pane.querySelector("#models-msg");
  const status = pane.querySelector("#mf-status");
  const baseUrlInput = pane.querySelector("#mf-base-url");
  const basePreset = pane.querySelector("#mf-base-preset");
  const readBaseUrl = () => String(baseUrlInput?.value || "").trim();
  basePreset?.addEventListener("change", () => {
    if (basePreset.value && basePreset.value !== "__custom__") baseUrlInput.value = basePreset.value;
  });

  // 密码显示/隐藏切换
  const keyInput = pane.querySelector("#mf-key");
  const keyToggle = pane.querySelector("#mf-key-toggle");
  if (keyInput && keyToggle) {
    keyToggle.onclick = () => {
      const isPassword = keyInput.type === "password";
      keyInput.type = isPassword ? "text" : "password";
      const showIcon = keyToggle.querySelector(".key-icon-show");
      const hideIcon = keyToggle.querySelector(".key-icon-hide");
      if (showIcon && hideIcon) {
        showIcon.style.display = isPassword ? "none" : "block";
        hideIcon.style.display = isPassword ? "block" : "none";
      }
    };
  }

  // 切换供应商；视觉/生图只在本页配置，不改变当前对话模型。
  pane.querySelectorAll(".provider-tab").forEach(btn => {
    btn.onclick = () => {
      const next = btn.dataset.provider;
      if (next === "image" || next === "vision") {
        renderModelsPane(pane, { ...s, active_provider: next });
        return;
      }
      saveSettings({ active_provider: next }, msg).then(() => {
        renderModelsPane(pane, { ...s, active_provider: next });
      });
    };
  });

  // 视觉配置独立保存，不加入聊天模型列表，也不改变当前对话模型。
  if (isVisionProvider) {
    const clearVision = document.createElement("button");
    clearVision.type = "button";
    clearVision.className = "settings-action-btn secondary";
    clearVision.textContent = "清除视觉配置";
    clearVision.onclick = async () => {
      const cleared = { base_url: "", api_key: "", model: "", models: [] };
      if (await saveSettings({ media: { vision: cleared } }, msg)) renderModelsPane(pane, { ...s, media: { ...md, vision: cleared } });
    };
    pane.querySelector(".model-footer-right")?.prepend(clearVision);
  }

  // 拉取模型列表
  const refreshBtn = pane.querySelector("#mf-refresh");
  if (refreshBtn) {
    refreshBtn.onclick = async (e) => {
      const apiKey = pane.querySelector("#mf-key").value.trim();
      const baseUrl = readBaseUrl();
      if (!baseUrl) return toast("请先填写模型请求地址");
      if (!apiKey) return toast("请先输入 API Key");

      e.target.disabled = true;
      status.textContent = "拉取中...";

      try {
        const resp = await fetch("/api/models/fetch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: apiKey,
            base_url: baseUrl,
            provider: currentProvider,
            purpose: isImageProvider ? "image" : "chat",
          }),
        });

        const data = await resp.json();

        if (!resp.ok) {
          throw new Error(data.error || `HTTP ${resp.status}`);
        }

        const models = data.models || [];
        if (models.length === 0) {
          throw new Error("模型列表为空");
        }

        if (isImageProvider || isVisionProvider) {
          // 媒体模型只更新本页草稿，保存后才会成为独立配置。
          const mediaKey = isImageProvider ? "image" : "vision";
          renderModelsPane(pane, { ...s, media: { ...md, [mediaKey]: { ...mediaConfig, models, model: models.includes(mediaConfig.model) ? mediaConfig.model : models[0], api_key: apiKey, base_url: baseUrl } } });
          return;
        }

        // 保存到设置
        const updates = {
          [`available_${currentProvider}_models`]: models,
          [`${currentProvider}_model`]: models[0],
          [`${currentProvider}_api_key`]: apiKey,
        };

        await saveSettings(updates, msg);
        status.textContent = `✓ 已加载 ${models.length} 个模型`;

        // 重新渲染以显示模型选择器
        renderModelsPane(pane, { ...s, ...updates });
      } catch (err) {
        status.textContent = `✗ 拉取失败: ${err.message}`;
        e.target.disabled = false;
      }
    };
  } else {
    console.error("找不到拉取模型按钮 #mf-refresh");
  }

  // 启用/禁用当前供应商
  const toggleEnableBtn = pane.querySelector("#mf-toggle-enable");
  if (toggleEnableBtn) {
    toggleEnableBtn.onclick = async () => {
      const disabledProviders = s.disabled_providers || [];
      let newDisabledProviders;

      if (isCurrentDisabled) {
        // 启用：从禁用列表中移除
        newDisabledProviders = disabledProviders.filter(p => p !== currentProvider);
        toast(`✓ 已启用 ${providerNames[currentProvider]}，将出现在模型选择中`);
      } else {
        // 禁用：添加到禁用列表
        newDisabledProviders = [...disabledProviders, currentProvider];
        toast(`✓ 已禁用 ${providerNames[currentProvider]}，不会出现在模型选择中`);
      }

      await saveSettings({ disabled_providers: newDisabledProviders }, msg);
      // 重新渲染以更新UI
      const updatedSettings = await fetch("/api/settings").then(r => r.json());
      renderModelsPane(pane, updatedSettings);
    };
  }

  // 保存配置
  pane.querySelector("#mf-save").onclick = async () => {
    const apiKey = pane.querySelector("#mf-key").value.trim();
    const baseUrl = readBaseUrl();

    if (!baseUrl) return toast("请填写模型请求地址");
    if (!apiKey) return toast("API Key 必填");

    const modelSelect = pane.querySelector("#mf-model");
    const selectedModel = modelSelect ? modelSelect.value : availableModels[0] || '';

    if (!selectedModel) {
      return toast("请先拉取模型列表");
    }

    if (isImageProvider || isVisionProvider) {
      const mediaKey = isImageProvider ? "image" : "vision";
      await saveSettings({ media: { [mediaKey]: { base_url: baseUrl, api_key: apiKey, model: selectedModel, models: availableModels } } }, msg);
      return;
    }

    // 将当前供应商拉取到的全部模型写入统一模型列表。
    // 发送按钮旁的模型菜单读取的是 config.models，而不是 available_*_models。
    const providerLabel = providerNames[currentProvider];
    const fetchedModels = [...new Set(availableModels.map(m => String(m).trim()).filter(Boolean))];
    const entries = fetchedModels.map(model => ({
      name: `${providerLabel} - ${model}`,
      provider: currentProvider === "claude" ? "anthropic" : "openai",
      model,
      base_url: baseUrl,
      api_key: apiKey,
    }));
    const selectedEntry = entries.find(m => m.model === selectedModel) || entries[0];
    if (!selectedEntry) {
      return toast("请先拉取模型列表");
    }

    // 当前供应商的旧缓存以本次拉取结果为准，其他供应商/手动配置的模型继续保留。
    const providerPrefix = `${providerLabel} - `;
    const keptModels = (Array.isArray(s.models) ? s.models : []).filter(m => !String(m.name || "").startsWith(providerPrefix));
    const mergedModels = new Map(keptModels.map(m => [m.name, m]));
    entries.forEach(entry => mergedModels.set(entry.name, entry));
    const models = Array.from(mergedModels.values());

    const updates = {
      models,
      active_model: selectedEntry.name,
      [`${currentProvider}_api_key`]: apiKey,
      [`${currentProvider}_model`]: selectedModel,
      [`${currentProvider}_base_url`]: baseUrl,
      [`available_${currentProvider}_models`]: availableModels,
    };

    await saveSettings(updates, msg);

    // 保存到当前项目的 localStorage 缓存
    if (typeof activeProject !== 'undefined' && activeProject) {
      localStorage.setItem(`project_model_${activeProject}`, selectedEntry.name);
    }

    toast("✓ 已保存并生效");
  };

  // 网络检测
  // 模型测试
  const modelTestBtn = pane.querySelector("#mf-model-test");
  if (modelTestBtn) {
    modelTestBtn.onclick = () => {
      const apiKey = pane.querySelector("#mf-key").value.trim();
      const baseUrl = readBaseUrl();

      if (!baseUrl) return toast("请填写模型请求地址");
      if (!apiKey) return toast("请先输入 API Key");
      if (availableModels.length === 0) return toast("请先拉取模型列表");

      // 创建模型测试弹窗
      showModelTestDialog(availableModels, apiKey, baseUrl, currentProvider);
    };
  }
}

// 模型测试弹窗
const TEST_TIMEOUT_MS = 30000; // 单个模型最长等待时间：卡住的渠道不能把整轮测试拖死
function showModelTestDialog(models, apiKey, baseUrl, provider) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';

  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--wb-card);border-radius:16px;width:90%;max-width:600px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);border:1px solid var(--wb-border);overflow:hidden;';

  dialog.innerHTML = `
    <style>
      .mt-item { display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid var(--wb-border);border-radius:12px;cursor:pointer;transition:border-color .2s,background .2s;background:var(--wb-bg); }
      .mt-item:hover { border-color:var(--wb-brand);background:var(--wb-bg-hover); }
      .mt-item input { width:18px;height:18px;cursor:pointer;accent-color:var(--wb-brand);flex:0 0 auto; }
      .mt-list.busy .mt-item { cursor:default; }
      .mt-list.busy .mt-item:hover { border-color:var(--wb-border);background:var(--wb-bg); }
      .mt-list.busy .mt-item input { cursor:not-allowed; }
      .mt-btn { padding:10px 24px;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;transition:background .2s,transform .2s,box-shadow .2s,opacity .2s; }
      .mt-btn-ghost { border:1px solid var(--wb-border);background:var(--wb-card);color:var(--wb-text); }
      .mt-btn-ghost:hover { background:var(--wb-bg-hover); }
      .mt-btn-primary { border:none;background:var(--wb-brand-grad);color:#fff; }
      .mt-btn-primary:hover:not(:disabled) { transform:translateY(-1px);box-shadow:var(--wb-shadow-md,0 4px 12px rgba(91,95,247,.4)); }
      .mt-btn:disabled { opacity:.55;cursor:not-allowed;pointer-events:none;transform:none;box-shadow:none; }
    </style>
    <div style="padding:24px;border-bottom:1px solid var(--wb-border);background:var(--wb-bg-side);">
      <h3 style="margin:0;font-size:18px;font-weight:600;color:var(--wb-text);">模型测试</h3>
      <p style="margin:8px 0 0;font-size:13px;color:var(--wb-text-2);">选择要测试的模型，将向每个模型发送 "hi" 消息，测量首字响应时间（单个模型最长等待 ${TEST_TIMEOUT_MS / 1000} 秒）</p>
    </div>
    <div style="padding:20px;overflow-y:auto;flex:1;background:var(--wb-card);">
      <div id="model-test-list" class="mt-list" style="display:flex;flex-direction:column;gap:10px;">
        ${models.map((model, i) => `
          <label class="mt-item">
            <input type="checkbox" value="${esc(model)}" checked>
            <span style="flex:1;min-width:0;font-size:14px;color:var(--wb-text);font-weight:500;word-break:break-all;">${esc(model)}</span>
            <span class="test-status" style="font-size:13px;color:var(--wb-text-2);min-width:104px;text-align:right;flex:0 0 auto;">待测试</span>
          </label>
        `).join('')}
      </div>
    </div>
    <div style="padding:20px 24px;border-top:1px solid var(--wb-border);display:flex;gap:12px;justify-content:flex-end;background:var(--wb-bg-side);">
      <button id="model-test-cancel" type="button" class="mt-btn mt-btn-ghost">取消</button>
      <button id="model-test-retry" type="button" class="mt-btn mt-btn-ghost" hidden>重新测试</button>
      <button id="model-test-start" type="button" class="mt-btn mt-btn-primary">开始测试</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // 关闭弹窗
  let testing = false;
  let closed = false;
  let completed = false;
  let activeController = null;
  let activeReader = null;
  const closeDialog = () => {
    closed = true;
    activeController?.abort();
    activeReader?.cancel().catch(() => {});
    overlay.remove();
  };
  overlay.onclick = (e) => { if (e.target === overlay) closeDialog(); };
  dialog.querySelector('#model-test-cancel').onclick = closeDialog;

  const listEl = dialog.querySelector('#model-test-list');
  const startBtn = dialog.querySelector('#model-test-start');
  const cancelBtn = dialog.querySelector('#model-test-cancel');

  const retryBtn = dialog.querySelector('#model-test-retry');
  startBtn.onclick = () => completed ? closeDialog() : runTests();
  retryBtn.onclick = () => runTests();

  // 每个弹窗独立持有请求；关闭后所有异步结果均失效。
  async function runTests() {
    if (testing || closed) return;
    const checkedBoxes = [...dialog.querySelectorAll('input[type="checkbox"]:checked')];
    if (checkedBoxes.length === 0) return toast("请至少选择一个模型");

    // 运行中保留取消入口，只锁定启动与模型选择。
    testing = true;
    completed = false;
    retryBtn.hidden = true;
    startBtn.disabled = true;
    cancelBtn.textContent = '取消测试';
    startBtn.textContent = '测试中...';
    listEl.classList.add('busy');
    for (const cb of dialog.querySelectorAll('input[type="checkbox"]')) cb.disabled = true;

    // 未被选中的行重置回待测试，避免上一轮的旧成绩留在界面上造成误读
    for (const cb of dialog.querySelectorAll('input[type="checkbox"]:not(:checked)')) {
      const s = cb.parentElement.querySelector('.test-status');
      s.textContent = '待测试';
      s.style.color = 'var(--wb-text-2)';
    }

    let done = 0;
    for (const checkbox of checkedBoxes) {
      if (closed) return;
      const modelName = checkbox.value;
      const statusSpan = checkbox.parentElement.querySelector('.test-status');
      statusSpan.removeAttribute('title');
      statusSpan.textContent = '测试中...';
      statusSpan.style.color = 'var(--wb-brand)';
      startBtn.textContent = `测试中 ${++done}/${checkedBoxes.length}`;

      const startTime = Date.now();
      const controller = new AbortController();
      activeController = controller;
      const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
      let reader = null;
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            sessionId: 'model-test-' + Date.now(),
            message: 'hi',
            mode: 'ask',
            testMode: true,
            testConfig: {
              provider: provider || 'openai',
              model: modelName,
              base_url: baseUrl,
              api_key: apiKey,
            }
          }),
        });

        if (closed || controller.signal.aborted) {
          response.body?.cancel().catch(() => {});
          if (closed) return;
          throw new DOMException('Timed out', 'AbortError');
        }
        if (!response.ok) {
          statusSpan.textContent = `失败 (${response.status})`;
          statusSpan.style.color = 'var(--wb-err)';
          continue;
        }

        // 读取流式响应，解析 SSE 事件：只有真正的文本增量才算首字，error 事件按失败计
        reader = response.body.getReader();
        activeReader = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        let firstTokenMs = null;
        let errMsg = null;

        outer: while (true) {
          const { done: streamDone, value } = await reader.read();
          if (closed) return;
          if (controller.signal.aborted) throw new DOMException('Timed out', 'AbortError');
          if (streamDone) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            let evt;
            try { evt = JSON.parse(trimmed.slice(6)); } catch { continue; }

            if (evt.type === 'error') { errMsg = evt.message || '未知错误'; break outer; }
            if (evt.type === 'text' && evt.text) { firstTokenMs = Date.now() - startTime; break outer; }
            if (evt.type === 'done') break outer;
          }
        }

        if (errMsg) {
          statusSpan.textContent = '失败';
          statusSpan.title = errMsg;
          statusSpan.style.color = 'var(--wb-err)';
        } else if (firstTokenMs != null) {
          statusSpan.textContent = `✓ ${firstTokenMs}ms`;
          statusSpan.style.color = 'var(--wb-ok)';
        } else {
          statusSpan.textContent = `无响应 (${Date.now() - startTime}ms)`;
          statusSpan.style.color = 'var(--wb-warn)';
        }
      } catch (err) {
        if (closed) return;
        if (err.name === 'AbortError') {
          statusSpan.textContent = `超时 (>${TEST_TIMEOUT_MS / 1000}s)`;
          statusSpan.style.color = 'var(--wb-warn)';
        } else {
          statusSpan.textContent = '错误';
          statusSpan.title = err.message;
          statusSpan.style.color = 'var(--wb-err)';
        }
      } finally {
        clearTimeout(timer);
        if (reader) reader.cancel().catch(() => {}); // 拿到首字就断开，不等模型说完
        controller.abort();
        activeController = null;
        activeReader = null;
      }
    }

    if (closed) return;
    testing = false;
    completed = true;
    listEl.classList.remove('busy');
    for (const cb of dialog.querySelectorAll('input[type="checkbox"]')) cb.disabled = false;
    cancelBtn.textContent = '关闭';
    retryBtn.hidden = false;
    startBtn.disabled = false;
    startBtn.textContent = '测试完成';
  }
}

// 技能管理面板
async function renderSkillsPane(pane, s) {
  pane.innerHTML = '<div style="padding:40px;text-align:center;color:var(--wb-text-3);">加载中...</div>';

  try {
    const skills = await fetch('/api/skills').then(r => r.json());

    // 区分内置技能和用户技能
    const builtinSkills = [
      'ai-image-gen',
      'html-page',
      'skill-creator',
      'today-lunar',
      'today-weather',
      'code-review',
      'api-design',
      'unit-test',
      'refactor-guide',
      'db-design',
      'pdf-processing',
      'pdf-convert',
      'word-processing',
      'excel-processing',
      'docode-pricing'
    ];
    const userSkills = skills.filter(s => !builtinSkills.includes(s.name) && !s.plugin);
    const systemSkills = skills.filter(s => builtinSkills.includes(s.name) || s.plugin);

    pane.innerHTML = `
      <div class="card-item" style="border:1px solid rgba(91,95,247,0.2);border-radius:14px;background:var(--wb-bg);padding:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;">
              ${uiIcon("skills")} 技能管理
            </h3>
            <p style="margin:8px 0 0;font-size:13px;color:var(--wb-text-3);">管理agent的技能</p>
          </div>
          <div style="display:flex;gap:8px;">
            <button id="import-skill-btn" class="settings-action-btn" style="height:38px;">
              <svg class="i" style="width:14px;height:14px"><use href="#i-download"></use></svg>
              <span>导入技能</span>
            </button>
            <button id="add-skill-btn" class="settings-action-btn primary" style="height:38px;">
              <svg class="i" style="width:14px;height:14px"><use href="#i-plus"></use></svg>
              <span>新建技能</span>
            </button>
          </div>
        </div>

        ${systemSkills.length > 0 ? `
        <div style="margin-bottom:30px;">
          <h4 style="margin:0 0 12px;font-size:14px;font-weight:600;color:var(--wb-text-2);">系统内置技能 (${systemSkills.length})</h4>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${systemSkills.map(skill => `
              <div class="skill-item" data-name="${esc(skill.name)}" style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--wb-border);border-radius:8px;background:var(--wb-bg-1);">
                <div style="flex:1;">
                  <div style="font-size:14px;font-weight:500;color:var(--wb-text);">${esc(skill.name)}</div>
                  <div style="font-size:12px;color:var(--wb-text-3);margin-top:4px;">${esc(skill.description || '暂无描述')}</div>
                  ${skill.plugin ? `<div style="font-size:11px;color:var(--wb-text-3);margin-top:4px;">来自插件: ${esc(skill.plugin)}</div>` : ''}
                </div>
                <div style="display:flex;gap:8px;">
                  <button class="view-skill-btn" data-name="${esc(skill.name)}" style="padding:6px 12px;border:1px solid var(--wb-border);border-radius:6px;background:var(--wb-bg);color:var(--wb-text);cursor:pointer;font-size:12px;">查看</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        ${userSkills.length > 0 ? `
        <div>
          <h4 style="margin:0 0 12px;font-size:14px;font-weight:600;color:var(--wb-text-2);">用户自定义技能 (${userSkills.length})</h4>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${userSkills.map(skill => `
              <div class="skill-item" data-name="${esc(skill.name)}" style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--wb-border);border-radius:8px;background:var(--wb-bg-1);">
                <div style="flex:1;">
                  <div style="font-size:14px;font-weight:500;color:var(--wb-text);">${esc(skill.name)}</div>
                  <div style="font-size:12px;color:var(--wb-text-3);margin-top:4px;">${esc(skill.description || '暂无描述')}</div>
                </div>
                <div style="display:flex;gap:8px;">
                  <button class="view-skill-btn" data-name="${esc(skill.name)}" style="padding:6px 12px;border:1px solid var(--wb-border);border-radius:6px;background:var(--wb-bg);color:var(--wb-text);cursor:pointer;font-size:12px;">查看</button>
                  <button class="edit-skill-btn" data-name="${esc(skill.name)}" style="padding:6px 12px;border:1px solid var(--wb-border);border-radius:6px;background:var(--wb-bg);color:var(--wb-text);cursor:pointer;font-size:12px;">编辑</button>
                  <button class="delete-skill-btn" data-name="${esc(skill.name)}" style="padding:6px 12px;border:1px solid var(--wb-border);border-radius:6px;background:#f44336;color:#fff;cursor:pointer;font-size:12px;">删除</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : `
        <div style="padding:40px;text-align:center;color:var(--wb-text-3);">
          <div style="margin-bottom:12px;">${uiIcon("box", "hero")}</div>
          <div style="font-size:14px;">暂无自定义技能</div>
          <div style="font-size:12px;margin-top:8px;">点击右上角"新建技能"创建你的第一个技能</div>
        </div>
        `}
      </div>
    `;

    // 新建技能
    pane.querySelector('#add-skill-btn')?.addEventListener('click', () => {
      showSkillEditor(null, () => renderSkillsPane(pane, s));
    });

    // 导入技能
    pane.querySelector('#import-skill-btn')?.addEventListener('click', () => {
      showSkillImporter(() => renderSkillsPane(pane, s));
    });

    // 查看技能
    pane.querySelectorAll('.view-skill-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        const skill = await fetch(`/api/skills/${encodeURIComponent(name)}`).then(r => r.json());
        showSkillViewer(skill);
      });
    });

    // 编辑技能
    pane.querySelectorAll('.edit-skill-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        const skill = await fetch(`/api/skills/${encodeURIComponent(name)}`).then(r => r.json());
        showSkillEditor(skill, () => renderSkillsPane(pane, s));
      });
    });

    // 删除技能
    pane.querySelectorAll('.delete-skill-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        if (!confirm(`确定要删除技能"${name}"吗？此操作不可撤销。`)) return;

        try {
          const resp = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
          if (!resp.ok) throw new Error('删除失败');
          toast('✓ 技能已删除');
          if (typeof refreshSkillsCache === 'function') refreshSkillsCache(); // 刷新 / 自动补全缓存
          renderSkillsPane(pane, s);
        } catch (err) {
          toast('删除失败：' + err.message);
        }
      });
    });

  } catch (err) {
    pane.innerHTML = `<div style="padding:40px;text-align:center;color:#f44336;">加载失败：${esc(err.message)}</div>`;
  }
}

// 技能查看器
function showSkillViewer(skill) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';

  const isDark = document.documentElement.dataset.theme === 'dark';
  const bgColor = isDark ? '#1e1e1e' : '#ffffff';
  const borderColor = isDark ? '#333' : '#e0e0e0';
  const textColor = isDark ? '#e0e0e0' : '#333';
  const textColor2 = isDark ? '#999' : '#666';

  const dialog = document.createElement('div');
  dialog.style.cssText = `background:${bgColor};border-radius:12px;width:90%;max-width:800px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);`;

  dialog.innerHTML = `
    <div style="padding:20px;border-bottom:1px solid ${borderColor};">
      <h3 style="margin:0;font-size:18px;font-weight:600;color:${textColor};">${esc(skill.name)}</h3>
      <p style="margin:8px 0 0;font-size:13px;color:${textColor2};">${esc(skill.description || '暂无描述')}</p>
    </div>
    <div style="padding:20px;overflow-y:auto;flex:1;">
      <pre style="margin:0;padding:16px;background:var(--wb-bg-1);border:1px solid ${borderColor};border-radius:8px;font-size:13px;line-height:1.6;color:${textColor};white-space:pre-wrap;word-wrap:break-word;">${esc(skill.content || '')}</pre>
    </div>
    <div style="padding:20px;border-top:1px solid ${borderColor};display:flex;justify-content:flex-end;">
      <button id="close-viewer" style="padding:8px 20px;border-radius:8px;border:1px solid ${borderColor};background:${bgColor};color:${textColor};cursor:pointer;font-size:14px;">关闭</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const closeDialog = () => document.body.removeChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) closeDialog(); };
  dialog.querySelector('#close-viewer').onclick = closeDialog;
}

// 技能编辑器
function showSkillEditor(skill, onSave) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';

  const isDark = document.documentElement.dataset.theme === 'dark';
  const bgColor = isDark ? '#1e1e1e' : '#ffffff';
  const borderColor = isDark ? '#333' : '#e0e0e0';
  const textColor = isDark ? '#e0e0e0' : '#333';
  const textColor2 = isDark ? '#999' : '#666';

  const dialog = document.createElement('div');
  dialog.style.cssText = `background:${bgColor};border-radius:12px;width:90%;max-width:800px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);`;

  const isEdit = !!skill;

  dialog.innerHTML = `
    <div style="padding:20px;border-bottom:1px solid ${borderColor};">
      <h3 style="margin:0;font-size:18px;font-weight:600;color:${textColor};">${isEdit ? '编辑技能' : '新建技能'}</h3>
      <p style="margin:8px 0 0;font-size:13px;color:${textColor2};">${isEdit ? '修改技能信息和内容' : '创建一个新的技能'}</p>
    </div>
    <div style="padding:20px;overflow-y:auto;flex:1;">
      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:${textColor};">技能名称</label>
        <input id="skill-name" type="text" value="${esc(skill?.name || '')}" placeholder="例如：数据分析" style="width:100%;padding:10px;border:1px solid ${borderColor};border-radius:8px;background:${bgColor};color:${textColor};font-size:14px;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:${textColor};">技能描述</label>
        <input id="skill-desc" type="text" value="${esc(skill?.description || '')}" placeholder="简短描述这个技能的用途" style="width:100%;padding:10px;border:1px solid ${borderColor};border-radius:8px;background:${bgColor};color:${textColor};font-size:14px;">
      </div>
      <div>
        <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:500;color:${textColor};">技能内容 (Markdown)</label>
        <textarea id="skill-content" placeholder="输入技能的详细内容..." style="width:100%;height:300px;padding:10px;border:1px solid ${borderColor};border-radius:8px;background:${bgColor};color:${textColor};font-size:13px;font-family:monospace;resize:vertical;">${esc(skill?.content || '')}</textarea>
      </div>
    </div>
    <div style="padding:20px;border-top:1px solid ${borderColor};display:flex;gap:10px;justify-content:flex-end;">
      <button id="cancel-edit" style="padding:8px 20px;border-radius:8px;border:1px solid ${borderColor};background:${bgColor};color:${textColor};cursor:pointer;font-size:14px;">取消</button>
      <button id="save-skill" style="padding:8px 20px;border-radius:8px;border:none;background:#4285f4;color:#fff;cursor:pointer;font-size:14px;font-weight:500;">保存</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const closeDialog = () => document.body.removeChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) closeDialog(); };
  dialog.querySelector('#cancel-edit').onclick = closeDialog;

  dialog.querySelector('#save-skill').onclick = async () => {
    const name = dialog.querySelector('#skill-name').value.trim();
    const description = dialog.querySelector('#skill-desc').value.trim();
    const content = dialog.querySelector('#skill-content').value.trim();

    if (!name) return toast('请输入技能名称');
    if (!content) return toast('请输入技能内容');

    try {
      const resp = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          content,
          original_name: skill?.name
        })
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || '保存失败');
      }

      toast('✓ 技能已保存');
      closeDialog();
      if (typeof refreshSkillsCache === 'function') refreshSkillsCache(); // 刷新 / 自动补全缓存
      if (onSave) onSave();
    } catch (err) {
      toast('保存失败：' + err.message);
    }
  };
}

// 技能导入器：支持 GitHub 和 ZIP 文件两种方式。
// 颜色一律走 --wb-* 令牌，不再自己判断 isDark 写死色值 —— 主题不止亮/暗两套，写死就跟着错。
function showSkillImporter(onImport) {
  const overlay = document.createElement('div');
  overlay.className = 'skill-import-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'skill-import-dialog';

  dialog.innerHTML = `
    <div class="sid-head">
      <h3>导入技能</h3>
      <p>从 GitHub 或本地 ZIP 文件导入</p>
    </div>
    <div class="sid-body">
      <div class="sid-tabs">
        <button id="tab-github" class="sid-tab active">GitHub</button>
        <button id="tab-zip" class="sid-tab">ZIP 文件</button>
      </div>

      <div id="panel-github" class="sid-panel">
        <label class="sid-label" for="import-url">GitHub 链接</label>
        <input id="import-url" type="text" class="sid-input" placeholder="https://github.com/user/repo">
        <div class="sid-hint">
          <strong>支持的链接形式：</strong>
          <div>· 整个仓库：<code>github.com/user/repo</code></div>
          <div>· 子目录：<code>github.com/user/repo/tree/main/skills</code></div>
          <div>· 单文件：<code>raw.githubusercontent.com/…/skill.md</code></div>
          <div class="sid-dim">目录下有多个技能时会一次全部导入。</div>
        </div>
      </div>

      <div id="panel-zip" class="sid-panel" hidden>
        <label class="sid-label">选择 ZIP 文件</label>
        <input id="import-file" type="file" accept=".zip" hidden>
        <div id="drop-zone" class="sid-drop" tabindex="0" role="button">
          <svg class="i sid-drop-icon"><use href="#i-download"></use></svg>
          <div class="sid-drop-main">点击选择，或把 .zip 拖到这里</div>
          <div class="sid-drop-sub">仅支持 .zip 格式</div>
        </div>
        <div class="sid-hint">
          <strong>ZIP 文件要求：</strong>
          <div>· 根目录或子目录包含 <code>skill.md</code> 文件</div>
          <div>· skill.md 需包含技能的 name、description 和 content</div>
          <div class="sid-dim">ZIP 内有多个 skill.md 时会一次全部导入。</div>
        </div>
      </div>
    </div>
    <div class="sid-foot">
      <button id="cancel-import" class="sid-btn">取消</button>
      <button id="do-import" class="sid-btn primary">导入</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const onKeydown = (e) => { if (e.key === 'Escape') closeDialog(); };
  const closeDialog = () => {
    document.removeEventListener('keydown', onKeydown);
    document.body.removeChild(overlay);
  };
  document.addEventListener('keydown', onKeydown);
  overlay.onclick = (e) => { if (e.target === overlay) closeDialog(); };
  dialog.querySelector('#cancel-import').onclick = closeDialog;

  const tabGithub = dialog.querySelector('#tab-github');
  const tabZip = dialog.querySelector('#tab-zip');
  const panelGithub = dialog.querySelector('#panel-github');
  const panelZip = dialog.querySelector('#panel-zip');
  const urlInput = dialog.querySelector('#import-url');
  const fileInput = dialog.querySelector('#import-file');
  const dropZone = dialog.querySelector('#drop-zone');
  const importBtn = dialog.querySelector('#do-import');

  let activeTab = 'github';

  const switchTab = (tab) => {
    activeTab = tab;
    tabGithub.classList.toggle('active', tab === 'github');
    tabZip.classList.toggle('active', tab === 'zip');
    panelGithub.hidden = tab !== 'github';
    panelZip.hidden = tab !== 'zip';
    if (tab === 'github') urlInput.focus();
  };

  tabGithub.onclick = () => switchTab('github');
  tabZip.onclick = () => switchTab('zip');

  // 自定义文件选择：原生 input[type=file] 的按钮样式改不动，只能藏起来自己画一个
  const showPicked = (file) => {
    dropZone.classList.add('picked');
    dropZone.innerHTML = `
      <svg class="i sid-drop-icon"><use href="#i-folder"></use></svg>
      <div class="sid-drop-main">${esc(file.name)}</div>
      <div class="sid-drop-sub">${(file.size / 1024).toFixed(1)} KB · 点击可重新选择</div>
    `;
  };

  dropZone.onclick = () => fileInput.click();
  dropZone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };
  fileInput.onchange = () => { if (fileInput.files[0]) showPicked(fileInput.files[0]); };

  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('over'); };
  dropZone.ondragleave = () => dropZone.classList.remove('over');
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { toast('只支持 .zip 文件'); return; }
    // DataTransfer 是把拖进来的文件塞进 input 的唯一办法，后面统一从 fileInput 读
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    showPicked(file);
  };

  const doImport = async () => {
    importBtn.disabled = true;
    importBtn.textContent = '导入中…';

    try {
      if (activeTab === 'github') {
        const url = urlInput.value.trim();
        if (!url) { toast('请先填 GitHub 链接'); urlInput.focus(); importBtn.disabled = false; importBtn.textContent = '导入'; return; }

        const resp = await fetch('/api/skills/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `导入失败 HTTP ${resp.status}`);
        const names = (data.installed || []).map((it) => it.name).filter(Boolean);
        toast(names.length ? `✓ 已导入：${names.join('、')}` : '✓ 导入完成');
        closeDialog();
        if (typeof refreshSkillsCache === 'function') refreshSkillsCache(); // 刷新 / 自动补全缓存
        if (onImport) onImport();
      } else {
        const file = fileInput.files[0];
        if (!file) { toast('请先选择 ZIP 文件'); importBtn.disabled = false; importBtn.textContent = '导入'; return; }

        // 读成 base64 发给服务端（项目没装 multer，走 express.json 够用）
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const resp = await fetch('/api/skills/install-zip', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: reader.result }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || `导入失败 HTTP ${resp.status}`);
            const names = (data.installed || []).map((it) => it.name).filter(Boolean);
            toast(names.length ? `✓ 已导入：${names.join('、')}` : '✓ 导入完成');
            closeDialog();
            if (typeof refreshSkillsCache === 'function') refreshSkillsCache(); // 刷新 / 自动补全缓存
            if (onImport) onImport();
          } catch (err) {
            toast('' + err.message);
            importBtn.disabled = false;
            importBtn.textContent = '导入';
          }
        };
        reader.onerror = () => {
          toast('文件读取失败');
          importBtn.disabled = false;
          importBtn.textContent = '导入';
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      toast('' + err.message);
      importBtn.disabled = false;
      importBtn.textContent = '导入';
    }
  };

  importBtn.onclick = doImport;
  urlInput.onkeydown = (e) => { if (e.key === 'Enter') doImport(); };
  urlInput.focus();
}

// 联网搜索：provider 可切（Jina / Tavily / Brave），各自独立 key；没 key 自动退免费 DuckDuckGo
function renderSearchPane(pane, s) {
  const sc = s.search || {};
  pane.innerHTML = `
    <div class="card-item">
      <div class="t">搜索服务商</div>
      <div class="d" style="margin-bottom:6px">web_search 工具用哪家搜索 API。所选服务商没填 Key 或调用失败时，自动回退到免费 DuckDuckGo。</div>
      <select id="sr-provider">
        <option value="jina">Jina（s.jina.ai）</option>
        <option value="tavily">Tavily</option>
        <option value="brave">Brave Search</option>
      </select>
      <div class="t" style="margin-top:10px">Jina API Key</div>
      <input id="sr-jina" type="password" placeholder="jina_..." value="${esc(sc.jina_key || "")}">
      <div class="t" style="margin-top:8px">Tavily API Key</div>
      <input id="sr-tavily" type="password" placeholder="tvly-..." value="${esc(sc.tavily_key || "")}">
      <div class="t" style="margin-top:8px">Brave API Key</div>
      <input id="sr-brave" type="password" placeholder="BSA..." value="${esc(sc.brave_key || "")}">
    </div>
    <button class="btn-brand" id="sr-save">保存</button>
    <button class="btn-plain" id="sr-test">测试搜索</button>
    <span class="ok-msg" id="sr-msg"></span>`;
  pane.querySelector("#sr-provider").value = sc.provider || "jina";
  const msg = pane.querySelector("#sr-msg");
  const collect = () => ({
    provider: pane.querySelector("#sr-provider").value,
    jina_key: pane.querySelector("#sr-jina").value.trim(),
    tavily_key: pane.querySelector("#sr-tavily").value.trim(),
    brave_key: pane.querySelector("#sr-brave").value.trim(),
  });
  pane.querySelector("#sr-save").onclick = () => saveSettings({ search: collect() }, msg);
  pane.querySelector("#sr-test").onclick = async (e) => {
    e.target.disabled = true;
    msg.textContent = "保存并测试中…";
    const ok = await saveSettings({ search: collect() });
    if (ok) {
      const r = await fetch("/api/search/test").then(x => x.json()).catch(() => ({ error: "请求失败" }));
      msg.textContent = r.ok ? `✓ ${r.provider} 可用：${r.sample}` : `✗ ${r.error || "测试失败"}`;
    } else msg.textContent = "保存失败";
    e.target.disabled = false;
  };
}
function renderAgentPane(pane, s) {
  const config = s.agent || {};
  const remoteConfig = s.remote_control || {};
  const attr = value => esc(value).replace(/"/g, "&quot;");
  const numeric = (value, fallback) => Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : fallback;
  const field = (id, label, value, unit, help, min, max, step = "1", increment = step === "any" ? 1 : Number(step)) => `
    <div class="agent-field">
      <label for="${id}">${label}</label>
      <div class="agent-number">
        <button class="agent-stepper" type="button" data-input="${id}" data-delta="${-increment}" aria-label="减少${label}" aria-controls="${id}"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5 10h10"/></svg></button>
        <input id="${id}" type="number" inputmode="decimal" required min="${min}" ${max === undefined ? "" : `max="${max}"`} step="${step}" value="${value}" data-label="${label}" aria-label="${label}（${unit}）" aria-describedby="${id}-help"><span aria-hidden="true">${unit}</span>
        <button class="agent-stepper" type="button" data-input="${id}" data-delta="${increment}" aria-label="增加${label}" aria-controls="${id}"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5 10h10M10 5v10"/></svg></button>
      </div>
      <p id="${id}-help">${help}</p>
    </div>`;
  const models = s.models || [];
  const failover = config.failover_model || "";
  pane.innerHTML = `
    <form class="agent-settings" id="ag-form" data-autosave novalidate>
      <header class="agent-settings-header"><h2>智能体设置</h2><p>决定如何协作，以及每个任务可以投入多少执行资源。</p><span class="agent-save-feedback" id="ag-msg" role="status" aria-live="polite">自动保存 · 输入完成后离开即可</span></header>
      <section class="agent-section" aria-labelledby="ag-collaboration-title">
        <div class="agent-section-heading">
          <div class="agent-section-kicker"><svg class="i" aria-hidden="true"><use href="#i-users"></use></svg><h3 id="ag-collaboration-title">专家协作</h3></div>
          <p>全局默认策略 · 单次任务可在输入框「协作」中单独选择</p>
        </div>
        <label class="agent-toggle-row" for="ag-auto-delegate">
          <span class="agent-toggle-copy"><strong><span id="ag-auto-label">自动匹配专家 / 团队</span><span class="agent-toggle-status" id="ag-auto-status"></span></strong><small id="ag-auto-help">在 Craft / Goal 下，为明确的专业任务匹配专家；简单问答直接处理。</small></span>
          <span class="agent-switch"><input id="ag-auto-delegate" type="checkbox" role="switch" aria-labelledby="ag-auto-label" aria-describedby="ag-auto-help" ${config.auto_delegate !== false ? "checked" : ""}><span class="agent-switch-track" aria-hidden="true"></span></span>
        </label>
        <div class="agent-cooperation-guide">
          <div><strong>自动匹配</strong><p>按任务需要选择，不是每轮都调用专家。</p></div>
          <div><strong>指定协作</strong><p>手动选专家或团队，不受此开关影响。</p></div>
          <div><strong>独立处理</strong><p>仅由主助手完成，关闭本轮专家委派。</p></div>
        </div>
        <p class="agent-cost-note"><svg class="i" aria-hidden="true"><use href="#i-circle-help"></use></svg><span>团队按成员顺序接力，会增加模型调用与费用。关闭自动匹配后，模型仍可能按需调用专家；本轮完全不委派请选「独立处理」。</span></p>
      </section>
      <section class="agent-section" aria-labelledby="ag-remote-title">
        <div class="agent-section-heading"><h3 id="ag-remote-title">远程控制</h3><p>通过 Cloudflare Tunnel 从手机浏览器访问 CloseCode；默认关闭。</p></div>
        <label class="agent-toggle-row" for="ag-remote-enabled">
          <span class="agent-toggle-copy"><strong><span id="ag-remote-label">开启远程控制</span><span class="agent-toggle-status" id="ag-remote-status"></span></strong><small id="ag-remote-help">开启后自动启动 Cloudflare Quick Tunnel，生成临时 HTTPS 地址和绑定二维码。应用会优先使用内置客户端。</small></span>
          <span class="agent-switch"><input id="ag-remote-enabled" type="checkbox" role="switch" aria-labelledby="ag-remote-label" aria-describedby="ag-remote-help" ${remoteConfig.enabled === true ? "checked" : ""}><span class="agent-switch-track" aria-hidden="true"></span></span>
        </label>
        <div class="remote-endpoint-row" style="margin-top:14px"><span class="agent-cost-note">当前临时访问地址</span><code id="ag-remote-url" class="remote-endpoint-value">${attr(remoteConfig.public_url || "等待生成…")}</code></div>
        <div id="ag-remote-qrcode" style="display:none;margin-top:16px;padding:16px;border:1px solid var(--wb-border);border-radius:10px;text-align:center"><strong>手机扫码打开远程控制</strong><div><img id="ag-remote-qr-image" alt="远程控制绑定二维码" style="display:block;width:220px;height:220px;margin:12px auto;background:#fff;padding:8px;border-radius:8px"></div><div class="agent-cost-note" id="ag-remote-qr-message">正在建立 Cloudflare 临时通道…</div><button type="button" class="agent-icon-button" id="ag-remote-copy" style="display:inline-grid;place-items:center;width:32px;height:32px;padding:0;margin-top:10px;border:1px solid var(--wb-border);border-radius:8px;background:var(--wb-bg-2);color:var(--wb-text-2);cursor:pointer" title="复制临时访问地址" aria-label="复制临时访问地址"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M7 6V4.8A1.8 1.8 0 0 1 8.8 3h6.4A1.8 1.8 0 0 1 17 4.8v6.4a1.8 1.8 0 0 1-1.8 1.8H14M11.2 7H4.8A1.8 1.8 0 0 0 3 8.8v6.4A1.8 1.8 0 0 0 4.8 17h6.4a1.8 1.8 0 0 0 1.8-1.8V8.8A1.8 1.8 0 0 0 11.2 7Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button></div>
      </section>
      <section class="agent-section" aria-labelledby="ag-git-title">
        <div class="agent-section-heading"><h3 id="ag-git-title">Git 自动同步</h3><p>默认开启 · 每轮先拉取，有改动时在收尾阶段提交并推送</p></div>
        <label class="agent-toggle-row" for="ag-git-sync">
          <span class="agent-toggle-copy"><strong><span id="ag-git-label">自动拉取 / 提交 / 推送</span><span class="agent-toggle-status" id="ag-git-status"></span></strong><small id="ag-git-help">缺少上游时自动使用已指定的远程或唯一远程，绑定同名分支；远程分支尚不存在时，在有成果需要推送时创建并绑定。</small></span>
          <span class="agent-switch"><input id="ag-git-sync" type="checkbox" role="switch" aria-labelledby="ag-git-label" aria-describedby="ag-git-help" ${config.git_auto_sync !== false ? "checked" : ""}><span class="agent-switch-track" aria-hidden="true"></span></span>
        </label>
        <div class="agent-cooperation-guide">
          <div><strong>任务前 · 自动同步</strong><p>包括 Ask / Plan。仅快进拉取；未暂存的旧成果通过安全检查后自动接续。非 Git 项目、无远程、无初始提交或远程目标不明确时，仅在本地执行；暂存修改、冲突或同步失败仍会阻止同步任务。</p></div>
          <div><strong>任务后 · 收尾同步</strong><p>有新增、修改或删除就提交并推送；Agent 报错、执行到上限或自测失败，也会收尾同步并保留错误提示。用户手动停止时不提交、不推送；没有文件变更时跳过同步。</p></div>
          <div><strong>同步失败 · 保留成果</strong><p>推送失败保留本地提交，下轮收尾时补同步，不重复提交。手动停止保留本地改动。分支分叉、暂存修改、提交钩子或安全检查失败时仍停止同步；已同步不代表任务成功。</p></div>
        </div>
        <p class="agent-cost-note">同一仓库串行执行。专家与内部续跑共用一次提交。推送可能将当前分支已有的本地提交一并上传，请确认上游与仓库权限。关闭后不再自动同步。</p>
      </section>
      <section class="agent-section" aria-labelledby="ag-budget-title">
        <div class="agent-section-heading"><h3 id="ag-budget-title">执行预算</h3><p>约束单个任务的步数、耗时和用量，避免长任务持续消耗。</p></div>
        <div class="agent-fields">
          ${field("ag-steps", "最大执行步数", numeric(config.max_steps, 200), "步", "单轮执行循环上限，范围 1–200。", 1, 200)}
          ${field("ag-runtime", "任务时间上限", numeric(config.max_runtime_ms, 14400000) / 60000, "分钟", "包含专家的执行时间，达到上限后收尾。", 1, undefined, "any")}
          ${field("ag-timeout", "单工具超时", numeric(config.tool_timeout_ms, 120000) / 1000, "秒", "一次工具调用的最长等待时间。", 5, undefined, "any", 5)}
          ${field("ag-tokbudget", "Token 总预算", numeric(config.max_tokens_budget, 0) / 10000, "万 tokens", "0 为不限；包含专家与续跑，用到 80% 时提醒。", 0, undefined, "0.0001", .1)}
        </div>
      </section>
      <details class="agent-section agent-advanced" id="ag-advanced">
        <summary><span><strong>高级 · 续跑与容错</strong><small>自动续跑、模型超时、失败重试与备用渠道</small></span><svg class="i" aria-hidden="true"><use href="#i-chevron-down"></use></svg></summary>
        <div class="agent-advanced-body"><div class="agent-fields">
          ${field("ag-rounds", "自动续跑轮数", numeric(config.auto_continue_rounds, 0), "轮", "0 为关闭；达到步数或时间上限后可接着执行。", 0, 20)}
          ${field("ag-llm-timeout", "模型无输出超时", numeric(config.llm_timeout_ms, 300000) / 1000, "秒", "连续无任何输出才计超时，持续输出不受影响。", 30, undefined, "any", 30)}
          ${field("ag-retry-count", "模型重试次数", numeric(config.llm_retry_count, 5), "次", "遇到限流、服务异常或断流时自动退避重试。", 1, 10)}
          <div class="agent-field"><label for="ag-failover">备用模型渠道</label><select id="ag-failover" aria-describedby="ag-failover-help"><option value="">关闭 · 不自动换道</option>
            ${failover && !models.some(m => m.name === failover) ? `<option value="${attr(failover)}" selected>${esc(failover)}（当前不可用，请重新选择）</option>` : ""}
            ${models.map(m => `<option value="${attr(m.name)}"${failover === m.name ? " selected" : ""}>${esc(m.name)}（${esc(m.model)}）${String(m.api_key || "").trim() || /ollama|本地/i.test(m.name || "") ? "" : " · 未配 Key"}</option>`).join("")}
          </select><p id="ag-failover-help">重试用尽或连续超时后换道，每个任务最多一次。</p></div>
        </div><p class="agent-cost-note"><svg class="i" aria-hidden="true"><use href="#i-circle-help"></use></svg><span>每次续跑都会产生实际费用；手动停止或用尽 Token 预算后不会自动续跑。</span></p></div>
      </details>
      <div class="agent-modes-note"><strong>执行模式</strong><span>Ask 只问答 · Plan 只出计划 · Craft 执行交付 · Goal 持续推进目标。指定专家或团队时，会从只读模式切换到 Craft。</span></div>
    </form>`;
  const form = pane.querySelector("#ag-form"), msg = pane.querySelector("#ag-msg");
  const controls = [...form.querySelectorAll("input, select")];
  const fields = {
    "ag-auto-delegate": ["auto_delegate"], "ag-git-sync": ["git_auto_sync"],
    "ag-remote-enabled": ["remote_control.enabled"],
    "ag-steps": ["max_steps", 1], "ag-runtime": ["max_runtime_ms", 60000],
    "ag-timeout": ["tool_timeout_ms", 1000], "ag-tokbudget": ["max_tokens_budget", 10000],
    "ag-rounds": ["auto_continue_rounds", 1], "ag-llm-timeout": ["llm_timeout_ms", 1000],
    "ag-retry-count": ["llm_retry_count", 1], "ag-failover": ["failover_model"],
  };
  const read = el => el.type === "checkbox" ? el.checked : el.type === "number" ? Math.round(Number(el.value) * fields[el.id][1]) : el.value;
  const valid = el => el.type !== "number" || (!!el.value.trim() && el.checkValidity() && Number.isSafeInteger(read(el)));
  const label = el => el.dataset.label || (el.id === "ag-failover" ? "备用模型渠道" : el.id === "ag-git-sync" ? "Git 自动同步" : el.id === "ag-remote-enabled" ? "远程控制" : el.id === "ag-remote-url" ? "远程控制 HTTPS 地址" : "自动匹配专家 / 团队");
  const saved = new Map(controls.map(el => [el, read(el)])), pending = new Map(), errors = new Map();
  const uncertain = new Set();
  const steppers = [...form.querySelectorAll(".agent-stepper")];
  let saving = null, inFlight = new Map(), hasSaved = false;
  const feedback = (text, state = "") => { msg.textContent = text; msg.dataset.state = state; };
  const syncStatus = () => {
    const enabled = pane.querySelector("#ag-auto-delegate").checked;
    const status = pane.querySelector("#ag-auto-status");
    status.textContent = enabled ? "已开启" : "已关闭"; status.dataset.enabled = String(enabled);
    const gitEnabled = pane.querySelector("#ag-git-sync").checked;
    const gitStatus = pane.querySelector("#ag-git-status");
    gitStatus.textContent = gitEnabled ? "已开启" : "已关闭"; gitStatus.dataset.enabled = String(gitEnabled);
    const remoteEnabled = pane.querySelector("#ag-remote-enabled").checked;
    const remoteStatus = pane.querySelector("#ag-remote-status");
    remoteStatus.textContent = remoteEnabled ? "已开启" : "已关闭"; remoteStatus.dataset.enabled = String(remoteEnabled);
    const remoteBox = pane.querySelector("#ag-remote-qrcode");
    if (remoteBox) remoteBox.style.display = remoteEnabled ? "block" : "none";
    for (const button of steppers) {
      const input = form.querySelector("#" + button.dataset.input), delta = Number(button.dataset.delta);
      const limit = input.getAttribute(delta < 0 ? "min" : "max");
      button.disabled = valid(input) && limit !== null && (delta < 0 ? Number(input.value) <= Number(limit) : Number(input.value) >= Number(limit));
    }
    form.setAttribute("aria-busy", String(!!saving));
    const dirty = uncertain.size || controls.some(el => !valid(el) || read(el) !== saved.get(el));
    if (errors.size) feedback(errors.values().next().value, "error");
    else if (saving) feedback("正在自动保存…", "saving");
    else if (dirty) feedback("输入完成后离开此项，将自动保存", "dirty");
    else feedback(hasSaved ? "已自动保存" : "自动保存 · 输入完成后离开即可", hasSaved ? "success" : "");
  };
  const queue = control => {
    if (!valid(control)) {
      pending.delete(control);
      control.setAttribute("aria-invalid", "true");
      errors.set(control, "「" + label(control) + "」未保存，请输入范围内的有效数字。");
      return;
    }
    const value = read(control), target = pending.get(control) ?? inFlight.get(control) ?? saved.get(control);
    if (value !== target || (uncertain.has(control) && !inFlight.has(control) && !pending.has(control))) pending.set(control, value);
    errors.delete(control); control.removeAttribute("aria-invalid");
  };
  const drain = () => {
    if (saving) return saving;
    if (!pending.size) { syncStatus(); return Promise.resolve(); }
    // Serialize accepted field values only. Never upload another field that the
    // user is still typing, and never let an older response overwrite that draft.
    saving = Promise.resolve().then(async () => {
      while (pending.size) {
        inFlight = new Map(pending); pending.clear();
        const agent = {};
        const patch = {};
        for (const [el, value] of inFlight) {
          const key = fields[el.id][0];
          if (key.startsWith("remote_control.")) {
            patch.remote_control = patch.remote_control || {};
            patch.remote_control[key.slice("remote_control.".length)] = value;
          } else agent[key] = value;
        }
        const resultMessage = document.createElement("span");
        let ok = false;
        try { ok = await saveSettings({ ...(Object.keys(agent).length ? { agent } : {}), ...patch }, resultMessage, { quiet: true }); }
        catch { resultMessage.textContent = "连接失败"; }
        for (const [el, value] of inFlight) {
          if (ok) {
            saved.set(el, value); uncertain.delete(el); hasSaved = true;
            if (valid(el) && read(el) === value) errors.delete(el);
          } else {
            uncertain.add(el);
            errors.set(el, "「" + label(el) + "」未保存：" + (resultMessage.textContent || "保存失败") + "。输入已保留，重新离开此项可重试。");
          }
        }
        inFlight.clear(); syncStatus();
      }
    }).finally(() => { saving = null; syncStatus(); });
    syncStatus(); return saving;
  };
  const commit = control => { queue(control); return drain(); };
  const refreshRemoteQr = async () => {
    const box = pane.querySelector("#ag-remote-qrcode");
    const image = pane.querySelector("#ag-remote-qr-image");
    const note = pane.querySelector("#ag-remote-qr-message");
    const enabled = pane.querySelector("#ag-remote-enabled").checked;
    if (!enabled) return;
    box.style.display = "block";
    const urlEl = pane.querySelector("#ag-remote-url");
    const url = (urlEl?.textContent || "").trim();
    if (!url || url === "等待生成…") { note.textContent = "正在等待 Cloudflare 临时地址…"; image.removeAttribute("src"); return; }
    note.textContent = "正在生成二维码…";
    try {
      const response = await fetch("/api/remote-control/qrcode");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.data_url) throw new Error(data.error || "二维码生成失败");
      image.src = data.data_url;
      note.textContent = "扫码后将在手机浏览器打开远程控制页面。";
    } catch (e) { image.removeAttribute("src"); note.textContent = e.message || "二维码生成失败"; }
  };
  let remotePollTimer = null;
  const startRemotePolling = () => {
    clearTimeout(remotePollTimer);
    let polls = 0;
    const pollRemote = async () => {
      if (!pane.querySelector("#ag-remote-enabled")?.checked || polls++ > 30) return;
      const state = await fetch("/api/remote-control/status").then(r => r.json()).catch(() => null);
      const note = pane.querySelector("#ag-remote-qr-message");
      if (state?.url) {
        pane.querySelector("#ag-remote-url").textContent = state.url;
        await refreshRemoteQr();
        return;
      }
      if (state?.status === "error") {
        note.textContent = state.error || "Cloudflare 临时通道启动失败";
        return;
      }
      note.textContent = state?.status === "starting" ? "正在建立 Cloudflare 临时通道…" : "正在等待 Cloudflare 临时地址…";
      remotePollTimer = setTimeout(pollRemote, 1000);
    };
    pollRemote();
  };
  pane.querySelector("#ag-remote-enabled").addEventListener("change", async () => {
    syncStatus();
    await commit(pane.querySelector("#ag-remote-enabled"));
    if (pane.querySelector("#ag-remote-enabled").checked) startRemotePolling();
    else { clearTimeout(remotePollTimer); pane.querySelector("#ag-remote-url").textContent = "等待生成…"; }
    await refreshRemoteQr();
  });
  pane.querySelector("#ag-remote-copy").addEventListener("click", async () => {
    const url = (pane.querySelector("#ag-remote-url")?.textContent || "").trim();
    if (!url || url === "等待生成…") return;
    try { await navigator.clipboard.writeText(url); if (typeof toast === "function") toast("✓ 已复制远程控制地址"); }
    catch { pane.querySelector("#ag-remote-qr-message").textContent = "复制失败，请手动复制地址。"; }
  });
  syncStatus();
  if (remoteConfig.enabled === true) {
    refreshRemoteQr();
    startRemotePolling();
  }
  for (const control of controls) {
    control.addEventListener("input", () => { control.removeAttribute("aria-invalid"); errors.delete(control); syncStatus(); });
    control.addEventListener(control.type === "number" ? "blur" : "change", () => commit(control));
    control.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(control); }
    });
  }
  for (const button of steppers) {
    // Keep pointer clicks from blurring the number before applying the step.
    button.addEventListener("pointerdown", event => { if (event.button === 0) event.preventDefault(); });
    button.onclick = () => {
      const input = form.querySelector("#" + button.dataset.input);
      const min = Number(input.getAttribute("min")), max = input.getAttribute("max");
      const base = valid(input) ? Number(input.value) : Number(saved.get(input)) / fields[input.id][1];
      input.value = String(Math.max(min, Math.min(max === null ? Infinity : Number(max), Number((base + Number(button.dataset.delta)).toFixed(4)))));
      syncStatus(); return commit(input);
    };
  }
  form.flushAutosave = async () => {
    controls.forEach(queue); await drain();
    const invalid = controls.find(el => !valid(el));
    if (invalid) { const details = invalid.closest("details"); if (details) details.open = true; invalid.focus(); }
    return !errors.size && !uncertain.size && !controls.some(el => !valid(el) || read(el) !== saved.get(el));
  };
  form.onsubmit = event => { event.preventDefault(); return form.flushAutosave(); };
  syncStatus();
}

// ================= 上下文设置 =================
function renderContextPane(pane, s) {
  const providerNames = {
    gpt: 'GPT',
    claude: 'Claude',
    gemini: 'Gemini',
    grok: 'Grok',
    custom: '国模'
  };
  const providers = Object.keys(providerNames);
  const contextConfig = Object.fromEntries(providers.map(provider => {
    const value = s.context_config?.[provider] || {};
    return [provider, {size: ['256k', '512k', '1m'].includes(value.size) ? value.size : provider === 'grok' ? '256k' : '1m',
      threshold: Number.isFinite(Number(value.threshold)) ? Math.max(60, Math.min(80, Math.round(Number(value.threshold)))) : 60}];
  }));

  pane.innerHTML = `
    <div id="ctx-form" data-autosave>
    <div class="card-item">
      <div class="t">模型上下文窗口配置</div>
      <div class="d" style="margin-bottom:12px">根据不同模型类型，配置上下文窗口大小和自动压缩阈值。窗口越大消耗越多，请根据中转站实际支持的上下文大小配置。</div>
      <span class="agent-save-feedback" id="ctx-msg" role="status" aria-live="polite">自动保存 · 调整后生效</span>
      ${Object.keys(providerNames).map(provider => `
        <div style="border:1px solid var(--wb-border);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--wb-bg)">
          <div style="font-weight:600;font-size:14px;margin-bottom:10px;color:var(--wb-text)">${providerNames[provider]}</div>

          <div style="margin-bottom:10px">
            <div style="font-size:13px;margin-bottom:6px;color:var(--wb-text-2)">上下文窗口大小</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <label style="flex:1;min-width:100px;display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid var(--wb-border);border-radius:6px;cursor:pointer;transition:all .2s;background:${contextConfig[provider].size === '256k' ? 'var(--wb-brand-weak)' : 'var(--wb-bg)'};border-color:${contextConfig[provider].size === '256k' ? 'var(--wb-brand)' : 'var(--wb-border)'}">
                <input type="radio" name="ctx-size-${provider}" value="256k" ${contextConfig[provider].size === '256k' ? 'checked' : ''} style="width:auto;margin:0">
                <span style="font-size:13px;font-weight:500">256K</span>
              </label>
              <label style="flex:1;min-width:100px;display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid var(--wb-border);border-radius:6px;cursor:pointer;transition:all .2s;background:${contextConfig[provider].size === '512k' ? 'var(--wb-brand-weak)' : 'var(--wb-bg)'};border-color:${contextConfig[provider].size === '512k' ? 'var(--wb-brand)' : 'var(--wb-border)'}">
                <input type="radio" name="ctx-size-${provider}" value="512k" ${contextConfig[provider].size === '512k' ? 'checked' : ''} style="width:auto;margin:0">
                <span style="font-size:13px;font-weight:500">512K</span>
              </label>
              <label style="flex:1;min-width:100px;display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid var(--wb-border);border-radius:6px;cursor:pointer;transition:all .2s;background:${contextConfig[provider].size === '1m' ? 'var(--wb-brand-weak)' : 'var(--wb-bg)'};border-color:${contextConfig[provider].size === '1m' ? 'var(--wb-brand)' : 'var(--wb-border)'}">
                <input type="radio" name="ctx-size-${provider}" value="1m" ${contextConfig[provider].size === '1m' ? 'checked' : ''} style="width:auto;margin:0">
                <span style="font-size:13px;font-weight:500">1M</span>
              </label>
            </div>
          </div>

          <div>
            <div class="settings-range-heading">
              <label for="ctx-threshold-${provider}">自动压缩阈值</label>
              <span id="ctx-threshold-val-${provider}" class="settings-range-value">${contextConfig[provider].threshold}%</span>
            </div>
            <input type="range" class="settings-range" id="ctx-threshold-${provider}" aria-label="${providerNames[provider]} 自动压缩阈值" aria-describedby="ctx-threshold-val-${provider}" min="60" max="80" value="${contextConfig[provider].threshold}" step="1">
            <div class="settings-range-labels">
              <span>60%</span>
              <span>70%</span>
              <span>80%</span>
            </div>
          </div>
        </div>
      `).join('')}

      <div style="margin-top:12px;padding:10px;background:var(--wb-brand-weak);border-radius:8px;font-size:12px;color:var(--wb-text-2)">
        <b style="color:var(--wb-brand)">${uiIcon("tip", "sm")} 建议：</b>GPT/Claude/Gemini/国模 默认 1M，Grok 默认 256K。如遇中转站错误请降低配置。阈值越低越早触发压缩，可避免超限。
      </div>
    </div>
    </div>
  `;

  const form = pane.querySelector('#ctx-form'), msg = pane.querySelector('#ctx-msg');
  const saved = new Map(Object.entries(contextConfig)), pending = new Map(), errors = new Map(), uncertain = new Set();
  const accepted = new Map(saved);
  let saving = null, inFlight = new Map(), hasSaved = false;
  const read = provider => ({size: form.querySelector(`input[name="ctx-size-${provider}"]:checked`).value,
    threshold: Number(form.querySelector(`#ctx-threshold-${provider}`).value)});
  const same = (a, b) => a.size === b.size && a.threshold === b.threshold;
  const sync = () => {
    for (const provider of providers) for (const radio of form.querySelectorAll(`input[name="ctx-size-${provider}"]`)) {
      const label = radio.closest('label');
      label.style.background = radio.checked ? 'var(--wb-brand-weak)' : 'var(--wb-bg)';
      label.style.borderColor = radio.checked ? 'var(--wb-brand)' : 'var(--wb-border)';
    }
    form.setAttribute('aria-busy', String(!!saving));
    const dirty = uncertain.size || providers.some(provider => !same(read(provider), saved.get(provider)));
    msg.dataset.state = errors.size ? 'error' : saving ? 'saving' : dirty ? 'dirty' : hasSaved ? 'success' : '';
    msg.textContent = errors.size ? errors.values().next().value : saving ? '正在自动保存…' : dirty ? '调整结束后自动保存' : hasSaved ? '已自动保存' : '自动保存 · 调整后生效';
  };
  const queue = (provider, patch) => {
    const target = pending.get(provider) || inFlight.get(provider) || saved.get(provider), next = {...accepted.get(provider), ...patch};
    accepted.set(provider, next);
    if (!same(next, target) || (uncertain.has(provider) && !pending.has(provider) && !inFlight.has(provider))) pending.set(provider, next);
    errors.delete(provider);
  };
  const drain = () => {
    if (saving) return saving;
    if (!pending.size) { sync(); return Promise.resolve(); }
    saving = Promise.resolve().then(async () => {
      while (pending.size) {
        inFlight = new Map(pending); pending.clear();
        const resultMessage = document.createElement('span');
        let ok = false;
        try { ok = await saveSettings({context_config: Object.fromEntries(inFlight)}, resultMessage, {quiet: true}); }
        catch { resultMessage.textContent = '连接失败'; }
        for (const [provider, value] of inFlight) {
          if (ok) { saved.set(provider, value); uncertain.delete(provider); errors.delete(provider); hasSaved = true; }
          else { uncertain.add(provider); errors.set(provider, providerNames[provider] + ' 设置未保存：' + (resultMessage.textContent || '保存失败') + '。调整值已保留，重新调整或离开此项可重试。'); }
        }
        inFlight.clear(); sync();
        if (ok && typeof updateContextIndicator === 'function') updateContextIndicator();
      }
    }).finally(() => { saving = null; sync(); });
    sync(); return saving;
  };
  for (const provider of providers) {
    for (const radio of form.querySelectorAll(`input[name="ctx-size-${provider}"]`)) {
      radio.addEventListener('change', () => { if (radio.checked) { queue(provider, {size: radio.value}); drain(); } });
      radio.addEventListener('blur', () => { if (radio.checked && uncertain.has(provider)) { queue(provider, {size: radio.value}); drain(); } });
    }
    const slider = form.querySelector(`#ctx-threshold-${provider}`);
    const preview = () => {
      updateSettingsRange(slider);
      form.querySelector(`#ctx-threshold-val-${provider}`).textContent = slider.value + '%';
      slider.setAttribute('aria-valuetext', slider.value + '%');
    };
    preview();
    slider.addEventListener('input', () => { preview(); sync(); });
    const commit = () => { queue(provider, {threshold: Number(slider.value)}); return drain(); };
    slider.addEventListener('change', commit); slider.addEventListener('blur', commit);
  }
  form.flushAutosave = async () => {
    providers.forEach(provider => queue(provider, read(provider))); await drain();
    return !errors.size && !uncertain.size && providers.every(provider => same(read(provider), saved.get(provider)));
  };
  sync();
}

// ================= 预设壁纸 =================
// 一个系列一张图：放在 public/assets/wallpapers/<dir>/1.jpg（也认 jpeg/png/webp）。
// 六个系列排成 3 列 × 2 行。图没放的那格会自己消失，不会留一块空白。
const WALLPAPER_PRESETS = [
  { key: "naruto",   label: "火影忍者", dir: "naruto" },
  { key: "onmyoji",  label: "阴阳师",   dir: "onmyoji" },
  { key: "genshin",  label: "原神",     dir: "genshin" },
  { key: "cyber",    label: "赛博朋克", dir: "cyberpunk" },
  { key: "nba",      label: "NBA",      dir: "nba" },
  { key: "softgirl", label: "轻柔少女", dir: "soft-girl" },
];
const WALLPAPER_EXTS = ["png", "jpg", "jpeg", "webp"];

/** 一个系列一格缩略图。src 先试 .jpg，onerror 依次换扩展名，全试完就把这格删掉 */
function wallpaperSeriesHtml(p) {
  const first = `/assets/wallpapers/${p.dir}/1.${WALLPAPER_EXTS[0]}`;
  return `
    <div class="wp-cell" data-wp-series="${p.key}">
      <img src="${first}" alt="${esc(p.label)}" loading="lazy"
           data-wp-dir="${p.dir}" data-wp-ext="0">
      <span class="wp-cell-label">${esc(p.label)}</span>
      <span class="wp-cell-check">✓</span>
    </div>`;
}

function renderPersonaPane(pane, s) {
  const a = { name: "DoCode", avatar: "🤖", ...(s.assistant || {}) };
  // 日间/夜间切换已挪到侧栏设置齿轮左边的开关上，这里不再重复一份——两处各算各的状态
  // 正是之前「界面是日间、这里却勾着夜间」的由来

  pane.innerHTML = `
    ${glassEffectCardHtml(s)}
    <div class="card-item" style="border:1px solid rgba(91,95,247,0.2);border-radius:14px;background:var(--wb-bg);box-shadow:0 4px 20px rgba(0,0,0,0.04);">
      <div class="t" style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">
        ${uiIcon("persona")} 预设壁纸主题
      </div>
      <div id="wp-presets" class="wp-presets-grid">${WALLPAPER_PRESETS.map(wallpaperSeriesHtml).join("")}</div>
      <div class="ok-msg" id="wp-preset-msg" style="margin-top:8px"></div>
    </div>

    <div class="card-item" style="border:1px solid rgba(91,95,247,0.2);border-radius:14px;background:var(--wb-bg);box-shadow:0 4px 20px rgba(0,0,0,0.04);margin-top:14px;">
      <div class="t" style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">
        ${uiIcon("image")} 沉浸式工作台背景
      </div>

      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="settings-action-btn primary" id="wallpaper-upload-btn" type="button" style="height:38px;">
          <svg class="i" style="width:14px;height:14px" aria-hidden="true"><use href="#i-paperclip"></use></svg>
          <span>上传新壁纸</span>
        </button>
        <button class="settings-action-btn secondary" id="wallpaper-remove-btn" type="button" ${!s.wallpaper ? 'disabled' : ''} style="height:38px;">
          <svg class="i" style="width:14px;height:14px" aria-hidden="true"><use href="#i-x"></use></svg>
          <span>清除壁纸</span>
        </button>
        <input type="file" id="wallpaper-input" accept="image/*" style="display:none">
      </div>

      <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--wb-border);">
        <div class="settings-range-heading">
          <label for="wallpaper-opacity">壁纸透明度</label>
          <span id="wallpaper-opacity-value" class="settings-range-value">${Math.round((s.wallpaperOpacity ?? 0.85) * 100)}%</span>
        </div>
        <input type="range" class="settings-range" id="wallpaper-opacity" aria-describedby="wallpaper-opacity-value" min="0.7" max="0.95" step="0.05" value="${s.wallpaperOpacity ?? 0.85}">
        <div class="settings-range-labels">
          <span>壁纸清晰</span>
          <span>内容清晰</span>
        </div>
      </div>

      <div class="ok-msg" id="wallpaper-msg" style="margin-top:6px"></div>
    </div>

    <style>
      .wp-presets-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-top: 10px;
      }
      .wp-cell {
        position: relative;
        aspect-ratio: 16 / 10;
        border: 1px solid var(--wb-border);
        border-radius: 8px;
        overflow: hidden;
        cursor: pointer;
        background: var(--wb-bg-1);
        transition: transform .18s cubic-bezier(0.16,1,0.3,1), border-color .18s, box-shadow .18s;
      }
      .wp-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .wp-cell:hover { transform: translateY(-2px); border-color: var(--wb-brand); box-shadow: 0 6px 16px rgba(0,0,0,0.18); }
      .wp-cell.active { border-color: var(--wb-brand); box-shadow: 0 0 0 2px var(--wb-brand) inset; }
      /* 系列名压在图片下沿，加一层渐变兜底，浅色壁纸上也读得清 */
      .wp-cell-label {
        position: absolute; left: 0; right: 0; bottom: 0;
        padding: 12px 8px 5px;
        font-size: 12px; font-weight: 600; color: #fff;
        background: linear-gradient(to top, rgba(0,0,0,0.72), transparent);
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        pointer-events: none;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .wp-cell-check {
        position: absolute; top: 4px; right: 4px;
        width: 18px; height: 18px; border-radius: 50%;
        background: var(--wb-brand); color: #fff;
        font-size: 11px; line-height: 18px; text-align: center;
        opacity: 0; transition: opacity .18s;
      }
      .wp-cell.active .wp-cell-check { opacity: 1; }
    </style>

    <style>
      .wallpaper-preview {
        width: 100%;
        height: 130px;
        border: 1px solid var(--wb-border);
        border-radius: 10px;
        overflow: hidden;
        background: var(--wb-bg-1);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: inset 0 2px 6px rgba(0,0,0,0.06);
      }
      .wallpaper-preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .no-wallpaper {
        color: var(--wb-text-3);
        font-size: 13px;
        font-weight: 500;
      }
    </style>
  `;

  bindGlassEffectControl(pane, s);

  // 壁纸上传
  const wallpaperInput = pane.querySelector("#wallpaper-input");
  const wallpaperMsg = pane.querySelector("#wallpaper-msg");

  pane.querySelector("#wallpaper-upload-btn").onclick = () => {
    wallpaperInput.click();
  };

  wallpaperInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      wallpaperMsg.textContent = "请选择图片文件";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      wallpaperMsg.textContent = "图片大小不能超过 5MB";
      return;
    }

    wallpaperMsg.textContent = "上传中...";

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const dataUrl = evt.target.result;
      const ok = await saveSettings({ wallpaper: dataUrl }, wallpaperMsg);
      if (ok) {
        wallpaperMsg.textContent = "✓ 壁纸已设置";
        applyWallpaper(dataUrl);
        // 更新预览
        const preview = pane.querySelector("#wallpaper-preview");
        if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="当前壁纸">`;
        pane.querySelector("#wallpaper-remove-btn").disabled = false;
        // 换成自己上传的图了，预设格上的勾要撤掉
        pane.querySelectorAll(".wp-cell.active").forEach(c => c.classList.remove("active"));
      }
    };
    reader.readAsDataURL(file);
  };

  pane.querySelector("#wallpaper-remove-btn").onclick = async () => {
    const ok = await saveSettings({ wallpaper: "" }, wallpaperMsg);
    if (ok) {
      wallpaperMsg.textContent = "✓ 壁纸已移除";
      applyWallpaper("");
      const preview = pane.querySelector("#wallpaper-preview");
      if (preview) preview.innerHTML = '<div class="no-wallpaper">未设置壁纸</div>';
      pane.querySelector("#wallpaper-remove-btn").disabled = true;
      // 清掉预设格上的勾，否则看着像「还选着这张」
      pane.querySelectorAll(".wp-cell.active").forEach(c => c.classList.remove("active"));
    }
  };

  // ---- 壁纸透明度 ----
  // 拖动时实时预览（不落盘），松手才保存：滑块每动一格都写一次配置太吵，
  // 而且看不到效果就调不准 —— 所以 input 只改样式，change 才请求接口。
  const opacitySlider = pane.querySelector("#wallpaper-opacity");
  const opacityValue = pane.querySelector("#wallpaper-opacity-value");
  if (opacitySlider) {
    const preview = () => {
      updateSettingsRange(opacitySlider);
      const text = `${Math.round(Number(opacitySlider.value) * 100)}%`;
      opacityValue.textContent = text;
      opacitySlider.setAttribute('aria-valuetext', text);
    };
    preview();
    opacitySlider.oninput = () => {
      const v = parseFloat(opacitySlider.value);
      preview();
      applyWallpaperOpacity(v);
    };
    opacitySlider.onchange = async () => {
      const v = parseFloat(opacitySlider.value);
      const ok = await saveSettings({ wallpaperOpacity: v }, wallpaperMsg);
      if (ok) wallpaperMsg.textContent = `✓ 透明度已设为 ${Math.round(v * 100)}%`;
    };
  }

  // ---- 预设壁纸 ----
  const wpMsg = pane.querySelector("#wp-preset-msg");
  const wpBox = pane.querySelector("#wp-presets");

  // 缩略图逐个换扩展名重试：约定的是 1.jpg，但用户手里可能是 png/webp。
  // 全试完还是加载不出来，就把这一格删掉——空白格比少一格更像 bug。
  wpBox.querySelectorAll(".wp-cell img").forEach(img => {
    img.onerror = () => {
      const next = Number(img.dataset.wpExt) + 1;
      if (next < WALLPAPER_EXTS.length) {
        img.dataset.wpExt = String(next);
        img.src = `/assets/wallpapers/${img.dataset.wpDir}/1.${WALLPAPER_EXTS[next]}`;
        return;
      }
      // 四种扩展名都没有：这个系列的图还没放进去，整格删掉
      const cell = img.closest(".wp-cell");
      if (cell) cell.remove();
    };
    // 当前壁纸正好是这张预设，就把勾打上
    if (s.wallpaper && s.wallpaper === img.getAttribute("src")) {
      img.closest(".wp-cell").classList.add("active");
    }
  });

  wpBox.addEventListener("click", async (e) => {
    const cell = e.target.closest(".wp-cell");
    if (!cell) return;
    const img = cell.querySelector("img");
    if (!img) return;
    const url = img.getAttribute("src");
    wpMsg.textContent = "应用中…";
    const ok = await saveSettings({ wallpaper: url }, wpMsg);
    if (!ok) return;
    wpMsg.textContent = "✓ 壁纸已应用";
    applyWallpaper(url);
    wpBox.querySelectorAll(".wp-cell.active").forEach(c => c.classList.remove("active"));
    cell.classList.add("active");
    // 上面那张「当前壁纸」预览也跟着换
    const preview = pane.querySelector("#wallpaper-preview");
    if (preview) preview.innerHTML = `<img src="${url}" alt="当前壁纸">`;
    const rm = pane.querySelector("#wallpaper-remove-btn");
    if (rm) rm.disabled = false;
  });
}

// ================= 桌面宠物（独立菜单） =================
function renderPetPane(pane, s) {
  pane.innerHTML = petCardHtml(s.pet || {});
  bindPetCard(pane, s.pet || {});
}

function petCardHtml(p) {
  const on = p.enabled === true;
  const character = p.character === undefined ? "yaya3d" : ["cat", "spider", "judy", "fox", "muyu", "yaya", "yaya3d", "photo"].includes(p.character) ? p.character : "cat";
  return `
    <div class="card-item">
      <div class="t">${uiIcon("pet")} 桌面宠物</div>
      <div class="d" style="margin-bottom:10px">这里是桌面宠物的手动开关和微调。</div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;color:var(--wb-text-2);cursor:pointer"><input type="checkbox" id="pet-on" style="width:auto;margin:0"${on ? " checked" : ""}> 显示桌面宠物</label>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;color:var(--wb-text-2);cursor:pointer"><input type="checkbox" id="pet-notify" style="width:auto;margin:0"${p.notify !== false ? " checked" : ""}> 要提问时弹系统通知 + 图标跳动</label>
      <div class="t" style="margin-top:10px"><label for="pet-char">形象</label></div>
      <div class="d" style="margin-bottom:6px">可以换成你自己或朋友的照片——上传后自动裁成圆形，配上呼吸、摇摆、跳跃的动效"活"起来。图片只存在本机 <code>data/</code> 目录，不上传任何服务器。</div>
      <div class="pet-character-row">
        <div class="settings-select-wrap">
          <select id="pet-char" class="settings-select">
            <option value="cat"${character === "cat" ? " selected" : ""}>内置小猫</option>
            <option value="spider"${character === "spider" ? " selected" : ""}>Q版蜘蛛侠</option>
            <option value="judy"${character === "judy" ? " selected" : ""}>Q版兔朱迪</option>
            <option value="fox"${character === "fox" ? " selected" : ""}>绘本小狐狸</option>
            <option value="muyu"${character === "muyu" ? " selected" : ""}>Q版木鱼</option>
            <option value="yaya"${character === "yaya" ? " selected" : ""}>芽芽小机灵·2D</option>
            <option value="yaya3d"${character === "yaya3d" ? " selected" : ""}>芽芽小机灵·3D</option>
            <option value="photo"${p.character === "photo" ? " selected" : ""}>我的照片${p.has_photo ? "" : "（还没上传）"}</option>
          </select>
        </div>
        <button class="settings-action-btn secondary" id="pet-pick" type="button">上传照片</button>
        ${p.has_photo ? '<button class="settings-action-btn secondary" id="pet-drop" type="button">删除照片</button>' : ""}
        <input type="file" id="pet-file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none">
      </div>
      <div class="pet-range-field">
        <div class="settings-range-heading"><label for="pet-scale">大小</label><span id="pet-scale-v" class="settings-range-value">${Math.round((p.scale || 1) * 100)}%</span></div>
        <input type="range" class="settings-range" id="pet-scale" aria-describedby="pet-scale-v" min="0.6" max="2" step="0.1" value="${p.scale || 1}">
        <div class="settings-range-labels"><span>60%</span><span>200%</span></div>
      </div>
      <div class="pet-range-field">
        <div class="settings-range-heading"><label for="pet-op">透明度</label><span id="pet-op-v" class="settings-range-value">${Math.round((p.opacity || 1) * 100)}%</span></div>
        <input type="range" class="settings-range" id="pet-op" aria-describedby="pet-op-v" min="0.25" max="1" step="0.05" value="${p.opacity || 1}">
        <div class="settings-range-labels"><span>25%</span><span>100%</span></div>
      </div>
      <div class="pet-range-field" id="pet-voice-controls" ${character === 'yaya3d' ? '' : 'hidden'}>
        <label><input type="checkbox" id="pet-voice-on" style="width:auto" ${p.voice_enabled === true ? 'checked' : ''}> 芽芽3D本地语音</label>
        <label for="pet-voice-volume">语音音量 <span id="pet-voice-volume-v"></span></label>
        <input type="range" class="settings-range" id="pet-voice-volume" min="0" max="1" step="0.05" value="${Number.isFinite(p.voice_volume) ? Math.max(0, Math.min(1, p.voice_volume)) : .7}">
        <p id="pet-voice-status" role="status">${p.voice_assets?.ready ? '本地资源已就绪：'+p.voice_assets.files+' 个用户提供的音频，无需配置合成。' : '本地资源未确认或缺失，请检查 assets/mp3/ 原始音频。'}</p>
      </div>
      <div style="margin-top:8px"><span class="ok-msg" id="pet-msg"></span></div>
    </div>`;
}
function bindPetCard(pane, p) {
  const msg = pane.querySelector("#pet-msg");
  const q = (id) => pane.querySelector(id);
  const save = (patch) => saveSettings({ pet: patch }, msg);
  if (bindPetCard.voice) bindPetCard.voice.dispose();
  const voice = bindPetCard.voice = window.createPetYayaVoice({ base: '/assets/pet-yaya-voice/' });
  const voiceVolume = q('#pet-voice-volume');
  const syncVoice = () => voice.configure({ character: q('#pet-char').value, voice_enabled: q('#pet-voice-on').checked, voice_volume: Number(voiceVolume.value) });
  syncVoice();
  const observer = new MutationObserver(() => { if (!pane.isConnected || !pane.contains(voiceVolume)) { voice.dispose(); observer.disconnect(); } });
  observer.observe(document.body, { childList: true, subtree: true });
  q('#pet-voice-on').onchange = e => { syncVoice(); save({ voice_enabled: e.target.checked }); };
  voiceVolume.oninput = () => { q('#pet-voice-volume-v').textContent = Math.round(Number(voiceVolume.value)*100)+'%'; updateSettingsRange(voiceVolume); syncVoice(); };
  voiceVolume.onchange = () => save({ voice_volume: Number(voiceVolume.value) });
  voiceVolume.oninput();
  q("#pet-on").onchange = (e) => { if (!e.target.checked) voice.stop(); save({ enabled: e.target.checked }); };
  q("#pet-notify").onchange = (e) => save({ notify: e.target.checked });
  q("#pet-char").onchange = (e) => {
    if (e.target.value === "photo" && !p.has_photo) { msg.textContent = "先上传一张照片"; e.target.value = p.character === undefined || p.character === "photo" ? "yaya3d" : ["cat", "spider", "judy", "fox", "muyu", "yaya", "yaya3d"].includes(p.character) ? p.character : "cat"; return; }
    p.character = e.target.value;
    q('#pet-voice-controls').hidden = e.target.value !== 'yaya3d';
    syncVoice();
    save({ character: e.target.value });
  };
  const scale = q("#pet-scale"), op = q("#pet-op");
  const previewRange = (slider, label) => {
    updateSettingsRange(slider);
    const text = Math.round(Number(slider.value) * 100) + "%";
    q(label).textContent = text;
    slider.setAttribute("aria-valuetext", text);
  };
  scale.oninput = () => previewRange(scale, "#pet-scale-v");
  scale.onchange = () => save({ scale: Number(scale.value) });
  op.oninput = () => previewRange(op, "#pet-op-v");
  op.onchange = () => save({ opacity: Number(op.value) });
  scale.oninput(); op.oninput();

  q("#pet-pick").onclick = () => q("#pet-file").click();
  q("#pet-file").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    msg.textContent = "处理中…";
    try {
      // 前端先裁成 320×320 正方形再传：原图动辄好几 MB，宠物窗口只有 88px，
      // 传原图既浪费又会把 data URL 撑大（形象是通过 IPC 直接推给宠物窗口的）
      const dataUrl = await squareThumb(f, 320);
      const r = await fetch("/api/pet/avatar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data_url: dataUrl }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { msg.textContent = j.error || "上传失败"; return; }
      msg.textContent = "✓ 形象已换上";
      renderSettings("pet");
    } catch (err) { msg.textContent = "读取图片失败：" + err.message; }
  };
  const drop = q("#pet-drop");
  if (drop) drop.onclick = async () => {
    if (!confirm("删除已上传的照片，换回内置小猫？")) return;
    await fetch("/api/pet/avatar", { method: "DELETE" });
    renderSettings("pet");
  };
}
/** 把任意图片裁成居中正方形缩略图（保持比例，取中间）。GIF 会被拍成静态第一帧 */
function squareThumb(file, size) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("读不出这个文件"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("这不是一张能解码的图片"));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const cv = document.createElement("canvas");
        cv.width = cv.height = size;
        const cx = cv.getContext("2d");
        cx.imageSmoothingQuality = "high";
        cx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(cv.toDataURL("image/png"));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

async function renderMemoryPane(pane) {
  const m = await fetch("/api/memory").then(r => r.json());
  const items = m.items || [];
  const rows = items.length
    ? items.map(it => `
      <div class="mem-row">
        <span class="mem-tag">${it.scope === m.shared_tag ? "共享" : "调用方专属"}</span>
        <span class="mem-txt">${esc(it.text)}</span>
        <span class="mem-src">${it.source === "user" ? "手动" : "AI 记的"}</span>
        <a href="#" class="link danger" data-del="${esc(it.id)}">删</a>
      </div>`).join("")
    : '<div style="color:var(--wb-text-3);font-size: 14px;padding:6px 0">还没有。你说「以后都这样」「记住…」时它会自己记一条；也可以在下面手动加。</div>';
  pane.innerHTML = `
    <div class="card-item">
      <div class="t">${uiIcon("pin")} 记住的事（AI 自己记的 + 你手动加的）</div>
      <div class="d" style="margin-bottom:8px">一条一句话，跨任务保留。标「共享」的所有调用方都看得到，按调用方标记的只在对应调用方使用。每个作用域最多 ${esc(String((m.limits || {}).max_items || 120))} 条。</div>
      <div id="mem-items">${rows}</div>
      <div class="form-row" style="margin-top:8px">
        <input id="mem-new" placeholder="手动加一条，例如：周报只要三段——进展 / 问题 / 下周计划">
        <button class="btn-plain" id="mem-add" style="flex:0 0 auto">加进去</button>
      </div>
    </div>
    <div class="card-item">
      <div class="t">${uiIcon("note")} 背景说明（全局共享，原样进提示词）</div>
      <div class="d" style="margin-bottom:8px">适合放团队/业务背景、常用数据口径、固定模板要求这种成段的内容。所有调用方共用一份。</div>
      <textarea id="mem-text" rows="8" placeholder="例如：我们公司是做跨境电商的，主营美妆品类；周报收件人是运营部…">${esc(m.content)}</textarea>
    </div>
    <div class="card-item">
      <div class="t">${uiIcon("move")} 记忆搬家（导出 / 从其它 agent 导入）</div>
      <div class="d" style="margin-bottom:8px">导出成一份 Markdown 到哪都能用。导入自动扫描本机 Claude Code / Codex / Claude Cowork 的记忆文件；腾讯 WorkBuddy 等没有固定文件的，从它界面里把记忆复制出来粘到下面即可。「导入为条目」逐行进上面的条目区（自动去重），「并入背景说明」整段接到背景说明后面。</div>
      <div style="margin-bottom:8px"><button class="btn-plain" id="mem-export">${uiIcon("export", "sm")} 导出全部记忆（.md）</button></div>
      <div id="mem-scan" style="font-size: 13px;color:var(--wb-text-2)">扫描中…</div>
      <textarea id="mem-paste" rows="4" placeholder="或把其它 agent 的记忆文本粘到这里…" style="margin-top:8px"></textarea>
      <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-plain" id="mem-paste-items">导入为条目</button>
        <button class="btn-plain" id="mem-paste-manual">并入背景说明</button>
        <span class="ok-msg" id="mem-imp-msg"></span>
      </div>
    </div>
    <button class="btn-brand" id="mem-save">保存背景说明</button><span class="ok-msg" id="mem-msg"></span>`;
  pane.querySelector("#mem-save").onclick = async () => {
    const resp = await fetch("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: pane.querySelector("#mem-text").value }) });
    pane.querySelector("#mem-msg").textContent = resp.ok ? "✓ 已保存" : "保存失败";
  };
  pane.querySelector("#mem-add").onclick = async () => {
    const text = pane.querySelector("#mem-new").value.trim();
    if (!text) return;
    const r = await fetch("/api/memory/item", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then(r => r.json()).catch(() => ({ note: "网络错误" }));
    toast(r.note || (r.ok ? "已记住" : "没记成"));
    if (r.ok) renderMemoryPane(pane);
  };
  // ---- 记忆搬家 ----
  pane.querySelector("#mem-export").onclick = () => { location.href = "/api/memory/export"; };
  const impMsg = pane.querySelector("#mem-imp-msg");
  const showImp = (r) => {
    if (r.error) { impMsg.textContent = "" + r.error; return; }
    impMsg.textContent = r.note || `✓ 导入 ${r.added} 条${r.skipped ? `，跳过 ${r.skipped} 条（重复/太长/含敏感信息）` : ""}`;
  };
  const doImport = async (body) => {
    impMsg.textContent = "导入中…";
    const r = await fetch("/api/memory/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => ({ error: "网络错误" }));
    showImp(r);
    if (r.ok && r.added) setTimeout(() => renderMemoryPane(pane), 900);
  };
  pane.querySelector("#mem-paste-items").onclick = () => {
    const t = pane.querySelector("#mem-paste").value.trim();
    if (!t) return toast("先把要导入的内容粘进来");
    doImport({ text: t, mode: "items" });
  };
  pane.querySelector("#mem-paste-manual").onclick = () => {
    const t = pane.querySelector("#mem-paste").value.trim();
    if (!t) return toast("先把要导入的内容粘进来");
    doImport({ text: t, mode: "manual" });
  };
  const scanBox = pane.querySelector("#mem-scan");
  fetch("/api/memory/import/scan").then(r => r.json()).then(d => {
    const list = d.sources || [];
    scanBox.innerHTML = list.length ? list.map((s, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:4px 0;border-bottom:1px solid var(--wb-border)">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis" title="${esc(s.path)}">${esc(s.label)}</span>
        <span style="color:var(--wb-text-3)">${fmtSize(s.size)}</span>
        <a href="#" class="link" data-imp-i="${i}" data-imp-mode="items">导入为条目</a>
        <a href="#" class="link" data-imp-i="${i}" data-imp-mode="manual">并入背景说明</a>
      </div>`).join("") : "本机没扫到其它 agent 的记忆文件（Claude Code / Codex / Claude Cowork）。可以用下面的粘贴导入。";
    scanBox.querySelectorAll("[data-imp-i]").forEach(a => a.onclick = (e) => {
      e.preventDefault();
      const s = list[+a.dataset.impI];
      doImport({ path: s.path, mode: a.dataset.impMode });
    });
  }).catch(() => { scanBox.textContent = "扫描失败"; });
  pane.querySelectorAll("[data-del]").forEach(a => a.onclick = async (e) => {
    e.preventDefault();
    await fetch("/api/memory/item/" + encodeURIComponent(a.dataset.del), { method: "DELETE" });
    renderMemoryPane(pane);
  });
}
function renderDataPane(pane, s) {
  pane.innerHTML = `


    <div class="card-item" style="border:1px solid rgba(91,95,247,0.2);border-radius:14px;background:var(--wb-bg);box-shadow:0 4px 20px rgba(0,0,0,0.04);margin-top:14px;">
      <div class="t" style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">
        ${uiIcon("broom")} 本地运行时缓存
      </div>
      <div class="d" id="cache-desc" style="margin-bottom:10px;color:var(--wb-text-2)">统计缓存中…</div>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="settings-action-btn danger" id="cache-clear" style="height:38px;">
          ${uiIcon("broom")} 立即清理缓存
        </button>
        <span class="ok-msg" id="cache-msg"></span>
      </div>
    </div>

    <div class="card-item" style="border:1px solid rgba(91,95,247,0.2);border-radius:14px;background:var(--wb-bg);box-shadow:0 4px 20px rgba(0,0,0,0.04);margin-top:14px;">
      <div class="t" style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">
        ${uiIcon("save")} 数据备份与恢复
      </div>
      <div class="d" style="margin-bottom:10px">备份所有会话记录与配置，恢复时自动还原</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <button class="settings-action-btn primary" id="bk-create" style="height:38px;">
          ${uiIcon("save")} 立即备份
        </button>
        <span class="ok-msg" id="bk-msg"></span>
      </div>
      <div id="bk-list" style="margin-top:10px">加载中…</div>
    </div>
  `;

  const cacheDesc = pane.querySelector("#cache-desc");
  const loadCache = () => fetch("/api/cache").then(r => r.json()).then(c => {
    cacheDesc.textContent = `界面缓存 ${fmtSize(c.ui)} · 临时脚本 ${fmtSize(c.tmp)}，共 ${fmtSize(c.total)}。只清可再生的缓存，不动会话记录、工作区文件和登录态。`;
  }).catch(() => { cacheDesc.textContent = "统计失败"; });
  loadCache();
  pane.querySelector("#cache-clear").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "清理中…";
    try {
      const r = await fetch("/api/cache/clear", { method: "POST" }).then(r => r.json());
      pane.querySelector("#cache-msg").textContent = r.ok ? `已释放 ${fmtSize(r.freed)}` : (r.error || "清理失败");
    } catch { pane.querySelector("#cache-msg").textContent = "清理失败"; }
    btn.disabled = false; btn.innerHTML = uiIcon("broom") + " 立即清理缓存";
    loadCache();
  };
  // ---- 备份 ----
  const bkMsg = pane.querySelector("#bk-msg");
  const bkList = pane.querySelector("#bk-list");
  const loadBackups = () => fetch("/api/backup").then(r => r.json()).then(d => {
    if (d.error) { bkList.textContent = d.error; return; }
    const list = d.list || [];
    bkList.innerHTML = list.length ? list.map(b => `
      <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--wb-border)">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(b.name)}</span>
        <span style="color:var(--wb-text-3)">${fmtSize(b.size)}</span>
        <a href="#" class="link" data-bk-restore="${esc(b.name)}">恢复</a>
        <a href="/api/backup/download/${encodeURIComponent(b.name)}" class="link">下载</a>
        <a href="#" class="link danger" data-bk-del="${esc(b.name)}">删</a>
      </div>`).join("") : "还没有备份。";
    bkList.querySelectorAll("[data-bk-del]").forEach(a => a.onclick = async (e) => {
      e.preventDefault();
      if (!confirm(`确认删除备份 ${a.dataset.bkDel}？`)) return;
      await fetch("/api/backup/" + encodeURIComponent(a.dataset.bkDel), { method: "DELETE" });
      loadBackups();
    });
    bkList.querySelectorAll("[data-bk-restore]").forEach(a => a.onclick = async (e) => {
      e.preventDefault();
      if (!confirm(`确认恢复到备份 ${a.dataset.bkRestore} 的状态？\n\n当前数据会先自动备份一份，恢复后需重启应用生效。`)) return;
      bkMsg.textContent = "恢复中…";
      const r = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: a.dataset.bkRestore }) }).then(r => r.json()).catch(() => ({ error: "网络错误" }));
      if (r.error) { bkMsg.textContent = "" + r.error; return; }
      bkMsg.textContent = "";
      if (confirm("已恢复到磁盘（恢复前现状已自动备份）。\n\n现在重启应用让它完全生效？")) {
        const rr = await fetch("/api/backup/restart", { method: "POST" }).then(r => r.json()).catch(() => ({}));
        if (rr.error) toast("" + rr.error);
      } else {
        toast("记得手动重启应用，恢复才完全生效");
      }
      loadBackups();
    });
  }).catch(() => { bkList.textContent = "加载失败"; });
  loadBackups();
  pane.querySelector("#bk-create").onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "备份中…";
    const r = await fetch("/api/backup", { method: "POST" }).then(r => r.json()).catch(() => ({ error: "网络错误" }));
    bkMsg.textContent = r.ok ? `✓ 已备份：${r.name}` : ("" + (r.error || "备份失败"));
    btn.disabled = false; btn.textContent = "立即备份";
    loadBackups();
  };
}

// ================= 安全中心面板 =================
