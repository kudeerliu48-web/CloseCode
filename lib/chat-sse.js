"use strict";

function openChatStream(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.on("error", () => {});
  res.flushHeaders();
  const timer = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) {
      try { res.write(": heartbeat\n\n"); } catch {}
    }
  }, 15000);
  timer.unref?.();
  const cleanup = () => clearInterval(timer);
  res.once("close", cleanup);
  res.once("finish", cleanup);
}

module.exports = { openChatStream };
