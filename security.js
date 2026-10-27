"use strict";
/**
 * 安全中心 — 应用层检查（核心路径/命令/网络），不是 OS 沙箱+ 审计日志 + 命令审批 + macOS 系统授权检测。
 *
 * 设计原则：每一项都是真实闸门（在工具执行层硬拦截），不做仅展示的开关。
 * - 文件安全：除 CloseCode 安装代码与私有运行数据外，文件路径不按 workspace 边界拦截
 * - 命令安全：放行名单直接执行；询问名单挂起等用户在界面上批准（超时/停止即拒绝）
 * - 网络安全：域名黑名单拦截；白名单非空时只允许白名单域名
 * - 审计中心：网络访问/命令执行/拦截记录全部落 data/audit.json（环形 1000 条）
 */

const fs = require("fs");
const path = require("path");
const { APP_DIR, DATA_DIR, dataPath } = require("./paths");
const os = require("os");
const { spawn } = require("child_process");

const jsonStore = require("./store");

// ---------- 核心保护：不可配置的硬保护，永远拦截，不受 gateway 开关和 file_blacklist 影响 ----------

/**
 * 应用自身的核心目录。agent 能写这些等于自我改写、代码注入、钓鱼用户凭证。
 *
 * 为什么不放进 file_blacklist：那是用户可编辑的配置项，会随 config.json 冻在旧版本。
 * 这次漏洞就是因为老 config.json 覆盖了新默认值，导致补丁完全不生效。
 *
 * 这里的规则是**硬编码**的，代码更新后立即生效，不依赖配置迁移或用户干预。
 */
const CORE_DIRS = [
  "public",      // 前端资源：能改界面就能伪造审批对话框、钓鱼凭证
  "patches",     // 补丁目录：写进这里改 current.json 就是代码注入
  "scripts",     // 构建/签名脚本：含私钥处理逻辑
  "lib",         // 核心库代码
];

/**
 * 应用根目录下的关键文件（不含路径分隔符的单层文件名）。
 * agent 能改这些等于改运行时逻辑、安全策略、认证机制。
 */
const CRITICAL_FILES = [
  "server.js", "agent.js", "security.js", "tools.js", "llm.js", "mcp.js",
  "patch-loader.js", "patch-crypto.js", "patch-updater.js",
  "electron-main.js", "preload.js", "plugins.js",
  "paths.js", "store.js",
  "package.json", "package-lock.json", "electron-builder.config.js",
];

/**
 * 检查路径是否触碰应用核心代码/资源。
 * @param {string} absPath 已解析的绝对路径
 * @param {string} appDir 应用根目录（开发态 = 仓库根；装机态 = ~/CloseCode）
 * @returns {string|null} 命中原因，null = 未命中
 */
function checkCoreProtection(absPath, appDir) {
  const norm = path.normalize(absPath);
  const base = path.normalize(appDir);

  // 不在 appDir 下 → 不归此安装目录的核心保护管
  if (norm !== base && !norm.startsWith(base + path.sep)) return null;

  const rel = path.relative(base, norm).split(path.sep);

  // 保护核心目录：public/、patches/、scripts/、lib/ 整个目录树
  if (CORE_DIRS.includes(rel[0])) {
    return `核心保护：${rel[0]}/ 目录是应用关键资源，agent 不得修改`;
  }

  // 保护根层关键文件：server.js、agent.js、package.json 等
  if (rel.length === 1 && CRITICAL_FILES.includes(rel[0])) {
    return `核心保护：${rel[0]} 是应用运行时核心文件，agent 不得修改`;
  }

  return null;
}

/**
 * 开发者逃生阀：设了 CLOSECODE_ALLOW_SELF_EDIT=1 就放开核心保护。
 *
 * 走环境变量而不是配置项，是因为 agent 改不到父进程的环境变量 ——
 * 它能写 config.json 的话，任何「配置里的开关」都等于没有开关。
 * 本项目自身的开发（就是现在这种场景）需要它；普通用户永远不会设。
 */
const ALLOW_SELF_EDIT = process.env.CLOSECODE_ALLOW_SELF_EDIT === "1";

/**
 * 核心保护统一入口。APP_DIR 和 DATA_DIR 都要查：
 * 开发态两者是同一个目录；装机态代码在 APP_DIR（app.asar，只读），
 * 而 DATA_DIR 下有 patches/ 这个真能被写、写了就被当代码加载的目录。
 */
function coreProtectionReason(absPath) {
  if (ALLOW_SELF_EDIT) return null;
  const scope = require("./lib/workspace-scope");
  const roots = [APP_DIR, DATA_DIR, path.join(os.homedir(), "CloseCode")];
  for (const root of roots) {
    // 同时比较词法与真实路径，保护安装位置、数据位置和旧的默认数据位置。
    for (const [p, base] of [[path.resolve(absPath), path.resolve(root)], [scope.realPath(absPath), scope.realPath(root)]]) {
      const rel = path.relative(base, p);
      if (rel === "") return "核心保护：应用根目录不可直接访问，请指定非敏感工作目录";
      if (path.isAbsolute(rel) || rel === ".." || rel.startsWith(".." + path.sep)) continue;
      const parts = rel.split(path.sep), first = parts[0];
      const secret = ["data", "backups", "plugins", ".git", "node_modules", ".claude"].includes(first) ||
        (parts.length === 1 && (/^(?:config(?:\..*)?\.json|\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|js|cjs|mjs))$/i.test(first) || /(?:secret|credential|token|signing-key)/i.test(first)));
      if (secret) return "核心保护：应用机密或可执行资源不可访问";
      const reason = checkCoreProtection(p, base);
      if (reason) return reason;
    }
  }
  return null;
}

const AUDIT_FILE = dataPath("data", "audit.json");
let auditLog = jsonStore.readJson(AUDIT_FILE, []);
if (!Array.isArray(auditLog)) auditLog = [];

/**
 * 权限模式：一档一档地决定"要不要问你"。
 *
 * 以前只有一套写死的规则（工作目录内随便写、命令按名单问），结果两头不讨好：
 * 想让它安心改代码的人嫌它烦，想全程盯着的人又觉得它太自由。
 * 现在把这件事变成一个明确的档位，改档立即生效，界面上一眼看得见自己在第几档。
 *
 * 普通目录不需要目录授权，旧文件黑白名单不参与判定。
 * CloseCode 安装代码与私有数据核心保护不受权限档位影响。
 */
const PERMISSION_MODES = {
  plan: { label: "只看不动", desc: "只读：不写文件、不跑命令，适合先让它把现场看明白", write: "deny", cmd: "deny" },
  ask: { label: "每步都问", desc: "写文件和跑命令都要你点头，最谨慎也最费手", write: "ask", cmd: "ask" },
  auto: { label: "自动改文件", desc: "普通目录文件可改；命令按名单来（删除、sudo 这些照样问）", write: "allow", cmd: "rules" },
  full: { label: "全自动", desc: "命令也不问了，保留核心保护、高危命令确认（rm -rf 到 /dev、down -v、强推这类）和审计。确定它在干什么再开", write: "allow", cmd: "allow" },
};
const DEFAULT_MODE = "auto";

function permissionMode(sec) {
  const m = String((sec || {}).permission_mode || DEFAULT_MODE);
  return PERMISSION_MODES[m] ? m : DEFAULT_MODE;
}

const DEFAULTS = {
  permission_mode: DEFAULT_MODE, // plan / ask / auto / full，见 PERMISSION_MODES
  gateway: true, // 网络名单与部分命令检查开关；核心保护、权限档位和审计不受影响
  delete_protect: true, // 删除保护：rm 类命令需要审批
  batch_delete_threshold: 50,
  // 仅保留旧配置字段兼容性；文件黑白名单不再参与路径、命令或代码判定。
  file_whitelist: [],
  file_blacklist: [],
  cmd_allow: [], // 命令前缀放行名单：匹配即直接执行
  cmd_ask: ["sudo ", "shutdown", "reboot", "mkfs", "diskutil erase", "killall ", "format "],
  url_whitelist: [], // 非空 = 只允许这些域名（后缀匹配）
  url_blacklist: [],
  runtime_node: true,
  runtime_python: true,
  approval_timeout_s: 120, // 审批等待上限（秒），超时按拒绝处理
};

/** 给 config.security 补默认值（保留用户已改项），返回引用 */
function getSecurity(config) {
  config.security = { ...DEFAULTS, ...(config.security || {}) };
  return config.security;
}

// ---------- 审计 ----------

let auditDirty = false;
function audit(type, text, action) {
  auditLog.push({ ts: new Date().toISOString(), type, text: String(text || "").slice(0, 300), action: action || "放行" });
  if (auditLog.length > 1000) auditLog.splice(0, auditLog.length - 1000);
  if (!auditDirty) {
    auditDirty = true;
    setTimeout(() => {
      auditDirty = false;
      try {
        // 审计是出事之后唯一的凭证：宁可写慢一点，也不能让断电把它截成半个 JSON
        jsonStore.writeJsonAtomic(AUDIT_FILE, auditLog, { backup: false });
      } catch {}
    }, 500);
  }
}
function auditList(limit) {
  return auditLog.slice(-(limit || 100)).reverse();
}
function auditClear() {
  auditLog = [];
  try {
    fs.writeFileSync(AUDIT_FILE, "[]", "utf8");
  } catch {}
}
function auditExport() {
  return auditLog.map((e) => `${e.ts}\t[${e.type}]\t${e.action}\t${e.text}`).join("\n");
}

// ---------- 文件安全 ----------

function expandPath(s) {
  return path.resolve(String(s).replace(/^~(?=$|\/)/, os.homedir()).replace(/^<app>/, DATA_DIR));
}
function underPrefix(p, prefix) {
  return p === prefix || p.startsWith(prefix + path.sep);
}

/**
 * 按文件安全策略解析路径。除 CloseCode 安装代码与私有运行数据外，普通路径不受 workspace 边界、旧文件名单或目录授权限制。
 */
function resolvePathWithPolicy(sec, rel, workspaceDir, base, context = {}) {
  // base：本次任务的成果子目录（默认工作空间按对话分文件夹）；相对路径仍以项目为基准
  const p = path.resolve(base || workspaceDir, String(rel || ".").replace(/\\/g, "/"));
  const scope = require("./lib/workspace-scope");
  let real;
  try { real = scope.realPath(p); }
  catch (e) { return { path: p, allowed: false, reason: "无法安全解析真实路径：" + e.message }; }
  // 核心保护排最前，且不看 sec.gateway：应用自己的代码和前端资源，
  // 不管网关开关、不管权限档位、不管用户怎么配黑名单，一律拦。
  const core = coreProtectionReason(p) || coreProtectionReason(real);
  if (core) return { path: p, allowed: false, reason: core };
  if (context.stopSignal?.aborted) return { path: p, allowed: false, reason: "任务已停止" };
  // 目录访问与会话归属分离；旧文件名单和目录授权不再决定访问权限。
  return { path: p, allowed: true, outside: !scope.contains(workspaceDir, p) };
}

// ---------- 命令安全 ----------

/** 只是包在真命令外面的东西，判断「这段到底在跑什么」时要先剥掉 */
const WRAPPERS = new Set(["nohup", "command", "builtin", "exec", "env", "time", "nice", "ionice", "xargs", "then", "else", "do", "{", "("]);
/** 会真的把文件弄没的命令 */
const DELETE_CMDS = new Set(["rm", "rmdir", "srm", "unlink", "shred", "del", "erase", "rd"]);

// P5 软护栏：不可逆、毁数据的命令形态。任何权限档位（含全自动）都要用户点头，
// 永久放行名单也盖不住——这不是沙箱，只是把「一条命令毁掉一晚上工作」换成一次审批。
// 批过一次的（「以后别再问这类」）按 danger:key 记在本会话里，不会反复骚扰。
const DANGER_PATTERNS = [
  { key: "dev-write", re: /(?:^|\s)>{1,2}\s*\/dev\/(?!null\b|stdout\b|stderr\b|tty\b|zero\b|fd\/)/i, rule: "重定向直写设备文件（> /dev/…）" },
  { key: "dd-dev", re: /\bdd\b[^\n]*\bof=\/dev\//i, rule: "dd 直写设备（of=/dev/…）" },
  { key: "compose-down-v", re: /\bdocker(?:-|\s+)compose\b[^\n]*\bdown\b[^\n]*(?:\s-\w*v|\s--volumes\b)/i, rule: "compose down 带 -v 会把数据卷一起删掉" },
  { key: "git-force-push", re: /\bgit\b[^\n]*\bpush\b[^\n]*(?:\s--force\b|\s-f\b)/i, rule: "git 强推会改写远端历史" },
  { key: "sql-drop", re: /\b(?:drop\s+(?:table|database|schema)|truncate\s+table)\b/i, rule: "SQL 删库/删表/清表" },
  { key: "mkfs-disk", re: /\b(?:mkfs|diskutil\s+(?:erase\w*|partitiondisk)|fdisk)\b/i, rule: "磁盘格式化/分区" },
];
const SUB_DEPTH_MAX = 4;

/**
 * 把一条命令拆成一段段真正会被执行的东西。
 *
 * 除了 `;` `&&` `||` `|` `&`，还有两件事以前是漏的，而且都能一句话废掉整个命令闸：
 *   - **换行**：agent 写的是多行脚本，`echo hi\nrm -rf ~/x` 以前算一整段，开头是 echo，删除保护看都看不见；
 *   - **`$(...)` 和反引号**：`echo $(rm -rf ~/x)` 同理，得把括号里的东西挖出来单独算一段。
 * 引号里的分隔符不算分隔符（`grep "a|b"` 不该被拆开），但双引号里的 `$()` 照样会执行，所以照挖。
 */
function splitSegments(command, out = [], depth = 0) {
  const src = String(command || "");
  let cur = "";
  let quote = null;
  const push = () => {
    const s = cur.trim();
    if (s) out.push(s);
    cur = "";
  };
  /** 吃掉一段替换（$(...) 或 `...`），把里面的内容当独立命令继续拆，返回结束位置 */
  const grab = (i, open, close) => {
    let d = 1;
    let j = i;
    let inner = "";
    for (; j < src.length && d > 0; j++) {
      const ch = src[j];
      if (ch === "\\") { inner += ch + (src[j + 1] || ""); j++; continue; }
      if (ch === open && open !== close) d++;
      else if (ch === close) { d--; if (!d) break; }
      inner += ch;
    }
    if (depth < SUB_DEPTH_MAX) splitSegments(inner, out, depth + 1);
    else if (inner.trim()) out.push(inner.trim());
    return j;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\" && quote !== "'") { cur += c + (src[i + 1] || ""); i++; continue; }
    if (quote) {
      if (c === quote) { quote = null; cur += c; continue; }
      if (quote === '"' && c === "$" && src[i + 1] === "(") { i = grab(i + 2, "(", ")"); continue; }
      if (quote === '"' && c === "`") { i = grab(i + 1, "`", "`"); continue; }
      cur += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === "$" && src[i + 1] === "(") { i = grab(i + 2, "(", ")"); continue; }
    if (c === "`") { i = grab(i + 1, "`", "`"); continue; }
    // 子 shell 和进程替换：( rm -x )、diff <(rm -x)
    if (c === ";" || c === "\n" || c === "|" || c === "&" || c === "(" || c === ")") { push(); continue; }
    cur += c;
  }
  push();
  return out;
}

/** 去掉开头的环境变量赋值：`FOO=1 rm -rf x` 里那个 rm 也得算数 */
function stripEnvAssign(seg) {
  return seg.replace(/^(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, "");
}
/** 剥到真正在跑的那条命令：包装词去掉、`/bin/rm` 还原成 `rm` */
function bareCommand(seg) {
  let s = stripEnvAssign(seg).trim();
  for (let i = 0; i < 5; i++) {
    const tok = s.split(/\s+/)[0] || "";
    if (!WRAPPERS.has(tok)) break;
    s = s.slice(tok.length).trim();
  }
  const tok = s.split(/\s+/)[0] || "";
  return tok.includes("/") ? path.basename(tok) + s.slice(tok.length) : s;
}

/** 一条黑名单路径在命令行里可能长什么样 */
function pathNeedles(entry) {
  const raw = String(entry).trim();
  if (!raw) return [];
  const abs = expandPath(raw);
  const out = [raw.toLowerCase(), abs.toLowerCase()];

  // Windows 路径的两种写法：F:\a\b 和 F:/a/b 都要认
  if (path.sep === "\\") out.push(abs.replace(/\\/g, "/").toLowerCase());

  const tail = raw.replace(/^~|^<app>/, "");
  // `~/.ssh` 写成 `$HOME/.ssh` 也要认出来；但 `/config.json` 这种太泛的尾巴不认，免得天天弹审批
  const parts = tail.split(/[/\\]/).filter(Boolean);
  if (tail.startsWith("/") && (parts.length > 1 || (parts[0] || "").startsWith("."))) {
    out.push(tail.toLowerCase());
    if (path.sep === "\\") out.push(tail.replace(/\\/g, "/").toLowerCase());
  }
  return out;
}

/**
 * 从命令段里挖出「看起来像路径」的 token，逐个按核心保护判定。
 *
 * 为什么不用文本模式匹配：补不完。`../public/x`、`F:/…/public/x`、`F:\…\public\x`
 * 是同一个文件的三种写法，再加上引号、拼接、cd 之后的相对路径，穷举必漏。
 * 挖 token 再 path.resolve 一次，三种写法归一到同一个绝对路径上，一次判定全覆盖。
 *
 * cwd 参数很关键：`cd ../public && echo x > app.js` 里那个裸 app.js，
 * 只有知道当前目录换过了才判得出来。调用方按段推进 cwd。
 */
function corePathHitInSegment(seg, cwd) {
  // 去掉重定向符、引号，按空白和 = 切开；只留含路径特征或已知危险裸名的 token
  const cleaned = String(seg || "").replace(/[<>|]+/g, " ").replace(/['"]/g, "");
  for (const tok of cleaned.split(/[\s=]+/)) {
    if (!tok || tok.startsWith("-")) continue; // 跳过选项开关
    const looksPath = /[/\\]/.test(tok) || CRITICAL_FILES.includes(tok) || CORE_DIRS.includes(tok);
    if (!looksPath) continue;
    let abs;
    try {
      abs = path.resolve(cwd, tok.replace(/\\/g, "/"));
    } catch {
      continue;
    }
    const reason = coreProtectionReason(abs);
    if (reason) return reason;
  }
  return null;
}

/** `cd xxx` / `cd ..`：命令闸要跟着走，否则切过目录后的裸文件名就判不出来了 */
function cdTarget(seg, cwd) {
  const m = String(seg || "").trim().match(/^cd\s+(?:-{1,2}\S+\s+)*(.+)$/);
  if (!m) return null;
  const arg = m[1].trim().replace(/['"]/g, "").split(/\s+/)[0];
  if (!arg || arg === "-") return null;
  try {
    return path.resolve(cwd, arg.replace(/\\/g, "/"));
  } catch {
    return null;
  }
}

/**
 * 「本会话一直允许」记在这儿。
 *
 * 治的是最招人烦的那件事：同一条 `git status` 连着问你八遍。批一次就把这条规则记下来，
 * 这次进程活着的期间不再问。**只在内存里**——重启就没了，不会悄悄在配置里长出一条你早忘了的放行规则。
 * 要永久放行是另一个按钮（写进 cmd_allow，看得见、删得掉）。
 */
const sessionAllow = new Set();
function addSessionAllow(rule) {
  const r = String(rule || "").trim();
  if (r) sessionAllow.add(r);
  return [...sessionAllow];
}
function listSessionAllow() {
  return [...sessionAllow];
}
function clearSessionAllow() {
  sessionAllow.clear();
}

/** 多子命令的工具，规则粒度取到第二个词：放行 `git status` 不等于放行 `git push --force` */
const SUBCMD_TOOLS = new Set(["git", "npm", "pnpm", "yarn", "npx", "docker", "kubectl", "pm2", "brew", "cargo", "go", "pip", "pip3", "python", "python3", "node", "gh", "systemctl", "ffmpeg"]);

/**
 * 从一段命令里推出一条「以后遇到这类就别问了」的规则。
 * 粒度太粗会把危险的一起放过去（放行 `git` 等于放行 `git push -f`），
 * 太细又等于没记（带具体文件名的规则下次必然不命中）。取「命令 + 子命令」是这两者之间。
 */
function ruleFor(text) {
  const seg = splitSegments(String(text || ""))[0] || String(text || "");
  const bare = bareCommand(seg).trim();
  const parts = bare.split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (SUBCMD_TOOLS.has(parts[0]) && parts[1] && !parts[1].startsWith("-")) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

function matchesPrefix(list, seg, env, bare) {
  return (list || []).some((p) => {
    const q = String(p || "").trim();
    return q && (seg.startsWith(q) || env.startsWith(q) || bare.startsWith(q));
  });
}

/**
 * 写文件闸。按权限模式决定：只看不动 → 拒；每步都问 → 问；自动/全自动 → 直接写。
 * 路径核心保护由 resolvePathWithPolicy 检查；普通外部目录无需授权，两者都要过。
 */
function checkWrite(sec, relPath) {
  const mode = permissionMode(sec);
  const m = PERMISSION_MODES[mode];
  if (m.write === "deny") return { action: "deny", rule: `当前权限档位是「${m.label}」，不写文件`, seg: String(relPath || "") };
  if (m.write === "ask") {
    const rule = `写文件 ${String(relPath || "")}`;
    if (sessionAllow.has("write:*")) return { action: "allow" };
    return { action: "ask", rule, seg: String(relPath || ""), ruleKey: "write:*" };
  }
  return { action: "allow" };
}

/**
 * 命令闸。返回 allow / ask / deny（附命中的规则）。
 * 核心保护优先于命令放行名单；旧文件名单不参与判定。
 * 只看不动禁止命令；高危命令仍按原有审批规则处理。
 */
function checkCommand(sec, command, cwd) {
  const segs = splitSegments(command);
  const mode = permissionMode(sec);
  // 核心保护跟着 cd 走；调用方没给起点就用进程 cwd（工具层都会传 workspace）
  let cur = cwd ? path.resolve(cwd) : process.cwd();
  for (const seg of segs) {
    // 核心保护排在所有名单之前，且不看 gateway / 权限档位：改应用自身一律 deny，不是 ask。
    // 这里没有「问一下用户」的余地——伪造出来的审批框长得跟真的一样。
    const coreHit = corePathHitInSegment(seg, cur);
    if (coreHit) return { action: "deny", rule: coreHit, seg };
    const moved = cdTarget(seg, cur);
    if (moved) cur = moved;
    const low = seg.toLowerCase();
    const env = stripEnvAssign(seg);
    const bare = bareCommand(seg);
    const tok = bare.split(/\s+/)[0] || "";
    if (mode === "plan") return { action: "deny", rule: `当前权限档位是「${PERMISSION_MODES.plan.label}」，不跑命令`, seg };
    if (sec.gateway) {
      // 高危表在放行名单之前查：cmd_allow 是给日常命令省事的，不该顺手把毁数据的形态一起放过去
      const danger = DANGER_PATTERNS.find((d) => d.re.test(seg) && !sessionAllow.has("danger:" + d.key));
      if (danger) return { action: "ask", rule: `高危命令：${danger.rule}`, seg, ruleKey: "danger:" + danger.key };
    }
    if (matchesPrefix(sec.cmd_allow, seg, env, bare)) continue; // 永久放行名单
    if (matchesPrefix([...sessionAllow], seg, env, bare)) continue; // 本会话已经批过同类
    // 运行时开关是用户明确关掉的东西，不受权限档位影响：全自动也不代表把关掉的运行时打开
    if (!sec.runtime_python && /^(python3?|pip3?)$/.test(tok)) {
      return { action: "deny", rule: "内置运行时 Python 已停用", seg };
    }
    if (mode === "full") continue; // 全自动：名单之外的也不问了
    if (mode === "ask") return { action: "ask", rule: `每步都问模式`, seg, ruleKey: ruleFor(seg) };
    const hitAsk = (sec.cmd_ask || []).find((p) => p && (seg.startsWith(p.trim()) || env.startsWith(p.trim()) || bare.startsWith(p.trim())));
    if (hitAsk) return { action: "ask", rule: `命令询问名单「${hitAsk.trim()}」`, seg, ruleKey: ruleFor(seg) };
    if (sec.delete_protect) {
      const findDeletes = tok === "find" && /(\s-delete\b|-exec\s+(\S*\/)?rm\b)/.test(bare);
      if (DELETE_CMDS.has(tok) || findDeletes) return { action: "ask", rule: "删除保护（rm 类命令需审批）", seg, ruleKey: ruleFor(seg) };
    }
  }
  return { action: "allow" };
}

/**
 * 代码闸（run_node / 未来的其它运行时）。
 *
 * 命令闸拦得再严，一句 `require("child_process").execSync("rm -rf ~")` 就全绕过去了——
 * 代码是从同一个 agent 嘴里出来的，不能只看 run_shell 那扇门。
 * 这里不做沙箱（做不到），只做一件事：代码要开子进程就按权限档位询问。
 * CloseCode 核心保护仍会拒绝访问；普通路径和旧文件名单不在这里拦截。
 */
function checkCode(sec, code, cwd) {
  const src = String(code || "");
  const mode = permissionMode(sec);
  if (mode === "plan") return { action: "deny", rule: `当前权限档位是「${PERMISSION_MODES.plan.label}」，不执行代码`, seg: "" };
  // 核心保护：挖出所有路径 token，按起始 cwd 解析后判定
  const cur = cwd ? path.resolve(cwd) : process.cwd();
  // 从代码里提取「看起来像路径」的字面量：字符串、模板字符串、注释里的不算
  const tokens = src.match(/(?:["'`])([^"'`\n]{2,})(?:["'`])/g) || [];
  for (const tok of tokens) {
    const clean = tok.slice(1, -1).replace(/\\\\/g, "/");
    if (!/[/\\]/.test(clean) && !CRITICAL_FILES.includes(clean) && !CORE_DIRS.includes(clean)) continue;
    let abs;
    try {
      abs = path.resolve(cur, clean);
    } catch {
      continue;
    }
    const reason = coreProtectionReason(abs);
    if (reason) return { action: "deny", rule: reason, seg: clean };
  }
  if (!sec.gateway) return { action: "allow" };
  if (mode === "full") return { action: "allow" };
  const shellOut = /child_process|execSync|execFileSync|spawnSync|process\.binding|node:child_process/.exec(src);
  if (shellOut) {
    if (sessionAllow.has("code:child_process")) return { action: "allow" };
    return { action: "ask", rule: "代码里要开子进程（等于绕过命令闸）", seg: shellOut[0], ruleKey: "code:child_process" };
  }
  if (mode === "ask") {
    if (sessionAllow.has("code:*")) return { action: "allow" };
    return { action: "ask", rule: "每步都问模式", seg: src.slice(0, 80), ruleKey: "code:*" };
  }
  return { action: "allow" };
}

// ---------- 网络安全 ----------

function checkUrl(sec, url) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { allowed: false, reason: "URL 无法解析" };
  }
  const hit = (list) => (list || []).some((d) => {
    const dom = String(d).trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    return dom && (host === dom || host.endsWith("." + dom));
  });
  if (!sec.gateway) return { allowed: true };
  if (hit(sec.url_blacklist)) return { allowed: false, reason: `域名在网络黑名单内（${host}）` };
  if ((sec.url_whitelist || []).filter((s) => String(s).trim()).length && !hit(sec.url_whitelist)) {
    return { allowed: false, reason: `网络白名单已启用，${host} 不在名单内` };
  }
  return { allowed: true };
}

// ---------- 命令审批（挂起等待界面批准） ----------

const approvals = new Map(); // id -> { id, kind, text, ts, resolve }
const directoryTasks = new Map();
const directoryGrants = new Map(); // 仅内存；不写 config、sessionAllow 或磁盘

function approvalUser(user) {
  const name = typeof user === "string" ? user : user?.username;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
function taskKey(user, taskId) {
  const owner = approvalUser(user);
  return owner && taskId != null ? JSON.stringify([owner, String(taskId)]) : null;
}
function beginDirectoryTask(user, taskId, stopSignal) {
  const key = taskKey(user, taskId);
  if (!key || stopSignal?.aborted || directoryTasks.has(key)) return false;
  const onAbort = () => endDirectoryTask(user, taskId);
  directoryTasks.set(key, { stopSignal, onAbort });
  stopSignal?.addEventListener("abort", onAbort, { once: true });
  return true;
}
function endDirectoryTask(user, taskId) {
  const key = taskKey(user, taskId), task = directoryTasks.get(key);
  directoryTasks.delete(key); // 先注销，防止等待中的审批恢复后重新授权
  task?.stopSignal?.removeEventListener("abort", task.onAbort);
  for (const [id, g] of directoryGrants) if (g.taskKey === key) directoryGrants.delete(id);
  for (const a of approvals.values()) if (a.taskKey === key && key) a.resolve(false);
}
function hasDirectoryGrant(user, taskId, target, access) {
  const key = taskKey(user, taskId);
  if (!key || !directoryTasks.has(key)) return false;
  const scope = require("./lib/workspace-scope");
  return [...directoryGrants.values()].some(g => g.taskKey === key &&
    (g.access === access || (g.access === "write" && access === "read")) &&
    scope.realPath(g.path) === g.path && scope.contains(g.path, target));
}
function listDirectoryGrants(user) {
  const owner = approvalUser(user);
  return [...directoryGrants.values()].filter(g => owner && g.owner === owner)
    .map(({ id, path, access, source, taskId }) => ({ id, path, access, source, taskId }));
}
function revokeDirectoryGrant(id, user) {
  const g = directoryGrants.get(id);
  if (!g || !approvalUser(user) || g.owner !== approvalUser(user)) return false;
  return directoryGrants.delete(id);
}
async function authorizeDirectoryPath(sec, rel, workspace, base, context = {}) {
  let result = resolvePathWithPolicy(sec, rel, workspace, base, context);
  if (result.allowed || !result.needsApproval) return result;
  const key = taskKey(context.user, context.runToken);
  if (!key || !directoryTasks.has(key) || context.stopSignal?.aborted) return { ...result, needsApproval: false, reason: "没有有效的所属用户任务，不能申请外部目录授权" };
  const access = context.access === "write" ? "write" : "read";
  if (access === "write" && checkWrite(sec, rel).action === "deny") return { ...result, needsApproval: false, reason: "当前为只读模式" };
  // 只对调用方明确提供的路径申请，不替根目录回退、递归子项或诊断扫描弹窗。
  const target = require("./lib/workspace-scope").realPath(result.path);
  let isDirectory = !!context.isDirectory;
  if (!isDirectory) {
    try { isDirectory = fs.statSync(target).isDirectory(); }
    catch (error) { if (error.code !== "ENOENT") return { ...result, needsApproval: false, reason: "无法确定授权路径类型" }; }
  }
  const directory = { path: isDirectory ? target : path.dirname(target), access, taskId: String(context.runToken) };
  const protectedReason = coreProtectionReason(directory.path);
  if (protectedReason) return { ...result, needsApproval: false, reason: protectedReason };
  const ok = await requestApproval("目录访问", directory.path, {
    ...context, directory, rule: access === "write" ? "本任务写入" : "本任务只读", ruleKey: "",
  });
  if (!ok) return { ...result, needsApproval: false, reason: "目录授权已拒绝、超时或任务结束；未访问文件" };
  result = resolvePathWithPolicy(sec, rel, workspace, base, context);
  return result; // 批准之后再次检查硬保护、撤销、任务状态和符号链接
}

function requestApproval(kind, text, { timeoutMs = 120000, stopSignal, rule = "", ruleKey = "", source = "", user, runToken, directory } = {}) {
  const owner = approvalUser(user);
  const key = taskKey(user, directory?.taskId ?? runToken);
  if (stopSignal?.aborted) return Promise.resolve(false);
  if (directory && (!owner || !directoryTasks.has(key) || !["read", "write"].includes(directory.access) || !path.isAbsolute(directory.path) || coreProtectionReason(directory.path))) return Promise.resolve(false);
  const id = "ap_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      approvals.delete(id);
      if (stopSignal) stopSignal.removeEventListener("abort", onAbort);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), Math.max(5000, timeoutMs));
    const onAbort = () => finish(false);
    if (stopSignal) stopSignal.addEventListener("abort", onAbort);
    approvals.set(id, {
      id,
      kind,
      owner,
      taskKey: key,
      ...(directory ? { directory: { path: require("./lib/workspace-scope").realPath(directory.path), access: directory.access, taskId: String(directory.taskId) } } : {}),
      text: String(text || "").slice(0, 500),
      rule: String(rule || ""),
      // 「以后别再问这类」批的是这条规则；空字符串表示这次的原因不适合记住
      ruleKey: String(ruleKey || ""),
      source: String(source || "").slice(0, 60), // 发起审批的任务标题：多任务并行时用户得知道是谁在求批
      ts: new Date().toISOString(),
      resolve: finish,
    });
  });
}
function listApprovals(user) {
  const owner = approvalUser(user);
  return [...approvals.values()].filter(a => owner && a.owner === owner)
    .map(({ id, kind, text, rule, ruleKey, source, ts, directory }) => ({ id, kind, text, rule, ruleKey, source, ts, ...(directory ? { directory } : {}) }));
}
/**
 * @param scope once（默认，只放这一次）/ session（本会话同类不再问）/ always（由调用方写进永久放行名单）
 * @returns { ok, ruleKey, scope } —— always 的持久化在 server 那边做，配置文件归它管
 */
function resolveApproval(id, allow, scope = "once", user) {
  const e = approvals.get(id), owner = approvalUser(user);
  if (!e || !owner || e.owner !== owner) return { ok: false, error: "审批不存在", status: 404 };
  if (!["once", "session", "always"].includes(scope) || (e.directory && scope !== "once")) return { ok: false, error: "目录授权仅支持 once（本任务）", status: 400 };
  if (e.directory) {
    if (!directoryTasks.has(e.taskKey) || coreProtectionReason(e.directory.path)) { e.resolve(false); return { ok: false, status: 409, error: "任务已结束或路径受保护" }; }
    if (allow) {
      const id = "dg_" + require("crypto").randomUUID();
      directoryGrants.set(id, { id, ...e.directory, owner, taskKey: e.taskKey, source: e.source });
    }
    e.resolve(!!allow);
    return { ok: true, scope: "once", directory: e.directory };
  }
  const key = e.ruleKey;
  if (allow && key && (scope === "session" || scope === "always")) addSessionAllow(key);
  e.resolve(!!allow);
  return { ok: true, ruleKey: key, scope };
}

// ---------- macOS 系统授权 ----------

/** 完全磁盘访问：能读 TCC.db 即已授权（这是 FDA 的标准探针） */
function checkFullDisk() {
  if (process.platform !== "darwin") return "unknown";
  try {
    const fd = fs.openSync(path.join(os.homedir(), "Library/Application Support/com.apple.TCC/TCC.db"), "r");
    fs.closeSync(fd);
    return "granted";
  } catch (e) {
    return e.code === "EPERM" || e.code === "EACCES" ? "denied" : "unknown";
  }
}

/** 辅助功能：仅桌面版（Electron 主进程）能查询 */
function checkAccessibility() {
  if (process.platform !== "darwin") return "unknown";
  try {
    const { systemPreferences } = require("electron");
    return systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

/** 自动化（Apple Events）：主动探测会触发系统授权弹窗，所以只在用户点「检测/授权」时调用 */
function checkAutomation() {
  if (process.platform !== "darwin") return Promise.resolve("unknown");
  return new Promise((resolve) => {
    const c = spawn("osascript", ["-e", 'tell application "System Events" to count processes'], { timeout: 8000 });
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve(code === 0 ? "granted" : /1743|not allowed|不允许/.test(err) ? "denied" : "unknown"));
    c.on("error", () => resolve("unknown"));
  });
}

const PREF_PANES = {
  fulldisk: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
};
function openPrefPane(pane) {
  const url = PREF_PANES[pane];
  if (!url || process.platform !== "darwin") return false;
  spawn("open", [url], { detached: true }).unref();
  return true;
}

module.exports = {
  getSecurity,
  DEFAULTS,
  audit,
  auditList,
  auditClear,
  auditExport,
  resolvePathWithPolicy,
  approvalUser,
  beginDirectoryTask,
  endDirectoryTask,
  authorizeDirectoryPath,
  listDirectoryGrants,
  revokeDirectoryGrant,
  PERMISSION_MODES,
  permissionMode,
  checkWrite,
  checkCommand,
  checkCode,
  ruleFor,
  addSessionAllow,
  listSessionAllow,
  clearSessionAllow,
  splitSegments, // 给测试用：命令拆段是整个命令闸的地基，得能单独验
  // 核心保护：不可配置的硬保护，导出供测试与「为什么被拦」的界面提示用
  CORE_DIRS,
  CRITICAL_FILES,
  coreProtectionReason,
  checkUrl,
  requestApproval,
  listApprovals,
  resolveApproval,
  checkFullDisk,
  checkAccessibility,
  checkAutomation,
  openPrefPane,
};
