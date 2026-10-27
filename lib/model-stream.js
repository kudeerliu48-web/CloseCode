"use strict";

// 消费 SSE 的 data 帧；在正常完成、出错及取消时释放连接。
async function* modelEvents(response, { signal, onActivity } = {}) {
  signal?.throwIfAborted();
  if (!response.body) throw new Error("模型流缺少响应体");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  function parse(frame) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return null;
    if (data === "[DONE]") return "done";
    try { return JSON.parse(data); }
    catch { throw new Error("模型流包含无效 JSON 事件"); }
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (value?.length) onActivity?.();
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = parse(frame);
        if (event === "done") return;
        if (event) yield event;
      }
      if (done) {
        const event = parse(buffer);
        if (event && event !== "done") yield event;
        return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

module.exports = { modelEvents };
