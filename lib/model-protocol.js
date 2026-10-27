"use strict";

// 只看实际请求的模型条目；全局 UI 页签不能决定会话或专家的协议。
function modelProvider(cfg = {}) {
  const name = String(cfg.name || "").trim();
  if (cfg.series === "custom" || cfg.provider === "custom" || /^国模\s*-/.test(name)) return "openai";
  if (["gpt", "grok"].includes(cfg.provider) || /^(?:GPT|Grok)\s*-/i.test(name)) return "openai";
  if (/^Claude\s*-/i.test(name) || cfg.provider === "anthropic" || cfg.provider === "claude" || /^claude(?:[-./\s]|$)/i.test(String(cfg.model || "").trim())) return "anthropic";
  return "openai";
}

function modelEndpoint(base, provider = "openai") {
  const value = String(base || (provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1")).trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("模型接口地址无效");
  const prefix = url.pathname.replace(/\/+$/, "").replace(/\/(?:chat\/completions|messages)$/i, "") || "/v1";
  url.pathname = `${prefix}/${provider === "anthropic" ? "messages" : "chat/completions"}`;
  url.hash = "";
  return url.toString();
}

module.exports = { modelProvider, modelEndpoint };
