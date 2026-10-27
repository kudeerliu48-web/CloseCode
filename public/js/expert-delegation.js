// 选择仍属于下一条消息；此文件只管理展示，不改动后端分派策略。
let pendingDelegation = { type: "auto" };
let delegationLoading = false;
let delegationCatalog = null;
let delegationLoadError = false;
let delegationTab = "team";
function getPendingDelegation() { return { ...pendingDelegation }; }
function delegationEl(id) { return document.getElementById(id); }
function delegationAutoEnabled() { return typeof settingsCache === "undefined" || settingsCache?.agent?.auto_delegate !== false; }
function delegationReadOnly() { return typeof currentMode !== "undefined" && ["ask", "plan"].includes(currentMode); }
function delegationNode(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function delegationMembers(team) {
  const names = new Set((delegationCatalog?.experts || []).map(e => e.name));
  return [...new Set(Array.isArray(team.members) ? team.members : [])].filter(n => names.has(n));
}
function setPendingDelegation(value) {
  pendingDelegation = { ...(value || { type: "auto" }) };
  closeDelegationPicker();
  syncDelegationControl();
}
function syncDelegationControl() {
  const button = delegationEl("delegation-trigger");
  if (!button) return;
  const { type, name } = pendingDelegation;
  const manual = type === "expert" || type === "team";
  const target = manual && delegationCatalog?.[type === "team" ? "teams" : "experts"].find(e => e.name === name);
  const invalid = !!(manual && delegationCatalog && (!target || (type === "team" && delegationMembers(target).length < 2)));
  const label = manual ? name : type === "none" ? "独立处理" : delegationReadOnly() ? "只读" : delegationAutoEnabled() ? "自动" : "按需";
  delegationEl("delegation-label").textContent = label;
  button.dataset.selection = type;
  button.dataset.invalid = String(invalid);
  button.title = invalid ? "所选对象不可用，请重新选择" : (manual ? (type === "team" ? "团队 · " : "专家 · ") + name : label) + " · 仅对下一条消息生效";
  button.setAttribute("aria-label", "本轮协作：" + label + (invalid ? "，对象不可用" : ""));
  delegationEl("delegation-auto-title").textContent = delegationReadOnly() ? "保持只读" : delegationAutoEnabled() ? "自动匹配" : "按需协作";
  delegationEl("delegation-auto-desc").textContent = delegationReadOnly() ? "不启动专家子任务" : delegationAutoEnabled() ? "按任务需要选择专家" : "规则匹配已在设置中关闭";
  const note = delegationEl("delegation-selection-note");
  note.hidden = !invalid;
  note.textContent = invalid ? "所选「" + name + "」不存在或有效成员不足，请重新选择。" : "";
  delegationEl("delegation-mode-hint").textContent = delegationReadOnly()
    ? "当前为只读模式；指定专家或团队将切换到 Craft 执行。"
    : "团队顺序接力，会增加模型调用与费用。";
  for (const choice of delegationEl("delegation-popover").querySelectorAll("[data-delegation-choice]")) {
    const selection = JSON.parse(choice.dataset.delegationChoice);
    choice.setAttribute("aria-pressed", String(selection.type === type && selection.name === name));
  }
}
function renderDelegationChoices() {
  const list = delegationEl("delegation-results");
  if (!list) return;
  const focusedChoice = list.contains(document.activeElement) ? document.activeElement?.closest("[data-delegation-choice]")?.dataset.delegationChoice : null;
  const scrollTop = list.scrollTop;
  list.replaceChildren();
  list.setAttribute("aria-busy", String(delegationLoading));
  list.setAttribute("aria-labelledby", "delegation-tab-" + delegationTab);
  for (const type of ["team", "expert"]) {
    const tab = delegationEl("delegation-tab-" + type);
    tab.setAttribute("aria-selected", String(type === delegationTab)); tab.tabIndex = type === delegationTab ? 0 : -1;
    delegationEl("delegation-" + type + "-count").textContent = delegationCatalog ? String(delegationCatalog[type === "team" ? "teams" : "experts"].length) : "—";
  }
  const feedback = delegationEl("delegation-feedback");
  feedback.hidden = !delegationLoading && !delegationLoadError;
  delegationEl("delegation-feedback-text").textContent = delegationLoading ? "正在更新协作对象…" : delegationCatalog ? "更新失败，暂时显示上次加载的列表。" : "暂时无法加载专家与团队。";
  delegationEl("delegation-retry").hidden = delegationLoading || !delegationLoadError;
  if (!delegationCatalog) {
    list.appendChild(delegationNode("p", "delegation-empty", delegationLoading ? "正在加载…" : "仍可选择自动协作或独立处理。"));
    syncDelegationControl(); return;
  }
  const query = delegationEl("delegation-search").value.trim().toLocaleLowerCase();
  const items = delegationCatalog[delegationTab === "team" ? "teams" : "experts"].filter(item =>
    [item.name, item.alias, item.description, item.category, ...(item.tags || []), ...(item.members || [])].join(" ").toLocaleLowerCase().includes(query));
  if (!items.length) list.appendChild(delegationNode("p", "delegation-empty", query ? "没有匹配的" + (delegationTab === "team" ? "团队" : "专家") + "，试试其他关键词或切换分类。" : "还没有" + (delegationTab === "team" ? "团队" : "专家") + "，可在专家页面创建。"));
  for (const item of items) {
    const team = delegationTab === "team", members = team ? delegationMembers(item) : [];
    const disabled = team && members.length < 2;
    const choice = delegationNode("button", "delegation-choice");
    choice.type = "button"; choice.disabled = disabled;
    choice.dataset.delegationChoice = JSON.stringify({ type: delegationTab, name: item.name });
    const avatar = delegationNode("span", "delegation-avatar", item.avatar || (team ? "团" : "专"));
    avatar.setAttribute("aria-hidden", "true");
    const info = delegationNode("span", "delegation-choice-info");
    const line = delegationNode("span", "delegation-choice-title");
    line.appendChild(delegationNode("strong", "", item.name));
    line.appendChild(delegationNode("span", "delegation-choice-meta", team ? members.length + " 人接力" : item.category || "专家"));
    info.appendChild(line);
    info.appendChild(delegationNode("span", "delegation-choice-desc", item.description || (team ? "按成员顺序协作，交接任务产物" : item.alias || "专注完成指定的专业任务")));
    if (team) info.appendChild(delegationNode("span", "delegation-choice-members", members.join(" → ")));
    const missing = team ? members.filter(n => delegationCatalog.experts.find(e => e.name === n)?.missing_skills?.length) : item.missing_skills || [];
    if (disabled || missing.length) info.appendChild(delegationNode("span", "delegation-choice-warning", disabled ? "有效成员不足 2 人，请先编辑团队" : team ? "部分成员的绑定技能缺失" : "缺少技能：" + missing.join("、")));
    const check = delegationNode("span", "delegation-check", "✓"); check.setAttribute("aria-hidden", "true");
    choice.append(avatar, info, check); list.appendChild(choice);
  }
  syncDelegationControl();
  if (focusedChoice && !delegationEl("delegation-popover").hidden) {
    const replacement = [...list.querySelectorAll("[data-delegation-choice]")].find(el => !el.disabled && el.dataset.delegationChoice === focusedChoice);
    (replacement || delegationEl("delegation-search")).focus({ preventScroll: true });
  }
  list.scrollTop = scrollTop;
}
async function refreshDelegationChoices() {
  if (delegationLoading) return;
  delegationLoading = true; delegationLoadError = false; renderDelegationChoices();
  try {
    const responses = await Promise.all([fetch("/api/experts"), fetch("/api/expert-teams")]);
    if (responses.some(r => !r.ok)) throw Error("catalog unavailable");
    const [experts, teams] = await Promise.all(responses.map(r => r.json()));
    if (!Array.isArray(experts) || !Array.isArray(teams)) throw Error("invalid catalog");
    delegationCatalog = { experts, teams };
  } catch { delegationLoadError = true; }
  finally { delegationLoading = false; renderDelegationChoices(); positionDelegationPicker(); }
}
function positionDelegationPicker() {
  const panel = delegationEl("delegation-popover"), trigger = delegationEl("delegation-trigger");
  if (!panel || panel.hidden || !trigger) return;
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
  const x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0;
  const rect = trigger.getBoundingClientRect(), gap = 8, edge = 12;
  const panelWidth = Math.max(1, Math.min(400, width - edge * 2));
  const above = rect.top - y - edge - gap, below = y + height - rect.bottom - edge - gap;
  const centered = Math.max(above, below) < 300 || rect.top >= y + height - edge || rect.bottom <= y + edge;
  panel.style.width = panelWidth + "px";
  panel.style.maxHeight = Math.max(1, Math.min(560, height - edge * 2, centered ? height - edge * 2 : Math.max(above, below))) + "px";
  panel.style.left = Math.max(x + edge, Math.min(rect.left, x + width - panelWidth - edge)) + "px";
  const top = centered ? y + (height - panel.offsetHeight) / 2 : above >= below ? rect.top - panel.offsetHeight - gap : rect.bottom + gap;
  panel.style.top = Math.max(y + edge, Math.min(top, y + height - panel.offsetHeight - edge)) + "px";
}
function closeDelegationPicker(restoreFocus = false) {
  const panel = delegationEl("delegation-popover"), trigger = delegationEl("delegation-trigger");
  if (!panel) return;
  const wasOpen = !panel.hidden;
  panel.hidden = true; trigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus && wasOpen) trigger?.focus();
}
function openDelegationPicker() {
  const panel = delegationEl("delegation-popover");
  if (!panel) return;
  // 与已有模型/权限菜单互斥，避免两层菜单盖住彼此。
  document.querySelectorAll(".picker-menu.show").forEach(menu => menu.classList.remove("show"));
  delegationTab = pendingDelegation.type === "expert" ? "expert" : "team";
  delegationEl("delegation-search").value = "";
  panel.hidden = false; delegationEl("delegation-trigger").setAttribute("aria-expanded", "true");
  renderDelegationChoices(); positionDelegationPicker();
  delegationEl("delegation-search").focus({ preventScroll: true });
  refreshDelegationChoices();
}
function chooseDelegation(selection) {
  setPendingDelegation(selection);
  if (["expert", "team"].includes(selection.type) && delegationReadOnly()) setMode("craft");
  delegationEl("delegation-trigger")?.focus();
}
document.addEventListener("DOMContentLoaded", () => {
  const trigger = delegationEl("delegation-trigger"), panel = delegationEl("delegation-popover");
  if (!trigger || !panel) return;
  syncDelegationControl();
  trigger.onclick = () => panel.hidden ? openDelegationPicker() : closeDelegationPicker();
  delegationEl("delegation-close").onclick = () => closeDelegationPicker(true);
  delegationEl("delegation-retry").onclick = refreshDelegationChoices;
  delegationEl("delegation-search").oninput = () => { delegationEl("delegation-results").scrollTop = 0; renderDelegationChoices(); positionDelegationPicker(); };
  panel.addEventListener("click", event => {
    const choice = event.target.closest("[data-delegation-choice]");
    if (choice && !choice.disabled) chooseDelegation(JSON.parse(choice.dataset.delegationChoice));
    const tab = event.target.closest("[data-delegation-tab]");
    if (tab) { delegationTab = tab.dataset.delegationTab; delegationEl("delegation-results").scrollTop = 0; renderDelegationChoices(); positionDelegationPicker(); }
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDelegationPicker(true); return; }
    if (event.target.matches("[role=tab]") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault(); delegationTab = event.key === "Home" ? "team" : event.key === "End" ? "expert" : delegationTab === "team" ? "expert" : "team";
      delegationEl("delegation-results").scrollTop = 0; renderDelegationChoices(); positionDelegationPicker(); delegationEl("delegation-tab-" + delegationTab).focus();
    } else if (["ArrowDown", "ArrowUp"].includes(event.key) && (event.target.id === "delegation-search" || event.target.closest(".delegation-choice"))) {
      const choices = [...panel.querySelectorAll(".delegation-choice:not(:disabled)")];
      if (!choices.length) return;
      event.preventDefault(); const index = choices.indexOf(document.activeElement);
      const next = index < 0 ? (event.key === "ArrowDown" ? 0 : choices.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
      choices[next].focus();
    }
  });
  document.addEventListener("click", event => { if (!delegationEl("delegation-control").contains(event.target)) closeDelegationPicker(); });
  document.addEventListener("focusin", event => { if (!panel.hidden && !delegationEl("delegation-control").contains(event.target)) closeDelegationPicker(); });
  window.addEventListener("resize", positionDelegationPicker);
  window.addEventListener("scroll", event => { if (!panel.contains(event.target)) positionDelegationPicker(); }, true);
  window.visualViewport?.addEventListener("resize", positionDelegationPicker);
  window.visualViewport?.addEventListener("scroll", positionDelegationPicker);
});
