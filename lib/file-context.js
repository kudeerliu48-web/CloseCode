"use strict";
const fs = require("fs");
const path = require("path");

/** 缺失文件只能诊断，不能伪造内容或从别的任务中偷换同名报告。 */
async function missingFileResult({ requested, resolved, baseDir, workspace, allowed }) {
  const locations = [...new Set([resolved, !path.isAbsolute(requested) ? path.resolve(workspace, requested) : resolved])].filter(allowed);
  const dirs = [...new Set([path.dirname(resolved), baseDir, workspace])].filter(allowed);
  const listings = [];
  for (const dir of dirs) {
    try {
      const entries = (await fs.promises.readdir(dir, { withFileTypes: true }))
        .filter(entry => entry.isFile() && allowed(path.join(dir, entry.name)));
      const stem = path.parse(requested).name.toLowerCase();
      const ext = path.extname(requested).toLowerCase();
      const score = name => (name.toLowerCase().startsWith(stem.slice(0, 3)) ? 2 : 0) + (path.extname(name).toLowerCase() === ext ? 1 : 0);
      entries.sort((a, b) => score(b.name) - score(a.name) || a.name.localeCompare(b.name));
      listings.push(dir + "：\n" + (entries.slice(0, 12).map(entry => "  " + JSON.stringify(path.join(dir, entry.name))).join("\n") || "  （没有可读文件）") + (entries.length > 12 ? "\n  …其余文件请用 list_files 查看" : ""));
    } catch { /* 目录不存在/不可读也不能掩盖原始缺失 */ }
  }
  return {
    isError: true, code: "FILE_NOT_FOUND", resolvedPath: resolved,
    content: "文件不存在：" + requested + "\n错误代码: FILE_NOT_FOUND\n" +
      "文件工具当前目录: " + baseDir + "\n项目根目录: " + workspace + "\n已检查的路径:\n" + locations.map(p => "- " + p).join("\n") +
      (listings.length ? "\n实际存在的文件（只是候选，未自动替换目标）：\n" + listings.join("\n") : "") +
      "\n请先用 list_files 核对真实文件名，或检查生成命令的退出码、cwd 和日志。不要继续猜测报告名或反复读取相同缺失路径。" +
      "Shell 中的 cd/cwd 只对该条命令生效；读它的产物须使用实际输出路径。文件尚未生成时先修复生成步骤；后台任务需确认已写完，不能假定已完成。未创建空文件，也未读取其他任务的同名文件。",
  };
}
module.exports = { missingFileResult };
