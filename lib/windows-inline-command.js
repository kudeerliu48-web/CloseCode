"use strict";
const path = require("path");

function unsupported(detail) {
  const error = new Error("Windows 多行命令未执行：" + detail + "。请先用 write_file 保存为 .py/.js/.cmd 脚本，再调用脚本；不要把多行源码直接交给 cmd /c，也不要据此继续读取未生成的文件。");
  error.code = "UNSUPPORTED_MULTILINE_COMMAND";
  return error;
}

// 解析无损直传的 argv 和白名单输出尾缀；不解释任意 shell 语法或环境变量。
// 双引号和反斜杠遵循 Windows CRT 的参数规则，Python 字符串里的单引号不当 shell 引号。
function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    if (/[ \t]/.test(src[i])) { i++; continue; }
    if (/[\r\n]/.test(src[i])) throw unsupported("引号外包含换行，cmd 可能只执行第一行");
    const op = /^(2>&1|&&|\|)/.exec(src.slice(i));
    if (op) { tokens.push({ value: op[0], operator: true, start: i, end: i + op[0].length }); i += op[0].length; continue; }
    const start = i;
    let value = "", quoted = false, multiline = false;
    while (i < src.length) {
      const c = src[i];
      if (!quoted && /[ \t&|]/.test(c)) break;
      if (!quoted && /[\r\n|<>^();]/.test(c)) throw unsupported("包含不能安全直传的 shell 语法");
      if (c === "\\") {
        let end = i;
        while (src[end] === "\\") end++;
        const n = end - i;
        if (src[end] === '"') {
          value += "\\".repeat(Math.floor(n / 2));
          if (n % 2) value += '"'; else quoted = !quoted;
          i = end + 1;
        } else { value += "\\".repeat(n); i = end; }
        continue;
      }
      if (c === '"') {
        if (quoted && src[i + 1] === '"') { value += '"'; i += 2; }
        else { quoted = !quoted; i++; }
        continue;
      }
      if (/[\r\n]/.test(c)) multiline = true;
      value += c; i++;
    }
    if (quoted) throw unsupported("双引号没有闭合");
    if (i === start) throw unsupported("包含单独的 & 等复合操作");
    tokens.push({ value, start, end: i, multiline });
  }
  return tokens;
}

/**
 * cmd /c 会在实际换行处截断，即使换行位于 python -c 的引号内。
 * 支持 [cd /d DIR &&] python/py [选项] -c "多行代码" [args]：
 * 直接 spawn 解释器 + argv（保留 -c 语义、缩进、sys.argv、cwd），不让源码经过 cmd。
 * 其他多行命令在任何进程启动前明确拒绝，绝不只执行一部分后报 0。
 */
function windowsInlinePlan(command, cwd, platform = process.platform) {
  const src = String(command).trim();
  if (platform !== "win32" || !/[\r\n]/.test(src)) return null;
  if (src.includes("\0")) throw unsupported("包含 NUL 字符");
  let tokens = tokenize(src), actualCwd = cwd;
  if (tokens[0]?.value.toLowerCase() === "cd") {
    const driveSwitch = tokens[1]?.value.toLowerCase() === "/d";
    const pos = driveSwitch ? 2 : 1, dir = tokens[pos];
    if (!dir || dir.operator || dir.multiline || !tokens[pos + 1]?.operator || tokens[pos + 1]?.value !== "&&" || /[%!]/.test(dir.value)) throw unsupported("cd 前缀必须是 cd [/d] 明确目录 &&");
    actualCwd = path.win32.resolve(cwd, dir.value);
    if (!driveSwitch && path.win32.parse(actualCwd).root.toLowerCase() !== path.win32.parse(cwd).root.toLowerCase()) throw unsupported("跨盘符 cd 请显式使用 /d");
    tokens = tokens.slice(pos + 2);
  }
  // In a non-interactive tool there is nothing to page. Support the common
  // full-output pager tail explicitly; never strip arbitrary pipes or filters.
  let mergeStderr = false, fullOutputPager = false;
  const tailAt = tokens.findIndex(t => t.operator);
  if (tailAt >= 0) {
    const tail = tokens.slice(tailAt); let pos = 0;
    if (tail[pos]?.operator && tail[pos]?.value === "2>&1") { mergeStderr = true; pos++; }
    if (tail[pos]?.operator && tail[pos]?.value === "|" && !tail[pos + 1]?.operator && /^more(?:\.com)?$/i.test(tail[pos + 1]?.value || "")) {
      fullOutputPager = true; pos += 2;
      if (tail[pos]?.value === "+0") pos++;
    }
    if (pos !== tail.length || (!mergeStderr && !fullOutputPager)) throw unsupported("多行解释器仅支持输出尾缀 2>&1 和 | more [+0]；其他过滤或复合命令请拆开执行");
    tokens = tokens.slice(0, tailAt);
  }
  if (!tokens.length) throw unsupported("缺少 Python 命令");
  const executable = path.win32.basename(tokens[0].value).toLowerCase();
  const launcher = /^py(?:\.exe)?$/.test(executable);
  if (!launcher && !/^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/.test(executable)) throw unsupported("目前仅自动兼容 Python/py 的多行 -c 参数");
  let index = 1;
  while (index < tokens.length && tokens[index].value !== "-c") {
    const flag = tokens[index].value;
    if (["-X", "-W"].includes(flag)) {
      if (!tokens[index + 1] || tokens[index + 1].value.startsWith("-")) throw unsupported("Python 选项缺少值");
      index += 2;
    } else if (/^-(?:u|B|E|I|s|S|q|v|O|OO|b|bb|d|i|P)$/.test(flag) || /^-[XW].+/.test(flag) || (launcher && /^-[23](?:\.\d+)?(?:-\d+)?$/.test(flag))) index++;
    else throw unsupported("无法确定 Python -c 前的参数含义");
  }
  const code = tokens[index + 1];
  if (!code?.multiline || tokens.some((t, i) => i !== index + 1 && t.multiline)) throw unsupported("换行必须完整位于 -c 的代码参数内");
  if (tokens.some((t, i) => i !== index + 1 && /[%!]/.test(t.value))) throw unsupported("源码以外包含需要 cmd 展开的环境变量");
  return {
    bin: tokens[0].value, args: tokens.slice(1).map(t => t.value), cwd: actualCwd,
    opts: {}, executionMode: "python-direct-argv", code: code.value, mergeStderr, fullOutputPager,
    // 安全闸还要检查原始命令；这里用规范运行时名 + 原始参数在真实 cwd 再核对一次。
    auditCommand: "python" + src.slice(tokens[0].end),
  };
}
module.exports = { windowsInlinePlan };
