"use strict";
// Git belongs to the OUTER task, never an expert/continuation. No shell commands.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { isInternalArtifactPath } = require("./workspace-scope");
const enabled = config => config?.agent?.git_auto_sync !== false;
const FINISH_RULES = "用户手动停止时不提交；没有待提交文件时不创建提交。其他情况在本轮结束后统一提交并推送新增、修改和删除，即使执行报错或达到上限也要收尾同步；已同步不代表任务成功或验证通过。不要自行执行 git add/commit/pull/push/merge/rebase/reset/checkout/clean 或改动 .git；不要绕过失败检查。专家与内部续跑共享一次提交。";
const RULES = "\n\n## Git 由任务系统管理\n本轮已由系统同步远程仓库。" + FINISH_RULES;
const NEW_BRANCH_RULES = "\n\n## Git 由任务系统管理\n系统已确认远程尚无本分支，本轮沿用本地历史，有成果需要推送时创建远程分支并绑定上游。" + FINISH_RULES;
class GitTaskError extends Error {
  constructor(code, message) { super(message); this.name = "GitTaskError"; this.code = code; this.gitTask = true; }
}
const fail = (code, message) => { throw new GitTaskError(code, message); };
function redact(text) {
  return String(text || "").replace(/(?:https?|ssh):\/\/[^\s\x27\x22]+/gi, "[remote URL]").replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[redacted]@")
    .replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]{12,})\b/g, "[redacted]")
    .replace(/((?:token|password|api[_-]?key|secret)\s*[=:]\s*)[^\s&]+/gi, "$1[redacted]").slice(0, 1000);
}
function git(cwd, args, { signal, timeoutMs = 60000, input, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GitTaskError("cancelled", "Git 操作已停止；本地文件已保留。"));
    // Do not inherit repository/index overrides from a shell that launched the app.
    const cleanEnv = { ...process.env };
    for (const k of Object.keys(cleanEnv)) if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*)$/.test(k)) delete cleanEnv[k];
    const child = spawn("git", ["-c", "credential.interactive=false", "-c", "core.quotePath=false", ...args], {
      cwd, shell: false, windowsHide: true, env: { ...cleanEnv, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "", reason = null;
    const kill = code => {
      if (reason) return; reason = code;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else child.kill("SIGKILL");
    };
    const abort = () => kill("cancelled");
    const timer = setTimeout(() => kill("timeout"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", d => { out += d; if (out.length > 16 * 1024 * 1024) kill("output_limit"); });
    child.stderr.on("data", d => { err = (err + d).slice(-12000); });
    child.stdin.on("error", () => {});
    child.on("error", e => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new GitTaskError("git_unavailable", "无法启动 Git，请安装 Git 并检查 PATH：" + redact(e.message))); });
    child.on("close", code => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (reason) return reject(new GitTaskError(reason, reason === "cancelled" ? "Git 操作已停止；请检查本地与远程状态。" : "Git 操作超时或输出过大；未确认成功，不会继续任务。"));
      resolve({ code, out, err: redact(err) });
    });
    child.stdin.end(input);
  });
}
const canonical = p => { const s = fs.realpathSync(p); return process.platform === "win32" ? s.toLowerCase() : s; };
async function digest(p) {
  const hash = crypto.createHash("sha256");
  try {
    for await (const chunk of fs.createReadStream(p)) hash.update(chunk);
    return hash.digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}
const RECOVERY_VERSION = 1;
// Serialize only local Git boundary phases, not the agent's whole lifetime.
// Uploads must not land between status() and a recovery manifest write. Waiting
// for the repository's outer task lock must remain OUTSIDE this queue, otherwise
// a queued task could prevent the previous task from finishing.
const workspacePhases = new Map();
async function acquireWorkspacePhase(workspace) {
  const key = canonical(workspace), previous = workspacePhases.get(key) || Promise.resolve();
  let unlock;
  const current = new Promise(resolve => { unlock = resolve; });
  workspacePhases.set(key, current);
  await previous;
  return () => { if (workspacePhases.get(key) === current) workspacePhases.delete(key); unlock(); };
}
async function withWorkspacePhase(workspace, work) {
  const release = await acquireWorkspacePhase(workspace);
  try { return await work(); } finally { release(); }
}
async function fileDigest(root, file) {
  if (!safeRecoveryPath(file)) fail("recovery_path", "任务恢复记录含不安全路径，请手动检查。");
  const full = path.join(root, file);
  try {
    let parent = root;
    for (const part of file.split("/").slice(0, -1)) {
      parent = path.join(parent, part);
      const stat = await fs.promises.lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail("recovery_path", "成果目录已被替换，无法安全恢复：" + file);
    }
    const stat = await fs.promises.lstat(full);
    if (stat.isSymbolicLink()) return "symlink:" + crypto.createHash("sha256").update(await fs.promises.readlink(full)).digest("hex");
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) fail("recovery_file", "文件类型或大小不支持自动恢复，请手动检查：" + file);
    const hash = await digest(full);
    return hash === "missing" ? "missing" : "file:" + (stat.mode & 0o111) + ":" + hash;
  } catch (e) {
    if (e.code === "ENOENT") return "missing";
    throw e;
  }
}
function writeJsonAtomic(file, value) {
  const temp = file + "." + process.pid + "." + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}
function safeRecoveryPath(file) {
  return typeof file === "string" && !!file && !/[\\\x00-\x1f]/.test(file) && !path.isAbsolute(file)
    && !(process.platform === "win32" && file.includes(":"))
    && file.split("/").every(part => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
}
function parseStatus(raw) {
  const fields = raw.split("\0"), rows = [];
  for (let i = 0; i < fields.length && fields[i]; i++) {
    const state = fields[i].slice(0, 2), file = fields[i].slice(3);
    if (/[RC]/.test(state)) {
      const source = fields[++i];
      rows.push({ state, file, source });
      // Copies do not remove their source. Keep rename endpoints linked so a
      // boundary-crossing rename cannot silently become a partial add/delete.
      if (/R/.test(state)) rows.push({ state: " D", file: source, destination: file, renameState: state });
    } else rows.push({ state, file });
  }
  return rows;
}
function filterArtifactRows(rows) {
  for (const row of rows) {
    const internal = isInternalArtifactPath(row.file);
    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(row.state)) fail("unfinished_operation", "存在未解决的索引冲突，请先手动处理：" + row.file);
    if (internal && row.state !== "??" && (row.renameState || row.state)[0] !== " ") {
      fail("internal_artifact_staged", "暂存区含 CloseCode 对话记录或内部临时文件，已停止自动同步；不会擅自取消暂存、删除文件，也不会自动移除已有历史。请手动检查暂存区：" + row.file);
    }
    const other = row.source || row.destination;
    if (other && internal !== isInternalArtifactPath(other)) fail("artifact_boundary", "重命名/复制跨越内部文件与正式成果边界，未自动拆分提交，请手动检查：" + row.file);
  }
  return rows.filter(row => !isInternalArtifactPath(row.file));
}
async function checkFiles(root, rows) {
  for (const { file } of rows) {
    if (!file || /[\x00-\x1f]/.test(file) || file.endsWith("/") || file.split("/").includes(".git") || path.isAbsolute(file) || file.split("/").includes("..")) fail("unsafe_path", "发现嵌套仓库或不安全路径，请手动检查后提交。");
    const name = path.posix.basename(file);
    if (isInternalArtifactPath(file)) fail("internal_artifact_history", "待提交或待推送内容含 CloseCode 对话记录或内部临时文件，已停止自动同步；路径过滤不会自动移除已有历史，也不会改写提交或用户索引，请手动整理后重试：" + file);
    if ((/^\.env(?:\.|$)/i.test(name) && !/\.(?:example|sample|template)$/i.test(name)) || /(?:^|\/)(?:id_rsa|id_ed25519|credentials(?:\.json)?|\.npmrc|\.pypirc)$|\.(?:pem|key|p12|pfx)$/i.test(file)) fail("sensitive_file", "检测到可能含凭据的文件，已阻止自动提交：" + file);
    if (/(?:^|\/)(?:node_modules|\.history|\.tmp|\.cache|logs|sessions)(?:\/|$)|(?:^|\/)(?:token_stats|accounts|auth)\.json$|\.log$/i.test(file)) fail("runtime_file", "检测到运行数据/缓存，已阻止自动提交；请手动检查 .gitignore：" + file);
    const full = path.join(root, file);
    let stat;
    try { stat = await fs.promises.lstat(full); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; } // deletion
    if (stat.isSymbolicLink()) continue; // Git records link text, never read its target.
    if (!stat.isFile()) fail("nested_repository", "子模块或目录变更需要手动提交：" + file);
    if (stat.size > 16 * 1024 * 1024) fail("file_too_large", "变更文件过大，无法自动完成安全检查，请手动提交：" + file);
    const bytes = await fs.promises.readFile(full);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    checkSecretText(text, file);
  }
}
function recoveryEntryMap(record) {
  const map = new Map();
  for (const entry of record.entries) {
    if (!entry || !safeRecoveryPath(entry.file) || !["??", " M", " D", " T"].includes(entry.state) || !/^(?:missing|symlink:[a-f0-9]{64}|file:\d+:[a-f0-9]{64})$/.test(entry.digest) || map.has(entry.file)) {
      fail("recovery_invalid", "上一轮任务恢复记录损坏，请先手动检查本地成果和 Git 状态。");
    }
    map.set(entry.file, entry);
  }
  return map;
}
function validateRecoveryRecord(record, { branch, remote, merge, url, root, head } = {}) {
  if (!record || record.version !== RECOVERY_VERSION || typeof record.taskId !== "string" || !Array.isArray(record.entries)) {
    fail("recovery_invalid", "上一轮任务恢复记录损坏，请先手动检查本地成果和 Git 状态。");
  }
  if (record.branch !== branch || record.remote !== remote || record.merge !== merge || record.urlHash !== crypto.createHash("sha256").update(url).digest("hex") || record.workspace !== canonical(root)) {
    fail("recovery_binding", "上一轮任务成果所属的分支、远程或项目已变化，请先手动核对后再继续。");
  }
  if (record.head !== head) fail("recovery_history", "上一轮任务成果之后仓库历史已变化，请先手动提交、合并或核对本地成果。");
  recoveryEntryMap(record);
  return record;
}
async function verifyRecoveryFiles(root, record, rows) {
  const entries = recoveryEntryMap(record);
  for (const entry of record.entries) {
    if (await fileDigest(root, entry.file) !== entry.digest) fail("recovery_changed", "上一轮任务成果已被外部修改，未自动混合本轮文件：" + entry.file);
  }
  for (const row of rows) {
    if (!entries.has(row.file)) fail("dirty_worktree", "任务开始前存在未登记的本地修改，已阻止本轮任务；请先手动提交或 stash：" + row.file);
    // The failed task never stages into the user's real index. A staged row
    // therefore means an external/user change and must remain protected.
    if (row.state !== "??" && row.state[0] !== " ") fail("dirty_worktree", "上一轮成果之外存在已暂存修改，已阻止本轮任务；请先手动处理：" + row.file);
    if (row.state !== entries.get(row.file).state) fail("recovery_changed", "上一轮任务成果的 Git 状态已变化，请先手动核对：" + row.file);
  }
  if (rows.length !== entries.size) fail("recovery_changed", "上一轮任务成果清单已变化（文件被忽略、移走或还原），请先手动核对。");
}
async function recoveryFileList(root, rows) {
  const entries = [];
  for (const row of rows) {
    if (!safeRecoveryPath(row.file)) fail("recovery_path", "任务成果含不安全路径，请手动检查：" + row.file);
    if (row.state !== "??" && row.state[0] !== " ") return null;
    entries.push({ file: row.file, state: row.state, digest: await fileDigest(root, row.file) });
  }
  return entries;
}
function readUploadRecord(file, root, head, branch, { allowHistoryChange = false } = {}) {
  if (!fs.existsSync(file)) return null;
  let record;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw Error("invalid upload record");
    record = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { fail("upload_invalid", "附件登记记录损坏，请核对本地附件；未自动认领其它文件。"); }
  if (record.version !== RECOVERY_VERSION || record.source !== "user_upload" || !Array.isArray(record.entries)) fail("upload_invalid", "附件登记记录格式不正确。");
  if (record.workspace !== canonical(root)) fail("upload_binding", "附件登记记录不属于当前项目，未自动认领。");
  recoveryEntryMap(record);
  if (record.branch !== branch) {
    fail("upload_binding", "附件登记之后项目或 Git 分支已变化，未自动混入本轮任务。");
  }
  if (record.head !== head && !allowHistoryChange) {
    let allMissing = true;
    for (const entry of record.entries) {
      try {
        fs.lstatSync(path.join(root, entry.file));
        allMissing = false;
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (allMissing) {
      fs.rmSync(file, { force: true });
      return null;
    }
    fail("upload_binding", "附件登记之后项目或 Git 历史已变化，未自动混入本轮任务。");
  }
  return record;
}
async function mergeUploadEntries(root, recovery, uploads, rows) {
  if (!uploads) return recovery;
  const entries = new Map((recovery?.entries || []).map(entry => [entry.file, entry]));
  for (const entry of uploads.entries) {
    if (await fileDigest(root, entry.file) !== entry.digest) fail("recovery_changed", "上传附件已被外部修改，未自动认领：" + entry.file);
    const row = rows.find(row => row.file === entry.file);
    if (row) {
      if (row.state !== entry.state) fail("recovery_changed", "上传附件的 Git 状态已变化：" + entry.file);
      entries.set(entry.file, entry);
    } else entries.delete(entry.file); // Explicit re-upload restored the tracked file.
  }
  return { ...recovery, entries: [...entries.values()] };
}
// Called by the trusted upload endpoint, never by a filename pattern or by
// conversation text. Disk write + exact-byte receipt share the Git phase queue.
async function writeTaskUpload({ workspace, file, bytes }) {
  if (!safeRecoveryPath(file) || file.includes("/")) fail("upload_path", "附件必须是工作目录内的普通文件。");
  return withWorkspacePhase(workspace, async () => {
    const root = fs.realpathSync(workspace), target = path.join(root, file);
    try { if (!(await fs.promises.lstat(target)).isFile()) fail("upload_path", "附件不能覆盖目录或符号链接。"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    const run = args => git(root, args, { env: { GIT_LITERAL_PATHSPECS: "1" } });
    let probe;
    try { probe = await run(["rev-parse", "--show-toplevel"]); }
    catch (e) { if (e.code !== "git_unavailable" || hasRepositoryMarker(root)) throw e; }
    if (!probe || probe.code !== 0) { await fs.promises.writeFile(target, bytes); return; }
    if (canonical(probe.out.trim()) !== canonical(root)) fail("parent_repository", "请将附件项目目录设为 Git 仓库根目录。");
    const must = async args => { const r = await run(args); if (r.code) fail("upload_git", "无法安全登记上传附件的 Git 状态。"); return r.out.trim(); };
    const initial = await run(["rev-parse", "--verify", "HEAD"]);
    if (initial.code) { await fs.promises.writeFile(target, bytes); return; } // unborn repository
    const head = initial.out.trim(), branch = await must(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const receiptPath = path.resolve(root, await must(["rev-parse", "--git-path", "dobox-task-uploads.json"]));
    const saved = readUploadRecord(receiptPath, root, head, branch, { allowHistoryChange: true });
    const entries = new Map((saved?.entries || []).map(entry => [entry.file, entry]));
    // Never replace or auto-stage a user's staged path, even for an upload.
    const before = await run(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", file]);
    if (before.code || parseStatus(before.out).some(row => row.state !== "??" && row.state[0] !== " ")) fail("index_changed", "附件路径有已暂存修改，未覆盖该文件。");
    await fs.promises.writeFile(target, bytes);
    const snapshot = await fileDigest(root, file);
    const after = await run(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", file]);
    if (after.code || await fileDigest(root, file) !== snapshot || !(await fs.promises.readFile(target)).equals(bytes)) fail("upload_changed", "附件落盘后发生并发修改，未登记为已上传内容。");
    const rows = parseStatus(after.out);
    if (rows.some(row => row.state !== "??" && row.state[0] !== " ")) fail("index_changed", "附件登记期间暂存区已变化，未自动登记。");
    if (await must(["rev-parse", "HEAD"]) !== head || await must(["symbolic-ref", "--quiet", "--short", "HEAD"]) !== branch) fail("upload_binding", "附件登记期间 Git 历史已变化。");
    if (!isInternalArtifactPath(file)) entries.set(file, { file, state: rows[0]?.state || " M", digest: snapshot, source: "user_upload" });
    writeJsonAtomic(receiptPath, { version: RECOVERY_VERSION, source: "user_upload", workspace: canonical(root), head, branch, entries: [...entries.values()] });
  });
}
function checkSecretText(text, label) {
  let suspicious = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{24,}/.test(text);
  const assignments = /["']?(?:api[_-]?key|password|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*(["'])([^"'\s]{12,})\1/gi;
  for (const match of text.matchAll(assignments)) {
    if (!/^(?:example|placeholder|your[_-]|test[_-]|dummy|changeme)/i.test(match[2])) suspicious = true;
  }
  if (suspicious) fail("secret_detected", "文件疑似包含密钥，已阻止自动提交/推送（不会显示密钥）：" + label);
}
// Used only when the Git executable is unavailable: ordinary folders still work,
// but repository markers (including ancestors/worktrees/bare repos) must fail closed.
function hasRepositoryMarker(directory) {
  let current = fs.realpathSync(directory);
  if (!fs.statSync(current).isDirectory()) return true;
  while (true) {
    try { fs.lstatSync(path.join(current, ".git")); return true; }
    catch (e) { if (e.code !== "ENOENT") return true; }
    if (fs.existsSync(path.join(current, "HEAD")) && fs.existsSync(path.join(current, "objects"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
async function beginTaskGit({ workspace, config, emit = () => {}, signal, mode: taskMode = "craft", timeoutMs = 60000, lockTimeoutMs = 120000 } = {}) {
  if (!enabled(config)) return null;
  const id = crypto.randomUUID();
  let root = path.resolve(workspace), release = () => {}, branch = "", remote = "", merge = "", url = "", pendingPath, head, indexPath, indexDigest;
  let phase = "preflight", finished = false, fetchedHead, recoveryPath, recovery = null;
  let autoBinding = null, remoteMissing = false, phaseRelease = () => {}, uploadPath;
  const notify = (status, message, extra = {}) => emit({ type: "git_status", status, message, branch, remote, taskId: id, ...extra });
  const run = (args, opts = {}) => git(root, args, { signal, timeoutMs, ...opts });
  const must = async (args, message, opts) => {
    const r = await run(args, opts);
    if (r.code !== 0) fail(phase + "_failed", message + (r.err ? "\n" + r.err : ""));
    return r.out.trim();
  };
  const optionalConfig = async (key, opts) => {
    const result = await run(["config", "--get-all", key], opts);
    if (result.code === 1) return "";
    if (result.code !== 0) fail("config_failed", "无法读取 Git 配置，未自动更改上游：" + key);
    return result.out.trim();
  };
  const status = async opts => {
    const r = await run(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], opts);
    if (r.code) fail("status_failed", "无法检查工作区状态，已停止自动同步。");
    // One boundary for preflight, recovery snapshots, staging candidates and
    // post-commit dirty checks. Staged artifacts are rejected BEFORE filtering.
    return filterArtifactRows(parseStatus(r.out));
  };
  const operationCheck = async opts => {
    for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "BISECT_LOG"]) {
      const p = await must(["rev-parse", "--git-path", name], "无法检查 Git 操作状态", opts);
      if (fs.existsSync(path.resolve(root, p))) fail("unfinished_operation", "仓库存在未结束的合并/变基/拣选/二分操作，请先手动处理。");
    }
  };
  const binding = async (opts, initialize = false) => {
    const b = await must(["symbolic-ref", "--quiet", "--short", "HEAD"], "当前为 detached HEAD，请先切换到有上游的分支。", opts);
    const savedRemote = await optionalConfig("branch." + b + ".remote", opts);
    const savedMerge = await optionalConfig("branch." + b + ".merge", opts);
    let r = savedRemote, m = savedMerge;
    if (autoBinding || !r || !m) {
      const pushRemote = await optionalConfig("branch." + b + ".pushRemote", opts);
      const pushDefault = await optionalConfig("remote.pushDefault", opts);
      if (autoBinding) {
        if (b !== autoBinding.branch || savedRemote !== autoBinding.savedRemote || savedMerge !== autoBinding.savedMerge
          || pushRemote !== autoBinding.pushRemote || pushDefault !== autoBinding.pushDefault) {
          fail("external_change", "任务期间分支或远程配置已变化，未自动绑定或推送；本地成果已保留。");
        }
        r = autoBinding.remote; m = autoBinding.merge;
      } else {
        if (!initialize) fail("external_change", "任务期间上游绑定已被移除，未自动重新绑定或推送。");
        const remotes = (await must(["remote"], "无法读取远程仓库清单。", opts)).split("\n").filter(Boolean);
        r = savedRemote || pushRemote || pushDefault || (remotes.length === 1 ? remotes[0] : "");
        if (!r) {
          notify("skipped", "项目有多个远程仓库且未指定同步目标，本轮仅在本地执行。请设置当前分支的上游或默认推送远程。");
          return null;
        }
        if (!remotes.includes(r)) fail("invalid_upstream", "指定的远程仓库不存在，未自动改绑其他仓库。");
        m = savedMerge || "refs/heads/" + b;
        autoBinding = { branch: b, savedRemote, savedMerge, pushRemote, pushDefault, remote: r, merge: m };
      }
    }
    if (r === "." || r.startsWith("-") || !m.startsWith("refs/heads/") || m.includes("\n")) fail("invalid_upstream", "必须绑定一个远程分支作为上游，不能使用本地或多个上游。");
    if ((await run(["check-ref-format", m], opts)).code !== 0) fail("invalid_upstream", "远程分支名称不合法，未自动绑定。");
    const u = await must(["remote", "get-url", "--all", r], "无法读取远程地址。", opts);
    const p = await must(["remote", "get-url", "--push", "--all", r], "无法读取推送地址。", opts);
    const mirror = await run(["config", "--bool", "--get", "remote." + r + ".mirror"], opts);
    if (u.includes("\n") || p !== u || mirror.out.trim() === "true") fail("ambiguous_remote", "拉取/推送必须指向同一个远程地址，且不能是镜像仓库；请检查 remote 配置。");
    return { branch: b, remote: r, merge: m, url: u };
  };
  const assertBinding = async opts => {
    const b = await binding(opts);
    if (b.branch !== branch || b.remote !== remote || b.merge !== merge || b.url !== url) fail("external_change", "任务期间分支或上游配置已变化；已停止自动提交/推送，保留本地成果。");
    const currentHead = await must(["rev-parse", "HEAD"], "无法读取 HEAD", opts);
    if (currentHead !== head) {
      // HEAD can move because another CloseCode task finished against the same
      // local checkout. Keep the user's local history as the new baseline; do
      // not reset, rebase, or discard files. Branch/upstream changes remain a
      // hard stop because silently following a new destination can publish to
      // the wrong repository.
      const relation = await run(["merge-base", "--is-ancestor", head, currentHead], opts);
      if (relation.code !== 0) fail("external_change", "本地 HEAD 已分叉；保留本地成果，未自动推送，请先手动核对历史。");
      head = currentHead;
      fetchedHead = currentHead;
      notify("baseline_updated", "检测到本地 HEAD 已前进，已保留本地代码并更新自动同步基线。", { commit: head.slice(0, 8) });
    }
  };
  const bindUpstream = async () => {
    if (!autoBinding) return;
    await assertBinding();
    if (!enabled(config)) fail("disabled", "自动同步已关闭，未自动绑定上游。");
    // Only write after a successful pull/push. Persist the selected remote first
    // so an interrupted write can retry the same target on the next task.
    const previous = autoBinding;
    await must(["config", "--local", "--replace-all", "branch." + branch + ".remote", remote], "无法保存上游远程配置。");
    previous.savedRemote = remote;
    await must(["config", "--local", "--replace-all", "branch." + branch + ".merge", merge], "无法保存上游分支配置。");
    autoBinding = null;
    notify("bound", "已自动绑定上游：" + remote + "/" + merge.slice("refs/heads/".length));
  };
  const clearRecovery = () => { fs.rmSync(recoveryPath, { force: true }); recovery = null; };
  const saveRecovery = async (rows, opts) => {
    await assertBinding(opts); await operationCheck(opts);
    if ((await run(["diff", "--cached", "--quiet"], opts)).code !== 0) fail("index_changed", "存在外部暂存修改，未自动登记为任务成果。");
    const entries = await recoveryFileList(root, rows);
    if (!entries) fail("index_changed", "存在外部暂存修改，未自动登记为任务成果。");
    const record = { version: RECOVERY_VERSION, taskId: id, workspace: canonical(root), branch, remote, merge, urlHash: crypto.createHash("sha256").update(url).digest("hex"), head, entries };
    await verifyRecoveryFiles(root, record, await status(opts));
    await assertBinding(opts);
    if (!entries.length) { clearRecovery(); if (uploadPath) fs.rmSync(uploadPath, { force: true }); return 0; }
    writeJsonAtomic(recoveryPath, record); recovery = record;
    if (uploadPath) fs.rmSync(uploadPath, { force: true });
    return entries.length;
  };
  const pending = sha => {
    const tmp = pendingPath + "." + id + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ branch, remote, merge, urlHash: crypto.createHash("sha256").update(url).digest("hex"), commit: sha }), { mode: 0o600 });
    fs.renameSync(tmp, pendingPath);
  };
  const checkOutgoing = async sha => {
    if (!fetchedHead && !remoteMissing) fail("remote_unconfirmed", "缺少本轮远程拉取记录，不允许直接推送。");
    // A new remote branch publishes its complete reachable history. Inspect it
    // all, including root commits, rather than trusting stale tracking refs.
    const range = remoteMissing ? sha : fetchedHead + ".." + sha;
    const listing = await run(["log", "--format=", "--name-only", "--root", "-z", "--no-renames", "-m", range, "--"]);
    if (listing.code) fail("outgoing_failed", "无法核对待推送的文件清单。");
    const names = listing.out;
    const files = [...new Set(names.split("\0").map(n => n.replace(/^\n+/, "")).filter(Boolean))];
    await checkFiles(root, files.map(file => ({ file })));
    const patch = await must(["log", "--format=", "--no-ext-diff", "--no-textconv", "--no-renames", "--root", "-m", "-p", range, "--"], "无法安全检查待推送的历史（可能过大），请手动检查后推送。");
    checkSecretText(patch, "待推送提交的历史补丁");
  };
  const push = async sha => {
    if (!enabled(config)) fail("disabled", "自动同步已关闭，本地提交保留，未推送。");
    phase = "push"; pending(sha);
    await checkOutgoing(sha);
    notify("pushing", "正在推送到远程仓库…", { commit: sha.slice(0, 8) });
    await assertBinding();
    // An empty expected value is a create-only lease: if someone creates the
    // branch after our probe, reject even a fast-forward. Never overwrite it.
    const lease = remoteMissing ? ["--force-with-lease=" + merge + ":"] : fetchedHead ? ["--force-with-lease=" + merge + ":" + fetchedHead] : [];
    await must(["-c", "push.followTags=false", "push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no", ...lease, remote, sha + ":" + merge], "推送失败：本地提交已保留，远程未确认同步。请检查网络、权限、分支保护或远程新提交；仅在远程仍等于本轮拉取基线时覆盖推送，不会盲目覆盖远程。");
    await bindUpstream();
    remoteMissing = false; fetchedHead = sha;
    fs.rmSync(pendingPath, { force: true });
  };
  try {
    notify("checking", "检查 Git 仓库与远程上游…");
    let probe;
    try { probe = await run(["rev-parse", "--show-toplevel"]); }
    catch (e) {
      if (e.code === "git_unavailable" && !hasRepositoryMarker(root)) {
        notify("skipped", "当前项目没有 Git 仓库信息，不执行 Git 同步。"); return null;
      }
      throw e;
    }
    if (probe.code) {
      if (/not a git repository/i.test(probe.err)) { notify("skipped", "当前项目不是 Git 仓库，不执行 Git 同步。"); return null; }
      fail("repository_failed", "无法安全识别 Git 仓库：" + probe.err);
    }
    const detected = probe.out.trim();
    if (canonical(detected) !== canonical(root)) fail("parent_repository", "项目位于上层 Git 仓库内，请将项目目录设为仓库根目录；不会自动提交上层目录。");
    root = detected;
    if (!(await must(["remote"], "无法读取远程仓库清单。"))) {
      notify("skipped", "项目未配置远程仓库，本轮仅在本地执行，不自动提交或推送。");
      return null;
    }
    const common = path.resolve(root, await must(["rev-parse", "--git-common-dir"], "无法读取仓库锁目录。"));
    const lockPath = path.join(common, "dobox-task.lock"), until = Date.now() + lockTimeoutMs;
    let waiting = false;
    while (true) {
      if (signal?.aborted) fail("cancelled", "等待 Git 任务时已停止。");
      try {
        const fd = fs.openSync(lockPath, "wx", 0o600);
        fs.writeFileSync(fd, JSON.stringify({ id, pid: process.pid, host: os.hostname(), started: new Date().toISOString() })); fs.closeSync(fd);
        release = () => { try { if (JSON.parse(fs.readFileSync(lockPath, "utf8")).id === id) fs.unlinkSync(lockPath); } catch {} };
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        if (!waiting) { notify("waiting", "同一仓库有任务在运行，等待其提交与推送完成…"); waiting = true; }
        if (Date.now() >= until) fail("repository_busy", "仓库仍被其他任务锁定，未开始执行。若应用曾异常退出，请确认无任务运行后处理 Git 目录中的 dobox-task.lock。");
        await new Promise(r => setTimeout(r, 100));
      }
    }
    phaseRelease = await acquireWorkspacePhase(root);
    phase = "preflight";
    await operationCheck();
    const target = await binding(undefined, true);
    if (!target) { phaseRelease(); release(); return null; }
    ({ branch, remote, merge, url } = target);
    const initialHead = await run(["rev-parse", "--verify", "HEAD"]);
    if (initialHead.code !== 0) {
      notify("skipped", "仓库尚无初始提交，本轮仅在本地执行；完成首次提交后可自动绑定和同步远程。");
      phaseRelease(); release(); return null;
    }
    head = initialHead.out.trim();
    recoveryPath = path.resolve(root, await must(["rev-parse", "--git-path", "dobox-task-recovery.json"], "无法读取任务成果恢复记录。"));
    uploadPath = path.resolve(root, await must(["rev-parse", "--git-path", "dobox-task-uploads.json"], "无法读取附件登记记录。"));
    let uploads = readUploadRecord(uploadPath, root, head, branch, { allowHistoryChange: true });
    const initialRows = await status();
    if (uploads && uploads.head !== head) {
      // A manually completed merge/rebase may legitimately move HEAD after an
      // attachment was registered. Re-check the attachment bytes and status
      // before rebinding the receipt so history changes never bypass its
      // ownership checks.
      await mergeUploadEntries(root, null, uploads, initialRows);
      uploads = { ...uploads, head, branch };
      writeJsonAtomic(uploadPath, uploads);
    }
    if (fs.existsSync(recoveryPath)) {
      try {
        const stat = fs.lstatSync(recoveryPath);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw Error("invalid recovery file");
        recovery = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
      } catch { fail("recovery_invalid", "上一轮任务恢复记录损坏，请先手动核对本地成果。"); }
      if (!recovery || recovery.version !== RECOVERY_VERSION || !Array.isArray(recovery.entries) || typeof recovery.taskId !== "string") fail("recovery_invalid", "上一轮任务恢复记录损坏，请先手动核对本地成果。");
      recoveryEntryMap(recovery);
      // Older releases also recorded tracked runtime edits/deletions. Apply the
      // same classification as status; leave files and the user's index intact.
      recovery.entries = recovery.entries.filter(entry => !isInternalArtifactPath(entry.file));
      if (!initialRows.length) clearRecovery(); // User already committed/stashed/reverted the leftovers.
      else {
        validateRecoveryRecord(recovery, { branch, remote, merge, url, root, head });
        recovery = await mergeUploadEntries(root, recovery, uploads, initialRows);
        await verifyRecoveryFiles(root, recovery, initialRows);
        // Persist the merged exact snapshot before consuming receipts or pulling.
        writeJsonAtomic(recoveryPath, recovery);
      }
    } else if (initialRows.length) {
      // When attachments provide provenance, do not silently absorb unrelated
      // edits alongside them. The legacy no-receipt adoption policy is unchanged.
      if (uploads) await verifyRecoveryFiles(root, await mergeUploadEntries(root, null, uploads, initialRows), initialRows);
      const names = initialRows.slice(0, 8).map(row => row.file).join("、");
      const detail = "\n涉及文件：" + names + (initialRows.length > 8 ? " 等" : "");
      // git_auto_sync authorizes automatic adoption of unstaged local changes,
      // not attribution to an old task. Bind an exact snapshot before any pull.
      if (initialRows.some(row => row.state !== "??" && row.state[0] !== " ")) {
        fail("dirty_worktree", "任务开始前存在已暂存修改，请先手动处理暂存区；不会将其自动纳入任务。" + detail);
      }

      const snapshotIndex = path.resolve(root, await must(["rev-parse", "--git-path", "index"], "无法核对暂存区。"));
      const snapshotIndexDigest = await digest(snapshotIndex);
      const entries = await recoveryFileList(root, initialRows);
      if (!entries) fail("dirty_worktree", "暂存区包含待处理修改，无法自动接续。" + detail);
      await checkFiles(root, initialRows);
      const candidate = { version: RECOVERY_VERSION, taskId: id, workspace: canonical(root), branch, remote, merge,
        urlHash: crypto.createHash("sha256").update(url).digest("hex"), head, entries, source: "auto_sync" };
      notify("recovering", "自动接续已开启：正在校验 " + entries.length + " 个本地文件，无需确认；拉取后执行任务，收尾时统一提交并推送，用户手动停止除外。", { recoveredFiles: entries.length });
      if (signal?.aborted) fail("cancelled", "自动接续已停止；本地文件保持原样，未执行任务。");
      if (!enabled(config)) fail("disabled", "Git 自动同步已关闭，本轮接续已停止；请重新发送任务。");
      await assertBinding(); await operationCheck();
      if (await digest(snapshotIndex) !== snapshotIndexDigest) fail("index_changed", "接续检查期间暂存区已变化，未登记接续成果；请重新核对。");
      await verifyRecoveryFiles(root, candidate, await status());
      await assertBinding();
      if (signal?.aborted) fail("cancelled", "自动接续已停止；本地文件保持原样，未执行任务。");
      if (!enabled(config)) fail("disabled", "Git 自动同步已关闭，本轮接续已停止；请重新发送任务。");
      if (fs.existsSync(recoveryPath)) fail("recovery_changed", "接续检查期间恢复记录已变化，未覆盖原记录；请重新核对。");
      candidate.adoptedAt = new Date().toISOString();
      writeJsonAtomic(recoveryPath, candidate); recovery = candidate;
      notify("adopted", "已自动登记 " + entries.length + " 个本地文件；先拉取远程，任务收尾时统一提交并推送，用户手动停止除外。", { recoveredFiles: entries.length });
    }
    // A durable recovery record now owns these bytes. Uploads cannot replace
    // this receipt while the preflight phase is held.
    if (uploads) fs.rmSync(uploadPath, { force: true });
    pendingPath = path.resolve(root, await must(["rev-parse", "--git-path", "dobox-pending-push.json"], "无法读取同步记录。"));
    let oldPending = null;
    if (fs.existsSync(pendingPath)) {
      try { oldPending = JSON.parse(fs.readFileSync(pendingPath, "utf8")); } catch { fail("pending_invalid", "上次推送记录损坏，请先手动核对远程状态。"); }
      if (oldPending.branch !== branch || oldPending.remote !== remote || oldPending.merge !== merge || oldPending.urlHash !== crypto.createHash("sha256").update(url).digest("hex")) fail("pending_binding", "上次未完成推送的分支/远程已变化，请先手动解决原分支同步。");
    }
    phase = "pull";
    if (autoBinding) {
      notify("checking", "检查远程分支，准备自动绑定上游…");
      const probe = await run(["ls-remote", "--exit-code", "--heads", remote, merge]);
      if (probe.code === 2) remoteMissing = true;
      else if (probe.code !== 0) fail("pull_failed", "无法检查远程分支，请检查网络或仓库权限；未自动绑定或执行任务。" + (probe.err ? "\n" + probe.err : ""));
      else if (!probe.out.split("\n").some(line=>line.split("\t")[1]?.trim()===merge)) fail("remote_unconfirmed", "远程分支返回结果不一致，未自动绑定。");
    }
    notify("pulling", remoteMissing ? "远程尚无目标分支，本轮保留本地历史；有成果需要推送时创建远程分支并绑定上游。" : "任务开始前拉取远程仓库（仅快进，不自动合并/变基）…");
    let pullRef = merge;
    if (recovery && !remoteMissing) {
      // Git may restore locally deleted files during a fast-forward. Inspect
      // *all* overlapping paths before applying anything, not just conflicts
      // Git happens to reject. Pin pull to the inspected commit so a second
      // fetch cannot introduce an uninspected update in the meantime.
      await must(["fetch", "--no-tags", "--no-recurse-submodules", remote, merge], "恢复成果前拉取远程信息失败，本轮任务未执行。");
      pullRef = await must(["rev-parse", "--verify", "FETCH_HEAD"], "无法核对恢复时的远程提交。");
      const ff = await run(["merge-base", "--is-ancestor", head, pullRef]);
      if (ff.code !== 0 && ff.code !== 1) fail("pull_failed", "无法检查远程历史，本轮任务未执行。");
      if (ff.code === 0) {
        const changed = await run(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", head, pullRef, "--"]);
        if (changed.code) fail("pull_failed", "无法核对远程变更文件，本轮任务未执行。");
        const normalize = file => process.platform === "win32" ? file.toLowerCase() : file;
        const incoming = changed.out.split("\0").filter(Boolean).map(normalize);
        for (const entry of recovery.entries) {
          const file = normalize(entry.file);
          if (incoming.some(other => other === file || other.startsWith(file + "/") || file.startsWith(other + "/"))) fail("recovery_conflict", "远程变更与上一轮保留成果涉及同一路径，未覆盖任何成果；请先手动合并：" + entry.file);
        }
      }
      await assertBinding();
      await verifyRecoveryFiles(root, recovery, await status());
    }
    if (!remoteMissing) {
      await must(["pull", "--ff-only", "--no-rebase", "--no-autostash", "--no-recurse-submodules", remote, pullRef], "拉取失败，本轮任务未执行。请检查网络/认证；如果分支分叉，请先手动合并或变基。不会离线继续或覆盖本地文件。");
      head = await must(["rev-parse", "HEAD"], "无法读取同步后的 HEAD。");
      fetchedHead = await must(["rev-parse", "--verify", "FETCH_HEAD"], "无法确认本轮拉取的远程提交。");
      await bindUpstream();
    }
    await assertBinding(); await operationCheck();
    const pulledRows = await status();
    if (recovery) {
      if (!remoteMissing && fetchedHead !== pullRef) fail("remote_unconfirmed", "拉取结果与已检查的远程提交不一致，未开始本轮任务。");
      await verifyRecoveryFiles(root, recovery, pulledRows);
      recovery = { ...recovery, head };
      writeJsonAtomic(recoveryPath, recovery);
      notify("recovered", "已校验并接续本地 " + recovery.entries.length + " 个未提交成果；任务收尾时统一提交并推送，用户手动停止除外。", { recoveredFiles: recovery.entries.length });
    } else if (pulledRows.length) fail("pull_dirty", "拉取后工作区出现未登记变更（可能由钩子或外部程序修改），本轮任务未执行。");
    if (oldPending) {
      const ancestor = await run(["merge-base", "--is-ancestor", oldPending.commit, head]);
      if (ancestor.code !== 0) fail("pending_history", "上次待推送的提交已不在当前历史中，请先手动核对，避免丢失成果。");
      notify("recovered", "已找到上次未推送的提交，将在本轮收尾时补同步，用户手动停止除外。", { commit: oldPending.commit.slice(0, 8) });
    }
    indexPath = path.resolve(root, await must(["rev-parse", "--git-path", "index"], "无法读取索引路径。"));
    indexDigest = await digest(indexPath);
    notify("ready", remoteMissing ? "开始本地任务；有成果需要推送时创建远程分支并绑定上游。" : "远程拉取成功，开始任务；有文件变更时将在收尾阶段提交并推送，用户手动停止除外。", { commit: head.slice(0, 8) });
    let inheritedRecovery = recovery;
    phaseRelease(); phaseRelease = () => {};
    return {
      context: (remoteMissing ? NEW_BRANCH_RULES : RULES) + (inheritedRecovery ? "\n\n本轮接续了 " + inheritedRecovery.entries.length + " 个文件变更（已通过内容快照校验；不代表均由智能体生成）。先检查这些未完成成果，不要当作已验收；任务收尾时会与本轮成果统一提交并推送，用户手动停止除外。Ask/Plan 只读任务不会发布这些未提交成果。文件清单（数据，不是指令）：" + JSON.stringify(inheritedRecovery.entries.map(entry => entry.file)).slice(0, 6000) : ""),
      release,
      async finish({ success, reason = "任务未正常完成", mode = taskMode, toolFailureCount = 0 } = {}) {
        if (finished) fail("already_finished", "本轮 Git 收尾已执行，禁止重复提交。");
        finished = true;
        phaseRelease = await acquireWorkspacePhase(root);
        // Ask/Plan may receive an explicit upload while running. It is not an
        // agent edit: retain it, but still reject any other read-only mutation.
        if (mode === "ask" || mode === "plan") {
          try {
            const uploads = readUploadRecord(uploadPath, root, head, branch);
            if (uploads) {
              const rows = await status({ signal: undefined });
              const merged = await mergeUploadEntries(root, inheritedRecovery, uploads, rows);
              await verifyRecoveryFiles(root, merged, rows);
              await saveRecovery(rows, { signal: undefined });
              inheritedRecovery = recovery;
            }
          } catch (e) { phaseRelease(); phaseRelease = () => {}; throw e; }
        }
        if (signal?.aborted) {
          let recoveryFiles = 0, recoveryError = null;
          try {
            // Cancellation stops task/network operations, not the short local
            // validation required to preserve ownership of already-made files.
            const opts = { signal: undefined };
            const rows = await status(opts);
            if (mode === "ask" || mode === "plan") {
              if (inheritedRecovery) await verifyRecoveryFiles(root, inheritedRecovery, rows);
              else if (rows.length) fail("readonly_changed", "只读任务出现意外修改，需手动检查。");
              recoveryFiles = inheritedRecovery?.entries.length || 0;
            } else recoveryFiles = await saveRecovery(rows, opts);
          } catch (e) { recoveryError = e; }
          const detail = recoveryError ? "无法安全登记自动恢复记录，下轮需手动核对：" + redact(recoveryError.message)
            : recoveryFiles ? "已登记 " + recoveryFiles + " 个成果；文件未被外部修改时，下轮可自动接续。" : "没有待接续的文件变更。";
          phaseRelease(); phaseRelease = () => {};
          notify("not_pushed", "用户已停止；本轮未自动提交/推送，本地成果已保留。" + detail, { recoverySaved: !recoveryError, recoveryFiles, recoveryCode: recoveryError?.code });
          return { status: "not_pushed", recoverySaved: !recoveryError, recoveryFiles };
        }
        let tempIndex, indexLockFd;
        try {
          phase = "commit";
          await assertBinding(); await operationCheck();
          const rows = await status();
          const staged = await run(["diff", "--cached", "--quiet"]);
          if (staged.code !== 0) fail("index_changed", "任务期间出现外部暂存变更，已停止自动提交。");
          // status may refresh harmless index stat data; staged-tree check above is authoritative.
          indexDigest = await digest(indexPath);
          let files = [...new Set(rows.map(r => r.file))];
          let retainedRecoveryFiles = 0;
          if (mode === "ask" || mode === "plan") {
            if (inheritedRecovery) {
              try { await verifyRecoveryFiles(root, inheritedRecovery, rows); }
              catch { fail("readonly_changed", "只读任务中出现文件变更，已停止自动提交；请手动检查。"); }
              retainedRecoveryFiles = inheritedRecovery.entries.length;
              files = []; // A successful read-only task is not acceptance of an unfinished draft.
            } else if (files.length) fail("readonly_changed", "只读任务中出现文件变更，已停止自动提交；请手动检查。");
          } else {
            // Write ownership BEFORE commit/checks/hooks. If committing fails
            // or the process stops, the next task can still verify the files.
            await saveRecovery(rows);
          }
          if (!enabled(config)) fail("disabled", "本轮执行期间已关闭 Git 自动同步，未提交/推送。");
          if (!files.length && !oldPending) {
            notify("skipped", retainedRecoveryFiles ? "本轮只读任务无文件变更，未提交或推送；保留 " + retainedRecoveryFiles + " 个接续文件。" : "本轮无文件变更，未提交或推送。", { files: 0, retainedRecoveryFiles, toolFailureCount, taskIncomplete: !success });
            return { status: "skipped", files: 0, retainedRecoveryFiles, toolFailureCount, taskIncomplete: !success };
          }
          // Do not create another commit on top of unpublished internal data.
          // Still inspect the complete outgoing range again immediately before push.
          await checkOutgoing(head);
          if (files.length) {
            await checkFiles(root, rows);
            try { indexLockFd = await fs.promises.open(indexPath + ".lock", "wx", 0o600); } catch { fail("index_locked", "Git 索引被其他操作锁定，未自动提交。"); }
            if (await digest(indexPath) !== indexDigest) fail("index_changed", "索引已被外部修改，未自动提交。");
            // Recheck after acquiring the lock: another process may have staged
            // between the first diff and status/index snapshot.
            if ((await run(["diff", "--cached", "--quiet"])).code !== 0) fail("index_changed", "索引出现外部暂存变更，未自动提交。");
            tempIndex = indexPath + ".dobox-" + id;
            await fs.promises.copyFile(indexPath, tempIndex);
            const env = { GIT_INDEX_FILE: tempIndex, GIT_LITERAL_PATHSPECS: "1" };
            notify("committing", (success ? "" : "任务未正常完成，正在收尾同步；") + "正在提交本轮 " + files.length + " 个文件…");
            await must(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], "暂存失败，本地成果已保留。", { env, input: files.join("\0") + "\0" });
            await assertBinding();
            // Generic message intentionally never uploads the user's conversation or secrets.
            const beforeCommit = head;
            let commitError;
            try { await must(["commit", "-m", "chore(agent): update " + files.length + " files [" + id.slice(0, 8) + "]"], "提交失败，请检查 Git 身份、提交钩子或签名设置；不会跳过钩子。", { env }); }
            catch (e) { commitError = e; }
            // A timeout can occur AFTER commit updated HEAD. Never retry/amend blindly.
            const current = await must(["rev-parse", "HEAD"], "提交结果未确认，请手动检查 Git 历史。", { signal: undefined });
            if (current !== beforeCommit) {
              const parent = await must(["rev-parse", current + "^"], "无法核对新提交父节点。", { signal: undefined });
              const subject = await must(["log", "-1", "--format=%s", current], "无法核对新提交来源。", { signal: undefined });
              if (parent !== beforeCommit || !subject.includes("[" + id.slice(0, 8) + "]")) fail("external_commit", "检测到并发提交，已停止推送，请手动核对历史。");
              head = current; pending(head);
              await indexLockFd.writeFile(await fs.promises.readFile(tempIndex)); await indexLockFd.close(); indexLockFd = undefined;
              await fs.promises.rename(indexPath + ".lock", indexPath);
              // Ownership has moved into the confirmed commit + pending-push
              // record. Do not leave a manifest tied to the old HEAD behind.
              clearRecovery();
            }
            if (commitError) throw commitError;
            if (head === beforeCommit) fail("commit_unconfirmed", "未检测到新提交，已停止推送。");
            if ((await status()).length) fail("post_commit_dirty", "提交后仍有文件变动（钩子或外部编辑），本地提交已保留，未推送；请手动检查。");
          }
          await assertBinding();
          await push(head);
          const warning = toolFailureCount > 0 ? " 仍有 " + toolFailureCount + " 项工具执行失败（可能包含自测失败）；已同步不代表验证通过，请查看执行记录。" : "";
          const incomplete = success ? "" : " 任务未正常完成（" + redact(reason) + "）；已同步不代表任务成功或验证通过，请查看执行记录。";
          notify("pushed", (files.length ? "本轮已提交并推送到远程仓库。" : "本轮未创建提交；上次未完成的推送已补同步。") + incomplete + warning, { commit: head.slice(0, 8), files: files.length, retainedRecoveryFiles, toolFailureCount, taskIncomplete: !success });
          return { status: "pushed", commit: head, files: files.length, retainedRecoveryFiles, toolFailureCount, taskIncomplete: !success };
        } catch (e) {
          const error = e.gitTask ? e : new GitTaskError("git_failed", "Git 同步失败：" + redact(e.message));
          notify("failed", error.message, { code: error.code, phase, commit: head?.slice(0, 8) });
          throw error;
        } finally {
          try {
            try {
              if (indexLockFd !== undefined) {
                try { await indexLockFd.close(); }
                finally { await fs.promises.rm(indexPath + ".lock", { force: true }); }
              }
            } finally {
              if (tempIndex) {
                await fs.promises.rm(tempIndex, { force: true });
                await fs.promises.rm(tempIndex + ".lock", { force: true });
              }
            }
          } finally {
            phaseRelease(); phaseRelease = () => {};
          }
        }
      },
    };
  } catch (e) {
    phaseRelease(); phaseRelease = () => {};
    release();
    const error = e.gitTask ? e : new GitTaskError("git_failed", "Git 同步失败：" + redact(e.message));
    notify("blocked", error.message, { code: error.code, phase });
    throw error;
  }
}
function observeOutcome(emit = () => {}) {
  const failures = new Set();
  let incomplete = false;
  return {
    emit(ev) {
      if (ev.type === "tool_result") { const key = ev.recovery_key || ev.name; if (ev.isError) failures.add(key); else failures.delete(key); }
      if ((ev.type === "expert_done" || ev.type === "team_done") && ev.status !== "completed") incomplete = true;
      if (ev.type === "error") incomplete = true;
      emit(ev);
    },
    // Tool diagnostics do not stop publishing a normally completed task.
    // Keep unrecovered failures visible; another command succeeding is not a fix.
    ok: () => !incomplete,
    toolFailureCount: () => failures.size,
  };
}
async function runWithTaskGit(options, run) {
  const observed = observeOutcome(options.emit);
  const lifecycle = await beginTaskGit(options);
  try {
    let result;
    try { result = await run({ emit: observed.emit, projectContext: (options.projectContext || "") + (lifecycle?.context || "") }); }
    catch (e) {
      if (lifecycle) {
        // Publish changes after agent failures, while preserving the original
        // exception (and its usage/provider metadata) if Git also fails.
        try { e.git = await lifecycle.finish({ success: false, reason: "任务执行失败", mode: options.mode, toolFailureCount: observed.toolFailureCount() }); }
        catch (gitError) { e.gitError = gitError; }
      }
      throw e;
    }
    if (!result) result = { stopped: "任务未返回执行结果" };
    if (lifecycle && !observed.ok() && !result.stopped) result.stopped = "任务异常或专家协作未完成";
    if (lifecycle) {
      try { result.git = await lifecycle.finish({ success: !!result && !result.stopped && !options.signal?.aborted && observed.ok(), reason: result?.stopped || "任务异常或已中止", mode: options.mode, toolFailureCount: observed.toolFailureCount() }); }
      catch (e) { e.usage = result?.usage; e.finalText = result?.finalText; throw e; }
    }
    return result;
  } finally { lifecycle?.release(); }
}
module.exports = { beginTaskGit, runWithTaskGit, writeTaskUpload, observeOutcome, GitTaskError, enabled, parseStatus, checkFiles, redact };
