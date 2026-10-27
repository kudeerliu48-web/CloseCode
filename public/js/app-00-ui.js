/* ============================================================================
 * app-00-ui.js —— 界面底层小工具，排在 app-01 之前，后面所有模块直接用
 *   ic(name)  取一个 lucide 图标（sprite 在 index.html 顶部，离线可用）
 *   tooltip   顶掉浏览器原生 title
 * ========================================================================== */

/** 取一个 lucide 图标的内联 svg。name 见 index.html 里 #wb-sprite 的 symbol id */
function ic(name, cls) {
  return `<svg class="i${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

/* 自建 tooltip 顶掉原生 title：原生那个要悬停一秒才出来，出来是一坨系统灰框，
   成果卡上那种长路径会直接糊掉半张卡。这里 380ms 出、跟着目标走、贴不下就翻到下方。
   不改任何标记——鼠标扫过时把 title 就地搬进 data-tip，动态插入的节点一样吃得到。 */
(function () {
  let tipEl = null, timer = null, cur = null;

  function ensure() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "ui-tooltip";
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function place(target) {
    const t = ensure();
    const r = target.getBoundingClientRect();
    const b = t.getBoundingClientRect();
    let top = r.top - b.height - 8;
    if (top < 6) top = r.bottom + 8;                                  // 上面塞不下就翻到下面
    let left = r.left + r.width / 2 - b.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - b.width - 6)); // 别顶出屏幕
    t.style.top = `${Math.round(top)}px`;
    t.style.left = `${Math.round(left)}px`;
  }

  function hide() {
    clearTimeout(timer);
    cur = null;
    if (tipEl) tipEl.classList.remove("show");
  }

  function show(target, text) {
    const t = ensure();
    cur = target;
    t.textContent = text;
    t.style.top = "-9999px";
    t.classList.add("show");
    place(target);
  }

  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest("[title],[data-tip]");
    if (!el) return;
    if (el.hasAttribute("title")) {
      // 搬家而不是复制：留着 title 的话原生框还会照样弹出来，变成两个提示叠着
      const raw = el.getAttribute("title");
      el.removeAttribute("title");
      if (raw) el.dataset.tip = raw;
    }
    const text = el.dataset.tip;
    if (!text || el === cur) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(el, text), 380);
  });

  document.addEventListener("mouseout", (e) => {
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (el && el === cur) hide();
    else if (el) clearTimeout(timer);
  });
  // 点一下就把提示收走：点完按钮还挂着一条说明，看着像卡住了
  document.addEventListener("mousedown", hide, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
})();


// 现代化确认弹窗：替换原生的 confirm
function showConfirmDialog(options = {}) {
  const {
    title = "确认操作？",
    desc = "",
    confirmText = "确认",
    cancelText = "取消",
    icon = "logout", // "logout" | "trash" | "warning"
    danger = true,
    onConfirm = () => {}
  } = options;

  const safe = (value) => { const el = document.createElement("div"); el.textContent = String(value ?? ""); return el.innerHTML; };
  let overlay = document.getElementById("custom-confirm-dialog");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "custom-confirm-dialog";
    overlay.className = "confirm-dialog-overlay";
    document.body.appendChild(overlay);
  }

  let iconSvg = '';
  if (icon === "trash") {
    iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
    `;
  } else if (icon === "warning") {
    iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    `;
  } else {
    // 默认 logout
    iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
      </svg>
    `;
  }

  overlay.innerHTML = `
    <div class="confirm-dialog-card" onclick="event.stopPropagation()">
      <div class="confirm-dialog-body">
        <div class="confirm-dialog-icon">
          ${iconSvg}
        </div>
        <div class="confirm-dialog-title">${safe(title)}</div>
        ${desc ? `<div class="confirm-dialog-desc">${safe(desc)}</div>` : ""}
        <div class="confirm-dialog-actions" style="${desc ? '' : 'margin-top:14px;'}">
          <button type="button" class="confirm-dialog-btn btn-cancel" id="confirm-dialog-cancel">${safe(cancelText)}</button>
          <button type="button" class="confirm-dialog-btn ${danger ? 'btn-danger' : 'btn-brand'}" id="confirm-dialog-ok">${safe(confirmText)}</button>
        </div>
      </div>
    </div>
  `;

  const close = () => {
    overlay.classList.remove("show");
  };

  overlay.onclick = close;
  const cancelBtn = overlay.querySelector("#confirm-dialog-cancel");
  const okBtn = overlay.querySelector("#confirm-dialog-ok");

  if (cancelBtn) cancelBtn.onclick = close;
  if (okBtn) {
    okBtn.onclick = () => {
      close();
      if (typeof onConfirm === "function") onConfirm();
    };
  }

  // 动画展示
  requestAnimationFrame(() => {
    overlay.classList.add("show");
  });
}
