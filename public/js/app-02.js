// menu 不传就是输入框右下角那个；助理页顶栏那个把自己的容器传进来，两处共用同一份菜单
function renderModelMenu(menu) {
  // 如果没有传入 menu 且 modelMenu 未定义，直接返回
  if (!menu && typeof modelMenu === 'undefined') return;
  if (!menu) menu = modelMenu;
  if (!settingsCache || !menu) return;
  const ov = currentSessModel();

  // 二级分类：从模型名 "Provider - model" 提取 Provider，分6类
  const providerNames = { gpt: 'GPT', claude: 'Claude', grok: 'Grok', gemini: 'Gemini', custom: '国模', welfare: '福利' };
  const categories = [
    { key: 'gpt', label: 'GPT', models: [] },
    { key: 'claude', label: 'Claude', models: [] },
    { key: 'grok', label: 'Grok', models: [] },
    { key: 'gemini', label: 'Gemini', models: [] },
    { key: 'custom', label: '国模', models: [] },
    { key: 'welfare', label: '福利', models: [] },
  ];
  const catMap = {};
  categories.forEach(c => { catMap[c.key] = c; });

  settingsCache.models.forEach(m => {
    // 过滤掉没有配置 Key 的模型（本地模型除外）
    const isLocal = /ollama|本地/i.test(m.name || "") || /localhost|127\.0\.0\.1/i.test(m.base_url || "");
    const hasKey = String(m.api_key || "").trim().length > 0;
    if (!isLocal && !hasKey) return; // 跳过没有 Key 的非本地模型

    const prefix = (m.name || "").split(" - ")[0].trim();
    for (const [k, label] of Object.entries(providerNames)) {
      if (prefix === label) {
        catMap[k].models.push(m);
        return;
      }
    }
    // 没匹配上的归到国模
    catMap.custom.models.push(m);
  });

  // 过滤掉空分类
  const validCats = categories.filter(c => c.models.length > 0);
  // 默认展开「当前选中的模型」所在的分类——一打开就能看到自己在用哪个，
  // 不然 27 个模型分完类后，用户还得自己猜当前那个藏在哪一类里
  const cur = ov || settingsCache.active_model;
  const firstCat = (validCats.find(c => c.models.some(m => m.name === cur)) || validCats[0] || {}).key || "custom";

  menu.innerHTML = `
    <div class="mm-top">
      <div class="mi ${ov ? "" : "on"}" data-act="default" style="justify-content:space-between;margin-bottom:6px;border-bottom:1px solid var(--wb-border);padding-bottom:6px">
        <span>↺ 跟随全局默认 <span class="sub">${esc(settingsCache.active_model)}${healthBadge(settingsCache.active_model)}</span></span>${ov ? "" : '<span style="color:var(--wb-ok)">✓</span>'}
      </div>
    </div>
    <div class="mm-cascade">
      <div class="mm-cats">
        ${validCats.map(c => `<div class="mm-cat ${c.key === firstCat ? "active" : ""}" data-cat="${c.key}">${esc(c.label)}</div>`).join("")}
      </div>
      <div class="mm-models">
        ${validCats.map(c => `
          <div class="mm-models-group ${c.key === firstCat ? "active" : ""}" data-cat="${c.key}">
            ${c.models.map(m => {
              const on = m.name === ov;
              // 拆分展示：提取 Provider 和 模型标识，结构化左右对齐或统一间距
              const rawName = String(m.name || "");
              const partsRaw = rawName.split(" - ");
              let provTag = "";
              let modDisplay = rawName;
              if (partsRaw.length >= 2) {
                provTag = partsRaw[0].trim();
                modDisplay = partsRaw.slice(1).join(" - ").trim();
              }
              const dup = m.model && (m.model === modDisplay || m.model === rawName);
              const parts = [];
              if (m.model && !dup) parts.push(esc(m.model));
              if (!m.api_key) parts.push("⚠ 未填Key");
              const health = healthBadge(m.name);
              let subTxt = parts.join(" · ");
              subTxt += subTxt ? health : health.replace(/^\s*·\s*/, "");

              return `<div class="mi mm-model-item ${on ? "on" : ""}" data-name="${esc(m.name)}">
                <div class="mm-item-left">
                  ${provTag ? `<span class="mm-prov-tag">${esc(provTag)}</span><span class="mm-prov-sep">-</span>` : ""}
                  <span class="mm-model-name">${esc(modDisplay)}</span>
                  ${subTxt ? `<span class="sub mm-model-sub">${subTxt}</span>` : ""}
                </div>
                ${on ? '<span class="mm-check" style="color:var(--wb-ok)">✓</span>' : ""}
              </div>`;
            }).join("")}
          </div>
        `).join("")}
      </div>
    </div>
    <div class="mi" data-act="manage" style="border-top:1px solid var(--wb-border);margin-top:4px">${uiIcon("settings", "sm")} 管理模型…</div>
  `;

  // 分类切换
  menu.querySelectorAll(".mm-cat").forEach(cat => {
    cat.onclick = (e) => {
      e.stopPropagation();
      const key = cat.dataset.cat;
      menu.querySelectorAll(".mm-cat").forEach(c => c.classList.remove("active"));
      menu.querySelectorAll(".mm-models-group").forEach(g => g.classList.remove("active"));
      cat.classList.add("active");
      menu.querySelector(`.mm-models-group[data-cat="${key}"]`)?.classList.add("active");
    };
  });

  // 模型选择
  menu.querySelectorAll(".mi").forEach(mi => mi.onclick = async () => {
    menu.classList.remove("show");
    if (mi.dataset.act === "manage") return openModal("settings", "models");
    if (mi.dataset.act === "default") {
      await setSessionModel(null);
      return;
    }
    if (mi.dataset.name) {
      await setSessionModel(mi.dataset.name);
      // 保存到当前项目的 localStorage 缓存
      if (typeof activeProject !== 'undefined' && activeProject) {
        localStorage.setItem(`project_model_${activeProject}`, mi.dataset.name);
      }
    }
  });
}

// ================= Goal 目标卡 =================
function renderGoalCard() {
  const card = document.getElementById("goal-card");
  const g = sessionId && sessionGoals.get(sessionId);
  if (!g || g.status === "closed") { card.style.display = "none"; card.innerHTML = ""; return; }
  const doneN = g.criteria.filter(c => c.done).length;
  card.style.display = "";
  card.innerHTML = `
    <div class="gc-head">
      <span class="gc-title">🎯 ${esc(g.text)}</span>
      <span class="gc-meta">${g.status === "done" ? '<span class="gc-done">已达成 ✓</span>' : `${doneN}/${g.criteria.length} · 第 ${g.round || 0} 轮`}</span>
      <button class="gc-close" title="归档目标（不再显示，也不再按它验收）">✕</button>
    </div>
    <div class="gc-list">${g.criteria.map(c => `<div class="gc-item ${c.done ? "ok" : ""}">${c.done ? "✅" : "⬜"} ${esc(c.text)}</div>`).join("")}</div>`;
  card.querySelector(".gc-close").onclick = async () => {
    try { await fetch("/api/session/" + encodeURIComponent(sessionId) + "/goal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "close" }) }); } catch {}
    g.status = "closed";
    renderGoalCard();
  };
}

// ================= 工作空间选择（快捷栏，仿官方"选择工作空间"） =================
const wsMenu = setupPicker("ws-btn", "ws-menu");
function renderWsMenu() {
  wsMenu.innerHTML =
    `<div class="mi" data-act="cur">📁 ${esc(settingsCache.workspace_dir)}</div>
     <div class="mi" data-act="pick">📂 选择新文件夹…</div>
     <div class="mi" data-act="open">🗂 打开当前文件夹</div>`;
  wsMenu.querySelectorAll(".mi").forEach(mi => mi.onclick = async () => {
    wsMenu.classList.remove("show");
    if (mi.dataset.act === "pick") {
      const r = await fetch("/api/pick-folder", { method: "POST" }).then(r => r.json()).catch(() => ({}));
      if (r.path) {
        const d = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_dir: r.path }) }).then(x => x.json()).catch(() => ({}));
        // 有任务在跑时服务端会保留原目录（其余设置照存），把这件事说出来，别让用户以为切好了
        if (d.workspace_skipped) toast("⏳ " + d.workspace_skipped);
        refreshSettingsCache();
        // Fix C: 刷新文件列表时传递当前项目参数
        refreshProjectFiles();
      } else if (r.error) {
        const p = prompt("输入工作空间文件夹的完整路径：", settingsCache.workspace_dir);
        if (p) {
          const d = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_dir: p }) }).then(x => x.json()).catch(() => ({}));
          if (d.workspace_skipped) toast("⏳ " + d.workspace_skipped);
          refreshSettingsCache();
        }
      }
    } else if (mi.dataset.act === "open") fetch("/api/open-workspace", { method: "POST" });
  });
}
refreshSettingsCache();

// ================= 推理强度选择 =================
const thinkingMenu = setupPicker("thinking-btn", "thinking-menu");
const THINKING_LEVELS = [
  { value: 'low', label: '低', desc: '快速响应，适合简单任务' },
  { value: 'medium', label: '中', desc: '平衡速度和质量' },
  { value: 'high', label: '高', desc: '深度思考，适合复杂任务' },
  { value: 'xhigh', label: '极高', desc: '极强推理能力，深度分析' },
  { value: 'max', label: '最高', desc: '最强推理能力，耗时较长' }
];
let currentThinking = 'xhigh'; // 默认极高强度

function renderThinkingMenu() {
  if (!thinkingMenu) return;
  thinkingMenu.innerHTML = THINKING_LEVELS.map(level => {
    const on = level.value === currentThinking;
    return `<div class="mi ${on ? "on" : ""}" data-level="${level.value}" style="justify-content:space-between">
      <span>⚡ ${level.label} <span class="sub">${level.desc}</span></span>
      ${on ? '<span style="color:var(--wb-ok)">✓</span>' : ""}</div>`;
  }).join("");

  thinkingMenu.querySelectorAll(".mi").forEach(mi => mi.onclick = () => {
    currentThinking = mi.dataset.level;
    updateThinkingLabel();
    thinkingMenu.classList.remove("show");
  });
}

function updateThinkingLabel() {
  const level = THINKING_LEVELS.find(l => l.value === currentThinking);
  document.getElementById("thinking-label").textContent = level ? level.label : '中';
  renderThinkingMenu();
}

// 初始化推理强度菜单
renderThinkingMenu();
updateThinkingLabel();

// ================= 模式选择（快捷栏"默认权限"式下拉） =================
const modeMenu = setupPicker("mode-btn", "mode-menu");
const MODE_LABEL = { craft: "✅ Craft · 执行", goal: "🎯 Goal · 目标", plan: "🗺️ Plan · 规划", ask: "💬 Ask · 问答" };
function setMode(mode) {
  currentMode = mode;
  if (typeof syncDelegationControl === "function") syncDelegationControl();
  if (["ask", "plan"].includes(mode) && ["expert", "team"].includes(getPendingDelegation().type)) setPendingDelegation({ type: "auto" });
  document.getElementById("mode-label").textContent = MODE_LABEL[mode].slice(2).trim();
  modeMenu.querySelectorAll(".mi").forEach(x => x.classList.toggle("on", x.dataset.mode === mode));
  inputEl.placeholder = mode === "ask" ? "问我任何问题（不会修改文件）…"
    : mode === "goal" ? "描述你的目标，我拆成验收标准，没达成自动接着跑…"
    : mode === "plan" ? "描述任务，我先给你出执行计划…"
    : "今天帮你做些什么？可以让我处理数据、写报告、做 PPT、联网调研…";
}
modeMenu.querySelectorAll(".mi").forEach(mi => mi.onclick = () => {
  setMode(mi.dataset.mode);
  modeMenu.classList.remove("show");
});

// ================= ＋ 上传文件到工作空间（选择/拖拽共用） =================
const attachChips = document.getElementById("attach-chips");
const pendingAttach = []; // 已上传、待随下一条消息发出的附件名。发送时才拼进消息文本，绝不往输入框里塞标记
function addAttachChip(name, thumbUrl, hint) {
  if (pendingAttach.includes(name)) return; // 同名重复上传只留一个 chip（文件本身已覆盖更新）
  pendingAttach.push(name);
  const chip = document.createElement("span");
  if (thumbUrl) {
    // 截图之间光看文件名分不出谁是谁，给张缩略图才知道自己贴对了没有
    const img = document.createElement("img");
    img.src = thumbUrl;
    img.className = "attach-thumb";
    img.alt = "";
    chip.appendChild(img);
  }
  chip.appendChild(document.createTextNode(thumbUrl ? name : "📎 " + name));
  if (hint) chip.title = hint; // 鼠标停上去能看见开头几行，确认贴的是哪一段
  const x = document.createElement("b");
  x.textContent = "✕";
  x.title = "从这条消息移除（文件仍在工作目录里）";
  x.onclick = () => { const i = pendingAttach.indexOf(name); if (i >= 0) pendingAttach.splice(i, 1); chip.remove(); };
  chip.appendChild(x);
  attachChips.appendChild(chip);
}
/** 二进制转 base64。必须分块喂 fromCharCode：一个字节一个字节拼字符串，30MB 的文件能把界面卡死好几秒 */
function bytesToB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return btoa(s);
}
/** 往工作空间放一份内容并挂上 chip。文件、截图、粘贴进来的大段文字,最后都走这里 */
async function uploadBytes(name, u8, { thumbMime, hint, project = activeProject, sid = sessionId } = {}) {
  const b64 = bytesToB64(u8);
  const resp = await fetch("/api/upload", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, data_b64: b64, project }),
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  if (activeProject === project && sessionId === sid) {
    addAttachChip(name, thumbMime ? `data:${thumbMime};base64,${b64}` : "", hint);
  }
  refreshProjectFiles(project);
}
async function uploadFiles(fileList, { rename } = {}) {
  const project = activeProject, sid = sessionId;
  for (const file of fileList) {
    if (file.size > 30 * 1048576) { toast(`${file.name} 超过 30MB，跳过`); continue; }
    try {
      const name = rename ? rename(file) : file.name;
      const buf = await file.arrayBuffer();
      await uploadBytes(name, new Uint8Array(buf), { thumbMime: /^image\//.test(file.type) ? file.type : "", project, sid });
    } catch (err) {
      toast(`❌ 上传失败: ${file.name}`); // 拖进来的是文件夹时读不出内容，也走这里
    }
  }
}
/**
 * 时间戳文件名。同一秒里连贴两张截图会撞名，撞上就往后编号——
 * 不编号的话第二张会把第一张覆盖掉，而且 chip 按名字去重，界面上只剩一个，用户根本看不出来丢了一张。
 */
function stampName(prefix, ext) {
  const d = new Date();
  const p2 = (x) => String(x).padStart(2, "0");
  const stem = `${prefix}_${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  let name = `${stem}.${ext}`;
  for (let i = 2; pendingAttach.includes(name); i++) name = `${stem}-${i}.${ext}`;
  return name;
}
/**
 * 大段文字（日志、报错、整篇文档）不塞进输入框，落成工作空间里的一个 .txt 再挂 chip。
 * 塞进输入框有三处坏处：输入框被撑成一屏没法再打字、发出去的气泡里几万字滚不到头、
 * 而且这段文字会原样躺在对话历史里被每一步重发一遍。落成文件之后模型按需 read_file，
 * 要看第几行看第几行。
 */
const BIG_TEXT_CHARS = 2000;
async function uploadText(text, { name } = {}) {
  const fname = name || stampName("粘贴文本", "txt");
  const head = text.replace(/\s+/g, " ").trim().slice(0, 80);
  try {
    await uploadBytes(fname, new TextEncoder().encode(text), { hint: head + (text.length > 80 ? "…" : "") });
    toast(`大段文字已存成 ${fname}（${text.length.toLocaleString()} 字），发消息时一起带给它`);
    return true;
  } catch (err) {
    toast("❌ 文字存盘失败，已按普通粘贴处理");
    return false;
  }
}
/** 把输入框文字和待发附件合成一条要发出的消息，并清空两者。附件标记只在这里拼，界面上永远只见 chip */
function composeOutgoing() {
  const typed = inputEl.value.trim();
  const note = pendingAttach.length ? `（已上传文件：${pendingAttach.join("、")}）` : "";
  if (!typed && !note) return "";
  inputEl.value = "";
  syncInputHl();
  attachChips.innerHTML = "";
  pendingAttach.length = 0;
  return typed && note ? typed + "\n" + note : typed || note;
}
document.getElementById("attach-btn").onclick = () => document.getElementById("file-input").click();
document.getElementById("file-input").addEventListener("change", async (e) => {
  await uploadFiles(e.target.files);
  e.target.value = "";
});
// 拖文件进窗口即上传。document 级必须拦掉默认行为，否则 Electron 会把整个页面导航到 file:// 吞掉应用
let dragDepth = 0;
const inputCard = attachChips.closest(".input-card");
document.addEventListener("dragover", (e) => e.preventDefault());
const dragHasPayload = (e) => {
  const t = [...((e.dataTransfer || {}).types || [])];
  return t.includes("Files") || t.includes("text/plain") || t.includes("text/uri-list");
};
document.addEventListener("dragenter", (e) => {
  if (!dragHasPayload(e)) return;
  dragDepth++;
  inputCard?.classList.add("dragging");
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) { dragDepth = 0; inputCard?.classList.remove("dragging"); }
});
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  inputCard?.classList.remove("dragging");
  const dt = e.dataTransfer || {};
  const files = [...(dt.files || [])];
  if (files.length) { await uploadFiles(files); return; }
  // 从浏览器/编辑器里选中一段文字直接拖进来
  const text = (dt.getData ? dt.getData("text/plain") : "") || "";
  if (!text.trim()) return;
  if (text.length > BIG_TEXT_CHARS) { await uploadText(text); return; }
  insertAtCursor(inputEl, text); // 短的就落到输入框里，让用户接着打字
});
/** 在光标处插入文字（拖进来的短文本）。直接 += 会把用户已经写好的半句话顶到后面去 */
function insertAtCursor(el, text) {
  const a = el.selectionStart ?? el.value.length;
  const b = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, a) + text + el.value.slice(b);
  el.selectionStart = el.selectionEnd = a + text.length;
  el.focus();
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// ================= 粘贴即上传（截图、Finder 里复制的文件） =================
/**
 * 剪贴板里的截图一律叫 image.png——连贴两张，第二张会把第一张覆盖掉，而且用户完全看不出来
 * （chip 按名字去重，只剩一个）。所以只要名字是这种通用名，就按贴的时刻另起一个。
 */
function pastedName(file) {
  const generic = /^(image|图像|截屏|screenshot|未命名)?\.?(png|jpe?g|gif|webp|bmp|heic)?$/i;
  if (file.name && !generic.test(file.name)) return file.name; // Finder 里复制的真文件，保留原名
  return stampName("粘贴图片", (file.type.split("/")[1] || "png").replace("jpeg", "jpg"));
}
document.addEventListener("paste", async (e) => {
  const t = e.target;
  // 别抢别处输入框的粘贴：设置里的记忆文本框、搜索框都得能正常粘文字
  const editable = t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));
  if (editable && t !== inputEl) return;
  const cd = e.clipboardData;
  if (!cd) return;
  // 有文字就按文字处理——从网页/表格复制来的内容常常同时带一张图，那时用户要的是文字。
  // 纯截图不带 text/plain，正好落到下面走文件那条路。
  const text = cd.getData("text/plain");
  if (text.trim()) {
    if (text.length <= BIG_TEXT_CHARS) return; // 短文本照常粘进输入框，别多管
    e.preventDefault();
    // 存盘失败就退回普通粘贴，别把用户复制的东西弄丢（焦点不在输入框时无处可退，只能作罢）
    if (!(await uploadText(text)) && t === inputEl) insertAtCursor(inputEl, text);
    return;
  }
  const files = [...(cd.files || [])];
  if (!files.length) return;
  e.preventDefault();
  await uploadFiles(files, { rename: pastedName });
  toast(files.length > 1 ? `已贴上 ${files.length} 个文件` : "图片已贴上，发消息时会一起带给它");
});

// ================= 会话历史（服务端持久化 + 回放，按项目过滤） =================
function openHistoryMenu(item, toggle = false) {
  const dropdown = item.querySelector(".hmenu-dropdown");
  const wasOpen = dropdown.classList.contains("show");
  document.querySelectorAll(".hmenu-dropdown.show").forEach(d => d.classList.remove("show"));
  const rename = dropdown.querySelector('[data-action="rename"]');
  rename.disabled = runningSessions.has(item.dataset.id);
  dropdown.querySelector('[data-action="delete"]').disabled = runningSessions.has(item.dataset.id);
  if (!toggle || !wasOpen) dropdown.classList.add("show");
}
let historyRename = null;
function showRenameSession(id) {
  if (runningSessions.has(id)) { toast("任务运行中，暂不能重命名"); return; }
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  if (historyRename) { historyRename.input.focus(); return; }
  const item = [...document.querySelectorAll(".hist-item")].find(el => el.dataset.id === id);
  const ht = item?.querySelector(".ht");
  if (!ht) return;
  const input = document.createElement("input");
  input.className = "history-title-input";
  input.setAttribute("aria-label", "任务标题");
  input.value = stripSceneTag(s.title);
  const state = historyRename = { id, input, project: activeProject, pending: false, composing: false };
  const close = () => { if (historyRename === state) { historyRename = null; renderHistory(); } };
  const error = message => { input.title = message; input.setAttribute("aria-invalid", "true"); toast(message); };
  const save = async () => {
    if (historyRename !== state || state.pending || state.composing) return;
    if (runningSessions.has(id)) { error("任务运行中，暂不能重命名"); return; }
    const title = input.value.trim();
    if (!title || [...title].length > 100 || /[\u0000-\u001f\u007f]/u.test(title)) {
      error("标题须为 1–100 个字符，不能包含控制字符"); return;
    }
    if (title === stripSceneTag(s.title)) { close(); return; }
    state.pending = true; input.readOnly = true;
    input.removeAttribute("aria-invalid");
    try {
      const response = await fetch("/api/session/" + encodeURIComponent(id) + "/title", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "重命名失败，请重试");
      const current = sessions.find(x => x.id === id);
      if (current) {
        current.title = data.title;
        saveSessions();
        if (sessionId === id) document.getElementById("session-title").textContent = stripSceneTag(data.title);
      }
      close();
    } catch (err) { error(err.message || "保存失败，请重试"); }
    finally { state.pending = false; input.readOnly = runningSessions.has(id); }
  };
  input.addEventListener("compositionstart", () => { state.composing = true; });
  input.addEventListener("compositionend", () => {
    state.composing = false;
    if (document.activeElement !== input) save();
  });
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.isComposing || state.composing || e.keyCode === 229) return;
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); if (!state.pending) close(); }
  });
  input.addEventListener("blur", save);
  input.addEventListener("click", e => e.stopPropagation());
  ht.replaceChildren(input);
  input.focus(); input.select();
}
function projectHasRunning(name) {
  return sessions.some(s => (s.project || "默认项目") === name && runningSessions.has(s.id));
}
function syncDeleteControls() {
  document.querySelectorAll('.proj-item .del, .proj-card[data-name] [data-act="del"]').forEach(el => {
    const name = el.closest('[data-name]').dataset.name;
    el.disabled = projectHasRunning(name);
    el.title = el.disabled ? "项目内有任务运行中，暂不能移除" : "移除项目（不删文件）";
  });
}
async function removeProject(name) {
  if (projectHasRunning(name)) { toast("项目内有任务运行中，暂不能移除"); return false; }
  try {
    const r = await fetch("/api/projects/" + encodeURIComponent(name), { method: "DELETE" });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || "移除失败");
    await refreshProjects(); await refreshSettingsCache();
    return true;
  } catch (err) { toast("❌ " + (err.message || "移除失败")); return false; }
}
function renderHistory() {
  syncDeleteControls();
  // 同一项目刷新保留原 DOM、焦点、选区及输入法状态；切项目时取消未提交草稿。
  if (historyRename) {
    const state = historyRename;
    if (state.project === activeProject && sessions.some(s => s.id === state.id)) {
      state.input.readOnly = state.pending || runningSessions.has(state.id);
      document.querySelectorAll('.hist-item .hmenu-opt[data-action="rename"], .hist-item .hmenu-opt[data-action="delete"]').forEach(el => {
        el.disabled = runningSessions.has(el.closest('.hist-item').dataset.id);
      });
      return;
    }
    historyRename = null;
  }
  // 修复：更健壮的项目匹配逻辑
  // 1. 如果会话没有 project 字段，归属到"默认项目"
  // 2. 匹配时统一使用标准化后的项目名
  const normalizeProject = (p) => String(p || "默认项目").trim();
  const currentProject = normalizeProject(activeProject);

  let list = sessions.filter(s => {
    const sessionProject = normalizeProject(s.project);
    return sessionProject === currentProject;
  });

  // 置顶对话排在前面
  const pinned = list.filter(s => s.pinned);
  const unpinned = list.filter(s => !s.pinned);
  list = [...pinned, ...unpinned];

  // 调试信息：如果列表为空，输出调试日志
  if (list.length === 0 && sessions.length > 0) {
    console.log('[调试] 当前项目无对话', {
      activeProject: currentProject,
      totalSessions: sessions.length,
      sessionProjects: sessions.map(s => ({ id: s.id, title: s.title, project: s.project || '(空)' }))
    });
  }

  document.getElementById("history").innerHTML = list.map(s =>
    `<div class="hist-item ${s.id === sessionId ? "active" : ""} ${s.pinned ? "pinned" : ""}" data-id="${s.id}" title="${esc(stripSceneTag(s.title))}"><span class="ht">${s.source === "remote" ? '<span class="hremote" title="手机远程任务">📱</span>' : ""}${esc(stripSceneTag(s.title))}</span>${(runningSessions.has(s.id) || s.remote_running) ? '<span class="hrun" title="任务运行中"></span>' : ""}<span class="hmenu" title="更多操作">⋯</span><div class="hmenu-dropdown"><div class="hmenu-opt" data-action="pin">${s.pinned ? '取消置顶' : '📌 置顶对话'}</div><button type="button" class="hmenu-opt" data-action="rename" ${runningSessions.has(s.id) ? 'disabled title="任务运行中，暂不能重命名"' : ''}>重命名</button><button type="button" class="hmenu-opt danger" data-action="delete" ${runningSessions.has(s.id) ? 'disabled title="任务运行中，暂不能删除"' : ''}>🗑 删除对话</button></div></div>`).join("")
    || '<div style="font-size: 13px;color:var(--wb-text-3);padding:4px 10px">该项目还没有任务</div>';
}
document.getElementById("history").addEventListener("click", async (e) => {
  const item = e.target.closest(".hist-item");
  if (!item) return;

  // 三个点菜单按钮
  if (e.target.closest(".hmenu")) {
    e.stopPropagation();
    openHistoryMenu(item, true);
    return;
  }

  // 菜单选项
  if (e.target.closest(".hmenu-opt")) {
    e.stopPropagation();
    const opt = e.target.closest(".hmenu-opt");
    const action = opt.dataset.action;
    const id = item.dataset.id;
    const s = sessions.find(x => x.id === id);

    // 关闭下拉菜单
    item.querySelector(".hmenu-dropdown").classList.remove("show");

    if (action === "rename") {
      showRenameSession(id); // 再检查运行状态，不能仅依赖菜单打开时的 disabled。
      return;
    }
    if (action === "pin") {
      // 置顶/取消置顶
      if (s) {
        s.pinned = !s.pinned;
        saveSessions();
        renderHistory();
      }
      return;
    }

    if (action === "delete") {
      if (runningSessions.has(id)) { toast("任务运行中，暂不能删除"); return; }
      const title = s ? stripSceneTag(s.title) : "任务";
      const doDel = async () => {
        if (runningSessions.has(id)) { toast("任务运行中，暂不能删除"); return; }
        try {
          const r = await fetch("/api/session/" + encodeURIComponent(id), { method: "DELETE" });
          const d = await r.json();
          if (!r.ok || !d.ok) throw new Error(d.error || "删除失败");
          if (historyRename?.id === id) historyRename = null;
          sessions = sessions.filter(s => s.id !== id);
          saveSessions();
          sessionQueues.delete(id);
          if (sessionId === id) document.getElementById("new-task").click();
          else renderHistory();
        } catch (err) { toast("❌ " + (err.message || "删除失败")); }
      };

      if (typeof showConfirmDialog === "function") {
        showConfirmDialog({
          title: `删除对话「${title}」？`,
          desc: "删除该任务及其所有对话记录与产物关联（不可撤销）。",
          confirmText: "确认删除",
          cancelText: "取消",
          icon: "trash",
          danger: true,
          onConfirm: doDel
        });
      } else {
        if (confirm("删除该任务及其对话记录？")) doDel();
      }
      return;
    }
  }

  // 点击对话项本身（不是菜单按钮和选项）
  if (e.target.closest(".hmenu-dropdown")) return;

  closeAssistView();
  sessionId = item.dataset.id;
  // 上个会话开着的预览/文件面板不带进来
  pvPanel.classList.remove("show"); pvCurrent = null;
  document.getElementById("files-panel").classList.remove("show");
  const s = sessions.find(x => x.id === sessionId);
  const remoteReplayClick = s?.source === "remote" && typeof remoteReplayBegin === "function";
  const remoteReplayGeneration = typeof remoteReplayBegin === "function" ? remoteReplayBegin(sessionId, remoteReplayClick ? (s.remote_event_count || 0) : 0) : 0;
  if (typeof remoteReplayState !== "undefined") remoteReplayState.inFlight = remoteReplayClick;
  document.getElementById("session-title").textContent = s ? stripSceneTag(s.title) : "任务";
  renderHistory();
  // 更新上下文百分比显示：先归零再拉新值，否则请求在飞的这几百毫秒里
  // 头上挂的还是上一条对话的占比
  if (typeof resetContextIndicator === 'function') resetContextIndicator("正在读取上下文用量…");
  if (typeof updateContextIndicator === 'function') updateContextIndicator();
  // 回放服务端保存的完整对话（含工具执行过程）
  setPendingDelegation({ type: "auto" });
  chatCol.innerHTML = "";
  const loadingSid = sessionId;
  const data = await fetch("/api/session/" + encodeURIComponent(loadingSid)).then(r => r.json()).catch(() => ({ transcript: [] }));
  if (sessionId !== loadingSid) {
    if (typeof remoteReplayState !== "undefined" && remoteReplayState.owner === remoteReplayGeneration) remoteReplayState.inFlight = false;
    return;
  }
  if (s && data.project) { s.project = data.project; saveSessions(); }
  if (s?.source === "remote") {
    const count = (data.transcript || []).reduce((n, entry) => n + (entry.events?.length || 0), 0);
    s.remote_event_count = count;
    if (typeof remoteReplayState !== "undefined" && remoteReplayState.owner === remoteReplayGeneration) remoteReplayState.key = sessionId + ":" + count;
  }

  // 如果会话有关联的项目，且与当前activeProject不同，则切换到该项目
  if (data.project && data.project !== activeProject) {
    activeProject = data.project;
    resetProjectFileState();
    renderProjects();
    // 刷新文件列表以匹配项目
    refreshProjectFiles(data.project);
  }

  if (data.dir && sessionDirs.get(sessionId) !== data.dir) { sessionDirs.set(sessionId, data.dir); openDirs.add(data.dir); renderFiles(filesCache); }
  if (data.model) sessionModels.set(sessionId, data.model); else sessionModels.delete(sessionId);
  updateModelLabel();
  if (data.goal) sessionGoals.set(sessionId, data.goal); else sessionGoals.delete(sessionId);
  renderGoalCard();
  let transcript = data.transcript || [];
  // 该会话有任务正在后台跑：回放只到本轮之前，正在跑的这轮把"活的"回合元素接回来
  //（它切走期间一直在后台收事件更新，接上就是完整直播，不用回放+续流拼接）
  const live = runningSessions.get(sessionId);
  if (live) {
    const lastUser = transcript.map(e => e.type).lastIndexOf("user");
    if (lastUser >= 0) transcript = transcript.slice(0, lastUser);
  }
  let ui = null;
  isReplaying = true;
  try {
    for (const entry of transcript) {
      if (entry.type === "user") {
        ui = createTurnUI(entry.text, entry.mode, sessionId, entry.delegation);
      } else if (entry.type === "assistant" && ui) {
        for (const ev of entry.events || []) ui.handleEvent(ev);
        ui.finish();
      }
    }
  } finally {
    isReplaying = false;
    if (typeof remoteReplayState !== "undefined" && remoteReplayState.owner === remoteReplayGeneration) remoteReplayState.inFlight = false;
  }
  if (live) {
    document.getElementById("empty")?.remove();
    chatCol.appendChild(live.ui.turn);
  } else if (!transcript.length) {
    chatCol.innerHTML = '<div style="text-align:center;color:var(--wb-text-3);font-size: 13px;padding:20px">该任务还没有保存的对话记录（可能创建于旧版本），继续对话即可。</div>';
  }
  updateSendUI();
  scrollBottom(true);
});

document.getElementById("history").addEventListener("contextmenu", e => {
  const item = e.target.closest(".hist-item");
  if (!item) return;
  e.preventDefault(); e.stopPropagation();
  openHistoryMenu(item);
});

// 全局点击关闭历史菜单下拉框
document.addEventListener("click", (e) => {
  if (!e.target.closest(".hmenu") && !e.target.closest(".hmenu-dropdown")) {
    document.querySelectorAll(".hmenu-dropdown.show").forEach(d => d.classList.remove("show"));
  }
});

document.getElementById("new-task").onclick = () => {
  setPendingDelegation({ type: "auto" });
  closeAssistView();
  sessionId = null;
  pendingModel = defaultPendingModel();
  updateModelLabel();
  renderGoalCard();
  // 新任务还没有 history：占比必须立刻归零，不能留着上一条对话/上一个项目的数字
  if (typeof resetContextIndicator === 'function') resetContextIndicator("新任务，暂无上下文");
  pvPanel.classList.remove("show"); pvCurrent = null;
  document.getElementById("files-panel").classList.remove("show");
  updateSendUI(); // 新对话不是忙态：别的对话在跑也能立刻并行发任务
  document.getElementById("session-title").textContent = "新任务";
  chatCol.innerHTML = "";
  chatCol.appendChild(buildEmpty());
  renderHistory();
  // 上个任务里临时切过的工作文件夹不带进新任务：回到当前项目的默认目录
  fetch("/api/workspace/reset", { method: "POST" }).then(r => r.json()).then(st => {
    if (st.workspace_dir && settingsCache && st.workspace_dir !== settingsCache.workspace_dir) {
      refreshSettingsCache();
      refreshProjectFiles();
    }
  }).catch(() => {});
};

// ================= 右键菜单功能 =================
const contextMenu = document.createElement("div");
contextMenu.id = "context-menu";
contextMenu.className = "context-menu";
contextMenu.style.cssText = `
  position: fixed;
  display: none;
  background: var(--wb-bg);
  border: 1px solid var(--wb-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 10000;
  min-width: 160px;
  padding: 4px;
`;
document.body.appendChild(contextMenu);

let contextMenuTarget = null;
let contextMenuSelection = "";

// 监听右键事件
document.addEventListener("contextmenu", (e) => {
  // 获取选中的文本
  const selection = window.getSelection().toString();

  // 如果在输入框或可编辑元素内，显示编辑菜单
  const isEditable = e.target.matches("input, textarea, [contenteditable]");

  if (selection || isEditable) {
    e.preventDefault();
    contextMenuTarget = e.target;
    contextMenuSelection = selection;
    showContextMenu(e.pageX, e.pageY, isEditable, selection);
  }
});

function showContextMenu(x, y, isEditable, hasSelection) {
  const menuItems = [];

  if (hasSelection) {
    menuItems.push(
      { label: "复制", action: () => copyText(contextMenuSelection) },
      { label: "加入对话", action: () => addToInput(contextMenuSelection) }
    );
  }

  if (isEditable) {
    if (hasSelection) {
      menuItems.push(
        { label: "剪切", action: () => cutText() }
      );
    }
    menuItems.push(
      { label: "粘贴", action: () => pasteText() }
    );
  }

  if (menuItems.length === 0) {
    return;
  }

  contextMenu.innerHTML = menuItems.map(item =>
    `<div class="context-menu-item" data-action="${item.label}">${item.label}</div>`
  ).join("");

  // 绑定点击事件
  contextMenu.querySelectorAll(".context-menu-item").forEach((item, index) => {
    item.onclick = () => {
      menuItems[index].action();
      hideContextMenu();
    };
  });

  // 显示菜单
  contextMenu.style.display = "block";
  contextMenu.style.left = x + "px";
  contextMenu.style.top = y + "px";

  // 确保菜单不超出视口
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (x - rect.width) + "px";
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (y - rect.height) + "px";
  }
}

function hideContextMenu() {
  contextMenu.style.display = "none";
}

// 点击其他地方关闭菜单
document.addEventListener("click", hideContextMenu);

// 复制文本
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    toast("✓ 已复制");
  }).catch(() => {
    toast("❌ 复制失败");
  });
}

// 剪切文本
function cutText() {
  if (contextMenuTarget && (contextMenuTarget.tagName === "INPUT" || contextMenuTarget.tagName === "TEXTAREA")) {
    const start = contextMenuTarget.selectionStart;
    const end = contextMenuTarget.selectionEnd;
    const text = contextMenuTarget.value.substring(start, end);

    navigator.clipboard.writeText(text).then(() => {
      contextMenuTarget.value = contextMenuTarget.value.substring(0, start) + contextMenuTarget.value.substring(end);
      contextMenuTarget.selectionStart = contextMenuTarget.selectionEnd = start;
      if (contextMenuTarget === inputEl) syncInputHl();
      toast("✓ 已剪切");
    }).catch(() => {
      toast("❌ 剪切失败");
    });
  }
}

// 粘贴文本
function pasteText() {
  navigator.clipboard.readText().then(text => {
    if (contextMenuTarget && (contextMenuTarget.tagName === "INPUT" || contextMenuTarget.tagName === "TEXTAREA")) {
      const start = contextMenuTarget.selectionStart;
      const end = contextMenuTarget.selectionEnd;
      contextMenuTarget.value = contextMenuTarget.value.substring(0, start) + text + contextMenuTarget.value.substring(end);
      contextMenuTarget.selectionStart = contextMenuTarget.selectionEnd = start + text.length;
      if (contextMenuTarget === inputEl) syncInputHl();
      toast("✓ 已粘贴");
    }
  }).catch(() => {
    toast("❌ 粘贴失败");
  });
}

// 加入对话
function addToInput(text) {
  if (inputEl.value) {
    inputEl.value += "\n\n" + text;
  } else {
    inputEl.value = text;
  }
  syncInputHl();
  inputEl.focus();
  // 滚动到输入框末尾
  inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
  toast("✓ 已加入对话");
}
renderHistory();
reattachRunning(); // 刷新页面不丢正在跑的任务：找回并接上直播

// 页面刷新时默认选中第一个对话
setTimeout(() => {
  if (!sessionId && sessions.length > 0) {
    const firstSession = sessions.filter(s => (s.project || "默认项目") === activeProject)[0];
    if (firstSession) {
      document.querySelector(`.hist-item[data-id="${firstSession.id}"]`)?.click();
    }
  }
}, 100);

// ================= 项目（多工作空间，任务历史按项目分组；projects/activeProject 声明在顶部基础状态区） =================
async function activateCreatedProject(data, name) {
  // 新建是明确的本窗口切换操作，不能依赖保留本地选择的 refreshProjects。
  activeProject = data.active || name;
  if (Array.isArray(data.projects)) projects = data.projects;
  resetProjectFileState();
  renderProjects();
  document.getElementById("new-task").click();
  await Promise.all([refreshProjectFiles(activeProject), refreshSettingsCache()]);
}
async function refreshProjects() {
  const selected = activeProject, initializing = projects.length === 0;
  try {
    const data = await fetch("/api/projects").then(r => r.json());
    projects = data.projects || [];
    // 刷新配置不能把本窗口切到另一个窗口/后台修改过的全局活动项目。
    if (activeProject === selected && (initializing || !projects.some(p => p.name === selected))) {
      const next = data.active || "默认项目";
      if (activeProject !== next) { activeProject = next; resetProjectFileState(); refreshProjectFiles(next); }
    }
  } catch {}
  renderProjects();
  renderHistory();
}
function renderProjects() {
  const box = document.getElementById("proj-list");
  if (!box) return;
  box.innerHTML = projects.map(p =>
    `<div class="proj-item ${p.name === activeProject ? "active" : ""}" data-name="${esc(p.name)}" title="${esc(p.dir)}">📂 <span class="pn">${esc(p.name)}</span>${projects.length > 1 ? `<button type="button" class="del" ${projectHasRunning(p.name) ? 'disabled' : ''} title="移除项目（不删文件）">✕</button>` : ""}</div>`).join("");
  box.querySelectorAll(".proj-item").forEach(el => el.onclick = async (e) => {
    const name = el.dataset.name;
    if (e.target.classList.contains("del")) {
      if (projectHasRunning(name)) { toast("项目内有任务运行中，暂不能移除"); return; }
      const doDel = () => removeProject(name);
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
    if (name === activeProject) {
      // 如果点击的是当前项目，新建对话
      document.getElementById("new-task").click();
      return;
    }

    const resp = await fetch("/api/projects/switch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await resp.json();
    // 任务已固定自己的项目目录；仍兼容旧服务端的 busy 返回，不在被拒后只改界面。
    if (resp.status === 409 || (data && data.busy)) {
      toast("⏳ " + (data.error || "有任务正在运行，暂时不能切换项目"));
      return;
    }
    if (!resp.ok) { toast("❌ " + ((data && data.error) || "切换项目失败")); return; }
    activeProject = name;
    resetProjectFileState();
    // 换项目 = 换会话：先把占比清掉。下面要么点开新项目的最新对话（自己会重新拉），
    // 要么新建任务（本来就是 0%），中间这段不能继续显示旧项目的数字
    sessionId = null;
    if (typeof resetContextIndicator === 'function') resetContextIndicator("正在切换项目…");
    renderProjects();
    // Fix C: 切换项目后，传递新项目参数获取正确的文件列表
    refreshProjectFiles(name);

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

    if (activeProject !== name) return; // 另一轮切项目已完成，丢弃旧回调
    // 打开该项目的最新一条对话
    const normalizeProject = (p) => String(p || "默认项目").trim();
    const projectSessions = sessions.filter(s => normalizeProject(s.project) === normalizeProject(name));

    // 切换项目后立即刷新对话列表
    renderHistory();

    if (projectSessions.length > 0) {
      // 按时间倒序排序，取最新的一条
      projectSessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      const latestSession = projectSessions[0];
      // 触发历史记录的点击事件
      setTimeout(() => {
        if (activeProject !== name) return;
        const historyItem = document.querySelector(`[data-id="${latestSession.id}"]`);
        if (historyItem) {
          historyItem.click();
        } else {
          console.warn('[切换项目] 未找到对话项', latestSession.id);
        }
      }, 100);
    } else {
      // 如果没有历史对话，新建任务
      document.getElementById("new-task").click();
    }
  });
}
document.getElementById("proj-add").onclick = (e) => {
  e.preventDefault();
  const box = document.getElementById("proj-list");
  if (box.querySelector("#proj-new")) { box.querySelector("#proj-new").focus(); return; }
  const row = document.createElement("div");
  row.style.cssText = "padding:4px 6px";
  row.innerHTML = '<input id="proj-new" placeholder="项目名，回车创建" style="width:100%;font-size: 13px;padding:5px 8px">';
  box.prepend(row);
  const inp = row.querySelector("#proj-new");
  inp.focus();
  inp.onkeydown = async (ev) => {
    if (ev.key === "Escape") { row.remove(); return; }
    if (ev.key !== "Enter") return;
    const name = inp.value.trim();
    if (!name) return;
    const resp = await fetch("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { toast("❌ " + (data.error || "创建失败")); return; }
    await activateCreatedProject(data, name);
  };
};
refreshProjects();

// ================= 发送（运行中按钮变「停止」） =================
// ================= 并行任务：运行态/排队按会话隔离，不同对话互不阻塞 =================
function updateSendUI() {
  const busy = curBusy();
  sendBtn.classList.toggle("stop", busy);
  sendBtn.textContent = busy ? "◼" : "↑";
  sendBtn.title = busy ? "停止任务" : "发送";
  // ⚡ 插队按钮退役：发消息默认就是插队，按钮常隐（interject() 留给快捷键等旧入口）
  renderQueueBar();
  renderHistory(); // 侧栏「运行中」小圆点跟着刷新
}
function renderQueueBar() {
  const bar = document.getElementById("queue-bar");
  const q = (sessionId && sessionQueues.get(sessionId)) || [];
  if (!curBusy() && !q.length) { bar.classList.remove("show"); bar.innerHTML = ""; return; }
  bar.classList.add("show");
  bar.innerHTML =
    q.map((m, i) => `<span class="q-chip" title="${esc(m.text)}"><span class="qt">⏳ ${esc(m.text.slice(0, 60))}</span><span class="qx" data-i="${i}" title="撤回这条">✕</span></span>`).join("") +
    (curBusy() ? `<span>任务运行中：发消息会直接插队并入当前任务 · ◼ 停止 · 要另起并行任务点「新建任务」</span>` : "");
  bar.querySelectorAll(".qx").forEach(x => x.onclick = () => { q.splice(+x.dataset.i, 1); renderQueueBar(); toast("已撤回排队消息"); });
}
function drainQueue(sid) {
  const q = sessionQueues.get(sid);
  if (!q || !q.length || runningSessions.has(sid)) return;
  const m = q.shift();
  if (sid === sessionId) renderQueueBar();
  runTurn(sid, m.text, m.mode, m.regen, m.delegation);
}
/** 把一条消息立即注入正在执行的任务；任务恰好刚结束就直接当新一轮跑，两头都不丢消息 */
async function interjectText(text, delegation = getPendingDelegation()) {
  const sid = sessionId, mode = currentMode;
  delegation = { ...delegation };
  setPendingDelegation({ type: "auto" });
  // 显式协作选择不能悄悄丢进正在运行的旧团队；保留到独立的下一轮。
  if (delegation.type !== "auto") {
    qOf(sid).push({ text, mode, delegation });
    renderQueueBar(); drainQueue(sid);
    toast("已排队：当前任务结束后按本轮协作选择执行");
    return;
  }
  const resp = await fetch("/api/chat/interject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sid, message: text }),
  }).catch(() => null);
  if (resp && resp.ok) {
    const live = runningSessions.get(sid);
    if (live && live.ui.markPendingInterject) live.ui.markPendingInterject(text);
    else toast("⚡ 已插队：这条消息会并入当前任务一起处理");
  } else {
    qOf(sid).push({ text, mode, delegation });
    renderQueueBar();
    drainQueue(sid);
  }
}
async function interject() {
  if (!sessionId) return;
  const text = composeOutgoing();
  if (!text) return;
  await interjectText(text);
}
document.getElementById("interject-btn").onclick = interject;
async function stopTask() {
  if (!sessionId) return;
  sendBtn.textContent = "…";
  sendBtn.disabled = true;
  try {
    await fetch("/api/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  } catch (e) {
    console.error("停止任务失败:", e);
  } finally {
    sendBtn.disabled = false;
    updateSendUI();
  }
}
async function send() {
  let text = composeOutgoing();
  if (!text) return;
  if (sceneTag) {
    text = `【任务类型：${sceneTag.replace(/^[^一-龥A-Za-z]+\s*/, "")}】` + text;
    setSceneTag(null);
  }
  mentionMenu.classList.remove("show");
  if (pageKind === "assist") { await sendAssistLocal(text); return; }
  if (curBusy()) {
    // 本对话的任务在跑 → 默认直接插队：消息立即注入当前任务一起处理（要另起并行任务用「新建任务」）
    await interjectText(text);
    return;
  }
  await doSend(text, currentMode);
}

// regen=true 表示「重新生成」：服务端回滚最后一轮再重跑同一条消息
async function doSend(text, mode, regen, delegation = getPendingDelegation()) {
  if (curBusy()) return;
  delegation = { ...delegation };
  if (!regen) setPendingDelegation({ type: "auto" });
  closeAssistView();
  let modelRequest = null;
  if (!sessionId) {
    sessionId = "s_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    const title = stripSceneTag(text);
    sessions.unshift({ id: sessionId, title, at: Date.now(), project: activeProject });
    saveSessions();
    document.getElementById("session-title").textContent = title;
    if (pendingModel) {
      const pm = pendingModel;
      pendingModel = undefined;
      modelRequest = setSessionModel(pm);
    }
  }
  const sid = sessionId; // await 期间切换会话，也不改变本次请求归属
  if (modelRequest) await modelRequest;
  await runTurn(sid, text, mode, regen, delegation);
}

// 真正执行一轮任务：绑定 sid 而不是全局 sessionId——用户切走后它继续在后台跑
/** 镜像 server.js recordingEmit 的记录口径：数出服务端 transcript 已记录到第几个事件。
 *  断流重连时靠它算出准确的 from/textOffset 从断点续流——哪些事件入账、text 怎么合并必须和服务端完全一致 */
function makeRecCounter() {
  const KEEP = ["tool_use", "tool_result", "parallel", "expert_start", "expert_done", "delegation", "team_start", "team_progress", "team_done", "expert_skills", "git_status", "error", "limit", "auto_continue", "failover", "sleep", "trim", "compact", "usage", "interject", "sources", "ask_user", "ask_answer", "milestones", "text_reset"];
  const st = { n: 0, lastIsText: false, textLen: 0 };
  st.feed = (ev) => {
    if (ev.type === "text") {
      if (ev.depth > 0) return;
      if (!st.lastIsText) { st.n++; st.lastIsText = true; st.textLen = 0; }
      st.textLen += String(ev.delta || "").length;
    } else if (ev.type === "text_reset") {
      // 断流重试撤稿：后端已经把录像里的半段剪掉了，这里同步回退字符计数
      if (ev.depth > 0) return;
      const chars = Math.max(0, Number(ev.chars) || 0);
      st.textLen = Math.max(0, st.textLen - chars);
      // textLen 归零就等于这条 text 事件被整条剪掉了，n 也要退一格
      if (st.textLen === 0 && st.lastIsText) { st.n--; st.lastIsText = false; }
    } else if (ev.type === "files") {
      // 服务端只保存带变更的产物事件；专家每棒都会发，漏计会让重连重复播放团队进度。
      if ((ev.changed || []).length) { st.n++; st.lastIsText = false; }
    } else if (KEEP.includes(ev.type)) { st.n++; st.lastIsText = false; }
  };
  return st;
}

/** 读一条 SSE 流喂给回合 UI；返回是否收到了正常收尾的 done 事件 */
async function pumpStream(resp, ui, rc, idleMs = 45000) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", timer;
  try {
    while (true) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("连接长时间未收到数据，正在重新连接")), idleMs); }),
      ]);
      clearTimeout(timer);
      if (done) return false;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        let ev;
        try { ev = JSON.parse(part.slice(6)); } catch { continue; }
        rc.feed(ev);
        ui.handleEvent(ev);
        if (ev.type === "done") { rc.taskStatus = ev.status || "completed"; return true; }
      }
    }
  } finally {
    clearTimeout(timer);
    // Cancellation itself must not hold up reconnection on a broken transport.
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    try { reader.releaseLock(); } catch {}
  }
}

async function fetchChatResponse(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

/** 主流断了但服务端任务可能还在跑：断流期间保持运行态，直到收到 done 或服务端确认任务已结束。 */
async function keepAttached(sid, ui, rc, sawDone, netErr) {
  let failures = 0;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const runningState = async () => {
    const r = await fetchChatResponse(`/api/chat/running/${encodeURIComponent(sid)}`, { cache: "no-store" });
    if (!r.ok) throw new Error("查询任务状态失败（HTTP " + r.status + "）");
    const state = await r.json();
    if (typeof state.running !== "boolean") throw new Error("任务状态响应无效");
    return state;
  };
  while (!sawDone) {
    ui.handleEvent({ type: "status", text: "连接中断，正在恢复执行进度…" });
    const before = rc.n + ":" + rc.textLen;
    try {
      const qs = rc.lastIsText ? `from=${rc.n - 1}&textOffset=${rc.textLen}` : `from=${rc.n}`;
      const turnQuery = rc.requestId ? "&requestId=" + encodeURIComponent(rc.requestId) : "";
      const resp = await fetchChatResponse(`/api/chat/stream/${encodeURIComponent(sid)}?${qs}${turnQuery}`);
      if (resp.status === 404 || resp.status === 409) {
        const state = await runningState();
        if (!state.running) {
          ui.handleEvent({ type: "error", message: "服务端已无运行任务，但未取得本轮完成结果。" });
          return false;
        }
        if (state.requestId && rc.requestId && state.requestId !== rc.requestId) {
          ui.handleEvent({ type: "error", message: "服务端已切换回合，正在重新接入当前任务。" });
          await reattachRunning(sid, ui);
          if (runningSessions.get(sid)?.ui !== ui) return false;
          throw new Error("正在接回服务端当前回合");
        }
        throw new Error("本轮任务仍在服务端执行，暂时无法恢复连接");
      }
      if (!resp.ok) throw new Error("恢复连接失败（HTTP " + resp.status + "）");
      sawDone = await pumpStream(resp, ui, rc);
      if (sawDone) { netErr = null; break; }
      throw new Error("执行进度连接提前关闭");
    } catch (e) {
      netErr = e;
      if (before !== rc.n + ":" + rc.textLen) failures = 0;
      failures++;
      // Keep replaying after failures: polling alone would lose final files and errors.
      try {
        const state = await runningState();
        ui.handleEvent({ type: "status", text: state.running
          ? (state.finishing ? "任务正在收尾，正在恢复连接…" : "任务仍在执行，正在恢复连接…")
          : "正在取回本轮最终结果…" });
      } catch (_) {
        ui.handleEvent({ type: "status", text: "连接中断，暂无法确认任务状态，正在重连…" });
      }
      await wait(Math.min(10000, 1500 * failures));
    }
  }
  if (netErr && !sawDone) ui.handleEvent({ type: "error", message: "连接中断：" + netErr.message });
  return sawDone;
}

/** 一轮任务收尾（正常结束/出错/被停止都走这里） */
function endRun(sid, ui, taskStatus = 'completed') {
  if (runningSessions.get(sid)?.ui !== ui) return;
  ui.turn._taskStatus = taskStatus;
  ui.finish();
  runningSessions.delete(sid);
  updateSendUI();
  if (taskStatus === "completed" && !(sessionQueues.get(sid) || []).length) notifyRunDone(sid, ui); // 还有排队消息就不算完
  if (sid === sessionId) inputEl.focus();

  // 更新上下文百分比显示
  if (sid === sessionId && typeof cachedTranscript !== 'undefined') {
    cachedTranscript = null; // 清除缓存，强制重新获取
    if (typeof updateContextIndicator === 'function') updateContextIndicator();
  }

  drainQueue(sid); // 本会话运行期间排队的消息按序自动执行
}

/** 并行任务多了得知道哪个跑完了：后台会话完成弹 toast；窗口失焦时发系统通知 */
function notifyRunDone(sid, ui) {
  const s = sessions.find((x) => x.id === sid);
  const name = stripSceneTag(s && s.title) || "任务";
  // 长跑完成通知带上战报：用时/步数/产出件数，长任务离开视线也知道干了多少活
  const st = ui && ui.stats ? ui.stats() : null;
  const detail = st ? `用时 ${st.dur}${st.steps ? ` · ${st.steps} 步` : ""}${st.rounds ? ` · 续跑 ${st.rounds} 轮` : ""}${st.outs ? ` · 产出 ${st.outs} 件` : ""}` : "";
  if (sid !== sessionId) toast(`✅ 「${name}」已完成${detail ? `（${detail}）` : ""}，点侧栏查看`);
  if (document.hidden && "Notification" in window) {
    try {
      if (Notification.permission === "granted") {
        const n = new Notification(`✅ ${name}`, { body: detail || "任务已完成" });
        n.onclick = () => { try { window.focus(); } catch {} document.querySelector(`.hist-item[data-id="${sid}"]`)?.click(); };
      } else if (Notification.permission === "default") Notification.requestPermission();
    } catch {}
  }
}

/** 页面加载时找回还在后台跑的任务：回放已记录的过程 + 断点续流接上直播（刷新不再丢任务画面） */
async function reattachRunning(replaceSid, replaceUI) {
  let ids = [];
  try { const r = await fetchChatResponse("/api/chat/running", { cache: "no-store" }); if (r.ok) ids = await r.json(); } catch {}
  if (!Array.isArray(ids)) return false;
  let attached = false;
  for (const sid of ids) {
    const previous = runningSessions.get(sid);
    if (previous && !(sid === replaceSid && previous.ui === replaceUI)) continue;
    let data = null;
    try { const r = await fetchChatResponse("/api/session/" + encodeURIComponent(sid)); if (r.ok) data = await r.json(); } catch {}
    if (!data || runningSessions.get(sid) !== previous) continue;
    if (data?.project) {
      const item = sessions.find(s => s.id === sid);
      if (item) item.project = data.project;
      else sessions.push({ id: sid, project: data.project });
    }
    if (data && data.dir) sessionDirs.set(sid, data.dir);
    if (data && data.model) sessionModels.set(sid, data.model);
    if (data && data.goal) sessionGoals.set(sid, data.goal);
    const t = (data && data.transcript) || [];
    const lastUser = t.map((e) => e.type).lastIndexOf("user");
    if (lastUser < 0) continue;
    const evs = (t[lastUser + 1] && t[lastUser + 1].events) || [];
    const ui = createTurnUI(t[lastUser].text, t[lastUser].mode, sid, t[lastUser].delegation);
    const rc = makeRecCounter();
    rc.requestId = t[lastUser + 1]?.requestId;
    isReplaying = true;
    try {
      const pendingAsks = new Map((data?.pending_asks || []).map(ask => [ask.id, ask.expires_at]));
      for (const ev of evs) {
        rc.feed(ev);
        const expires = ev.type === "ask_user" && pendingAsks.get(ev.ask_id);
        ui.handleEvent(expires ? { ...ev, pending: true, expires_at: expires } : ev);
      }
    } finally { isReplaying = false; }
    runningSessions.set(sid, { ui });
    // 用户手快已经点进了这个会话：把静态回放出来的最后一轮换成活的回合元素
    if (sid === sessionId) {
      const turns = chatCol.querySelectorAll(".turn");
      if (turns.length) turns[turns.length - 1].remove();
      document.getElementById("empty")?.remove();
      chatCol.appendChild(ui.turn);
      scrollBottom(true);
    }
    updateSendUI();
    attached = true;
    keepAttached(sid, ui, rc, false, null).then(done => endRun(sid, ui, done ? (rc.taskStatus || "completed") : "interrupted")); // 各会话各自接，互不等待
  }
  return attached;
}

async function runTurn(sid, text, mode, regen, delegation = { type: "auto" }) {
  delegation = { ...delegation };
  if (runningSessions.has(sid)) { qOf(sid).push({ text, mode, regen, delegation }); if (sid === sessionId) renderQueueBar(); return; }
  const ui = createTurnUI(text, mode, sid, delegation);
  runningSessions.set(sid, { ui });
  updateSendUI();
  if (sid === sessionId) scrollBottom(true);

  const rc = makeRecCounter();
  rc.requestId = "turn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  let sawDone = false, netErr = null;
  try {
    const resp = await fetchChatResponse("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, requestId: rc.requestId, message: text, mode, regen: !!regen, delegation, project: sessions.find(s => s.id === sid)?.project || undefined }),
    });
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      if (resp.status === 409 && d.code === "SESSION_RUNNING") {
        // POST 被服务端拒绝时，这个占位回合不是正在运行的任务。
        // 删除它并排队请求；唯一的续流 owner 由 reattachRunning 创建，避免两个 UI 抢同一条 SSE。
        ui.turn.remove();
        qOf(sid).push({ text, mode, regen, delegation });
        if (sid === sessionId) renderQueueBar();
        ui.handleEvent({ type: "status", text: "重新生成已排队，正在接回上一轮任务…" });
        ui.turn._taskStatus = "queued";
        ui.finish();
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        let failures = 0;
        while (runningSessions.get(sid)?.ui === ui) {
          if (await reattachRunning(sid, ui)) return;
          try {
            const resp = await fetchChatResponse(`/api/chat/running/${encodeURIComponent(sid)}`, { cache: "no-store" });
            if (resp.ok) {
              const state = await resp.json();
              if (state.running === false) {
                endRun(sid, ui, "interrupted"); // 原任务已结束，释放会话并执行排队的重新生成。
                return;
              }
            }
          } catch {}
          failures++;
          ui.handleEvent({ type: "status", text: "重新生成已排队，原任务仍在后台运行；正在恢复连接…" });
          await wait(Math.min(10000, 1500 * failures));
        }
        return;
      }
      ui.handleEvent({ type: "error", message: d.error || `请求失败（HTTP ${resp.status}）` });
      endRun(sid, ui, "interrupted");
      return;
    } else {
      sawDone = await pumpStream(resp, ui, rc);
    }
  } catch (e) {
    netErr = e;
  }
  sawDone = await keepAttached(sid, ui, rc, sawDone, netErr);
  // 根据是否收到 done 事件判断任务状态
  const taskStatus = sawDone ? (rc.taskStatus || 'completed') : 'interrupted';
  endRun(sid, ui, taskStatus);
}
sendBtn.onclick = () => (curBusy() ? stopTask() : send());
// 输入法（中文/日文等）组字状态。macOS WebKit 上 compositionend 可能先于 keydown 触发，
// 此时 e.isComposing 已是 false，光靠它判断会把「确认选字」的 Enter 当成发送。
// 所以自己记一个状态，并在 compositionend 后留一个极短的宽限期。
let imeComposing = false;
let imeEndedAt = 0;
inputEl.addEventListener("compositionstart", () => { imeComposing = true; });
inputEl.addEventListener("compositionend", () => { imeComposing = false; imeEndedAt = Date.now(); });
inputEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey) return;
  // keyCode 229 = 按键被输入法吃掉了
  if (imeComposing || e.isComposing || e.keyCode === 229) return;
  if (Date.now() - imeEndedAt < 100) return; // 刚确认完选字的那一下 Enter，不算发送
  e.preventDefault();
  send();
});

// ================= 弹窗（技能/专家/定时/设置中心） =================
async function closeMainModal() {
  const settingsForm = mBody.querySelector("[data-autosave]");
  if (settingsForm?.flushAutosave && !await settingsForm.flushAutosave()) return;
  mask.classList.remove("show");
  delete mask.dataset.modalKind;
}
document.getElementById("m-close").onclick = closeMainModal;
mask.addEventListener("click", (e) => {
  if (e.target === mask && mask.dataset.modalKind !== "settings") closeMainModal();
});
document.querySelectorAll(".side-nav").forEach((nav) => nav.addEventListener("click", (e) => {
  const item = e.target.closest(".item");
  if (!item) return;
  if (item.id === "more-toggle") {
    item.classList.toggle("open");
    document.getElementById("more-box").classList.toggle("open");
    return;
  }
  if (item.dataset.view) return openPageView(item.dataset.view); // 主区页面（不是弹窗）
  if (item.dataset.modal) openModal(item.dataset.modal);
}));

/** 打开「专家 · 技能 · 连接器」主区页并直接落到某个 Tab */
function openHub(tab) {
  hubState.tab = tab || "experts";
  hubState.cat = "全部"; hubState.q = ""; hubState.mine = false; hubState.editing = null;
  if (tab === "team") { hubState.tab = "experts"; hubState.sub = "team"; }
  else if (tab === "experts") hubState.sub = "expert";
  openPageView("hub");
}

async function openModal(kind, subTab) {
  // 技能/专家已经从弹窗搬到主区的「专家·技能·连接器」页，老入口（快捷键等）改成跳页
  if (kind === "skills") return openHub("skills");
  if (kind === "experts") return openHub("team");
  if (kind === "sched") return openPageView("autom"); // 自动化已从弹窗搬到主区
  if (kind === "library") return openPageView("lib"); // 资料库同理

  mask.dataset.modalKind = kind;
  mask.classList.add("show");
  modalBox.classList.toggle("wide", ["settings", "proj-edit"].includes(kind));
  if (kind === "settings") {
    mTitle.textContent = "⚙️ 设置";
    await renderSettings(subTab || "models");
  }
}

// ================= 快捷键引擎 =================
// [id, 名称, 默认键, 固定?, 系统级?]；用户改绑存 config.shortcuts（只存改过的项）
const SHORTCUT_DEFS = [
  ["open-settings", "打开设置", "Meta+Comma"],
  ["voice-record", "语音录制开关", "Meta+D"],
  ["chat-search", "对话内搜索", "Meta+F"],
  ["send", "发送消息", "Enter", true],
  ["newline", "输入时换行", "Shift+Enter", true],
  ["new-chat", "新建对话", "Meta+N"],
  ["stop", "停止生成 / 关闭弹层", "Escape"],
  ["prev-task", "上一个任务", "Meta+BracketLeft"],
  ["next-task", "下一个任务", "Meta+BracketRight"],
  ["toggle-sidebar", "切换左侧栏", "Meta+B"],
  ["toggle-files", "切换右侧产物面板", "Shift+Meta+B"],
  ["fullscreen", "进入/退出全屏", "Ctrl+Meta+F"],
  ["toggle-window", "唤起/隐藏主窗口", "Shift+Alt+W", false, true],
  ["open-skills", "打开技能广场", "Shift+Meta+K"],
  ["open-experts", "打开专家团", "Shift+Meta+E"],
  ["open-prompts", "打开参考模板库", "Shift+Meta+P"],
  ["open-library", "打开资料库", "Shift+Meta+L"],
  ["open-sched", "打开定时任务", "Shift+Meta+T"],
  ["open-assistant", "打开本地助理", "Shift+Meta+A"],
];
function canonAccel(a) {
  const mods = [], keys = [];
  for (const p of String(a || "").split("+").map(x => x.trim()).filter(Boolean)) {
    const m = { meta: "Meta", cmd: "Meta", command: "Meta", ctrl: "Ctrl", control: "Ctrl", alt: "Alt", option: "Alt", shift: "Shift" }[p.toLowerCase()];
    if (m) { if (!mods.includes(m)) mods.push(m); } else keys.push(p);
  }
  const order = { Ctrl: 0, Alt: 1, Shift: 2, Meta: 3 };
  mods.sort((x, y) => order[x] - order[y]);
  return mods.concat(keys).join("+");
}
function accelFromEvent(e) {
  if (/^(Meta|Control|Alt|Shift)/.test(e.code)) return null; // 只按了修饰键
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(e.code.replace(/^Key/, "").replace(/^Digit/, ""));
  return parts.join("+");
}
function accelDisplay(a) {
  const KEY = { Comma: ",", Period: ".", BracketLeft: "[", BracketRight: "]", Escape: "Esc", Enter: "⏎", Space: "空格", Minus: "-", Equal: "=", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'", Backquote: "`" };
  const MOD = { Meta: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
  const parts = canonAccel(a).split("+");
  // mac 习惯顺序 ⌃⌥⇧⌘
  const mods = ["Ctrl", "Alt", "Shift", "Meta"].filter(m => parts.includes(m)).map(m => MOD[m]);
  return mods.join("") + parts.filter(p => !MOD[p]).map(p => KEY[p] || p).join("");
}
let toastTimer = null;
function toast(msg) {
  let t = document.getElementById("wb-toast");
  if (!t) { t = document.createElement("div"); t.id = "wb-toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  // 长消息（多半是报错原因）多留一会儿，2.2 秒读不完一句「分字段「*/0」的步长必须 ≥ 1」
  toastTimer = setTimeout(() => t.classList.remove("show"), Math.min(6000, Math.max(2200, String(msg).length * 120)));
}
async function toggleAppFullscreen() {
  const r = await fetch("/api/app/fullscreen", { method: "POST" }).then(x => x.json()).catch(() => ({ ok: false }));
  if (!r.ok) { // Web 模式走浏览器全屏兜底
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
}
function navTask(dir) {
  const list = sessions.filter(s => (s.project || "默认项目") === activeProject);
  if (!list.length) return;
  let i = list.findIndex(s => s.id === sessionId);
  i = i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + dir));
  if (list[i].id === sessionId) return;
  const el = document.querySelector(`.hist-item[data-id="${list[i].id}"]`);
  if (el) el.click();
}
const SHORTCUT_ACTIONS = {
  "open-settings": () => openModal("settings"),
  "voice-record": () => toast("🎤 语音录制暂未支持（复刻版）"),
  "chat-search": () => openChatSearch(),
  "new-chat": () => document.getElementById("new-task").click(),
  "stop": () => {
    const cs = document.getElementById("chat-search");
    if (mask.classList.contains("show")) mask.classList.remove("show");
    else if (cs && cs.style.display === "flex") closeChatSearch();
    else if (curBusy()) stopTask();
  },
  "prev-task": () => navTask(-1),
  "next-task": () => navTask(1),
  "toggle-sidebar": () => toggleSidebar(),
  "toggle-files": () => document.getElementById("toggle-files").onclick(),
  "fullscreen": toggleAppFullscreen,
  "toggle-window": () => {}, // 系统级快捷键由桌面版主进程注册，网页端无动作
  "open-skills": () => openHub("skills"),
  "open-experts": () => openHub("team"),
  "open-prompts": () => openPageView("prompts"),
  "open-library": () => openModal("library"),
  "open-sched": () => openModal("sched"),
  "open-assistant": () => openAssistView(),
};
document.addEventListener("keydown", (e) => {
  if (window.__scRebinding) return; // 设置页改绑捕获中，不触发动作
  const acc = accelFromEvent(e);
  if (!acc) return;
  const canon = canonAccel(acc);
  const inText = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "") || e.target.isContentEditable;
  const map = (settingsCache && settingsCache.shortcuts) || {};
  for (const [id, , def, fixed] of SHORTCUT_DEFS) {
    if (fixed || !SHORTCUT_ACTIONS[id]) continue;
    if (canonAccel(map[id] || def) !== canon) continue;
    if (!/Meta|Ctrl|Alt/.test(canon) && inText && canon !== "Escape") return; // 无修饰键的组合在输入框里只放行 Esc
    e.preventDefault();
    SHORTCUT_ACTIONS[id]();
    return;
  }
});

// ================= 对话内搜索（⌘F） =================
let csMatches = [], csIdx = -1;
function openChatSearch() {
  let bar = document.getElementById("chat-search");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "chat-search";
    bar.innerHTML = `<input id="cs-input" placeholder="搜索对话内容…"><span id="cs-count" style="color:var(--wb-text-3);font-size: 13px;white-space:nowrap"></span><button id="cs-prev" title="上一个">↑</button><button id="cs-next" title="下一个">↓</button><button id="cs-close" title="关闭 (Esc)">✕</button>`;
    document.querySelector(".main").appendChild(bar);
    bar.querySelector("#cs-input").oninput = runChatSearch;
    bar.querySelector("#cs-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); csNav(e.shiftKey ? -1 : 1); }
      if (e.key === "Escape") { e.stopPropagation(); closeChatSearch(); }
    });
    bar.querySelector("#cs-prev").onclick = () => csNav(-1);
    bar.querySelector("#cs-next").onclick = () => csNav(1);
    bar.querySelector("#cs-close").onclick = closeChatSearch;
  }
  bar.style.display = "flex";
  bar.querySelector("#cs-input").focus();
  bar.querySelector("#cs-input").select();
}
function closeChatSearch() {
  const bar = document.getElementById("chat-search");
  if (bar) bar.style.display = "none";
  csMatches.forEach(m => m.classList.remove("search-hit"));
  csMatches = [];
  csIdx = -1;
  inputEl.focus();
}
function runChatSearch() {
  csMatches.forEach(m => m.classList.remove("search-hit"));
  csMatches = [];
  csIdx = -1;
  const q = document.getElementById("cs-input").value.trim().toLowerCase();
  const cnt = document.getElementById("cs-count");
  if (!q) { cnt.textContent = ""; return; }
  for (const el of chatCol.querySelectorAll(".u-msg .bubble, .a-text")) {
    if (el.textContent.toLowerCase().includes(q)) csMatches.push(el);
  }
  cnt.textContent = csMatches.length ? `0/${csMatches.length}` : "无结果";
  if (csMatches.length) csNav(1);
}
function csNav(dir) {
  if (!csMatches.length) return;
  if (csIdx >= 0) csMatches[csIdx].classList.remove("search-hit");
  csIdx = (csIdx + dir + csMatches.length) % csMatches.length;
  csMatches[csIdx].classList.add("search-hit");
  csMatches[csIdx].scrollIntoView({ block: "center", behavior: "smooth" });
  document.getElementById("cs-count").textContent = `${csIdx + 1}/${csMatches.length}`;
}

// ================= 命令审批条（安全中心「询问名单」命中时挂起等这里批准） =================
let apSeen = new Set(); // 已经通知过的审批 id：轮询是重复的，系统通知只发一次
let apPollVersion = 0;
let directoryApproval = null;
let directoryApprovalQueue = [];
const directoryApprovalResolved = new Set();

function closeDirectoryApproval() {
  if (!directoryApproval) return;
  const { dialog } = directoryApproval;
  directoryApproval = null;
  dialog.close();
  dialog.remove();
}

function syncDirectoryApprovals(items) {
  directoryApprovalQueue = items.filter(a => a.directory && !directoryApprovalResolved.has(a.id));
  if (directoryApproval) {
    const current = directoryApprovalQueue.find(a => a.id === directoryApproval.item.id);
    // 同一审批不重绘、不重复 showModal，保留焦点、滚动位置和失败提示。
    if (current && JSON.stringify([current.directory, current.source]) === directoryApproval.signature) return;
    closeDirectoryApproval(); // 已拒绝、超时、任务结束，或审批内容发生变化
  }
  const item = directoryApprovalQueue[0];
  if (!item) return;
  if (!document.getElementById('directory-approval-style')) {
    const style = document.createElement('style');
    style.id = 'directory-approval-style';
    style.textContent = `
      .directory-approval-dialog { box-sizing:border-box; width:min(600px,calc(100vw - 32px)); max-height:calc(100dvh - 32px); margin:auto; padding:24px; overflow:auto; border:1px solid var(--wb-border,#667085); border-radius:12px; background:var(--wb-bg,#f8fafc); color:var(--wb-text,#202124); box-shadow:0 16px 64px #0005; font:14px/1.6 system-ui,sans-serif; }
      .directory-approval-dialog::backdrop { background:#0008; }
      .directory-approval-dialog h2 { margin:0 0 16px; font-size:20px; }
      .directory-approval-dialog dt { margin-top:12px; font-weight:600; }
      .directory-approval-dialog dd { margin:4px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
      .directory-approval-dialog .directory-approval-path { padding:12px; border:1px solid var(--wb-border,#667085); border-radius:8px; font-family:monospace; }
      .directory-approval-dialog .directory-approval-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:12px; margin-top:20px; }
      .directory-approval-dialog button { padding:8px 16px; border:1px solid var(--wb-border,#667085); border-radius:8px; background:var(--wb-bg,#f8fafc); color:inherit; cursor:pointer; font:inherit; }
      .directory-approval-dialog button[data-action="allow"] { background:#2563eb; color:#fff; border-color:#2563eb; }
      .directory-approval-dialog button:disabled { opacity:.55; cursor:wait; }
      .directory-approval-dialog button:focus-visible { outline:3px solid #60a5fa; outline-offset:3px; }
      .directory-approval-dialog [role="alert"] { color:var(--wb-danger,#dc2626); white-space:pre-wrap; overflow-wrap:anywhere; }
      @media (prefers-color-scheme:dark) { .directory-approval-dialog { background:var(--wb-bg,#20242b); color:var(--wb-text,#eef2f7); } .directory-approval-dialog button { background:var(--wb-bg,#20242b); } }
      @media (max-width:480px) { .directory-approval-dialog { padding:16px; } .directory-approval-dialog .directory-approval-actions button { flex:1; } }
    `;
    document.head.appendChild(style);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'directory-approval-dialog';
  dialog.setAttribute('aria-labelledby', 'directory-approval-title');
  dialog.setAttribute('aria-describedby', 'directory-approval-scope');
  // 所有服务端文本均用 textContent 填充，目录/任务中的 HTML 不会被执行。
  dialog.innerHTML = `<h2 id="directory-approval-title">外部目录访问授权</h2>
    <p id="directory-approval-scope">仅当前任务有效，任务结束或应用重启后失效。不会永久授权；可在设置的「安全中心」中撤销。</p>
    <dl><dt>完整目录（含子目录）</dt><dd class="directory-approval-path"></dd>
    <dt>发起任务</dt><dd class="directory-approval-source"></dd>
    <dt>任务 ID</dt><dd class="directory-approval-task"></dd>
    <dt>申请权限</dt><dd class="directory-approval-access"></dd></dl>
    <p class="directory-approval-error" role="alert"></p>
    <div class="directory-approval-actions"><button type="button" data-action="deny" autofocus>拒绝</button><button type="button" data-action="allow"></button></div>`;
  const access = item.directory.access;
  const valid = (access === 'read' || access === 'write') && !!item.directory.path && !!item.directory.taskId;
  dialog.querySelector('.directory-approval-path').textContent = item.directory.path || '（缺少目录，不能授权）';
  dialog.querySelector('.directory-approval-source').textContent = item.source || '未提供任务名称';
  dialog.querySelector('.directory-approval-task').textContent = item.directory.taskId || '（缺少任务 ID）';
  dialog.querySelector('.directory-approval-access').textContent = access === 'write'
    ? '读取和写入（write）：允许读取、创建和修改该目录及子目录中的文件，可能修改已有内容。'
    : access === 'read' ? '只读（read）：允许读取该目录及子目录，不允许写入或修改文件。' : '未知权限，不能授权。';
  const allowButton = dialog.querySelector('[data-action="allow"]');
  allowButton.textContent = access === 'write' ? '允许本任务写入' : '允许本任务只读';
  allowButton.disabled = !valid;
  const state = { item, dialog, pending:false, signature:JSON.stringify([item.directory, item.source]) };
  directoryApproval = state;
  const submit = async allow => {
    if (state.pending || directoryApproval !== state || (allow && !valid)) return;
    state.pending = true;
    dialog.setAttribute('aria-busy', 'true');
    const buttons = dialog.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; });
    const error = dialog.querySelector('.directory-approval-error');
    error.textContent = '';
    try {
      const response = await fetch('/api/security/approvals/' + encodeURIComponent(item.id), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({allow, scope:'once'}), signal:AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error('审批未确认');
      directoryApprovalResolved.add(item.id);
      ++apPollVersion; // 丢弃在提交完成前发出的旧 GET，避免已经处理的审批复活。
      if (directoryApproval === state) {
        closeDirectoryApproval();
        syncDirectoryApprovals(directoryApprovalQueue);
      }
      pollApprovals();
    } catch {
      if (directoryApproval === state) error.textContent = '提交失败或未收到确认，不能视为已授权。请重试；也可以拒绝。';
    } finally {
      state.pending = false;
      dialog.removeAttribute('aria-busy');
      buttons.forEach(b => { b.disabled = false; });
      allowButton.disabled = !valid;
    }
  };
  allowButton.onclick = () => submit(true);
  dialog.querySelector('[data-action="deny"]').onclick = () => submit(false);
  dialog.addEventListener('cancel', e => {
    e.preventDefault(); // Esc 等价于拒绝；提交期间不并发发送相反决定。
    submit(false);
  });
  document.body.appendChild(dialog);
  dialog.showModal(); // 默认聚焦拒绝，回车不会意外批准。
}

async function pollApprovals() {
  const version = ++apPollVersion;
  const d = await fetch("/api/security/approvals", {cache:'no-store'}).then(r => (r.ok ? r.json() : null)).catch(() => null);
  // 网络错误不等于审批消失：保留窗口，只有有效列表才能关闭超时审批。
  if (version !== apPollVersion || !d || !Array.isArray(d.items)) return;
  const allItems = d.items;
  for (const id of directoryApprovalResolved) if (!allItems.some(a => a.id === id)) directoryApprovalResolved.delete(id);
  syncDirectoryApprovals(allItems);
  const list = allItems.filter(a => !a.directory);
  if (d && d.mode) syncPermLabel(d.mode);
  // 审批默认 120 秒超时按拒绝：窗口不在前台时必须把人喊回来，不然任务白等一场
  const fresh = allItems.filter(a => !apSeen.has(a.id));
  if (apSeen.size > 500) apSeen = new Set();
  allItems.forEach(a => apSeen.add(a.id));
  if (fresh.length && document.hidden && "Notification" in window && Notification.permission === "granted") {
    const a = fresh[0];
    try { new Notification("🛡️ CloseCode 等你审批", { body: `${a.source ? `「${a.source}」· ` : ""}${a.kind}：${(a.text || "").slice(0, 80)}` }); } catch {}
  }
  let bar = document.getElementById("approval-bar");
  if (!list.length) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "approval-bar";
    const inner = document.querySelector(".input-inner");
    inner.insertBefore(bar, inner.querySelector(".input-card"));
  }
  // ruleKey 为空 = 这次拦截的理由不适合被记住（碰了文件黑名单那种），只给「本次允许」
  bar.innerHTML = list.map(a => `
    <div class="ap-row">
      <div class="ap-main">
        <div class="ap-head">🛡️ ${esc(a.kind)}待审批${a.source ? ` · <span class="ap-src" title="发起审批的任务">来自「${esc(a.source)}」</span>` : ""}${a.rule ? ` · <span class="ap-why">${esc(a.rule)}</span>` : ""}</div>
        ${a.directory ? `<div class="ap-why">${a.directory.access === 'write' ? '申请读取和写入该目录及子目录；写入可能修改已有文件。' : '申请只读访问该目录及子目录，不允许写入。'}仅当前任务有效，可随时在设置的「安全中心」中撤销。</div>` : ''}
        <code class="ap-cmd" style="${a.directory ? 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:none' : ''}" title="${esc(a.text)}">${esc(a.directory ? a.directory.path : a.text.slice(0, 160))}</code>
      </div>
      <div class="ap-btns">
        <button class="ap-ok" data-id="${esc(a.id)}" data-scope="once">${a.directory ? (a.directory.access === 'write' ? '允许本任务写入' : '允许本任务只读') : '本次允许'}</button>
        ${!a.directory && a.ruleKey ? `<button class="ap-ok2" data-id="${esc(a.id)}" data-scope="session" title="本次运行期间不再问「${esc(a.ruleKey)}」">本会话一直允许</button>
        <button class="ap-ok2" data-id="${esc(a.id)}" data-scope="always" title="把「${esc(a.ruleKey)}」写进放行名单，重启也生效">一直允许</button>` : ""}
        <button class="ap-no" data-id="${esc(a.id)}">拒绝</button>
      </div>
    </div>`).join("");
  bar.querySelectorAll("button").forEach(b => b.onclick = async () => {
    bar.querySelectorAll("button").forEach(x => (x.disabled = true));
    const allow = !b.classList.contains("ap-no");
    const r = await fetch("/api/security/approvals/" + encodeURIComponent(b.dataset.id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allow, scope: b.dataset.scope || "once" }),
    }).then(r => r.json()).catch(() => ({}));
    if (allow && b.dataset.scope === "always" && r.ruleKey) toast(`已永久放行「${r.ruleKey}」（可在 设置 → 安全中心 的放行名单里删掉）`);
    else if (allow && b.dataset.scope === "session" && r.ruleKey) toast(`本次运行期间不再问「${r.ruleKey}」`);
    pollApprovals();
  });
}

// ================= 权限档位（参考 Claude Code：档位 + 记住的批准） =================
let permModes = null;
function syncPermLabel(mode) {
  const el = document.getElementById("perm-label");
  if (!el || !permModes || !permModes[mode]) return;
  el.textContent = permModes[mode].label;
  document.querySelectorAll("#perm-menu .mi").forEach(x => x.classList.toggle("on", x.dataset.perm === mode));
}
async function loadPermModes() {
  const d = await fetch("/api/security/modes").then(r => r.json()).catch(() => null);
  if (!d) return;
  permModes = d.modes;
  const menu = document.getElementById("perm-menu");
  menu.innerHTML = Object.entries(d.modes)
    .map(([k, m]) => `<div class="mi" data-perm="${esc(k)}">${esc(m.label)} <span class="sub">${esc(m.desc)}</span></div>`)
    .join("");
  menu.querySelectorAll(".mi").forEach(mi => mi.onclick = async () => {
    menu.classList.remove("show");
    await setPermMode(mi.dataset.perm);
  });
  syncPermLabel(d.current);
}
async function setPermMode(mode) {
  const r = await fetch("/api/security/mode", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }),
  }).then(r => r.json()).catch(() => ({}));
  if (r.ok) { syncPermLabel(mode); toast(`权限档位：${permModes[mode].label}`); }
  else toast("切换失败");
}
setupPicker("perm-btn", "perm-menu");
loadPermModes();
// 审批只可能在任务运行中产生：跑任务时 3 秒一查，空闲时降到 15 秒
// （定时任务/IM 触发的后台任务也会要审批，所以空闲不能完全停）
(function approvalLoop() {
  pollApprovals().finally(() => setTimeout(approvalLoop, runningSessions.size ? 3000 : 15000));
})();


// ---------- 外观（浅色/深色/跟随系统，存本机与配置）
document.getElementById("gear-btn").onclick = () => openModal("settings");
// ---------- 外观（浅色/深色/跟随系统，存本机与配置） ----------
const THEME_LABEL = { light: "浅色", dark: "深色", system: "跟随系统" };
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
function getTheme() {
  const t = localStorage.getItem("wb-theme");
  if (THEME_LABEL[t]) return t;
  if (window.settingsCache && THEME_LABEL[window.settingsCache.theme]) return window.settingsCache.theme;
  return "system";
}
function applyTheme(theme) {
  const t = (theme && THEME_LABEL[theme]) ? theme : getTheme();
  const effective = t === "dark" || (t === "system" && themeMedia.matches) ? "dark" : "light";
  document.documentElement.dataset.theme = effective;
  document.documentElement.setAttribute('data-theme', effective);

  // 根据主题切换 logo
  const brandLogo = document.getElementById("brand-logo");
  if (brandLogo) {
    brandLogo.src = effective === "dark" ? "/assets/logos/docode1.webp" : "/assets/logos/docode2.webp";
  }

  // 更新对话中所有助手头像
  const logoSrc = effective === "dark" ? "/assets/logos/docode1.webp" : "/assets/logos/docode2.webp";
  document.querySelectorAll(".a-msg .avatar img").forEach(img => {
    img.src = logoSrc;
  });

  // 更新侧栏的助手头像
  const abIc = document.getElementById("ab-ic");
  if (abIc) {
    const abAva = abIc.querySelector(".ab-ava img");
    if (abAva) {
      abAva.src = logoSrc;
    }
  }
}
themeMedia.addEventListener("change", () => applyTheme());
function setTheme(t) {
  if (!THEME_LABEL[t]) return;
  localStorage.setItem("wb-theme", t);
  applyTheme(t);
  if (typeof saveSettings === "function") {
    saveSettings({ theme: t }).catch(() => {});
  }
}
applyTheme();

// 侧栏底部的日间/夜间开关。真正生效的主题写在 html[data-theme] 上，开关的样式也只认这一个值，
// 所以这里不另存一份状态——点一下就是翻到另一边，不会出现「界面是亮的、控件却显示深色」
const themeSwitchBtn = document.getElementById("theme-switch");
if (themeSwitchBtn) {
  themeSwitchBtn.onclick = () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  };
}

// 关闭历史对话下拉菜单（点击外部）
document.addEventListener("click", (e) => {
  if (!e.target.closest(".hist-item")) {
    document.querySelectorAll(".hmenu-dropdown.show").forEach(d => d.classList.remove("show"));
  }
});

// 代码块「复制」按钮（事件委托，覆盖所有历史与流式渲染出的代码块）
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".code-copy");
  if (!btn) return;
  const pre = btn.closest(".code-wrap")?.querySelector("pre");
  if (!pre) return;
  const text = pre.textContent || "";
  const done = () => { btn.textContent = "已复制 ✓"; setTimeout(() => { btn.textContent = "复制"; }, 1500); };
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done)); }
  else fallbackCopy(text, done);
  function fallbackCopy(t, cb) {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta); cb();
  }
});

// 内联 SVG 图表的三个动作（事件委托，历史回放与流式渲染共用）
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".svg-fig .svg-acts button");
  if (!btn) return;
  const fig = btn.closest(".svg-fig");
  const raw = fig.dataset.src || "";
  const act = btn.dataset.a;
  const project = btn.closest(".turn")?.dataset.project || activeProject;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  if (act === "svg-code") {
    const box = fig.querySelector(".svg-raw");
    if (box) { box.remove(); btn.textContent = "源码"; return; }
    const pre = document.createElement("pre");
    pre.className = "svg-raw";
    pre.textContent = raw;
    fig.insertBefore(pre, fig.querySelector(".svg-acts"));
    btn.textContent = "收起源码";
    return;
  }
  if (act === "svg-save") return saveInlineFile(`图表-${stamp}.svg`, fig.querySelector("svg").outerHTML, btn, project);
  if (act === "svg-png") {
    btn.disabled = true;
    try { await saveInlineFile(`图表-${stamp}.png`, await SvgFig.svgToPngDataUrl(fig.querySelector("svg")), btn, project); }
    catch (err) { toast("转图片失败：" + err.message); }
    finally { btn.disabled = false; }
  }
});
async function saveInlineFile(name, content, btn, project = btn.closest(".turn")?.dataset.project || activeProject) {
  const r = await fetch("/api/files/save", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, content, project }),
  }).then(x => x.json()).catch(() => null);
  if (!r?.ok) return toast("保存失败：" + (r?.error || "接口无响应"));
  if (r.files && activeProject === project) renderFiles(r.files);
  const old = btn.textContent;
  btn.textContent = "已存 ✓";
  setTimeout(() => { btn.textContent = old; }, 1600);
  toast(`已存到工作目录：${name}`);
}

async function checkUpdate() {
  toast("正在检查更新…");
  const r = await fetch("/api/app/update-check", { method: "POST" }).then(x => x.json()).catch(() => null);
  if (!r) return toast("检查更新失败：接口无响应");
  if (!r.ok) return toast(`当前版本 v${r.version || "?"} · ${r.reason}`);
  toast(r.behind > 0 ? `发现新版本：本地落后 ${r.behind} 个提交，在项目目录执行 git pull 后重启即可` : `已是最新版本（v${r.version}）`);
}
const SRC_TXT = { web: "网页", cli: "CLI", im: "IM", schedule: "定时" };
