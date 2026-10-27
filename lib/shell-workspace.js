"use strict";
const fs = require("fs");
const path = require("path");
const scope = require("./workspace-scope");

// 普通外部目录可作为 cwd，无需目录授权；命令审批与核心保护独立执行。
function resolveShellCwd(rel, base, workspace, security, policy) {
  const projectRoot = path.resolve(workspace);
  const resolvedCwd = path.resolve(base, String(rel ?? ".").replace(/\\/g, "/"));
  const fail = (code, message) => {
    throw Object.assign(new Error(message + "\nprojectRoot: " + projectRoot + "\nresolvedCwd: " + resolvedCwd + "\n本次命令未执行。"), {
      code, projectRoot, resolvedCwd, running: false,
    });
  };
  const result = security.resolvePathWithPolicy(policy, resolvedCwd, workspace, base);
  // 外部普通目录允许作为 cwd；只有 CloseCode 核心保护命中时才拒绝。
  if (!result.allowed) fail("SHELL_CWD_DENIED", "Shell 工作目录被安全中心拦截：" + result.reason);
  try {
    if (!fs.statSync(resolvedCwd).isDirectory()) fail("SHELL_CWD_INVALID", "Shell 工作目录不是目录。");
    return scope.realPath(resolvedCwd);
  } catch (error) {
    if (error.code?.startsWith("SHELL_CWD_")) throw error;
    fail("SHELL_CWD_INVALID", "Shell 工作目录不存在或无法解析：" + error.message);
  }
}

// Accidental directory changes are checked before execution. This is a guardrail,
// NOT an OS sandbox: arbitrary programs/scripts still run with the host user's rights.
function checkShellWorkspace(command, cwd, workspace, security, policy) {
  let current = cwd;
  const stack = [];
  for (let segment of security.splitSegments(command)) {
    segment = segment.replace(/^cmd(?:\.exe)?\s+\/c\s+/i, "").trim();
    if (/^popd\s*$/i.test(segment)) { current = stack.pop() || cwd; continue; }
    const match = /^(cd|chdir|pushd|set-location)\s+(.+)$/i.exec(segment);
    if (!match) continue;
    let dir = match[2].replace(/^(?:\/d|-literalpath|-path|--)\s+/i, "").trim();
    if ((dir.startsWith('"') && dir.endsWith('"')) || (dir.startsWith("'") && dir.endsWith("'"))) dir = dir.slice(1, -1);
    if (!dir || dir === "-" || /[%!$\x60<>]/.test(dir)) throw new Error("无法确认 Shell 切换目录的项目归属，请改用 run_shell.cwd 指定本项目目录。");
    let target;
    try { target = resolveShellCwd(dir, current, workspace, security, policy); }
    catch (error) {
      error.message = "Shell 切换目录被拦截；请用 run_shell.cwd 明确指定目录，不会自动扩大权限。\n" + error.message;
      throw error;
    }
    if (/^pushd$/i.test(match[1])) stack.push(current);
    current = target;
  }
}
module.exports = { checkShellWorkspace, resolveShellCwd };
