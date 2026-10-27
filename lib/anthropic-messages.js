"use strict";

const { modelEndpoint } = require("./model-protocol");
const { modelEvents } = require("./model-stream");

function upstreamError(data, status) {
  const error = new Error(`LLM 接口错误${status ? ` HTTP ${status}` : ""}：Anthropic Messages 请求失败`);
  if (status) error.status = status;
  // 仅用于错误分类，不把可能含凭据的上游原文写到日志或界面。
  const detail = String(data?.error?.message || data?.error?.type || "");
  if (/context length|context_length|context window|maximum context|too many tokens|prompt is too long|input is too long/i.test(detail)) error.contextOverflow = true;
  return error;
}

function validateMessage(message) {
  if (!message || message.type === "error" || message.error || !Array.isArray(message.content)) throw upstreamError(message);
  for (const block of message.content) {
    if (!block || typeof block.type !== "string") throw new Error("Anthropic Messages 内容块不完整");
    if (["tool_use", "server_tool_use"].includes(block.type)) {
      if (!block.id || !block.name || !block.input || typeof block.input !== "object" || Array.isArray(block.input)) throw new Error("Anthropic Messages 工具调用不完整，未执行工具");
      if (message.stop_reason === "max_tokens") throw new Error("Anthropic Messages 工具调用达到输出上限，未执行工具");
    }
  }
  return message;
}

async function requestMessages(cfg, body, { signal, onTextDelta, onActivity } = {}) {
  signal?.throwIfAborted();
  const response = await fetch(modelEndpoint(cfg.base_url, "anthropic"), {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "x-api-key": cfg.api_key || process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw upstreamError(await response.json().catch(() => ({})), response.status);
  if (!body.stream || /application\/json/i.test(response.headers?.get("content-type") || "")) {
    const message = await response.json();
    signal?.throwIfAborted();
    validateMessage(message);
    for (const block of message.content) if (block.type === "text" && block.text) onTextDelta?.(block.text);
    return message;
  }

  let message = null, stopped = false;
  const blocks = new Map();
  for await (const event of modelEvents(response, { signal, onActivity })) {
    if (event.type === "error" || event.error) throw upstreamError(event);
    if (event.type === "message_start") message = { ...event.message };
    else if (event.type === "content_block_start") {
      blocks.set(event.index, { block: { ...event.content_block }, json: "", closed: false });
      if (event.content_block?.type === "text" && event.content_block.text) onTextDelta?.(event.content_block.text);
    } else if (event.type === "content_block_delta") {
      const state = blocks.get(event.index);
      if (!state || state.closed) throw new Error("Anthropic Messages 内容块不完整");
      const delta = event.delta || {};
      if (delta.type === "text_delta") {
        state.block.text = (state.block.text || "") + (delta.text || "");
        onTextDelta?.(delta.text || "");
      } else if (delta.type === "input_json_delta") state.json += delta.partial_json || "";
      else if (delta.type === "thinking_delta") state.block.thinking = (state.block.thinking || "") + (delta.thinking || "");
      else if (delta.type === "signature_delta") state.block.signature = (state.block.signature || "") + (delta.signature || "");
      else if (delta.type === "citations_delta") state.block.citations = [...(state.block.citations || []), delta.citation];
    } else if (event.type === "content_block_stop") {
      const state = blocks.get(event.index);
      if (!state) throw new Error("Anthropic Messages 内容块不完整");
      if (state.json) {
        try { state.block.input = JSON.parse(state.json); }
        catch { throw new Error("Anthropic Messages 工具参数不是完整 JSON，未执行工具"); }
      }
      if (["tool_use", "server_tool_use"].includes(state.block.type) && (!state.block.input || typeof state.block.input !== "object" || Array.isArray(state.block.input))) throw new Error("Anthropic Messages 工具参数必须为对象");
      state.closed = true;
    } else if (event.type === "message_delta") {
      if (!message) throw new Error("Anthropic Messages 缺少消息起始事件");
      Object.assign(message, event.delta);
      if (event.usage) message.usage = { ...(message.usage || {}), ...event.usage };
    } else if (event.type === "message_stop") {
      stopped = true;
      break;
    }
  }
  if (!stopped || !message || [...blocks.values()].some(state => !state.closed)) throw new Error("LLM 接口错误：Anthropic Messages 流提前结束，未收到完整消息");
  message.content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, state]) => state.block);
  return validateMessage(message);
}

module.exports = { requestMessages };
