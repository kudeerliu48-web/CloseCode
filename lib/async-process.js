"use strict";

const { spawn } = require("child_process");
const { killTree } = require("./process-tree");

function runProcess(command, args, {
  input,
  timeout = 15000,
  maxBuffer = 8 * 1024 * 1024,
  encoding,
  signal: abortSignal,
  onStdout,
  onStderr,
  captureOutput = true,
  ...options
} = {}) {
  return new Promise((resolve) => {
    const stdoutChunks = [], stderrChunks = [];
    let stdoutLength = 0, stderrLength = 0, totalLength = 0;
    let error = null, overflow = false, settled = false, stopping = false, finalizing = false;
    let timeoutTimer = null, killTimer = null, exitTimer = null, outputWaitTimer = null;
    let child;
    const pendingOutput = new Set();
    const onAbort = () => {
      if (!error) error = Object.assign(new Error("Process was aborted"), { code: "ABORT_ERR" });
      stop("abort");
    };

    const result = (status, signal) => {
      const stdout = captureOutput ? Buffer.concat(stdoutChunks, stdoutLength) : Buffer.alloc(0);
      const stderr = captureOutput ? Buffer.concat(stderrChunks, stderrLength) : Buffer.alloc(0);
      resolve({
        status,
        signal,
        stdout: encoding ? stdout.toString(encoding) : stdout,
        stderr: encoding ? stderr.toString(encoding) : stderr,
        error,
      });
    };
    const finish = (status, signal) => {
      if (settled || finalizing) return;
      finalizing = true;
      (async () => {
        if (pendingOutput.size) {
          let expired = false;
          const allOutput = Promise.all([...pendingOutput]);
          await Promise.race([allOutput, new Promise(resolve => {
            outputWaitTimer = setTimeout(() => { expired = true; resolve(); }, 5000);
          })]);
          clearTimeout(outputWaitTimer);
          outputWaitTimer = null;
          if (expired && !error) error = Object.assign(new Error("Process output callback timed out"), { code: "OUTPUT_TIMEOUT" });
        }
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        clearTimeout(killTimer);
        clearTimeout(exitTimer);
        clearTimeout(outputWaitTimer);
        abortSignal?.removeEventListener("abort", onAbort);
        result(status, signal);
      })();
    };
    const stop = (reason) => {
      if (settled || stopping) return;
      stopping = true;
      if (reason === "timeout") error = Object.assign(new Error(`Process timed out after ${timeout}ms`), { code: "ETIMEDOUT" });
      if (reason === "overflow") overflow = true;
      if (!child.pid) {
        try { child.kill(); } catch {}
      } else {
        killTree(child.pid).catch(() => {});
      }
      // A descendant can inherit stdout/stderr and keep `close` from firing.
      killTimer = setTimeout(() => {
        for (const stream of [child.stdin, child.stdout, child.stderr]) {
          try { stream?.destroy(); } catch {}
        }
        child.unref();
        finish(child.exitCode, child.signalCode);
      }, 7000);
    };
    const collect = (chunks, which, chunk) => {
      if (settled || overflow) return;
      const remaining = Math.max(0, maxBuffer - totalLength);
      if (chunk.length > remaining) {
        if (remaining) {
          const partial = chunk.subarray(0, remaining);
          chunks.push(partial);
          if (which === "stdout") stdoutLength += partial.length;
          else stderrLength += partial.length;
          totalLength += partial.length;
        }
        error = Object.assign(new Error(`Process output exceeded ${maxBuffer} bytes`), { code: "MAXBUFFER" });
        stop("overflow");
        return;
      }
      chunks.push(chunk);
      if (which === "stdout") stdoutLength += chunk.length;
      else stderrLength += chunk.length;
      totalLength += chunk.length;
    };

    try {
      child = spawn(command, args, {
        windowsHide: true,
        detached: process.platform !== "win32",
        ...options,
      });
    } catch (e) {
      error = e;
      finish(null, null);
      return;
    }

    const consume = (stream, chunks, which, callback) => {
      if (!stream) return;
      stream.on("data", (chunk) => {
        if (!callback) {
          if (captureOutput) collect(chunks, which, chunk);
          return;
        }
        stream.pause();
        const pending = Promise.resolve().then(() => callback(chunk)).then(
          () => { if (!settled && !stopping) stream.resume(); },
          (e) => {
            if (!error) error = e;
            stop("output-error");
            stream.resume();
          },
        ).finally(() => pendingOutput.delete(pending));
        pendingOutput.add(pending);
      });
    };
    consume(child.stdout, stdoutChunks, "stdout", onStdout);
    consume(child.stderr, stderrChunks, "stderr", onStderr);
    child.stdin?.on("error", () => {}); // EPIPE is expected when a short-lived child closes stdin.
    child.on("error", (e) => { error = e; });
    child.on("exit", () => {
      if (settled || stopping) return;
      // Catch a child that exits while a descendant still holds its output pipes open.
      exitTimer = setTimeout(() => {
        if (!settled) stop("orphaned-pipes");
      }, 2000);
    });
    child.on("close", (status, signal) => {
      finish(status, signal);
    });

    if (timeout > 0) timeoutTimer = setTimeout(() => stop("timeout"), timeout);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
    if (child.stdin) {
      if (input == null) child.stdin.end();
      else child.stdin.end(input);
    }
  });
}

module.exports = { runProcess };
