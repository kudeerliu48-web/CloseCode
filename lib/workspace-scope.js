"use strict";
const fs = require("fs");
const path = require("path");

// Resolve existing ancestors too: a new file below a junction must not escape the workspace.
function realPath(target) {
  const absolute = path.resolve(target);
  try { return fs.realpathSync.native(absolute); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    // A dangling link is not an ordinary missing destination.
    try { if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error("路径包含失效的符号链接：" + absolute); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(realPath(parent), path.basename(absolute));
  }
}
function key(target) {
  const p = realPath(target);
  return process.platform === "win32" ? p.toLowerCase() : p;
}
function contains(root, target) {
  const rel = path.relative(key(root), key(target));
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep));
}
function same(a, b) { return !!a && !!b && key(a) === key(b); }

// Server-created session folders live directly under the project root.
function isTaskArtifactPath(file) {
  return /^\u4efb\u52a1_\d{4}_[^/]+\//.test(String(file).replace(/\\/g, "/"));
}

// Git-relative paths only. These names come from tools.js (tmp/backup),
// server.js/cli.js/im.js (session persistence) and store.js (atomic/backup files).
// Do not classify ordinary scripts/tests, JSON/JS/MD, or all of data/ as internal.
function isInternalArtifactPath(file) {
  const normalized = String(file).replace(/\\/g, "/");
  return isTaskArtifactPath(normalized)
    || /(?:^|\/)(?:\.tmp|\.history)(?:\/|$)/.test(normalized)
    || /^data\/(?:sessions|im-sessions)(?:\/|$)/.test(normalized)
    || /^data\/(?:running|im-log)\.json(?:\.bak|\.corrupt(?:-\d+)?|\.\d+\.tmp)?$/.test(normalized)
    // Legacy sibling backups use the exact tools.js ISO stamp, not *.js/*.bak.
    || /[^/]+\.\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3])-[0-5]\d-[0-5]\d-\d{3}Z$/.test(normalized);
}

// Existing sessions are authoritative. Never move their history/outputs to the active project.
function bindSessionProject(session, requested, projects, activeName) {
  const name = requested == null ? "" : String(requested).trim();
  const bound = session.project || session.project_dir;
  if (bound) {
    if (name && name !== session.project) throw new Error("会话已绑定其他项目，不能迁移；请在目标项目新建对话。");
    const project = projects.find(p => p.name === session.project);
    if (!session.project_dir) {
      if (!project?.dir) throw new Error("会话所属项目已不存在，请恢复项目配置，不能改用当前项目。");
      session.project_dir = path.resolve(project.dir);
    }
    if (project?.dir && !same(project.dir, session.project_dir)) throw new Error("会话绑定的项目目录已改变，请核对目录并新建对话。");
    return { workspace: path.resolve(session.project_dir), project };
  }
  if (session.history?.length || session.transcript?.length) throw new Error("旧会话缺少项目归属，不能自动套用当前项目。请在正确项目新建对话。");
  const project = projects.find(p => p.name === (name || activeName));
  if (!project?.dir) throw new Error("指定项目不存在，未使用其他项目代替。");
  session.project = project.name;
  session.project_dir = path.resolve(project.dir);
  return { workspace: session.project_dir, project };
}
module.exports = { realPath, key, contains, same, isTaskArtifactPath, isInternalArtifactPath, bindSessionProject };
