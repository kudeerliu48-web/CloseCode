"use strict";
// The same update is used for typed text, mentions, prompt templates and send/reset.
function bindComposerAutoSize(input, mirror) {
  let lastWidth = 0;
  function update(event) {
    if (!input.isConnected || !input.getClientRects().length) return;
    const style = getComputedStyle(input);
    const number = value => parseFloat(value) || 0;
    const borders = number(style.borderTopWidth) + number(style.borderBottomWidth);
    const base = Math.ceil((number(style.lineHeight) || number(style.fontSize) * 1.6) * (input.rows || 2)
      + number(style.paddingTop) + number(style.paddingBottom) + borders);
    const viewport = window.visualViewport?.height || window.innerHeight;
    // Grow by at most 50%; additional text stays scrollable inside the composer.
    const limit = Math.max(base, Math.min(Math.floor(base * 1.5), Math.floor(viewport * .45)));
    const scroll = input.scrollTop;
    input.style.maxHeight = limit + "px";
    input.style.height = base + "px";
    // Some Chromium builds still report the old activeElement during blur.
    if (event?.type !== "blur" && document.activeElement === input) {
      input.style.height = Math.min(limit, Math.max(base, input.scrollHeight + borders)) + "px";
    }
    // A scrollbar changes the wrapping width; the @file mirror must match it too.
    if (mirror) {
      mirror.style.width = input.clientWidth + "px";
      for (const property of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontFamily", "fontSize", "lineHeight", "letterSpacing"]) mirror.style[property] = style[property];
    }
    input.scrollTop = scroll;
    if (mirror) mirror.scrollTop = input.scrollTop;
  }
  input.addEventListener("focus", update);
  input.addEventListener("blur", update);
  window.addEventListener("resize", update);
  window.visualViewport?.addEventListener("resize", update);
  // Observe width only: watching our own height changes creates a resize loop.
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width !== lastWidth) { lastWidth = width; update(); }
  }) : null;
  observer?.observe(input);
  update();
  return update;
}
