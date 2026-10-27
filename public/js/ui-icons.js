"use strict";
// Local, transparent WebP assets. Keep paths/classes allow-listed: these helpers
// are also used while rendering provider names from user-managed model settings.
const UI_ICON_NAMES = new Set([
  "profile", "models", "skills", "agent", "context", "persona", "pet", "data", "update", "about",
  "settings", "tip", "clock", "error", "warning", "folder", "folder-open", "note", "export",
  "check", "globe", "sparkles", "monitor", "key", "box", "edit", "gift", "logout", "basketball",
  "image", "pin", "move", "broom", "save",
]);
function uiIcon(name, variant = "") {
  const safeName = UI_ICON_NAMES.has(name) ? name : "about";
  const modifier = ["sm", "lg", "hero", "spin"].includes(variant) ? " ui-icon--" + variant : "";
  return '<img class="ui-icon' + modifier + '" src="/assets/icons/' + safeName + '.webp" width="20" height="20" alt="" aria-hidden="true" draggable="false">';
}
function providerIcon(provider) {
  const key = String(provider || "").trim().toLowerCase();
  const names = { gpt: "GPT", grok: "Grok", claude: "Claude", gemini: "Gemini" };
  if (Object.prototype.hasOwnProperty.call(names, key)) {
    const tone = key === "gpt" || key === "grok" ? "mono" : "color";
    return '<img class="model-provider-icon model-provider-icon--' + tone + '" src="/assets/logos/' + key + '.webp" width="18" height="18" alt="' + names[key] + '" draggable="false">';
  }
  if (key === "custom" || key === "国模") return uiIcon("globe");
  if (key === "vision" || key === "视觉") return '<svg class="i model-provider-eye" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="vision-eye-gradient" x1="3" y1="6" x2="21" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="#38bdf8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs><path class="vision-eye-outline" d="M2.2 12s3.5-6 9.8-6 9.8 6 9.8 6-3.5 6-9.8 6-9.8-6-9.8-6Z" fill="none" stroke="url(#vision-eye-gradient)" stroke-width="1.8"/><circle class="vision-eye-pupil" cx="12" cy="12" r="2.8" fill="#a78bfa" stroke="#38bdf8" stroke-width="1.2"/></svg>';
  if (key === "image" || key === "生图") return uiIcon("image");
  if (key === "welfare" || key === "福利") return uiIcon("gift");
  return ""; // The caller displays an escaped text label for unknown providers.
}
