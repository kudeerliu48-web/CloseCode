"use strict";
// In browsers (and older installed shells) no title-bar space or native API is used.
function initDesktopAppearance() {
  const api = window.electronAPI;
  if (!api || typeof api.setWindowAppearance !== "function" || document.querySelector(".desktop-titlebar")) return;
  const root = document.documentElement;
  root.dataset.desktop = "true";
  root.dataset.platform = api.desktopPlatform;
  const titlebar = document.createElement("div");
  titlebar.className = "desktop-titlebar";
  titlebar.innerHTML = '<div class="desktop-titlebar-content"><span class="desktop-titlebar-name"></span></div>';
  titlebar.querySelector("span").textContent = document.title || "CloseCode";
  let maximizeButton, latestStateRevision = -1;
  function applyWindowState(state) {
    if (!state) return;
    if (Number.isInteger(state.stateRevision)) {
      if (state.stateRevision < latestStateRevision) return;
      latestStateRevision = state.stateRevision;
    }
    if (typeof state.fullscreen === "boolean") root.dataset.windowFullscreen = String(state.fullscreen);
    if (typeof state.maximized === "boolean") {
      root.dataset.windowMaximized = String(state.maximized);
      if (maximizeButton) {
        const label = state.maximized ? "还原" : "最大化";
        maximizeButton.setAttribute("aria-label", label); maximizeButton.title = label;
      }
    }
  }
  // macOS retains traffic lights; old shells retain their native overlay. Both
  // welcome/login and the main app use this same shared, background-free group.
  if (api.desktopPlatform !== "darwin" && typeof api.windowControl === "function") {
    titlebar.classList.add("has-window-controls");
    const controls = document.createElement("div");
    controls.className = "desktop-window-controls";
    controls.setAttribute("role", "group"); controls.setAttribute("aria-label", "窗口控制");
    const icons = {
      minimize: '<path d="M2 6h8"/>',
      "toggle-maximize": '<rect class="window-icon-maximize" x="2" y="2" width="8" height="8"/><path class="window-icon-restore" d="M4 3V1.5h6.5V8H9M1.5 4H8v6.5H1.5Z"/>',
      close: '<path d="m2 2 8 8m0-8-8 8"/>',
    };
    for (const [action, label] of [["minimize", "最小化"], ["toggle-maximize", "最大化"], ["close", "关闭"]]) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "desktop-window-button";
      button.dataset.windowAction = action; button.title = label; button.setAttribute("aria-label", label);
      button.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">' + icons[action] + "</svg>";
      let pending = false;
      button.addEventListener("click", async () => {
        if (pending) return;
        // aria-disabled guards repeated input without dropping keyboard focus.
        pending = true; button.setAttribute("aria-disabled", "true");
        try { applyWindowState(await api.windowControl(action)); }
        catch (error) {
          console.warn("窗口操作失败", error);
          if (typeof toast === "function") toast("窗口操作未成功，请重试");
        } finally { pending = false; button.removeAttribute("aria-disabled"); }
      });
      if (action === "toggle-maximize") maximizeButton = button;
      controls.append(button);
    }
    titlebar.append(controls);
  }
  document.body.prepend(titlebar);
  const reduced = matchMedia("(prefers-reduced-transparency: reduce)"), contrast = matchMedia("(forced-colors: active)");
  let revision = 0, queued = false, previous = "";
  function queueSync() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); });
  }
  async function sync() {
    const theme = root.dataset.theme === "dark" ? "dark" : "light";
    const css = getComputedStyle(root);
    const token = name => /^#[0-9a-f]{6}$/i.test(css.getPropertyValue(name).trim()) ? css.getPropertyValue(name).trim() : undefined;
    const value = {
      theme, themeSource: typeof getTheme === "function" ? getTheme() : theme,
      glassEffect: root.dataset.glass === "true" && !reduced.matches && !contrast.matches,
      background: token("--background"), foreground: token("--foreground"),
    };
    const key = JSON.stringify(value);
    if (key === previous) return;
    previous = key;
    const ownRevision = ++revision;
    try {
      const response = await api.setWindowAppearance(value);
      if (ownRevision === revision) {
        root.dataset.nativeGlass = response?.nativeGlass === true ? "true" : "false";
        applyWindowState(response);
      }
    } catch {
      if (ownRevision === revision) { root.dataset.nativeGlass = "false"; previous = ""; }
    }
  }
  new MutationObserver(queueSync).observe(root, {attributes:true, attributeFilter:["data-theme","data-glass","data-skin"]});
  reduced.addEventListener("change", queueSync); contrast.addEventListener("change", queueSync);
  api.onWindowState?.(applyWindowState);
  queueSync();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initDesktopAppearance, {once:true});
else initDesktopAppearance();
