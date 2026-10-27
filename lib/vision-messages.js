"use strict";

// Messages compatibility responses may be JSON or SSE. Never expose upstream
// error bodies: gateways can echo request credentials in errors.
function parseVisionMessages(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("识图接口返回空响应，不能判断为模型不支持图片。");
  if (text.startsWith("{")) {
    let body;
    try { body = JSON.parse(text); } catch { throw new Error("识图接口返回了无效 JSON。"); }
    if (body.error || body.type === "error") throw new Error("识图服务返回错误，未切换渠道或重试。");
    if (body.stop_reason === "max_tokens") throw new Error("识图结果达到输出上限，未收到完整回答。");
    return body;
  }
  const blocks = new Map();
  let stopped = false;
  for (const event of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    let body;
    try { body = JSON.parse(data); } catch { throw new Error("识图流包含无效事件，未返回不完整结果。"); }
    if (body.type === "error" || body.error) throw new Error("识图流返回服务错误，未切换渠道或重试。");
    if (body.type === "content_block_start" && body.content_block?.type === "text") blocks.set(body.index, body.content_block.text || "");
    if (body.type === "content_block_delta" && body.delta?.type === "text_delta") blocks.set(body.index, (blocks.get(body.index) || "") + (body.delta.text || ""));
    if (body.type === "message_delta" && body.delta?.stop_reason === "max_tokens") throw new Error("识图结果达到输出上限，未收到完整回答。");
    if (body.type === "message_stop") stopped = true;
  }
  if (!stopped) throw new Error("识图流提前结束，未收到完整回答。");
  return { content: [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => ({ type: "text", text: value })) };
}

module.exports = { parseVisionMessages };
