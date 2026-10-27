"use strict";
// Server settings are the single source of truth; no conflicting local override.
function applyGlassEffect(enabled) {
  document.documentElement.dataset.glass = enabled === true ? "true" : "false";
}

function glassEffectCardHtml(settings = {}) {
  const enabled = settings.glassEffect === true;
  return `
    <section class="glass-settings-card" id="glass-settings-card" data-enabled="${enabled}" aria-labelledby="glass-effect-title">
      <div class="glass-settings-heading">
        <div class="glass-settings-copy">
          <h4 id="glass-effect-title">${uiIcon("persona")} 毛玻璃效果 <span class="glass-setting-tag">可选外观</span></h4>
        </div>
        <label class="glass-toggle">
          <input id="glass-effect-toggle" type="checkbox" role="switch" aria-labelledby="glass-effect-title" aria-describedby="glass-effect-note" ${enabled ? "checked" : ""}>
          <span class="glass-toggle-track" aria-hidden="true"></span>
        </label>
      </div>
      <div class="glass-preview" aria-hidden="true">
        <div class="glass-preview-surface glass-preview-solid"><span>经典界面</span><i></i><i></i><i></i></div>
        <div class="glass-preview-surface glass-preview-frosted"><span>毛玻璃</span><i></i><i></i><i></i></div>
      </div>
      <div class="glass-settings-footer">
        <span id="glass-effect-note">即时生效 · 自动保存 · 默认关闭</span>
      </div>
      <p id="glass-effect-message" class="glass-setting-message" role="status" aria-live="polite"></p>
    </section>`;
}

function bindGlassEffectControl(pane, settings = {}) {
  const toggle = pane.querySelector("#glass-effect-toggle");
  const card = pane.querySelector("#glass-settings-card");
  const message = pane.querySelector("#glass-effect-message");
  if (!toggle || !card || !message) return;
  let saved = settings.glassEffect === true, saving = false;
  function display(enabled) {
    toggle.checked = enabled;
    card.dataset.enabled = String(enabled);
    applyGlassEffect(enabled);
  }
  display(saved);
  toggle.onchange = async () => {
    if (saving) return;
    const next = toggle.checked;
    saving = true;
    toggle.disabled = true;
    card.setAttribute("aria-busy", "true");
    message.textContent = "正在保存…";
    message.classList.remove("is-error");
    display(next);
    try {
      const ok = await saveSettings({ glassEffect: next }, message);
      if (!ok) throw new Error(message.textContent || "保存失败，请重试");
      saved = next;
      message.textContent = "";
    } catch (error) {
      message.textContent = "保存失败，已恢复原设置。" + (error?.message || "请检查连接后重试。");
      message.classList.add("is-error");
    } finally {
      // Request failure rolls back both the checkbox and the live appearance.
      display(saved);
      saving = false;
      toggle.disabled = false;
      card.setAttribute("aria-busy", "false");
    }
  };
}
