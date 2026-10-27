"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { TextDecoder } = require("util");
const { killTree } = require("./process-tree");
const { windowsInlinePlan } = require("./windows-inline-command");

// 仅识别明确的常驻入口。测试/build/任意 app.py 不按名字猜，更不能提前当作成功。
function isServiceCommand(command) {
  let s = String(command).trim();
  s = s.replace(/^cd(?:\s+\/d)?\s+(?:"[^"]+"|'[^']+'|[^&|;\r\n]+)\s*&&\s*/i, "");
  if (/[&|;\r\n<>]/.test(s) || /(?:^|\s)(?:--help|--version|-h|-V)(?:\s|$)/.test(s)) return false;
  // Normalize only known package-manager directory options, for detection only.
  s = s.replace(/^(npm|pnpm|yarn)(\.cmd)?\s+(?:(?:--prefix|--cwd|--dir|-C)(?:=|\s+)(?:"[^"]+"|'[^']+'|[^\s"']+)\s+)+/i, "$1$2 ");
  return /^(?:npm(?:\.cmd)?\s+(?:(?:run\s+)?(?:dev|serve|start|preview))|(?:pnpm|yarn)(?:\.cmd)?\s+(?:run\s+)?(?:dev|serve|start|preview)|(?:npx\s+)?(?:vite(?=\s+(?:--|preview\b)|\s*$)|next\s+dev|nuxt\s+dev)|(?:python(?:3|\.exe)?|py(?:\s+-3)?)\s+-m\s+(?:http\.server|uvicorn|flask\s+run)|(?:uvicorn|flask\s+run)|(?:python(?:3|\.exe)?|py(?:\s+-3)?)\s+manage\.py\s+runserver)(?:\s|$)/i.test(s);
}
function shellPath(env = process.env, platform = process.platform) {
  const key = platform === "win32" ? Object.keys(env).find(k => /^path$/i.test(k)) : "PATH";
  const current = env[key] || "";
  if (platform === "win32") return current;
  // 仅追加，不覆盖用户优先级，不向父进程或未知 node 注入 Electron 环境。
  const extra = ["/usr/bin", "/bin", "/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local", "bin")];
  const paths = current ? current.split(":") : [];
  return paths.concat(extra.filter(p => !paths.includes(p))).join(":");
}
const commandAlternatives = Object.freeze({
  rg: "内容搜索请用 search_files；查目录/文件名请用 list_files。不要自动改成 grep，二者参数和匹配语义不等价。",
  node: "JavaScript 计算、脚本逻辑优先用 run_node；不把内置 Electron 冒充系统 node。",
  python: "先检查 python3 是否可用；仅确认脚本兼容后显式选用。简单数据处理可用 run_node。",
  python3: "先检查 python 是否可用及其版本兼容性；简单数据处理可用 run_node。",
  npm: "run_node 不是 npm 的替代品；需由用户配置 Node.js/npm 环境，本工具不自动安装。",
  git: "无等价内置 Git 工具；文件查看可用 read_file/list_files，但不能代替 Git 操作。",
});
const capabilityCache = new Map();
// 只检查文件及执行权限，不调用 which/where、--version 或任何被探测程序。
async function shellCapabilities({ env = process.env, platform = process.platform, cwd = process.cwd(), refresh = false } = {}) {
  const effectivePath = shellPath(env, platform);
  const extKey = Object.keys(env).find(k => /^pathext$/i.test(k));
  const extensions = platform === "win32" ? (env[extKey] || ".COM;.EXE;.BAT;.CMD").split(";").filter(e => /^\.[a-z0-9]+$/i.test(e)) : [""];
  const key = JSON.stringify([platform, effectivePath, extensions, cwd]);
  const cached = capabilityCache.get(key);
  if (!refresh && cached && (cached.at === null || Date.now() - cached.at < 5000)) return JSON.parse(await cached.value);
  const pending = (async () => {
    const p = platform === "win32" ? path.win32 : path.posix;
    let dirs = effectivePath.split(platform === "win32" ? ";" : ":");
    if (platform === "win32") dirs = [cwd, ...dirs];
    const commands = {};
    for (const name of Object.keys(commandAlternatives)) {
      let found = null;
      search: for (const dir of dirs) {
        const entry = platform === "win32" ? dir.replace(/^"(.*)"$/, "$1") : dir;
        const base = p.resolve(cwd, entry || ".");
        for (const ext of extensions) {
          const candidate = p.join(base, name + ext);
          try {
            if (!(await fs.promises.stat(candidate)).isFile()) continue;
            await fs.promises.access(candidate, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
            found = candidate; break search;
          } catch {} // 不存在、不可访问都不能宣称可用。
        }
      }
      commands[name] = { available: !!found, path: found, alternative: commandAlternatives[name] };
    }
    return JSON.stringify({ platform, commands });
  })();
  const entry = { at: null, value: null };
  entry.value = pending.then(value => {
    entry.at = Date.now();
    return value;
  }, error => {
    if (capabilityCache.get(key) === entry) capabilityCache.delete(key);
    throw error;
  });
  if (!capabilityCache.has(key) && capabilityCache.size >= 8) capabilityCache.delete(capabilityCache.keys().next().value);
  capabilityCache.set(key, entry);
  return JSON.parse(await entry.value);
}
async function shellEnvironmentSummary(options) {
  const { platform, commands } = await shellCapabilities(options);
  return "Shell 命令能力（" + platform + "；文件/权限检查，缓存最多 5 秒；不保证运行成功，不探测版本或 shell alias）：\n" +
    Object.entries(commands).map(([name, item]) => name + ": " + (item.available ? "可用（" + item.path + "）" : "当前 PATH 未找到可执行文件") + "；" + item.alternative).join("\n");
}
function missingCommandDiagnostic(stderr, exitCode, platform = process.platform) {
  // 必须有 shell 的明确文本证据；不能用 exit 1/127 单独猜测，grep 无匹配不是缺命令。
  const text = String(stderr).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  const matches = platform === "win32"
    ? [...text.matchAll(/^[ \t]*['"]([^'"\r\n]+)['"][ \t]*(?:is not recognized as an internal or external command|不是内部或外部命令)/gmi)]
    : [...text.matchAll(/^(?:[^\r\n]*?:\s*)?([\w./+@-]+):\s*(?:command not found|not found|未找到命令|找不到命令)\s*$/gm),
       ...text.matchAll(/^zsh:\s*command not found:\s*([\w./+@-]+)\s*$/gm)];
  if (!matches.length) return null;
  const commands = [...new Set(matches.map(m => m[1]))].slice(0, 8);
  return {
    code: "SHELL_COMMAND_NOT_FOUND", platform, commands, exitCode, retried: false,
    message: "Shell 报告命令不存在或当前 PATH 无法解析；原始退出码已保留。复合命令可能已部分执行，不要直接重放。",
    suggestions: commands.map(name => commandAlternatives[name.toLowerCase()] || "请检查命令拼写、可执行文件路径及运行环境；文件操作优先使用内置工具。"),
  };
}
function formatShellDiagnostic(diagnostic) {
  return diagnostic ? "命令诊断: " + JSON.stringify(diagnostic) + "\n" : "";
}
function shellSpec(command, encoding) {
  if (process.platform === "win32") {
    // /s /c 去掉外层引号，保留带空格的 exe/cd 路径；只改这个子 shell 的代码页。
    return { bin: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", '"chcp ' + (encoding === "utf8" ? "65001" : "936") + '>nul & ' + command + '"'], opts: { windowsVerbatimArguments: true } };
  }
  return { bin: process.platform === "darwin" ? "/bin/zsh" : fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh", args: ["-c", command], opts: {} };
}
// Commit complete UTF-8 sequences only; keep at most three undecided bytes.
// Once invalid UTF-8 is observed, this pipe stays GB18030. Already emitted
// UTF-8 cannot be reinterpreted, so arbitrary mixed encodings remain ambiguous.
function outputDecoder(encoding) {
  if (encoding !== "utf8" || process.platform !== "win32") {
    return new TextDecoder(encoding === "utf8" ? "utf-8" : "gb18030");
  }
  let pending = Buffer.alloc(0), fallback = null;
  return {
    decode(chunk, options = {}) {
      if (fallback) return fallback.decode(chunk, options);
      const bytes = pending.length ? Buffer.concat([pending, chunk || Buffer.alloc(0)]) : (chunk || Buffer.alloc(0));
      const streaming = options.stream === true;
      let i = 0, invalid = false;
      while (i < bytes.length) {
        const first = bytes[i];
        if (first <= 0x7f) { i++; continue; }
        const size = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
        if (!size) { invalid = true; break; }
        for (let j = 1; j < size && i + j < bytes.length; j++) {
          const b = bytes[i + j];
          if (b < 0x80 || b > 0xbf || (j === 1 &&
            ((first === 0xe0 && b < 0xa0) || (first === 0xed && b > 0x9f) ||
             (first === 0xf0 && b < 0x90) || (first === 0xf4 && b > 0x8f)))) {
            invalid = true; break;
          }
        }
        if (invalid) break;
        if (i + size > bytes.length) { invalid = !streaming; break; }
        i += size;
      }
      const text = bytes.subarray(0, i).toString("utf8");
      pending = Buffer.from(bytes.subarray(i));
      if (!invalid) return text;
      fallback = new TextDecoder("gb18030");
      const tail = fallback.decode(pending, options);
      pending = Buffer.alloc(0);
      return text + tail;
    },
  };
}
async function runShell({ command, cwd, workspace, timeoutMs, detach, encoding = "utf8", sessionId, stopSignal,
  onStatus = () => {}, dataDir, logDir, createSink, registry, startupMs = 3000, heartbeatMs = 5000 }) {
  if (stopSignal?.aborted) return Promise.resolve({ content: "任务已被停止，命令未执行。", isError: true });
  if (!(timeoutMs > 0)) return Promise.resolve({ content: "任务已超时，命令未执行。", isError: true });
  if (!["utf8", "gb18030"].includes(encoding)) return Promise.resolve({ content: "encoding 仅支持 utf8 或 gb18030。", isError: true });
  if (!String(command).trim()) return Promise.resolve({ content: "command 不能为空。", isError: true });
  if (detach != null && typeof detach !== "boolean") return Promise.resolve({ content: "detach 必须是布尔值 true/false，不能传字符串。", isError: true });
  let inlinePlan;
  try { inlinePlan = windowsInlinePlan(command, cwd); }
  catch (error) { return Promise.resolve({ isError: true, code: error.code, content: error.message, running: false }); }
  if (inlinePlan) cwd = inlinePlan.cwd;
  const automatic = detach == null && isServiceCommand(command);
  const background = detach === true || automatic;
  let logHandle = null, logFile = "";
  if (background) {
    try {
      await fs.promises.mkdir(logDir, { recursive: true });
      logFile = path.join(logDir, 'bg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '.log');
      logHandle = await fs.promises.open(logFile, "wx");
      await logHandle.writeFile("命令: " + command + "\n初始工作目录: " + cwd + "\n=== 启动输出 ===\n", "utf8");
    } catch (error) {
      await logHandle?.close().catch(() => {});
      return { content: "初始工作目录: " + cwd + "\n命令未启动: " + error.message, cwd, executionMode: inlinePlan?.executionMode || "shell", isError: true, running: false };
    }
    if (stopSignal?.aborted) {
      await logHandle?.close().catch(() => {});
      return { content: "任务已被停止，命令未执行。", cwd, executionMode: inlinePlan?.executionMode || "shell", isError: true, running: false };
    }
  }
  return new Promise(resolve => {
    const env = { ...process.env };
    // Windows 环境变量名不区分大小写，避免同时存在 Path/PATH 让 Node 选错。
    for (const key of Object.keys(env)) if (/^(?:path|pythonioencoding|pythonutf8|pythonunbuffered|pythonlegacywindowsstdio)$/i.test(key)) delete env[key];
    Object.assign(env, { PATH: shellPath(), CLOSECODE_HOME: dataDir,
      PYTHONIOENCODING: (encoding === "utf8" ? "utf-8" : "gb18030") + ":backslashreplace", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" });
    const spec = inlinePlan || shellSpec(command, encoding);
    let child, timer, startupTimer, heartbeat, settleTimer, pipeTimer, outputTimer;
    let responded = false, closed = false, finishing = false, exit = null, failure = "", terminating = false, closeEvent = null;
    let logError = "", captured = "", lastOutput = "", logQueue = Promise.resolve();
    const pendingOutput = new Set();
    const outputQueues = [Promise.resolve(), Promise.resolve()];
    const diagnosticOutput = ["", ""];
    const began = Date.now();
    const out = background ? null : createSink("shell", 8000, 8000, workspace);
    const err = background ? null : createSink("shell-err", 4000, 6000, workspace);
    function status(text, phase = "running") {
      if (responded || closed) return;
      try { onStatus(text, { phase, elapsedMs: Date.now() - began, timeoutMs, output: lastOutput }); } catch {}
    }
    function progress() {
      status("Shell 已运行 " + Math.floor((Date.now() - began) / 1000) + " 秒 / 上限 " + Math.ceil(timeoutMs / 1000) + " 秒。" +
        (lastOutput ? "已有命令输出。" : "尚无输出；常驻服务请使用 detach:true。"));
    }
    function cleanupWait() {
      clearTimeout(timer); clearTimeout(startupTimer); clearInterval(heartbeat);
      clearTimeout(pipeTimer); clearTimeout(outputTimer);
      stopSignal?.removeEventListener("abort", onAbort);
    }
    function reply(result) {
      if (responded) return;
      responded = true; cleanupWait();
      resolve({ ...result, cwd, executionMode: inlinePlan?.executionMode || "shell", content: "初始工作目录: " + cwd + "\n" + (inlinePlan ? "多行 Python 代码已通过独立 argv 完整传递（不经过 cmd）。\n" : "") + (inlinePlan?.fullOutputPager ? "more 分页已按无交互全文输出处理，不等待翻页；长输出仍保留完整日志。\n" : "") + (inlinePlan?.mergeStderr ? "stderr 已合并到 stdout。\n" : "") + result.content });
    }
    function log(text) {
      if (!logHandle || !text) return logQueue;
      logQueue = logQueue.then(async () => {
        if (!logHandle || logError) return;
        try { await logHandle.writeFile(text, "utf8"); }
        catch (error) {
          logError = error.message;
          console.warn("[shell] 后台日志写入失败:", error.message);
        }
      });
      return logQueue;
    }
    async function closeLog() {
      await logQueue;
      const handle = logHandle;
      logHandle = null;
      if (handle) {
        try { await handle.close(); }
        catch (error) { if (!logError) logError = error.message; }
      }
    }
    const decoders = [outputDecoder(encoding), outputDecoder(encoding)];
    const ended = [false, false];
    async function take(index, text) {
      if (!text) return;
      lastOutput = (lastOutput + text).slice(-2000);
      diagnosticOutput[index] = (diagnosticOutput[index] + text).slice(-65536);
      if (background) { await log(text); if (!responded) captured = (captured + text).slice(-65536); }
      else await (index === 0 || inlinePlan?.mergeStderr ? out : err).writeText(text);
      if (!responded && !closed && !terminating && !outputTimer) outputTimer = setTimeout(() => { outputTimer = null; progress(); }, 500);
    }
    async function flush(index) {
      if (!ended[index]) { ended[index] = true; await take(index, decoders[index].decode()); }
    }
    function queueOutput(index, action) {
      const stream = index === 0 ? child?.stdout : child?.stderr;
      stream?.pause();
      const pending = outputQueues[index].then(action).catch(error => {
        if (!failure) failure = "输出处理失败: " + error.message;
        if (!closed) void terminate(failure);
      }).finally(() => {
        pendingOutput.delete(pending);
        if (!closed && !terminating) stream?.resume();
      });
      outputQueues[index] = pending;
      pendingOutput.add(pending);
      return pending;
    }
    function finish(code, signal) {
      if (closed || finishing) return;
      finishing = true;
      closed = true; clearTimeout(settleTimer); cleanupWait();
      void (async () => {
      try {
        while (pendingOutput.size) await Promise.all([...pendingOutput]);
        await flush(0); await flush(1);
        // stderr 可能被用户显式 2>&1 合并；保留分流尾部以免两路交错破坏诊断。
        const diagnostic = missingCommandDiagnostic(diagnosticOutput.join("\n"), code);
        const diagnosticText = formatShellDiagnostic(diagnostic);
        if (background) {
          await log(diagnosticText + '\n=== 进程退出 ===\n退出码: ' + code + '\n信号: ' + (signal || "无") + '\n');
          await closeLog();
          if (child?.pid && registry.list().some(p => p.pid === child.pid)) registry.unregister(child.pid);
          if (!responded) reply({ content: diagnosticText + (failure || "命令已结束；没有持续运行的后台服务。") + "\n" + (captured || "（无输出）") + "\nexit code: " + code + (logFile ? "\n完整日志: " + logFile : ""),
            ...(diagnostic ? { diagnostic } : {}),
            isError: !!failure || code !== 0, running: false, exitCode: code, logFile });
        } else {
          const stdout = await out.render(), stderr = await err.render();
          // 只对单独的 dir 查无文件做兼容，不掩盖复合命令后面真正的失败。
          const noMatches = process.platform === "win32" && /^\s*dir\b[^&|;\r\n]*$/i.test(command) && code === 1 && /找不到文件|File Not Found/i.test(stdout + stderr);
          reply({ content: diagnosticText + (failure ? failure + "\n" : "") + (stdout ? "stdout:\n" + stdout + "\n" : "") + (stderr ? "stderr:\n" + stderr + "\n" : "") + "exit code: " + code,
            ...(diagnostic ? { diagnostic } : {}),
            isError: !!failure || (code !== 0 && !noMatches), exitCode: code, running: false });
        }
      } catch (error) {
        await closeLog();
        reply({ content: (failure ? failure + "\n" : "") + "命令输出收尾失败: " + error.message + "\n最近输出:\n" + lastOutput,
          isError: true, exitCode: code, running: false });
      }
      })();
    }
    function terminate(reason) {
      if (terminating || closed || responded) return;
      terminating = true; failure = reason; cleanupWait();
      const stoppingAt = Date.now();
      status(reason + " 正在清理进程…", "stopping");
      const forceFinish = (confirmed) => {
        if (closed) return;
        if (!confirmed) failure += "（进程树停止未能确认，PID " + child?.pid + "，请检查系统进程；不要直接重复执行可能修改文件的命令）";
        child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
        finish(child?.exitCode ?? null, child?.signalCode || null);
      };
      // Arm the deadline BEFORE cleanup: taskkill and inherited pipes may never finish.
      settleTimer = setTimeout(() => forceFinish(false), 6000);
      Promise.resolve().then(() => child?.pid ? killTree(child.pid) : true).then(killed => {
        if (closed) return;
        if (closeEvent) { forceFinish(!!killed); return; }
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => forceFinish(!!killed), Math.min(150, Math.max(0, 6000 - (Date.now() - stoppingAt))));
      }, () => forceFinish(false));
    }
    function onAbort() { void terminate("命令已被用户停止。"); }
    try {
      // Windows 的 detached+隐藏控制台会让 cmd 启动的原生命令丢失管道输出；
      // Windows 使用隐藏进程+unref 后台运行，Unix 建独立进程组以便完整清理。
      child = spawn(spec.bin, spec.args, { cwd, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], ...spec.opts });
    } catch (error) { failure = "命令未启动: " + error.message; finish(null, null); return; }
    [child.stdout, child.stderr].forEach((stream, i) => {
      stream.on("data", chunk => {
        if (closed) return;
        queueOutput(i, () => take(i, decoders[i].decode(chunk, { stream: true })));
      });
      stream.on("end", () => {
        if (closed) return;
        queueOutput(i, () => flush(i));
      });
      stream.on("error", error => { if (!responded) void terminate("输出管道错误: " + error.message); });
    });
    child.on("error", error => { failure = "启动失败: " + error.message; finish(null, null); });
    child.on("exit", (code, signal) => {
      exit = { code, signal };
      if (!background && !closed && !terminating) pipeTimer = setTimeout(() => {
        terminate("命令主进程已退出，但子进程仍占用输出管道，已请求停止进程树。");
      }, 2000);
    });
    child.on("close", (code, signal) => {
      closeEvent = { code, signal };
      if (!terminating) finish(code, signal);
    });
    stopSignal?.addEventListener("abort", onAbort, { once: true });
    // spawn 与添加监听之间的取消也不能遗漏。
    if (stopSignal?.aborted) { onAbort(); return; }
    timer = setTimeout(() => { void terminate("命令执行超时，已请求停止进程树。"); }, Math.min(timeoutMs, 2147483647));
    heartbeat = setInterval(progress, heartbeatMs);
    if (background) startupTimer = setTimeout(() => {
      if (closed || terminating || responded) return;
      if (exit) { void terminate("启动进程已退出，但输出管道未关闭；未登记为可用服务。"); return; }
      if (logError) { void terminate("后台日志写入失败: " + logError); return; }
      if (!registry.isAlive(child.pid)) { failure = "启动进程已退出；未登记为可用服务。"; finish(child.exitCode, child.signalCode); return; }
      registry.register(child.pid, command, sessionId || "unknown", logFile, cwd, workspace);
      const clean = captured.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
      const url = clean.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+(?:\/[^\s\x1b]*)?/i)?.[0] || null;
      child.unref(); child.stdout.unref?.(); child.stderr.unref?.();
      reply({ content: (automatic ? "已识别常驻服务命令，自动转为后台（可用 detach:false 强制前台）。\n" : "") +
        "后台进程正在运行（PID " + child.pid + "），不代表服务健康检查已通过。\n" +
        (url ? "输出中的服务地址: " + url + "\n预览构建型项目请访问服务地址，不要直接打开 index.html。\n" : "") +
        "启动输出:\n" + (captured || "（暂无输出，可用 read_process_log 查看）") + "\n完整日志: " + logFile +
        "\n使用 read_process_log 查看日志、kill_background_process 停止进程。",
        isError: false, running: true, pid: child.pid, logFile, devServerUrl: url });
    }, startupMs);
    // Status callbacks can synchronously cancel; install every timer before notifying.
    progress();
  });
}
module.exports = { runShell, isServiceCommand, shellSpec, shellPath, shellCapabilities, shellEnvironmentSummary, missingCommandDiagnostic };
