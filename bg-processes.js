/**
 * 后台进程管理：跟踪 detach 启动的 dev server / 数据库等常驻进程
 */

const fs = require("fs");
const path = require("path");
const { dataPath } = require("./paths");
const processTree = require("./lib/process-tree");

// 进程注册表：{ pid: { pid, command, sessionId, startTime, logFile, projectDir } }
const registry = new Map();
const REGISTRY_FILE = dataPath("data", "bg-processes.json");

// 启动时从磁盘加载
function load() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
      if (Array.isArray(data)) {
        for (const item of data) {
          registry.set(item.pid, item);
        }
      }
    }
  } catch (e) {
    console.warn("[后台进程] 加载注册表失败:", e.message);
  }
}

// 持久化到磁盘
function save() {
  try {
    fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify([...registry.values()], null, 2), "utf8");
  } catch (e) {
    console.error("[后台进程] 保存注册表失败:", e.message);
  }
}

// 注册一个新启动的后台进程
function register(pid, command, sessionId, logFile, projectDir, workspace) {
  registry.set(pid, {
    pid,
    command,
    sessionId,
    startTime: Date.now(),
    logFile,
    projectDir: projectDir || "",
    workspace: workspace ? require("./lib/workspace-scope").key(workspace) : "",
  });
  save();
}

// 注销进程（进程退出或被手动停止时调用）
function unregister(pid) {
  registry.delete(pid);
  save();
}

// 列出所有注册的进程（可选按 sessionId 过滤）
function list(sessionId = null) {
  const all = [...registry.values()];
  if (!sessionId) return all;
  return all.filter((p) => p.sessionId === sessionId);
}

// Tool callers may only see their project. Legacy records have no trustworthy root;
// retain them for the management UI, but only expose them to their original session.
function listForWorkspace(workspace, sessionId) {
  const scope = require("./lib/workspace-scope");
  return list().filter(p => {
    try {
      if (p.workspace) return scope.same(p.workspace, workspace);
      return !!sessionId && sessionId === p.sessionId && !!p.projectDir && scope.contains(workspace, p.projectDir);
    } catch { return false; }
  });
}

// 检查进程是否还活着（Windows/Unix 兼容）
function isAlive(pid) {
  return processTree.isAlive(pid);
}

// 清理已死亡的进程记录
function cleanup() {
  let cleaned = 0;
  for (const [pid, info] of registry) {
    if (!isAlive(pid)) {
      registry.delete(pid);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    save();
    console.log(`[后台进程] 清理了 ${cleaned} 个已退出的进程记录`);
  }
}

// 杀死一个进程（Windows/Unix 兼容）
async function kill(pid) {
  try {
    if (!await processTree.killTree(pid)) return false;
    unregister(pid);
    return true;
  } catch (e) {
    console.warn(`[后台进程] 停止 PID ${pid} 失败:`, e.message);
    return false;
  }
}

// 按端口查找占用进程（用于端口冲突检测）
function findByPort(port) {
  try {
    let cmd, regex;
    if (process.platform === "win32") {
      cmd = `netstat -ano | findstr :${port}`;
      regex = /\s+(\d+)$/;
    } else {
      cmd = `lsof -i :${port} -t`;
      regex = /^(\d+)$/;
    }
    const output = require("child_process").execSync(cmd, { encoding: "utf8", windowsHide: true, timeout: 3000 });
    const match = output.match(regex);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

load();
cleanup(); // 启动时清理僵尸记录

module.exports = {
  register,
  unregister,
  list,
  listForWorkspace,
  isAlive,
  cleanup,
  kill,
  findByPort,
};
