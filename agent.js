"use strict";
/**
 * Agent 核心运行时 — 被 Web 界面、IM 接入、专家委派共同复用。
 * 主 Agent 是"协调者"：可直接干活，也可通过 delegate_to_expert 把子任务委派给专家子智能体。
 */

const { TOOL_DEFS, executeTool, outputFiles, getWorkspaceDir, safePath } = require("./tools");
const { loadSkills, resolveSkill } = require("./skills");
const { selectDelegation, membersOf, delegationBrief, resolveExpert } = require("./lib/expert-routing");
const awake = require("./awake"); // 睡眠治理：任务期间防睡 + 睡了顺延时限
const { isContextOverflowError } = require("./llm"); // 上下文撞上模型硬上限的识别（抢救式压缩靠它判断）

const DELEGATE_TOOL = {
  name: "delegate_to_expert",
  description:
    "把一个子任务委派给专家团中的一位专家（子智能体）执行，返回该专家的完成汇报。专家与你共享同一个工作目录，它生成的文件你可以直接使用。适合把大任务拆成调研、分析、写作、做PPT等阶段分别委派。",
  input_schema: {
    type: "object",
    properties: {
      expert: { type: "string", description: "专家正式名称，必须从 enum 选择；花名只用于展示，不要拼到名称后面" },
      task: {
        type: "string",
        description: "子任务描述。要自包含：写清目标、输入（如已有文件名）、期望产出（如文件名）。",
      },
    },
    required: ["expert", "task"],
  },
};

const DELEGATE_TEAM_TOOL = {
  name: "delegate_to_team",
  description:
    "把一个完整任务交给一个专家团（智能体团队）。团里的专家会按名单顺序接力：每位都能看到前面同事的汇报和产出文件，做完交给下一位，最后返回全队的汇报汇总。适合一句话就要走完「调研→分析→成稿→做PPT」整条流水线的任务；只需要一个环节时用 delegate_to_expert 更省时间。",
  input_schema: {
    type: "object",
    properties: {
      team: { type: "string", description: "专家团名称，必须是专家团列表中的一个" },
      task: {
        type: "string",
        description: "交给整个团的任务描述。要自包含：目标、已有输入（文件名）、最终期望交付物。团里每位专家都会看到这段原文。",
      },
    },
    required: ["team", "task"],
  },
};

const ASK_USER_TOOL = {
  name: "ask_user",
  description:
    "向用户提一个关键问题并等待回答（前端会弹出选项卡片，用户点选或输入后你才继续，等待时间不算任务时长）。两类时机要主动用：①开工前——需求含糊到可能白干一场，或风格/范围/平台/受众/篇幅这类选择会让交付物完全不同（典型：封面图是 AI 生图还是 HTML 排版截图、报告交 Word 还是 PDF 还是飞书文档、视频出横版还是竖版），先问一题再动手，比做完返工强；②执行中——要花钱、不可逆动作、覆盖/删除已有内容、对外发布，或只有用户本人知道的偏好（预算/口味/时间安排）。纯技术细节自己定，别拿它当聊天；一次只问一个问题，给 2~4 个具体可点的选项。用户可能不在电脑前：超时没人答就按你认为最合理的默认继续，并在汇报里注明。",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string", description: "要问的问题，一句话说清，别夹多个问题" },
      options: {
        type: "array",
        description: "2~4 个选项。用户也可以两个都不选、自己输入",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "选项本身，一个短语，20 字以内" },
            detail: { type: "string", description: "选了它会得到什么、代价是什么，一句话。用户就是靠这句做判断的，不许省，也不许只是把 label 换个说法重说一遍" },
          },
          required: ["label", "detail"],
        },
      },
    },
    required: ["question", "options"],
  },
};

const FEISHU_DOC_TOOL = {
  name: "feishu_doc_create",
  description:
    "把 Markdown 内容创建成一篇飞书云文档，直接交付到用户的飞书（复用已配置的飞书机器人凭证）。支持表格（markdown 表格语法）和图片：独占一行的 ![说明](工作目录里的文件或URL) 会真插成文档里的图（SVG 自动转 PNG）——先用 gen_diagram 画图再引用，报告即图文并茂。成功返回文档链接。若因权限不足失败：先把返回的开通指引和链接告诉用户，然后立刻带 wait_for_permission:true 重调本工具——它会自动轮询等用户开通，权限一生效就建好文档继续任务，用户不用回来喊你。",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "文档标题" },
      markdown: {
        type: "string",
        description:
          "文档正文 Markdown。支持标题、列表、引用、代码块、**加粗**、`行内代码`、表格（|a|b|），以及独占一行的图片 ![说明](路径或URL)。",
      },
      wait_for_permission: {
        type: "boolean",
        description: "权限不足时轮询等待用户开通（每 20 秒重试，最多约 10 分钟），开通即自动创建。只在第一次因权限失败、且已把开通指引告诉用户之后用。",
      },
    },
    required: ["title", "markdown"],
  },
};

const USE_SKILL_TOOL = {
  name: "use_skill",
  description: "加载一个技能包的完整内容（操作指南与代码模板）。执行对应类型任务前先加载相关技能。",
  input_schema: {
    type: "object",
    properties: { name: { type: "string", description: "技能名称" } },
    required: ["name"],
  },
};

const fs = require("fs");
const path = require("path");
const { dataPath } = require("./paths");
const { writeJsonAtomicAsync } = require("./store");
const os = require("os");
const memory = require("./memory");

// ================= 成果核验（治「幻觉执行」） =================
// 模型有时在文本里"表演"跑命令并声称文件已生成，实际一个工具都没调。
// 收尾前核对它声称的产物是否真在磁盘上，不在就打回去要求真实执行。
const CLAIM_RE = /(生成成功|导出成功|保存成功|创建成功|已生成|已保存|已导出|已创建|已写入|生成完毕|制作完成|下载|✅)/;
const DELIVER_EXTS = "pptx|pptm|docx|doc|xlsx|xls|pdf|zip|mp4|mov|png|jpe?g|gif|csv|html|md|svg";

/**
 * 工作目录里所有文件名 → 字节数。一条回复往往声称生成了好几个文件，
 * 一个名字走一遍目录树等于同一棵树扫好几遍，扫一次记下来就够了。
 */
async function workspaceIndex(workspace) {
  const idx = new Map();
  let root;
  try { root = workspace || getWorkspaceDir(); } catch { return idx; }
  const stack = [[root, 0]];
  let visited = 0;
  while (stack.length && visited < 3000) {
    const [dir, d] = stack.pop();
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      visited++;
      if (e.isFile()) {
        // 同名文件出现在多个子目录时，非空的那份说了算——否则一个残留的空壳会把真交付判成"空文件"
        if (!idx.has(e.name) || idx.get(e.name) === 0) {
          try { idx.set(e.name, (await fs.promises.stat(path.join(dir, e.name))).size); } catch { idx.set(e.name, -1); }
        }
      } else if (e.isDirectory() && d < 4 && e.name !== "node_modules" && !e.name.startsWith(".")) {
        stack.push([path.join(dir, e.name), d + 1]);
      }
    }
  }
  return idx;
}

async function sizeOf(p) {
  try { return (await fs.promises.stat(p)).size; } catch { return -1; }
}

/**
 * 返回 [{ name, why }]：why = "missing"（磁盘上根本没有）或 "empty"（文件在但 0 字节）。
 * 空文件也必须打回——写到一半失败、编码出错都会留下一个 0 字节的壳，
 * 只查存在性的话这种"交付"会被判为成功，用户点开才发现是空的。
 */
async function missingDeliverables(text, workspace) {
  if (!text || !CLAIM_RE.test(text)) return [];
  const found = new Set();
  const pathRe = new RegExp(`(?:~|\\/(?:Users|home|tmp|private|var))\\/[^\\s"'\`（）()<>|,;：:*?]+\\.(?:${DELIVER_EXTS})\\b`, "gi");
  for (const m of text.match(pathRe) || []) found.add(m);
  const bareRe = new RegExp(`(?:^|[\\s"'\`（(：:、，=])([\\w\\u4e00-\\u9fff().&＆_-]+\\.(?:${DELIVER_EXTS}))\\b`, "gim");
  let mm;
  while ((mm = bareRe.exec(text))) { if (!mm[1].includes("/")) found.add(mm[1]); }
  const bad = [];
  let idx = null;
  for (const p of found) {
    let size;
    if (path.isAbsolute(p)) size = await sizeOf(p);
    else if (p.startsWith("~")) size = await sizeOf(path.join(os.homedir(), p.slice(1)));
    else {
      if (!idx) idx = await workspaceIndex(workspace); // 真有相对文件名要查时才扫目录
      size = idx.has(p) ? idx.get(p) : -1;
    }
    if (size < 0) bad.push({ name: p, why: "missing" });
    else if (size === 0) bad.push({ name: p, why: "empty" });
  }
  return bad;
}

// ================= 上下文预算（治「跑到一半突然 400」） =================
// 工具结果是上下文的绝对大头：read_file 5 万字、fetch_url 2 万字、run_shell 3 万字，
// 一个跑满 25 步的深度调研任务能堆到几十万字符，把模型上下文撑爆——表现是任务跑到一半
// 突然报 LLM 接口错误 400，前面做的全丢。这里在每次请求前把「老的」工具结果截短：
// 模型真正需要原文的是刚做完那几步，更早的它已经把结论写进自己的回复里了。
// 只截 tool 结果、不删任何消息——OpenAI 侧 tool_calls 必须有对应的 tool 消息应答，删了就是 400。
const CTX_KEEP_HEAD = 300; // 老结果保留的开头字符数（够模型认出这步干了什么）

// 上下文预算的单位是**字符**，不是 token。按英文口径 1 token ≈ 4 字符换算：
// 2M tokens × 4 = 8,000,000 字符。中文内容单字约占 2-3 token，同样的字符数换到的
// token 更少，所以这个数字对中文是偏保守的——宁可早压一次，也不要跑到一半撞 400。
// 五处默认值以前是散在各个 `|| 2000000` 里的，漏改一处就会出现「阈值比预算还大」这种
// 自相矛盾的状态，所以收成一个常量。
const DEFAULT_MAX_CONTEXT_CHARS = 8000000; // ≈ 2M tokens（英文口径）
const DEFAULT_COMPACT_KEEP_CHARS = 400000; // 压缩后保留的最近轮次字符数（≈ 100K tokens）

/**
 * 有效上下文预算：根据当前模型类型动态获取配置
 * 优先级：用户配置的模型类型上下文 > 设置页对应模型类型的默认值
 * @param {Object} config - 全局配置对象
 * @param {string} [sessionModel] - 可选的会话模型名，优先级高于 config.active_model
 */
function ctxBudget(config, sessionModel) {
  // 尝试从 context_config 中获取当前模型类型的配置
  const contextConfig = config.context_config || {};
  const activeModel = String(sessionModel || config.active_model || '').toLowerCase();

  // 根据模型名前缀判断类型
  let provider = 'custom'; // 默认国模
  if (activeModel.startsWith('gpt') || activeModel.includes('gpt')) provider = 'gpt';
  else if (activeModel.startsWith('claude') || activeModel.includes('claude')) provider = 'claude';
  else if (activeModel.startsWith('grok') || activeModel.includes('grok')) provider = 'grok';
  else if (activeModel.startsWith('gemini') || activeModel.includes('gemini')) provider = 'gemini';

  // 获取该类型的上下文窗口配置
  const providerConfig = contextConfig[provider] || {};
  let maxChars = DEFAULT_MAX_CONTEXT_CHARS;

  // 与设置页的默认选项保持一致，未保存的 1M 也必须实际生效。
  const size = ['256k', '512k', '1m'].includes(providerConfig.size)
    ? providerConfig.size : (provider === 'grok' ? '256k' : '1m');
  // 模型类型配置取代旧的全局 max_context_chars，避免 UI 默认值与实际预算分叉。
  switch (size) {
    case '256k': maxChars = 256 * 1024 * 4; break;
    case '512k': maxChars = 512 * 1024 * 4; break;
    case '1m': maxChars = 1024 * 1024 * 4; break;
  }

  return Math.max(20000, +maxChars);
}

function entryChars(e) {
  if (e.role === "user") return String(e.content || "").length;
  // Claude 路径回传的是 raw（含 thinking 块，往往比 text 大好几倍），要按真正发出去的那份算
  if (e.role === "assistant") return e.raw ? JSON.stringify(e.raw).length : String(e.text || "").length + JSON.stringify(e.toolCalls || []).length;
  let n = 0;
  if (e.role === "tool") for (const r of e.results || []) n += String(r.content || "").length;
  return n;
}
function historyChars(history) {
  let n = 0;
  for (const e of history) n += entryChars(e);
  return n;
}

// 「可重取」的工具结果：截掉不心疼——要用的时候再调一次工具就能拿回原文。
// 跑代码的输出/报错不在此列：那是一次性的现场证据，截掉就真没了。
const REFETCHABLE_TOOLS = new Set(["read_file", "fetch_url", "list_files", "search_files", "library_read", "library_list", "web_search", "render_page", "check_page"]);

// ── 上下文压缩标记 ──────────────────────────────────────────────
const COMPACT_MARK = "【系统·上下文压缩】";

/** 从被压缩的轮次里机械提取读/改过的文件，并把上一份摘要里的清单接续下来。
 *  清单不靠摘要模型转述（模型会丢文件名），跨多次压缩累计（借鉴 pi 的 cumulative file tracking）。 */
function collectFileOpsStandalone(old) {
  const read = new Set(), wrote = new Set();
  for (const e of old) {
    if (e.role === "assistant") {
      for (const c of e.toolCalls || []) {
        const p = String((c.args || c.input || {}).path || "").trim();
        if (!p) continue;
        if (c.name === "read_file") read.add(p);
        else if (c.name === "write_file" || c.name === "edit_file") wrote.add(p);
      }
    } else if (e.role === "user" && String(e.content || "").startsWith(COMPACT_MARK)) {
      const s = String(e.content);
      const grab = (label, set) => {
        const m = new RegExp(`【${label}】([^\\n]*)`).exec(s);
        if (m) for (const f of m[1].split("、")) { const t = f.trim(); if (t && t !== "无") set.add(t); }
      };
      grab("读过的文件", read);
      grab("改过的文件", wrote);
    }
  }
  for (const p of wrote) read.delete(p); // 改过的不用再占「读过」的位置
  const cap = (set) => Array.from(set).slice(-40).join("、") || "无";
  return { read: cap(read), wrote: cap(wrote) };
}

/**
 * 独立的上下文压缩函数，供外部调用（如会话加载时）
 * @param {Array} history - 会话历史记录
 * @param {Object} config - 配置对象
 * @param {Object} llm - LLM 客户端
 * @param {Object} options - 压缩选项
 * @returns {Promise<boolean>} - 是否执行了压缩
 */
async function compactHistoryStandalone(history, config, llm, { emit = () => {}, stats, force = false } = {}) {
  if (!history || !history.length) return false;
  if (!force && (config.agent || {}).compact === false) return false;

  const budget = ctxBudget(config);

  // 获取当前模型类型的压缩阈值
  const contextConfig = config.context_config || {};
  const activeModel = String(config.active_model || '').toLowerCase();
  let provider = 'custom';
  if (activeModel.includes('gpt')) provider = 'gpt';
  else if (activeModel.includes('claude')) provider = 'claude';
  else if (activeModel.includes('grok')) provider = 'grok';
  else if (activeModel.includes('gemini')) provider = 'gemini';

  const providerConfig = contextConfig[provider] || {};
  const thresholdPercent = providerConfig.threshold || 60;
  const threshold = force ? budget : Math.floor(budget * (thresholdPercent / 100));

  if (historyChars(history) <= threshold) return false;

  // 抢救模式下保留轮数收到 2：留太多就压不出空间，而空间不够整个任务就没了
  const keepTurns = force ? 2 : (config.agent.compact_keep_turns || 8);
  const userIdx = [];
  history.forEach((e, i) => { if (e.role === "user") userIdx.push(i); });

  let cut = userIdx.length > keepTurns ? userIdx[userIdx.length - keepTurns] : -1;
  let splitMode = false;

  if (cut < 1) {
    const keepChars = force
      ? Math.max(8000, Math.floor(budget / 2))
      : (config.agent.compact_keep_chars || DEFAULT_COMPACT_KEEP_CHARS);
    let acc = 0;
    for (let i = history.length - 1; i >= 1; i--) {
      acc += entryChars(history[i]);
      if (acc >= keepChars) {
        for (let j = i; j >= 1; j--) if (history[j].role !== "tool") { cut = j; break; }
        break;
      }
    }
    if (cut < 1) return false;
    splitMode = true;
  }

  const old = history.slice(0, cut);
  if (historyChars(old) < (force ? 2000 : 8000)) return false;

  // 老轮次转成纯文本转写
  const lines = [];
  for (const e of old) {
    if (e.role === "user") lines.push("用户：" + String(e.content || "").slice(0, 2000));
    else if (e.role === "assistant") {
      if (e.text) lines.push("助手：" + String(e.text).slice(0, 2000));
      for (const c of e.toolCalls || []) lines.push(`（调用 ${c.name} ${JSON.stringify(c.args || c.input || {}).slice(0, 200)}）`);
    } else if (e.role === "tool") {
      for (const r of e.results || []) lines.push("（工具结果：" + String(r.content || "").replace(/\s+/g, " ").slice(0, 300) + "）");
    }
  }

  let transcript = lines.join("\n");
  if (transcript.length > 60000) transcript = "…（更早部分略）\n" + transcript.slice(-60000);
  const fileOps = collectFileOpsStandalone(old);

  // 分轮压缩时保留原始指令
  let lastInstr = "";
  if (splitMode) {
    for (let i = old.length - 1; i >= 0; i--) {
      const e = old[i];
      if (e.role !== "user") continue;
      const c = String(e.content || "");
      if (c.startsWith(COMPACT_MARK) || c.startsWith("【系统")) continue;
      lastInstr = c.replace(/\s+/g, " ").slice(0, 2000);
      break;
    }
    if (!lastInstr) {
      for (let i = old.length - 1; i >= 0 && !lastInstr; i--) {
        const e = old[i];
        if (e.role !== "user" || !String(e.content || "").startsWith(COMPACT_MARK)) continue;
        const m = /【最近的用户指令原文】([^\n]*)/.exec(String(e.content));
        if (m) lastInstr = m[1].trim();
      }
    }
  }

  // 调用 LLM 进行压缩
  const result = await llm.chat({
    system:
      "你是会话压缩器。把用户给你的对话转写压成一份接手备忘录，严格按以下结构写（没内容的小节写「无」）：\n" +
      "## 目标\n## 已完成\n## 进行中 / 卡住\n## 关键决定（附原因）\n## 下一步\n## 关键上下文\n" +
      "「关键上下文」放继续干活必需的硬事实：路径、命令、报错原文、用户表达过的偏好与纠正。\n" +
      "只写事实不评论，文件名和关键数字一个都别丢。800 字以内，中文。",
    history: [{ role: "user", content: "以下是需要压缩的对话转写：\n\n" + transcript }],
    tools: [],
    signal: AbortSignal.timeout(60000),
  });

  if (result.usage && stats) {
    stats.prompt += result.usage.prompt;
    stats.completion += result.usage.completion;
    stats.cached = (stats.cached || 0) + (result.usage.cached || 0);
    stats.calls++;
  }

  const summary = String(result.text || "").trim();
  if (!summary) return false;

  // 归档压缩内容
  try {
    const dir = dataPath("data", "compact-archive");
    await writeJsonAtomicAsync(path.join(dir, `${Date.now()}.json`), old, { pretty: true, backup: false });
  } catch (e) {
    console.warn("[agent] 压缩归档失败（不拦压缩）:", e.message);
  }

  // 替换历史记录
  history.splice(0, cut, {
    role: "user",
    content:
      `${COMPACT_MARK}以下是本会话更早内容的自动摘要（原文已归档）：\n${summary}\n` +
      (lastInstr ? `【最近的用户指令原文】${lastInstr}\n` : "") +
      `【读过的文件】${fileOps.read}\n【改过的文件】${fileOps.wrote}\n` +
      `（摘要结束。把以上当作既定事实继续，不必向用户复述；若与用户最新要求冲突，以最新要求为准。）`,
  });

  emit({ type: "compact", removed: old.length });
  console.log(`[agent] 上下文已压缩（${splitMode ? "任务分轮" : "会话轮次"}）：${old.length} 条 → 1 条摘要（现约 ${historyChars(history)} 字符）`);

  return true;
}

// 削到多低才收手。削"刚好够"是个隐形的烧钱姿势：一超预算就每步再削一点点，
// 而历史被改了一个字节，后面整段缓存前缀就作废——于是每一步都是全价重买。
// 一次削到 75% 留出空档，接下来十几步历史都是逐字不变的，缓存才吃得住。
const CTX_LOW_WATER = 0.75;

/** 就地截短老工具结果直到进预算，返回省下的字符数（0 = 本来就没超） */
function trimHistory(history, maxChars, keepRecent = 3) {
  let total = historyChars(history);
  if (total <= maxChars) return 0;
  const toolIdx = [];
  history.forEach((e, i) => { if (e.role === "tool") toolIdx.push(i); });
  // 最近 keepRecent 轮工具结果留原文，从最老的开始截
  const older = toolIdx.slice(0, Math.max(0, toolIdx.length - keepRecent));
  let saved = 0;
  // 两轮裁剪：先动可重取的，还不够再动不可重现的（老会话的结果没记工具名，归入第二轮）。
  // 低水位只用在第一轮：可重取的结果多削一点无所谓（要用再调一次工具就有），
  // 而第二轮动的是跑代码的输出那种一次性现场证据，削一个字都是净损失，够用就停。
  const passes = [
    { wants: (r) => !r.isError && REFETCHABLE_TOOLS.has(r.name), target: Math.floor(maxChars * CTX_LOW_WATER) },
    { wants: () => true, target: maxChars },
  ];
  for (const { wants, target } of passes) {
    for (const i of older) {
      for (const r of history[i].results || []) {
        if (!wants(r)) continue;
        const s = String(r.content || "");
        if (s.length <= CTX_KEEP_HEAD * 2) continue;
        r.content = s.slice(0, CTX_KEEP_HEAD) + `\n…（原输出 ${s.length} 字符，为控制上下文长度已截断。需要完整内容请重新调用工具获取。）`;
        const cut = s.length - r.content.length;
        saved += cut;
        total -= cut;
        if (total <= target) break;
      }
      if (total <= target) break;
    }
    if (total <= maxChars) return saved;
  }
  return saved;
}

/**
 * 系统提示词里注入真实日期：不给的话模型会拿训练截止日当"今天"，凡是"最新/本周"的任务全歪。
 *
 * 缓存优化：为了最大化 prompt caching 效果，完全移除日期信息。
 * - 同一对话无论何时打开，系统提示词都相同，缓存永不失效
 * - 需要当前日期的任务，让模型自己调用工具获取（run_shell date / run_node new Date()）
 * - 用户说"今天""现在"时，模型会意识到需要先获取当前时间
 */
function envToday() {
  return ""; // 返回空字符串，完全移除日期
}

// Framework reads must enforce the same real-path boundary as file tools.
async function readProgressFile(workspace, relativePath, maxBytes = 20000) {
  const file = safePath(relativePath, workspace || getWorkspaceDir());
  const handle = await fs.promises.open(file, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}
async function resolveProjectImage(rel, baseDir, workspace) {
  const ws = workspace || getWorkspaceDir();
  const candidates = path.isAbsolute(rel)
    ? [path.resolve(rel)]
    : [path.resolve(ws, rel), ...(baseDir ? [path.resolve(ws, baseDir, rel)] : [])];
  for (const candidate of candidates) {
    try {
      const p = safePath(candidate, ws);
      if ((await fs.promises.stat(p)).isFile()) return p;
    } catch {}
  }
  return null;
}

function safeWorkspaceDir(baseDir, workspace) {
  try {
    const ws = workspace || getWorkspaceDir();
    return baseDir ? path.join(ws, baseDir) : ws;
  } catch { return "（未设置）"; }
}

/** 只解析运行实例；旧热替换代理未转发访问器时按实例身份精确匹配，不读全局 active_model。 */
function currentModelChannel(L, config) {
  if (!L) return {};
  if (typeof L.getRequestConfig === "function") return L.getRequestConfig();
  if (L.base_url) return { name: L.name, base_url: L.base_url, api_key: L.api_key, model: L.model, provider: require("./lib/model-protocol").modelProvider(L), series: L.series };
  const list = Array.isArray(config.models) ? config.models : [];
  const matches = list.filter(m => (m.name || (m.provider === "anthropic" ? "anthropic" : "openai")) === L.provider && m.model === L.model);
  if (matches.length === 1) {
    return require("./llm").createLLM({ ...config, models: matches, active_model: matches[0].name }).getRequestConfig();
  }
  if (!list.length && config.provider === L.provider && config[L.provider]?.model === L.model) {
    return require("./llm").createLLM(config).getRequestConfig();
  }
  return {};
}

function createAgentRuntime({ config, llm, mcpManager, experts = [], expertTeams = [], llmFactory }) {
  // 备用渠道换道要现造一个 LLM 客户端；懒 require 避免环形依赖，测试时可注入假工厂做零 token 验证
  const makeLLM = llmFactory || ((cfg) => require("./llm").createLLM(cfg));
  /** 团里挂着的成员可能已被删掉，取用时按当前专家表过一遍 */
  function teamMembers(team) {
    return membersOf(team, experts);
  }
  // 技能每次任务实时加载（save_skill 新建的技能立即可用）
  function getSkills() {
    return loadSkills();
  }

  async function baseSystemPrompt(user, hint, baseDir, workspace) {
    const skills = getSkills();
    const artifacts = baseDir || ".tmp";
    let p = `你是 CloseCode，一个由 DoCode Platform 开发的 AI 办公智能体。用户用自然语言下达办公任务，你自主思考、拆解任务、规划步骤、调用工具执行，最终交付可验证的成果。用户叫你「CloseCode」，被问到你是谁，就回答「我是由 DoCode Platform 开发的智能体 CloseCode」，不要说自己是别家的模型或产品。

## 当前环境
- 获取当前时间：需要"今天/现在/本周"等时间信息时，先用 run_shell 或 run_node 获取当前日期时间。例如：run_shell("date") 或 run_node("console.log(new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}))")。不要用训练数据里的时间。
- 最新信息查询：需要最新事实（价格、政策、版本号、人事、榜单）必须 web_search 现查，不许凭记忆答。
- 项目根目录：${workspace || getWorkspaceDir()}
- 本次对话的辅助文件目录：${artifacts}/（相对项目根目录）
- **项目隔离**：默认处理上面列出的项目，相对路径和成果归属仍固定在当前项目。任务需要普通外部目录时，可直接使用文件工具或 Shell cwd，无需目录授权，旧文件黑白名单不拦截。只访问任务所需范围；写入与命令仍按权限档位和危险操作规则执行。CloseCode 安装代码与私有运行数据保留核心保护，不得引导关闭保护。
- **重要**：文件工具的相对路径、run_shell/run_node 默认工作目录均为项目根目录。用户上传/拖拽的文件也在这里，搜索项目用 list_files(".", depth:1) 或 search_files(".", query:"文件名")。
- 编程任务直接修改当前项目，新增源码、正式回归测试、配置和交付文件遵循项目原有目录结构（例如 src/、tests/），不要在对话目录中另建项目副本。
- ${artifacts}/ 只存放本轮一次性测试脚本、扫描报告、截图、过程记录等辅助文件，不参与 Git 自动提交。写这些文件时必须显式带上目录前缀，例如 ${artifacts}/screenshots/page.png；正式项目文件不得放入此目录。
- 运行环境：${{ darwin: "macOS", win32: "Windows", linux: "Linux" }[process.platform] || process.platform}，本机执行，run_shell 拿到的是用户的真实电脑。
- Shell 工具探测：${await require("./lib/shell-runner").shellEnvironmentSummary({ cwd: workspace || getWorkspaceDir() })}
- 找文件、搜索源码优先使用 list_files/search_files；缺少 rg 不重复尝试，缺少 node 使用 run_node。命令缺失与搜索无匹配不是同一件事；不要重放可能已产生副作用的复合命令，也不要自行安装软件。

## 工具能力
- run_node：执行 Node.js 代码。已安装库：pptxgenjs(PPT)、docx(Word)、exceljs(Excel)，以及 Node 内置模块。
- run_shell：执行 shell 命令（${process.platform === "win32" ? "Windows cmd，注意用 cmd 语法：del/copy/where、路径反斜杠" : "zsh/bash"}），可用系统已装的 CLI 工具（git、curl、ffmpeg、lark-cli 等）。调现成命令行工具用它，写程序逻辑用 run_node。
- read_file：读已确认存在的文件（大文件用 start_line/end_line）。临时扫描报告应按生成代码的实际输出路径核对，再用 list_files/输出日志确认，不猜文件名；FILE_NOT_FOUND 时核对文件列表、生成步骤退出码和实际路径，不要重复碰同一个错误。
- 多行脚本：Python 扫描/测试优先 write_file 保存 .py，再 run_shell 执行。Windows 对单条 Python -c 多行代码会直接传递完整参数（支持前置 cd /d）；其余多行 shell/复合语法会在启动前拒绝。不要忽略此错误继续读取报告，也不要把无输出且未核验产物的退出码 0 当成报告已生成。
- Shell 与文件路径：run_shell 默认在项目根目录运行，cwd 也相对项目根目录；cd/cwd 不会改变后续 read_file/write_file 的基准。一次性测试脚本、截图和扫描报告指定输出到 ${artifacts}/，命令成功后核对文件存在，再读取。后台进程仍在运行不等于报告已生成/测试已通过。
- write_file：**新建**文件。写长文档用 append:true 一节一节续写，别把前文重新吐一遍（既慢又容易越写越短）。写完会自动做语法/结构自检，报了问题就当场修
- edit_file：改已有文件里的某一段（精确优先，安全兼容换行与整段缩进差异）。改代码、改文档只用它，不要 write_file 整篇重写
- search_files：全文搜索，返回 文件:行号:命中行。找定义、找调用点、改名前找引用，用它
- list_files：列目录（depth 给 2~3 可一次看清项目结构）
- remember / forget：把本项目跨任务成立的偏好记进长期记忆 / 删掉某条，不跨项目；全局偏好请用户在设置中手动维护
- web_search：联网搜索（标题/链接/摘要），查资料先搜索定位来源
- fetch_url：抓取网页全文或直接调 JSON 接口（带真实浏览器请求头；配合 web_search 的结果 URL 用）
- render_page：用内置浏览器真打开页面、等 JS 渲染完再取正文，专治动态站点（B 站、微博、单页应用）
- check_page：验收做好的网页（静态体检 + 真浏览器打开一遍看有没有报错、是不是白屏）。交付 HTML 之前必须跑
- gen_diagram：文本描述 → 专业图（mermaid 流程/时序/甘特、dot 架构图、echarts 数据图表、plantuml UML），一次生成 SVG+PNG 文件。文档/PPT/飞书文档要配图一律用它，不要手写 SVG 文件
- use_skill：加载技能包（做对应任务前先加载）
- library_list / library_read：查看用户的资料库与灵感笔记（跨项目共享的长期参考资料，任务涉及用户偏好/素材时先查）`;
    if ((config.im || {}).feishu && (config.im.feishu.app_id || config.im.feishu.doc_app_id)) {
      p += `\n- feishu_doc_create：把 Markdown 内容创建成飞书云文档交付给用户（用户要求"发到飞书/建飞书文档"时用它，不要自己找凭证写脚本）`;
    }

    if (skills.length) {
      // 描述截到 80 字：这里只是让模型会「选」技能，全文在 use_skill 加载时才给。
      // 第三方技能爱写整段英文简介，不截的话光这份清单就吃掉小一千 tokens、每一步都重复计费
      const brief = (d) => { const t = String(d || "").replace(/\s+/g, " ").trim(); return t.length > 80 ? t.slice(0, 80) + "…" : t; };
      p += `\n\n## 可用技能\n` + skills.map((s) => `- ${s.name}：${brief(s.description)}`).join("\n");
    }
    p += `

## 工作规范
1. 接到任务先简短说明计划（2-4 句），然后立即执行，不要等用户确认。信息不全时不要停下来反问，自己挑一个最合理的默认假设、写在开场白里继续做；只有缺了它整件事会白做的关键信息（比如要发给谁、用哪个账号）才允许问，且一次问完。
2. 涉及已有文件/项目的任务，动手前先 list_files、search_files、read_file 把现场看清楚，不要凭文件名猜内容。**看明白之后直接改**——用户让你改，你就改，不要回头问"要不要我改""确认后我再动手"；只有删文件、清空目录、推远端这类不可逆的事才值得停下来问一句。改的方式是 edit_file 精准替换，不是 write_file 整篇盖掉。
3. 成果文件写到工作目录根目录，文件名有意义。**一件产出只留一份**——写完不要再 cp 一份到别处（工作空间根目录也不行）：聊天里的产出卡片和右侧文件面板本来就能直接预览、直接「所在位置」，多出来的副本只会让用户看到同一个文件显示两遍。用户要把成果拿去别的地方，等他开口再动。**HTML / Markdown / CSS / JSON / 纯文本一律用 write_file 直接写内容，绝不要在 run_node 里用模板字符串拼**——网页正文里几乎必然出现 \`\${...}\`、反引号或 </script\>，会把外层模板字面量截断，直接 SyntaxError。run_node 只留给真的需要跑逻辑的活（pptxgenjs 出 PPT、docx 出 Word、exceljs 出 Excel、批量处理、算数据）。
3.1 消息里带「已上传文件：xxx」就是用户拖进来或粘贴进来的东西，一律先看再动手：
   - 图片（.png/.jpg/…）用 look_at_image，带上一个具体问题（"把报错原文一字不差抄下来"、"这页分几块、各放了什么"）。**别用 read_file 读图**，读出来是乱码。图不进对话历史，只有你问到的答案会进，所以一次就把要用的细节问全。
   - 「粘贴文本_….txt」是用户粘进来的大段文字（日志、报错、整篇文档），用 read_file 读；很长就先读头尾再 search_files 定位，别整篇灌进上下文。
4. 交付前自检：凡是生成的文件，写完必须再 read_file / list_files 读回来确认真的存在、内容完整（长文档至少核对开头结尾和篇幅），发现残缺就当场修好再交付。
4.1 **大任务先立进度档**：预计十步以上、或要产出多个文件的任务，第一步先 write_file 建 ${artifacts}/PROGRESS.md：目标一句话 + 分步清单（- [ ] 待做 / - [x] 已完成）。此后每完成一步就 edit_file 打勾。任务被打断或续跑时，先读这份进度档从断点接着做，绝不从头重来。
5. 代码报错要读懂原因、修正重试，不要放弃；同一处连续失败 3 次就换思路，别在死路上空转。
5.1 抓不到网页不等于做不到（高频翻车点）。一条路走不通就换下一条，**同一个目标至少真试满三种路子**才允许说抓不到：
   - fetch_url 拿回来是空壳 → 用 render_page 真渲染一遍；
   - 页面正文是异步加载的 → 去找它背后的数据接口（站点常见的 api.xxx.com/... 形式）直接 fetch_url，接口返回 JSON 比解析 HTML 靠谱得多；
   - 接口要签名/被风控挡 → 用 run_shell 调本机现成的命令行工具（curl 带完整请求头、yt-dlp 取视频站元数据、rss 源等），本机装了什么先 \`which\` 一下再说没有；
   - 还是不行 → web_search 搜同样的内容，从能打开的转载页/镜像站/第三方数据站拿。
   把「需要登录 Cookie / 需要官方 API 权限」当结论直接停手，是不合格的交付。真要用户的登录态才继续，先把不需要登录也能拿到的那部分做完再说。
5.2 **不许把选择题丢给用户**：严禁用「请告诉我你的选择：1... 2... 3...」「需要我尝试哪种方式？」这类问句结束回合。你有工具，方案的优劣你自己判断得了——挑最可能成的那个直接动手，失败了再换。同理，严禁把代码贴在回复里说"我能这样做"——能跑就 run_node / run_shell 真跑，回复里只放结论。
5.3 **只读的活一次性并发发出去**：要查 5 个关键词、要抓 6 个链接、要读 3 个文件时，在同一轮里一口气发多个工具调用（web_search / fetch_url / render_page / read_file / list_files / library_read），系统会并发执行，只花最慢那一个的时间；一个一个来是把等待时间叠加。会写文件、跑命令、委派专家的调用不要和别的混在一轮里发——那些的先后顺序有意义，混在一起会被退回串行。
6. 完成后简要总结做了什么、生成了哪些文件。
7. 始终用中文交流——包括报错说明、失败复盘、自我纠正这些中途叙述，任何时候都不许切成英文。工具返回的英文报错要翻成人话讲给用户听（原始报错可以放进代码块，但结论必须是中文）。
8. 用户消息里的「@某文件名」指工作目录中的文件（用 read_file 读取）；「/某技能名」表示要求使用该技能（先 use_skill 加载）；「【任务类型：X】」是场景标签，按该场景的最佳实践来做。
9. 工具能做到的事必须自己调工具真正执行，严禁把命令贴在回复里让用户代跑（除非确实需要用户本人登录/授权才能做的事）。
10. 严禁虚构执行结果（红线）：没有真实调用工具，绝不能声称「已生成/已保存/生成成功」，不能编造文件大小、页数、命令输出或下载链接（sandbox: 开头的链接是假的，禁止输出）。做不到就如实说做不到。系统会自动核验你声称生成的文件是否真实存在，虚构会被当场打回重做。
11. 严禁虚构事实（红线）：数字、日期、人名、机构、政策条款、引用链接，只能来自工具真实拿到的内容。查不到就写「未查到公开信息」，不许用"大约""据业内估算"糊过去，更不许编造看起来很像的 URL。交付物里每个关键数字都要能指回来源。

## 改代码（改用户已有的项目时按这个来）
1. 先看清楚再动手：search_files 找到要改的位置 → read_file 把那一段（含上下文）读出来。别只看文件名和函数名就下笔。
2. 一次只改一处，用 edit_file。old_text 从 read_file 当前原文复制，带足上下文保证全文唯一；工具会兼容 CRLF/LF、整段等量缩进和行尾空格，但绝不会猜测标点或代码内容。报"不唯一"就多带几行；报"没找到"就依据错误里的真实片段和差异行重新 read_file，修正 old_text 后再试，不要重复同一失败请求。
3. **绝不整篇重写用户的文件**。write_file 只用于新建。整篇重写会把你没读过的部分一起换掉，而且用户的 diff 会变成全红，根本没法审。
4. 改完自检：语法能不能过（node -c 之类的检查、或直接跑起来）、项目有测试就跑测试、改了函数签名就 search_files 找出所有调用点一并改掉。自检失败自己修，别把坏的交出去。
5. 顺手发现的其它问题：说出来，但不要顺手一起改。用户要的是这一件事的干净改动。
6. 收尾时说清楚：改了哪几个文件的哪几处、为什么这么改、验证过什么。

## 写文档（报告、方案、分析、说明书）
1. 先定骨架再落笔：动笔前用一两句话把「读者是谁、他看完要能做什么决定、分几节」定下来，再开写。上来就写第一段的文档，写到一半必然跑偏。
2. **每节先给结论，再给依据**。小标题要有信息量（写「获客成本三个月涨了 2.4 倍」，不写「现状分析」）。段落 3-5 行断开，能列表就列表，能表格就表格。
3. 数字必须可追溯：每个关键数字后面跟上来源（链接或文件名）。查不到就写「未查到公开信息」，不许用"大约""据业内估算"糊过去。
4. 删掉所有废话：「随着…的不断发展」「众所周知」「综上所述」「本文将」这类开场白和过渡句一律不要。凑字数不如把一个论点说透。
5. 长文档分节 append 写：先 write_file 写标题和目录，之后每节用 append:true 追加。一次生成上万字的整篇内容会被截断，而且中途出错要从头再来。
6. 写完必须 read_file 读回来核对：开头结尾在不在、篇幅对不对、有没有半截话、代码围栏是不是成对闭合。自检不过就当场修，别交出去。
7. 交付时说清楚：文件名、多少字、分几节、数据截止到哪天。

## 做网页（HTML 交付物）
1. **单文件自包含**：CSS 写 \`<style>\`、JS 写 \`<script>\`、图标用内联 SVG 或 emoji。**绝不引外部 CDN**（cdn.jsdelivr、unpkg、bootstrap、echarts CDN 等）——用户断网、换台电脑、发给同事，页面当场白屏。需要图表就自己用内联 SVG 或 canvas 画。
2. 必备骨架：\`<!DOCTYPE html>\`、\`<meta charset="utf-8">\`、\`<meta name="viewport" content="width=device-width, initial-scale=1">\`、有信息量的 \`<title>\`、\`lang="zh-CN"\`。
3. 手机上也要能看：宽度用 %/rem/clamp()，别写死 px；多栏布局用 flex/grid 并配 \`@media (max-width: 768px)\` 塌成单栏；表格外面套一层 \`overflow-x:auto\`。
4. 深色模式要跟随系统：颜色统一定义成 \`:root\` 上的 CSS 变量，再用 \`@media (prefers-color-scheme: dark)\` 覆盖一遍变量。别把颜色散写在各处，改起来必漏。
5. **现代视觉风格（默认必做）**：
   - **配色**：主色用饱和度适中的蓝/紫/绿（#3b82f6、#8b5cf6、#10b981 这类），强调色用对比色，背景用微灰（#f8fafc），不要纯白 #fff。卡片/按钮带微妙阴影（\`box-shadow: 0 1px 3px rgba(0,0,0,0.1)\`）增加层次感。
   - **间距与留白**：所有间距用 4 的倍数（8px、12px、16px、24px、32px），内容区最大宽度 1200px 居中，两侧留白，不要铺满整屏。
   - **圆角与线条**：按钮、卡片、输入框统一用 8px 圆角（\`border-radius: 8px\`），边框用淡灰（\`border: 1px solid #e5e7eb\`）。
   - **字体与排版**：标题用加粗（font-weight: 600/700），正文行高 1.6，字号层次分明（标题 24px、副标题 18px、正文 16px）。中英文混排时 \`font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif\`。
   - **交互反馈**：按钮/链接 hover 时变色或微抬升（\`transform: translateY(-1px)\`），配 \`transition: all 0.2s\`。
   - **渐变与点缀**：标题/hero区可用淡雅渐变背景（\`background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)\`），但不要全页渐变。
   - **图标与emoji**：适当用 emoji 或内联 SVG 图标增强视觉（✓ ✗ ⚠ 📊 🎯），但别滥用。
6. **内容必须是真数据**：页面里的数字、案例、引用都来自工具真拿到的东西，不许拿 Lorem ipsum、示例数据、占位图充数交付。
7. **写完必须跑一次 check_page**：白屏和 JS 报错光看源码看不出来。报错就改到干净为止，再告诉用户"做好了"。
8. 交付时给出文件名，并提醒用户可以在成果区直接点开预览。

## 构建型前端项目（Vue / React / Vite / Next 等，和上面的单文件 HTML 完全不同）
判断依据：目录里有 package.json 且带 dev/serve 脚本，或有 vite.config.*、vue.config.*、next.config.* —— 这类项目按下面这套来，上一节那套「单文件、点开预览」的规则一条都不适用。
1. **绝不预览项目里的 index.html**。构建型项目的 index.html 只是个空壳模板（通常就一个 \`<div id="app">\` 加一行 module script），用 file:// 或成果区直接打开必定是白屏或只有 loading——真实页面是 dev server 现场编译出来的。也不要对它跑 check_page，那只会检出一个「正常的空页面」，毫无意义。
2. **起 dev server 必须用 \`run_shell\` 且 \`detach:true\`**（\`npm run dev\`、\`pnpm dev\`、\`npm start\` 都算）。这类命令永不退出，不传 detach 就是让整个任务卡死在这一步直到超时——这是最常见的翻车方式。
3. detach 返回值里会带「🌐 开发服务器地址」（形如 http://localhost:5173）。**交付、验证、给用户的链接一律用这个地址**。要验证页面就对这个 URL 跑 check_page 或 fetch_url，不要去碰磁盘上的 index.html。
4. 返回值里没有 URL、或提示启动失败时，别假装它起来了：先看那段启动输出（端口占用、依赖没装、脚本名不对最常见），修掉再起一次。依赖没装就先 \`npm install\`（这个是会退出的正常命令，不要 detach）。
5. 收尾必须说清三件事：**访问地址**、dev server 还在后台跑着（附 PID，说明怎么停）、以及要出可部署产物得跑 \`npm run build\`（产物在 dist/）。不要让用户自己去猜为什么点开 index.html 是白屏。

## 长期记忆
- 用户说「以后都这样」「记住…」「别再…」「我习惯…」，或者纠正了你一个会反复出现的做法 → 立刻调 remember 记一句话结论。不记，下次任务你还会犯同样的错。
- 不止等用户开口：任务里摸清的、下次还会用到的稳定事实（用户的业务/产品叫什么、常用账号或主页链接、固定的交付格式、反复用到的文件路径），收尾前主动 remember 一条。判断标准：下个月做类似任务这条还成立、还省事，就值得记。
- 只记跨任务成立的东西（偏好、习惯、常用路径、身份、明确的纠正）。这次任务的过程、临时数据不要记。
- 绝不把密钥、密码、令牌记进去（记忆是明文存的，还会进每一次的系统提示词）。
- 用户说「不用记这个了」→ forget。

## 回复排版（重要）
- 结构固定三段式：**动手前**先用一两句说明你准备做什么、怎么做；**过程中**工具调用之间的过渡叙述控制在一两句话（界面会把中间过程折叠收起）；**收尾**最后一条消息必须是完整、自洽的最终结论/交付说明——用户默认只看到开场白和这段结论，别把关键信息只写在中间过程里。
- 回复用 Markdown 结构化输出：小标题（##/###）分段、要点用列表、关键结论/数字用**加粗**、代码和命令放代码块、对比数据用表格。
- 代码块必须用三反引号围栏包裹并标注语言（\`\`\`python、\`\`\`bash、\`\`\`text 等），围栏要成对闭合。严禁把语言名单独写一行然后直接贴裸代码——那样界面无法渲染成代码块。凡是代码、命令、文件树、日志、XML 片段，一律进围栏（SVG 信息图见下一节，用 \`\`\`svg 围栏会被直接渲染成图）。
- 结论先行，再给必要细节；不要把内心推演过程大段写出来（"让我想想""我先检查一下"这类只保留一句即可）。
- 不要虚构进度和等待（"预计耗时X秒，请稍候""正在生成中"这类话不要说）：要么直接调工具真的去做，要么直接给结果。

## 画信息图（内联 SVG，强烈推荐）
把结构化的结论画成一张图，比十行文字管用。**直接在回复正文里写 \`\`\`svg 围栏**，界面会边输出边把它画出来（用户看到图自己长出来），不用写文件、不用调工具。
- 什么时候画：人物/品牌/产品「画像」、方案对比、流程与时间线、数据拆解、能力雷达、结构总览——凡是"几个维度 + 每个维度几条结论"的东西都适合。一次回复最多 1～2 张，别刷屏。
- 图是结论的可视化，**不能代替文字结论**：图前面照样要有一段说人话的总结。图里的每个数字都必须是工具真拿到的，编数字画得再好看也是红线。
- 硬性写法（不遵守就会显示不出来或在暗色模式下变成黑底黑字）：
  1. 根元素必须带 \`viewBox\`，**不要写死 width/height 的像素值**，界面会自适应铺满；
  2. **这条只对回复正文里的 \`\`\`svg 围栏成立**：文字颜色、描边颜色只用这几个语义变量：\`var(--color-text-primary)\`（标题/正文）、\`var(--color-text-secondary)\`（次要说明）、\`var(--color-text-tertiary)\`（弱化标注）、\`var(--color-border-primary|secondary|tertiary)\`（分隔线/边框）、\`var(--color-bg-subtle)\`（浅底块）；字体统一 \`font-family="var(--font-sans)"\`。品牌色/强调色（高亮标签、数据条）可以直接写 hex；
  3. SVG **不会自动折行**：中文长句要自己拆成多个 \`<tspan x="…" dy="…">\`，或者提前断句，别指望它自己换行；
  4. \`<script>\`、\`<foreignObject>\`、外链图片/字体一律会被安全层清掉，别用；要用 \`<style>\` 就用类名，界面会自动把它限死在这张图里。
- 排版参考：竖版长图（viewBox 宽 680、高按内容给）最稳；顶部大标题+副标题，中间分区块，每块一个小节标题+若干条目，区块之间用细分隔线，末尾可以留一行数据来源。

### ⚠️ 写进文件的 SVG 不能照抄上面那套变量
上面那套 \`var(--color-text-primary)\` 之所以能用，是因为图渲染在应用页面里、变量是页面定义的。
**一旦你把 SVG 写进一个 .html 或 .svg 文件，那个文件是独立的，这些变量根本不存在**——
\`fill: var(--没定义的)\` 会让整条声明作废、回落到默认的黑色，底块和文字一起变黑，
用户打开就是一片看不清。而且在应用内预览时它是好的，只有用浏览器打开才露馅。

写文件时三选一：① 在这个文件自己的 \`:root\` 里把用到的变量定义出来；② 直接写死颜色值；
③ 至少写兜底 \`var(--x, #333)\`。另外：**同一个文件里已经定义了一套变量（比如 --ink/--bg），
就用它自己那套**，别混进另一套名字。写完 write_file 会自动查这一项，报出来就当场改。

### ⚠️ gen_diagram 画的图往 HTML 里贴：一个字符都不许改
流程图/架构图/时序图/思维导图一律 \`gen_diagram\` 画，别手写 SVG。要把它内联进报告时，
**把 .svg 文件的内容原样复制进去**——尤其是 \`<svg id="mmdXXXX">\` 这个 id 和 \`<style>\` 里的
\`#mmdXXXX ...\` 选择器，两边是绑死的。你只要为了"防冲突"改了其中一边（哪怕只加个后缀），
整张图的样式会一条都不生效，回落成黑字、没底色、框线全丢——**这就是用户说的"黑底黑字、排版乱成一团"**。
mermaid 每次渲染的 id 本来就是随机数，根本不会撞，不需要改名。
唯一允许动的是宽度：给 \`<svg>\` 加 \`width="100%"\` 并去掉写死的 width/height 像素值。
写完 write_file 会自动查这一项，报出来说明你确实改坏了，把图重新原样贴一遍。`;
    if (config.persona) {
      p += `\n\n## 用户的个性化偏好\n${config.persona}`;
    }
    // 记忆按账号取：共享的 + 这个人自己的。别人的偏好不该串到他头上；
    // hint 是本次任务线索，记忆装不下提示词预算时按它挑最相关的
    p += await memory.promptBlock(user, hint, workspace);
    return p;
  }

  async function coordinatorSystemPrompt(user, hint, baseDir, workspace) {
    let p = await baseSystemPrompt(user, hint, baseDir, workspace);
    if (experts.length) {
      p += `\n\n## 可委派的专家（delegate_to_expert）\n`;
      p += experts
        .map((e) => `- 调用参数 expert=${JSON.stringify(e.name)}${e.alias ? `；花名=${JSON.stringify(e.alias)}（仅展示，不是调用名）` : ""}：${e.description || ""}${(e.skills || []).length ? `（擅长技能：${e.skills.join("、")}）` : ""}`)
        .join("\n");
    }
    const teams = expertTeams.filter((t) => teamMembers(t).length >= 2);
    if (teams.length) {
      p += `\n\n## 可委派的专家团（delegate_to_team，整队接力）\n`;
      p += teams.map((t) => `- ${t.name}：${t.description || "（无说明）"}｜成员依次为 ${teamMembers(t).map((e) => e.name).join(" → ")}`).join("\n");
    }
    if (experts.length) {
      p += `\n\n委派原则：
- 简单任务自己直接做，别为了"显得专业"绕一圈委派，那只是白烧 token 和时间。
- 需要单一环节的专业能力（只是查资料 / 只是做 PPT）→ delegate_to_expert。
- 一句话要走完整条流水线（调研→分析→成稿→做图/做 PPT）→ 直接 delegate_to_team，别自己一个个串。
- 委派时任务描述必须自包含：目标、输入文件名、期望产出文件名。专家看不到你和用户的对话历史。
- 拿回专家汇报后，你要自己核一遍：说生成的文件真的存在吗？结论和用户要的对得上吗？不对就补做或再委派，别直接把专家的话转述给用户就收工。`;
    }
    return p;
  }

  async function expertSystemPrompt(expert, user, hint, baseDir, workspace, emit = () => {}) {
    let p = (await baseSystemPrompt(user, hint, baseDir, workspace)) +
      '\n\n## 你的专家角色：' + expert.name + (expert.alias ? '（' + expert.alias + '）' : '') + '\n' + expert.system;
    const skills = getSkills(), loaded = [], missing = [], truncated = [];
    let remaining = 40000;
    for (const name of [...new Set(expert.skills || [])]) {
      const skill = resolveSkill(name, skills);
      if (!skill) { missing.push(name); continue; }
      if (loaded.includes(skill.name)) continue;
      loaded.push(skill.name);
      const limit = Math.min(16000, remaining);
      const content = skill.content.slice(0, limit);
      remaining -= content.length;
      p += '\n\n## 已加载的专属技能：' + skill.name + '\n';
      if (skill.hasAssets) p += '技能资源目录：' + skill.dir + '（资源相对路径以此为准；成果写回任务工作目录）\n';
      p += content;
      if (content.length < skill.content.length) {
        truncated.push(skill.name);
        p += '\n（内容较长，仅预载了部分；执行前用 use_skill 加载完整技能。）';
      }
    }
    if (missing.length) p += '\n\n⚠️ 这些绑定技能不存在：' + missing.join('、') + '。不要声称已加载，也不要反复调用不存在的技能；可用基础工具完成可行部分，受影响的部分如实报告。';
    if (loaded.length || missing.length) emit({ type: 'expert_skills', expert: expert.name, loaded, missing, truncated });
    p += '\n\n你是被主协调者委派的专家。已预载的技能直接遵循，不必重复加载完整内容。完成后简明汇报：做了什么、真实产出文件名、关键结论、未完成部分。不得把失败或被停止的步骤说成已完成。';
    return p;
  }

  const READ_ONLY_TOOLS = ["read_file", "list_files", "search_files", "fetch_url", "render_page", "web_search", "library_list", "library_read", "look_at_image", "detect_project_type", "list_background_processes", "read_process_log"];

  function toolList(depth, mode) {
    if (mode === "ask" || mode === "plan") {
      return [...TOOL_DEFS.filter((t) => READ_ONLY_TOOLS.includes(t.name)), USE_SKILL_TOOL];
    }
    const tools = [...TOOL_DEFS, USE_SKILL_TOOL, ASK_USER_TOOL, ...mcpManager.toolDefs()];
    if ((config.im || {}).feishu && (config.im.feishu.app_id || config.im.feishu.doc_app_id)) tools.push(FEISHU_DOC_TOOL);
    if (depth === 0 && experts.length) tools.push({
      ...DELEGATE_TOOL, input_schema: { ...DELEGATE_TOOL.input_schema, properties: {
        ...DELEGATE_TOOL.input_schema.properties,
        expert: { ...DELEGATE_TOOL.input_schema.properties.expert, enum: experts.map(e => e.name) },
      } },
    });
    // 团委派只给主协调者：专家在团里接力时 depth 已经 >0，再让它组团会套娃
    if (depth === 0 && expertTeams.some((t) => teamMembers(t).length >= 2)) tools.push(DELEGATE_TEAM_TOOL);
    return tools;
  }

  function modePrompt(mode) {
    if (mode === "ask") {
      return `\n\n## 当前模式：Ask（问答）\n只负责回答问题、分析与建议。可以读文件、查资料，但绝不修改文件、不执行代码、不委派专家。回答完即结束。`;
    }
    if (mode === "plan") {
      return `\n\n## 当前模式：Plan（规划）\n只做调研与规划，不实际执行。输出一份结构化执行计划：任务拆解步骤、每步用什么工具/专家、预期产出文件。最后提醒用户切换到 Craft 模式执行。`;
    }
    return `\n\n## 当前模式：Craft（执行）\n用户已经在这个模式里点了「做」，就是要你动手，不是要你确认。
- 直接改文件、直接跑命令、直接交付。**严禁**用「要不要我帮你改？」「确认后我就开始」「你希望用哪种方案？」这类话结束回合——一个回合结束时，要么活干完了，要么真的卡在只有用户本人能解决的事情上（登录、授权、付钱）。
- 方案有好几种、但**成品长得差不多**（用哪个库、代码怎么组织、跑几轮）——自己挑最稳的那个，在开场白里说一句"我按 X 来做"，然后做。做错了再改，比停在原地问强。
- 但**成品形态会完全不同的岔路，不许自己替用户挑**：封面图是 AI 生图还是自己排版截图、报告交 Word 还是 PDF 还是飞书文档、视频出横版还是竖版、文案走口播稿还是图文——这类挑错了等于整件事白做。用 ask_user 把两条路摆出来：label 写选项本身，detail 写"选了它会得到什么、代价是什么"（比如 label"AI 生图" / detail"画面有质感有氛围，但风格随机、不好复现"；label"HTML 排版截图" / detail"版式配色全可控、改起来快，但偏平面没氛围"）。detail 是用户唯一的判断依据，不许省，也不许把 label 换个说法重说一遍。拿到答案再动手。
- 用户已经点名走哪条路了（"你用生图 API 给我做"），就照他说的做——哪怕你觉得另一条更稳，也只能把风险一句话说在前面，不许拿它当理由偷偷换方案。技能文档里的推荐做法同理：那是没人表态时的默认值，不是用来推翻用户的。
- 上面禁的是**文字反问**，不是 ask_user 工具——该问就问，用 ask_user 弹选项，拿到答案接着干：
  · 开工前：需求含糊到可能白干一场，或者风格/范围/平台/受众这类选择会让交付物完全不同——先问一题再动手，比做完返工强；
  · 执行中：要花钱、不可逆、要覆盖/删除已有内容、要对外发布，或碰到只有用户本人知道的偏好（预算、口味、时间安排）。
  一次只问一个问题；问完继续干，不许连环追问，也不许拿它汇报进度。
- 需要审批的危险动作（删除、sudo、碰黑名单文件）系统会自己弹窗拦，不用你在文字里预先请示。
- **结论先行**：交给用户看的东西——回合的最终答复、报告、文档——一律先给结论和建议，再给理由和过程。用户要的是"所以呢"，不是你一步步怎么查到的。长文档第一屏必须有一段能独立读懂的摘要：结论 + 3 条关键依据 + 建议的下一步；把结论埋在第七节里，等于没写。
- **时间盒**：调研、比价、找方案这类活儿，动手前先给自己定个量（查几个来源、看几家、试几种），够了就收手写结论。信息永远查不完，"再多查一点"是最贵的拖延；没查到的写进"待验证"一节交出去，比继续查划算得多。`;
  }

  async function runToolCall(tc, { emit, depth, deadline, stats, stopSignal, user, authorizationUser, projectContext, sec, taskLabel, runToken, baseDir, workspace, llmOverride, askUser, sessionId }) {
    if (tc.name === "ask_user") {
      const question = String(tc.input.question || "").trim().slice(0, 500);
      // 选项现在是 {label, detail}，但字符串也照收：老会话回放、以及模型偷懒直接给短语的情况
      const options = (Array.isArray(tc.input.options) ? tc.input.options : [])
        .map((o) =>
          o && typeof o === "object"
            ? { label: String(o.label || "").trim().slice(0, 120), detail: String(o.detail || "").trim().slice(0, 200) }
            : { label: String(o).trim().slice(0, 120), detail: "" }
        )
        .filter((o) => o.label)
        .slice(0, 6);
      if (!question) return { content: "question 不能为空。", isError: true };
      if (!askUser) {
        // IM/定时任务/评测这类无人值守场景没有回答通道，别傻等
        return { content: "当前是无人值守运行，没人在线回答。按你判断的最合理默认继续做，并在最终汇报里注明你替用户做了什么假设。", isError: false };
      }
      const askId = "ask_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const timeoutMs = Math.max(30000, Number(config.agent.ask_user_timeout_ms) || 300000);
      emit({ type: "ask_user", ask_id: askId, question, options, timeout_ms: timeoutMs, depth });
      const t0 = Date.now();
      const answer = await askUser({ askId, question, options, timeoutMs });
      const waited = Date.now() - t0;
      if (answer == null) {
        emit({ type: "ask_answer", ask_id: askId, timeout: true, depth });
        return { content: `等了 ${Math.round(waited / 1000)} 秒，用户没有回应。按你判断的最合理默认继续做，并在最终汇报里注明你替用户做了什么假设，别再重复问。`, isError: false, extendMs: waited };
      }
      emit({ type: "ask_answer", ask_id: askId, answer, depth });
      // 选中的那条路把 detail 一并回填：那句话是你自己写的承诺，照着它做，别选完就忘
      const picked = options.find((o) => o.label === answer);
      return {
        content: `用户的回答：${answer}` + (picked && picked.detail ? `（这条路你自己写的是：${picked.detail}——照它做）` : ""),
        isError: false,
        extendMs: waited,
      };
    }
    if (tc.name === "use_skill") {
      const skills = getSkills();
      const skill = resolveSkill(tc.input.name, skills);
      // folder 型技能自带 scripts/templates 等资源，动态告知 agent 技能目录的绝对路径
      const dirNote = skill && skill.hasAssets
        ? `【技能目录】${skill.dir}\n该技能自带 scripts/templates 等资源文件（在上述目录内，不在工作目录）。技能文档里的相对路径都相对这个目录；运行其脚本用 run_shell 先 cd 进该目录，但产出的成果文件仍要写到工作目录。\n\n`
        : "";
      return skill
        ? { content: dirNote + skill.content, isError: false }
        : { content: `技能不存在: ${tc.input.name}。可用: ${skills.map((s) => s.name).join(", ")}`, isError: true };
    }
    if (mcpManager.isMcpTool(tc.name)) {
      return await mcpManager.call(tc.name, tc.input);
    }
    if (tc.name === "feishu_doc_create") {
      try {
        const { createFeishuDoc } = require("./feishu-doc");
        // 图片路径以项目根目录为准，兼容旧会话的辅助目录；越界一律拒绝。
        const resolveImage = async (rel) => resolveProjectImage(rel, baseDir, workspace);
        const r = await createFeishuDoc((config.im || {}).feishu, tc.input, { deadline, stopSignal, resolveImage });
        return {
          content: `飞书文档已创建：${r.url}（${r.blocks} 个内容块${r.images ? `，含 ${r.images} 张图` : ""}）${r.warn ? `\n⚠️ ${r.warn}` : ""}\n请把这个链接告诉用户。`,
          isError: false,
        };
      } catch (e) {
        return { content: `创建飞书文档失败：${e.message}`, isError: true };
      }
    }
    if (tc.name === "delegate_to_expert" || tc.name === "delegate_to_team") {
      if (depth > 0) return { content: "专家不能再委派他人，请直接完成任务。", isError: true };
      const task = typeof tc.input.task === "string" ? tc.input.task.trim() : "";
      if (!task) return { content: "委派任务不能为空，请提供目标、输入和交付要求。", isError: true };
      const runExpert = async (expert, brief, team) => {
        emit({ type: "expert_start", expert: expert.name, team, task: brief, depth });
        let status = "failed", stopped = null;
        try {
          const sub = await runTask({
            projectContext, history: [{ role: "user", content: brief }],
            emit: ev => emit({ ...ev, expert: expert.name, ...(team ? { team } : {}) }),
            systemPrompt: await expertSystemPrompt(expert, user, task.slice(0, 500), baseDir, workspace,
              ev => emit({ ...ev, team, depth: depth + 1 })),
            depth: depth + 1, user, authorizationUser, taskLabel, runToken, baseDir, workspace, sessionId,
            deadline, stats, stopSignal, sec, llmOverride, askUser,
          });
          stopped = sub.stopped;
          status = stopped ? "stopped" : "completed";
          return sub;
        } finally {
          emit({ type: "expert_done", expert: expert.name, team, depth, status, stopped });
        }
      };
      if (tc.name === "delegate_to_expert") {
        let expert;
        try { expert = resolveExpert(tc.input.expert, experts); }
        catch (error) { return { content: error.message, isError: true }; }
        const sub = await runExpert(expert, task);
        return { content: '【专家 ' + expert.name + ' 的汇报】\n' + (sub.finalText || '(无文字汇报)'), isError: !!sub.stopped };
      }
      const team = expertTeams.find(t => t.name === String(tc.input.team || "").trim());
      if (!team) return { content: '专家团不存在：' + tc.input.team, isError: true };
      const members = teamMembers(team);
      if (members.length < 2) return { content: '专家团「' + team.name + '」的有效成员不足 2 人。', isError: true };
      emit({ type: "team_start", team: team.name, members: members.map(m => m.name), task, depth });
      const reports = [];
      let completed = 0, status = "failed", reason = "";
      try {
        for (let i = 0; i < members.length; i++) {
          if (stopSignal && stopSignal.aborted) { reason = "用户已停止"; break; }
          if (Date.now() >= deadline) { reason = "全队已达最大运行时间"; break; }
          if (config.agent.max_tokens_budget > 0 && stats.prompt + stats.completion >= config.agent.max_tokens_budget) { reason = "全队已达 token 预算"; break; }
          const member = members[i];
          emit({ type: "team_progress", team: team.name, expert: member.name, index: i + 1, total: members.length, completed, depth });
          // 限制接力汇报长度；完整产物始终可从共享且固定的工作目录读取。
          const brief = '【全队任务】' + task + '\n\n【你的位置】第 ' + (i + 1) + '/' + members.length + ' 棒' +
            (i === members.length - 1 ? '（最后一棒，负责最终交付与核验）' : '') + '\n\n' +
            (reports.length ? '【前面同事的汇报】\n' + reports.map(r => '— ' + r.name + '：\n' + r.text.slice(-6000)).join('\n\n') + '\n\n只做你这一棒的工作，复用同事产物；需要完整上下文时读取文件。' : '你是第一棒，先完成自己的专业环节并留下可复用的产物。');
          const sub = await runExpert(member, brief, team.name);
          reports.push({ name: member.name, text: sub.finalText || '(无文字汇报)' });
          if (sub.stopped) { reason = member.name + ' 未完成：' + sub.stopped; break; }
          completed++;
        }
        status = completed === members.length ? "completed" : "stopped";
        return {
          content: '【专家团「' + team.name + '」的全队汇报】（' + completed + '/' + members.length + ' 棒完成）' +
            (reason ? '\n⚠️ ' + reason + '；余下成员未执行，不得声称全队完成。' : '') + '\n\n' +
            reports.map(r => '— ' + r.name + '：\n' + r.text).join('\n\n'),
          isError: status !== "completed",
        };
      } catch (error) {
        reason = error.message;
        return { content: '专家团「' + team.name + '」执行失败（' + completed + '/' + members.length + ' 棒完成）：' + reason + '\n' + reports.map(r => r.name + '：' + r.text).join('\n\n'), isError: true };
      } finally {
        emit({ type: "team_done", team: team.name, status, completed, total: members.length, reason, depth });
      }
    }

    return await executeTool(tc.name, tc.input, {
      knownTools: toolList(depth, "craft").map((t) => t.name), // 拼错工具名时用来给出最接近的真名
      timeoutMs: config.agent.tool_timeout_ms,
      onStatus: (text, progress) => emit({ type: "status", text, depth, id: tc.id, name: tc.name, ...progress }),
      search: config.search,
      media: config.media,
      currentModel: tc.name === "look_at_image" ? currentModelChannel(llmOverride || llm, config) : undefined,
      // IM/定时等无人值守场景可传 sec 覆盖权限档位（没人守着屏幕点审批）
      security: sec || config.security,
      deadline,
      stopSignal,
      taskLabel, // 审批卡片上标明发起任务，多任务并行时才分得清是谁在求批
      baseDir, // 会话辅助目录；正式项目文件与命令仍以项目根目录为基准
      projectRoot: true,
      workspace, // Fix C: 钉死本次运行的工作目录，不读全局
      sessionId, // 后台进程按会话登记，list_background_processes 才分得清是谁起的
      memory: { user, workspace },
      user, authorizationUser, runToken,
    });
  }


  /**
   * 强制收尾时的最后一句话。不给工具、单独一小段超时预算（撞的就是时间上限，不能再等 5 分钟），
   * 失败就悄悄算了——收尾说明没拿到，也不该把整个任务变成一次报错。
   */
  async function wrapUp({ history, system, stopNote, emit, depth, stats, llmOverride }) {
    history.push({
      role: "user",
      content: `【系统】任务已到上限被强制收尾（${stopNote}）。现在不要再调用任何工具，直接给用户一段收尾说明：
1. 已经做完了什么、产出了哪些文件（只写真实存在的文件名，没生成就别写）；
2. 还差哪些没做完；
3. 下次接着做的话，从哪一步继续最省事。
用中文，简明扼要，不要客套。`,
    });
    try {
      trimHistory(history, ctxBudget(config)); // 最后一次工具输出可能刚把上下文顶爆，先压一压
      const result = await (llmOverride || llm).chat({
        system,
        history,
        tools: [],
        signal: AbortSignal.timeout(Math.min(90000, config.agent.llm_timeout_ms || 300000)),
        onTextDelta: (delta) => emit({ type: "text", delta, depth }),
      });
      if (result.usage) {
        stats.prompt += result.usage.prompt;
        stats.completion += result.usage.completion;
        stats.cached = (stats.cached || 0) + (result.usage.cached || 0);
        stats.calls++;
      }
      history.push({ role: "assistant", text: result.text, toolCalls: [], raw: result.raw });
      return result.text || "";
    } catch (e) {
      console.warn("[agent] 收尾说明没拿到:", e.message);
      history.pop(); // 把那条【系统】指令撤掉，免得下一轮对话里挂着一句没人回的话
      return "";
    }
  }

  // ── 长会话自动压缩 ──────────────────────────────────────────────
  // trimHistory 只截工具输出，对话轮永不清理：会话越聊越大越钝越贵，模型还会拿
  // 自己几十轮前的旧话当依据（「发不了文件」的幻觉就是这么反复复发的）。
  // 超阈值时把早期轮次交给模型浓缩成一条接手摘要，只留最近几轮原文。
  const COMPACT_MARK = "【系统·上下文压缩】";
  /** 从被压缩的轮次里机械提取读/改过的文件，并把上一份摘要里的清单接续下来。
   *  清单不靠摘要模型转述（模型会丢文件名），跨多次压缩累计（借鉴 pi 的 cumulative file tracking）。 */
  function collectFileOps(old) {
    const read = new Set(), wrote = new Set();
    for (const e of old) {
      if (e.role === "assistant") {
        for (const c of e.toolCalls || []) {
          const p = String((c.args || c.input || {}).path || "").trim();
          if (!p) continue;
          if (c.name === "read_file") read.add(p);
          else if (c.name === "write_file" || c.name === "edit_file") wrote.add(p);
        }
      } else if (e.role === "user" && String(e.content || "").startsWith(COMPACT_MARK)) {
        const s = String(e.content);
        const grab = (label, set) => {
          const m = new RegExp(`【${label}】([^\\n]*)`).exec(s);
          if (m) for (const f of m[1].split("、")) { const t = f.trim(); if (t && t !== "无") set.add(t); }
        };
        grab("读过的文件", read);
        grab("改过的文件", wrote);
      }
    }
    for (const p of wrote) read.delete(p); // 改过的不用再占「读过」的位置
    const cap = (set) => Array.from(set).slice(-40).join("、") || "无";
    return { read: cap(read), wrote: cap(wrote) };
  }
  /**
   * force / budgetOverride：撞上模型上下文硬上限后的抢救模式。
   * 常规压缩是「为了省钱和防钝」，可以挑时机、不划算就不压；抢救模式是「不压这一步就没得跑了」，
   * 所以三道保险全部让路：用户关了自动压缩也压、没到阈值也压、旧轮次不够肉也压。
   */
  async function compactHistory(history, { emit = () => {}, stats, force = false, budgetOverride = 0 } = {}) {
    if (!force && (config.agent || {}).compact === false) return;
    const budget = budgetOverride || ctxBudget(config);
    const threshold = force ? budget : (config.agent.compact_threshold_chars || Math.floor(budget * 0.6));
    if (historyChars(history) <= threshold) return;
    // 抢救模式下保留轮数收到 2：留太多就压不出空间，而空间不够整个任务就没了
    const keepTurns = force ? 2 : (config.agent.compact_keep_turns || 8);
    const userIdx = [];
    history.forEach((e, i) => { if (e.role === "user") userIdx.push(i); });
    // 首选切在用户轮开头（工具调用/结果永远成对保留）。轮次不够切 = 单轮长跑任务把上下文
    // 顶爆了，退到「分轮压缩」（借鉴 pi 的 split turn）：在助手消息边界下刀，把任务早期的
    // 几十步浓缩掉。不做这一步的话，长任务中途只能靠 trimHistory 盲截，早期结论全丢。
    let cut = userIdx.length > keepTurns ? userIdx[userIdx.length - keepTurns] : -1;
    let splitMode = false;
    if (cut < 1) {
      // 抢救模式按缩小后的预算算保留量，不然还是照老预算留一大坨，等于没压
      const keepChars = force
        ? Math.max(8000, Math.floor(budget / 2))
        : (config.agent.compact_keep_chars || DEFAULT_COMPACT_KEEP_CHARS);
      let acc = 0;
      for (let i = history.length - 1; i >= 1; i--) {
        acc += entryChars(history[i]);
        if (acc >= keepChars) {
          // 边界只能落在 user/assistant 开头：切在 tool 前面会把工具结果和它的调用拆散。
          // 往前（更早）找最近的非 tool 条目——越界点常落在工具结果上，它所属的调用必须一起保留
          for (let j = i; j >= 1; j--) if (history[j].role !== "tool") { cut = j; break; }
          break;
        }
      }
      if (cut < 1) return;
      splitMode = true;
    }
    const old = history.slice(0, cut);
    // 大头字符都在保留的最近几轮里时，压旧轮次省不下几个字符，总量照样超阈值，
    // 下一步又会再触发——变成每步烧一次总结调用的死循环。旧轮次不够肉就不压。
    // 抢救模式下门槛降到 2000：能省一点是一点，但太小就会「压完反而更长」（摘要本身有几百字）
    if (historyChars(old) < (force ? 2000 : 8000)) return;
    // 老轮次转成纯文本转写；工具结果只留个头，摘要模型不需要全文
    const lines = [];
    for (const e of old) {
      if (e.role === "user") lines.push("用户：" + String(e.content || "").slice(0, 2000));
      else if (e.role === "assistant") {
        if (e.text) lines.push("助手：" + String(e.text).slice(0, 2000));
        for (const c of e.toolCalls || []) lines.push(`（调用 ${c.name} ${JSON.stringify(c.args || c.input || {}).slice(0, 200)}）`);
      } else if (e.role === "tool") {
        for (const r of e.results || []) lines.push("（工具结果：" + String(r.content || "").replace(/\s+/g, " ").slice(0, 300) + "）");
      }
    }
    let transcript = lines.join("\n");
    if (transcript.length > 60000) transcript = "…（更早部分略）\n" + transcript.slice(-60000); // 压缩请求本身也别把上下文顶爆
    const fileOps = collectFileOps(old);
    // 分轮压缩会把本任务的原始指令一起压掉，摘要没写好任务就跑偏——指令原文机械保留，不过模型的手
    let lastInstr = "";
    if (splitMode) {
      for (let i = old.length - 1; i >= 0; i--) {
        const e = old[i];
        if (e.role !== "user") continue;
        const c = String(e.content || "");
        if (c.startsWith(COMPACT_MARK) || c.startsWith("【系统")) continue;
        lastInstr = c.replace(/\s+/g, " ").slice(0, 2000);
        break;
      }
      // 连续多次分轮压缩后，原始指令只活在上一份摘要里——像文件清单一样机械接续，不能靠摘要模型转述
      if (!lastInstr) {
        for (let i = old.length - 1; i >= 0 && !lastInstr; i--) {
          const e = old[i];
          if (e.role !== "user" || !String(e.content || "").startsWith(COMPACT_MARK)) continue;
          const m = /【最近的用户指令原文】([^\n]*)/.exec(String(e.content));
          if (m) lastInstr = m[1].trim();
        }
      }
    }
    const result = await llm.chat({
      system:
        "你是会话压缩器。把用户给你的对话转写压成一份接手备忘录，严格按以下结构写（没内容的小节写「无」）：\n" +
        "## 目标\n## 已完成\n## 进行中 / 卡住\n## 关键决定（附原因）\n## 下一步\n## 关键上下文\n" +
        "「关键上下文」放继续干活必需的硬事实：路径、命令、报错原文、用户表达过的偏好与纠正。\n" +
        "只写事实不评论，文件名和关键数字一个都别丢。800 字以内，中文。",
      history: [{ role: "user", content: "以下是需要压缩的对话转写：\n\n" + transcript }],
      tools: [],
      signal: AbortSignal.timeout(60000),
    });
    if (result.usage && stats) { stats.prompt += result.usage.prompt; stats.completion += result.usage.completion; stats.cached = (stats.cached || 0) + (result.usage.cached || 0); stats.calls++; }
    const summary = String(result.text || "").trim();
    if (!summary) return;
    // 先归档再动刀：压缩只做搬家不做销毁，真要翻旧账去 data/compact-archive 找
    try {
      const dir = dataPath("data", "compact-archive");
      await writeJsonAtomicAsync(path.join(dir, `${Date.now()}.json`), old, { pretty: true, backup: false });
    } catch (e) { console.warn("[agent] 压缩归档失败（不拦压缩）:", e.message); }
    history.splice(0, cut, {
      role: "user",
      content:
        `${COMPACT_MARK}以下是本会话更早内容的自动摘要（原文已归档）：\n${summary}\n` +
        (lastInstr ? `【最近的用户指令原文】${lastInstr}\n` : "") +
        `【读过的文件】${fileOps.read}\n【改过的文件】${fileOps.wrote}\n` +
        `（摘要结束。把以上当作既定事实继续，不必向用户复述；若与用户最新要求冲突，以最新要求为准。）`,
    });
    emit({ type: "compact", removed: old.length });
    console.log(`[agent] 上下文已压缩（${splitMode ? "任务分轮" : "会话轮次"}）：${old.length} 条 → 1 条摘要（现约 ${historyChars(history)} 字符）`);
  }

  /**
   * 运行一次 Agent 任务循环。
   * @param history 统一格式会话历史（会被就地追加）
   * @param emit    事件回调（SSE / IM 进度）
   * @returns { finalText }
   */
  // 并行任务共用一个工作目录：文件的某个版本（文件名+mtime）谁的差异检测先认领就归谁，
  // 别的任务再看到同一版本就不算自己的成果——不然 A 对话刚生成的文件会出现在 B 对话的成果卡片里。
  // 文件再次被改（mtime 变了）允许重新认领。账本只是去重提示，清掉最多短暂多报，不丢数据。
  const fileClaims = new Map(); // name -> { owner, mtime }
  let runSeq = 0;

  async function runTask(args) {
    const ownsDirectoryTask = !args.depth;
    const runToken = args.runToken ?? require("crypto").randomUUID();
    const security = require("./security");
    const authorizationUser = args.authorizationUser ?? args.user;
    if (ownsDirectoryTask) security.beginDirectoryTask(authorizationUser, runToken, args.stopSignal);
    try {
      return await runTaskBody({ ...args, authorizationUser, runToken });
    } finally {
      // 包住 system prompt 等初始化，正常、异常、abort 均清理；专家不清理父任务授权。
      if (ownsDirectoryTask) security.endDirectoryTask(authorizationUser, runToken);
    }
  }

  async function runTaskBody({ history, emit = () => {}, delegation, systemPrompt, depth = 0, mode = "craft", deadline, stats, stopSignal, getInterject, user, authorizationUser, projectContext, sec, taskLabel, runToken, baseDir, workspace, llmOverride, askUser, sessionId }) {
    let L = llmOverride || llm; // 按对话选的模型：整棵任务树（含专家）都用它；中途换道后，之后委派的专家也跟着走新渠道
    if (!runToken) runToken = ++runSeq; // 专家子任务从父任务继承，同一任务树内不互相抢认领
    // 项目指令：用户在「项目」里写的背景/规范。不进提示词的话，那个输入框就是个摆设
    const projBlock = projectContext ? `\n\n## 当前项目的背景与规范（用户在项目设置里写的，必须遵守）\n${projectContext}` : "";
    // 记忆召回的线索：用户最后一条消息的前 500 字。记忆超预算时按它挑相关条目
    const lastUserMsg = [...history].reverse().find((e) => e && e.role === "user" && typeof e.content === "string");
    const memHint = lastUserMsg ? lastUserMsg.content.slice(0, 500) : "";
    let system = (systemPrompt || (await coordinatorSystemPrompt(user, memHint, baseDir, workspace))) + projBlock + modePrompt(mode);
    const route = depth === 0 ? selectDelegation({ delegation, message: lastUserMsg && lastUserMsg.content, mode, experts, teams: expertTeams, autoDelegate: config.agent.auto_delegate !== false }) : null;
    const tools = toolList(depth, mode).filter(t => !(route && route.type === "none" && t.name.startsWith("delegate_")));
    const allowedTools = new Set(tools.map(t => t.name));
    let pendingDelegation = route && route.type !== "none" ? {
      id: 'dispatch_' + require('crypto').randomUUID(),
      name: route.type === 'team' ? 'delegate_to_team' : 'delegate_to_expert',
      input: { [route.type]: route.name, task: delegationBrief(history) },
    } : null;
    if (route) {
      emit({ ...route, targetType: route.type, type: "delegation", depth });
      system += route.type === "none" ? '\n\n本轮禁止专家委派，由你直接处理。' :
        '\n\n系统已按本轮协作策略安排' + (route.type === 'team' ? '团队' : '专家') + '「' + route.name + '」。其工具结果是实际执行汇报；复用产物并核验，只补未完成的部分，不要无理由重复派发同一任务。失败或中止必须如实说明。';
    }
    const maxSteps = config.agent.max_steps || 25;
    // 整个任务（含所有专家子代理）共享一个墙上时间预算，防止无限执行
    if (!deadline) deadline = Date.now() + (config.agent.max_runtime_ms || 1800000);
    // 整个任务（含专家）共享一份 token 账本，任务结束时汇总上报
    if (!stats) stats = { prompt: 0, completion: 0, cached: 0, calls: 0, startedAt: Date.now() };
    let finalText = "";
    let stopNote = "";
    let honestyRetries = 0;
    let trimmedChars = 0; // 本次任务累计被上下文预算截掉的工具输出字符数
    let ctxRescues = 0; // 撞上模型上下文硬上限后的抢救式压缩次数（最多 3 次，之后才认输收尾）
    // 备用渠道换道：主模型挂起或服务端持续报错时，切到用户在设置里显式选好的备用渠道接着跑本任务。
    // 默认关（agent.failover_model 为空）。红线：绝不静默降级——只有用户亲手选了备用渠道才换，换道必须大声播报。
    // 每个任务（含每位专家的子任务）最多换一次道：备用渠道也挂了就如实收尾，不搞换道链
    let failedOver = false;
    const switchToBackup = (reason) => {
      const name = String((config.agent || {}).failover_model || "").trim();
      if (!name || failedOver) return false;
      if ((L.provider || "") === name) return false; // 当前就跑在这条渠道上（主选=备用），没有道可换
      if (!(config.models || []).some((m) => m.name === name)) return false; // 渠道已被删掉，配置过期
      try { L = makeLLM({ ...config, active_model: name }); }
      catch (e) { console.warn("[agent] 备用渠道创建失败:", e.message); return false; }
      failedOver = true;
      emit({ type: "failover", note: `${reason}，已切换到备用渠道「${name}」继续本任务`, channel: name, depth });
      return true;
    };
    // 睡眠治理：任务运行期间按住「别睡」断言（并行任务引用计数）；真睡过去了就把
    // 时限顺延、把本步的卡壳计时清零——睡眠既不算任务时间，也不算模型安静时间
    const releaseAwake = awake.hold();
    let curStallReset = null; // 当前这一步的卡壳计时器复位函数，睡醒后先复位再谈超时
    const unwatchSleep = awake.watch((sleptMs) => {
      deadline += sleptMs;
      if (curStallReset) { try { curStallReset(); } catch {} }
      if (depth === 0) emit({ type: "sleep", ms: sleptMs, note: `检测到本机睡眠 ${Math.round(sleptMs / 1000)} 秒，任务时限已顺延（睡眠不算任务时间）`, depth });
    });
    try {
    // 卡循环检测：同一工具+同一入参反复拿到同一结果 = 在死路上空转。3 连提醒换思路，5 连直接拦截不执行。
    // 键里必须带结果指纹，才不会误伤「改一遍读一遍」的正常校验循环——文件改了，读回来的内容就变了，计数自动清零
    const loopHist = new Map(); // 工具名+入参 → { sig: 上次结果指纹, streak: 连续拿到相同结果的次数 }
    const errStreaks = new Map(); // 工具名 → 连续报错次数（换着参数撞同一堵墙也算）
    const loopNudged = new Set(); // 每个键只提醒一次，别变成新的噪音循环
    // 任务开始时先记一份工作目录快照，files 事件带上「这一轮真正新增/改动的文件」。
    // 这件事必须在服务端算：前端那份 mtime 快照是活的，历史回放时早就对不上了，算出来永远是空。
    const baseline = new Map();
    for (const f of await outputFiles(workspace)) baseline.set(f.name, f.mtime);
    const emitFiles = async () => {
      const files = await outputFiles(workspace);
      const changed = [];
      for (const f of files) {
        const isNew = baseline.get(f.name) !== f.mtime;
        baseline.set(f.name, f.mtime);
        if (!isNew) continue;
        const claimKey = path.resolve(workspace || getWorkspaceDir(), f.name);
        const claim = fileClaims.get(claimKey);
        // 同一版本已被别的并行任务认领 → 是它的产出。仍有一个小窗口：对方写完文件但
        // 它那步工具还没跑完、没来得及认领——误报也只是多摆一张卡片，不丢文件
        if (claim && claim.owner !== runToken && claim.mtime === f.mtime) continue;
        fileClaims.set(claimKey, { owner: runToken, mtime: f.mtime });
        changed.push(f.name);
      }
      if (fileClaims.size > 1000) fileClaims.clear();
      emit({ type: "files", files, changed });
      // 长跑可见性：进度档一有更新就把里程碑清单推给前端，时间线卡片实时打勾
      const progName = changed.find((n) => n.split("/").pop() === "PROGRESS.md");
      if (progName) {
        try {
          const raw = await readProgressFile(workspace, progName, 20000);
          const items = [];
          for (const line of raw.split("\n")) {
            const m = /^\s*[-*]\s*\[([ xX])\]\s*(.+)/.exec(line);
            if (m) items.push({ text: m[2].trim().slice(0, 120), done: m[1] !== " " });
            if (items.length >= 60) break;
          }
          if (items.length) emit({ type: "milestones", file: progName, items, depth });
        } catch {}
      }
    };

    // 长会话先压缩再开跑：只在顶层任务做（专家子任务的 history 是临时的，压不着）
    if (depth === 0) {
      try { await compactHistory(history, { emit, stats }); }
      catch (e) { console.warn("[agent] 上下文压缩失败，本次跳过:", e.message); }
    }

    // 自动续跑：撞「最大步数/最大运行时间」后自动开下一轮接着干（仅顶层任务；手动停止、模型挂死不续跑）。
    // 外层 for(;;) 只负责续跑判定，内层步循环保持原缩进不动。
    const autoRounds = depth === 0 ? Math.min(20, Math.max(0, Number(config.agent.auto_continue_rounds) || 0)) : 0;
    let roundsUsed = 0;
    for (;;) {
    for (let step = 0; step < maxSteps; step++) {
      if (stopSignal && stopSignal.aborted) {
        stopNote = "已手动停止";
        break;
      }
      // 插队消息：在两次模型调用之间的安全间隙注入（工具结果已闭合，不会写坏 tool_calls 序列）
      if (getInterject) {
        for (const m of getInterject()) {
          history.push({ role: "user", content: `【用户插话（在任务执行中补充）】${m}` });
          emit({ type: "interject", text: m, depth });
        }
      }
      if (Date.now() >= deadline) {
        stopNote = `已达最大运行时间（${Math.round((config.agent.max_runtime_ms || 1800000) / 60000)} 分钟）`;
        break;
      }
      // token 预算护栏：步数和时间都挡不住「小步快跑」式烧钱，按用量再设一道闸（0 = 不限）。
      // stats 整棵任务树共享，专家子代理花的也算；到 80% 先提醒一次，超了强制收尾且不自动续跑
      const tokBudget = Math.max(0, Math.round(+config.agent.max_tokens_budget || 0));
      if (tokBudget) {
        const used = stats.prompt + stats.completion;
        if (used >= tokBudget) {
          stopNote = `已达 token 预算（已用 ${used.toLocaleString()}，预算 ${tokBudget.toLocaleString()}）`;
          break;
        }
        if (!stats.budgetWarned && used >= tokBudget * 0.8) {
          stats.budgetWarned = true;
          emit({ type: "status", text: `token 用量已到预算的 ${Math.round((used / tokBudget) * 100)}%（${used.toLocaleString()} / ${tokBudget.toLocaleString()}），超出后任务会强制收尾`, depth });
        }
      }
      emit({ type: "step_start", step: step + 1, depth });

      // 发请求前先把老工具结果压进上下文预算，宁可丢细节也不能让整个任务撞 400 全丢
      // 超阈值时先智能压缩（老步骤浓缩成接手摘要），压不动再盲截。没有这一步，
      // 跑到几十步的长任务只能靠 trimHistory 把早期工具输出截成空壳，模型越跑越失忆
      try { await compactHistory(history, { emit, stats }); }
      catch (e) { console.warn("[agent] 任务中压缩失败，本步跳过:", e.message); }
      const trimmed = trimHistory(history, ctxBudget(config));
      if (trimmed) {
        trimmedChars += trimmed;
        console.warn(`[agent] 上下文超预算，已截断历史工具输出 ${trimmed} 字符（depth=${depth} step=${step + 1}）`);
        // 丢了东西就明说，别让用户以为模型一直看得见全部原文
        emit({ type: "trim", chars: trimmedChars, depth });
      }

      // 模型调用超时按「卡壳」判定，不是总时长硬顶：写大文件时全部输出走工具参数流，
      // 界面上一个字都看不到，按总时长掐会误杀正常的长生成。只要还有数据块在流（正文/思考/工具参数），
      // 计时器就一直重置；连续 llm_timeout_ms 收不到任何数据才算挂死。总时长由任务 deadline 兜底
      const stepSusMark = awake.totalSuspendedMs(); // 本步开跑时的累计睡眠数，用来识别「睡出来的假超时」
      const stallMs = Math.max(10000, Math.min(deadline - Date.now(), config.agent.llm_timeout_ms || 300000));
      const stallCtl = new AbortController();
      let stallTimer = setTimeout(() => stallCtl.abort(), stallMs);
      let lastData = Date.now();
      const onActivity = () => {
        lastData = Date.now();
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => stallCtl.abort(), stallMs);
      };
      curStallReset = onActivity; // 睡醒后先把卡壳计时清零：睡眠不算模型安静时间
      // 模型迟迟不吐字时界面完全静止，用户分不清「在想」和「挂了」——超过一分钟就报安静了多久
      const heartbeat = setInterval(() => {
        const quiet = Math.round((Date.now() - lastData) / 1000);
        if (quiet >= 60) emit({ type: "status", text: `模型已 ${quiet} 秒没有输出，仍在等待（连续 ${Math.round(stallMs / 1000)} 秒无输出将判定挂起并停止）`, depth });
      }, 30000);
      const budgetSignal = AbortSignal.timeout(Math.max(10000, deadline - Date.now()));
      const signal = AbortSignal.any
        ? AbortSignal.any([stallCtl.signal, budgetSignal, ...(stopSignal ? [stopSignal] : [])])
        : stallCtl.signal;
      let result;
      try {
        if (pendingDelegation) {
          // 系统生成合法的 assistant/tool 配对，复用正常工具执行、停止、计费和事件链；不让模型跳过用户选择。
          result = { text: "", toolCalls: [pendingDelegation] };
          pendingDelegation = null;
        } else result = await L.chat({
          system,
          history,
          tools,
          signal,
          onActivity,
          onStatus: (text) => emit({ type: "status", text, depth }),
          onTextDelta: (delta) => emit({ type: "text", delta, depth }),
          // 断流重试前撤掉已经吐出去的半段正文，否则重试生成的新一段会接在残段后面，
          // 用户看到同一段话说两遍（前半段往往还是截断的病句）
          onTextReset: (chars) => emit({ type: "text_reset", chars, depth }),
        });
      } catch (e) {
        if (e.name === "TimeoutError" || e.name === "AbortError") {
          const manual = stopSignal && stopSignal.aborted;
          const stalled = stallCtl.signal.aborted;
          // 睡眠假超时：本步期间真睡过、时限也已顺延到未来——不管开枪的是卡壳闹钟还是
          // 总时长闹钟，都是睡醒后过期计时器误开枪，直接重试本步（模型没得到过那些时间的 CPU）
          if (!manual && awake.totalSuspendedMs() > stepSusMark && Date.now() < deadline - 1000) {
            step--;
            continue;
          }
          // 挂起换道：只有「真挂起」才换——手动停止、任务总时长到点都不算；剩余时间太少也不值得换道重试
          if (!manual && stalled && Date.now() < deadline - 30000 &&
              switchToBackup(`主模型连续 ${Math.round(stallMs / 1000)} 秒无输出（疑似挂起）`)) {
            step--; // 重试当前步（finally 会先清掉本步的计时器）
            continue;
          }
          stopNote = manual
            ? "已手动停止"
            : stalled
              ? `模型响应超时（连续 ${Math.round(stallMs / 1000)} 秒没有任何输出，连接已挂起）`
              : "已达最大运行时间";
          break;
        }
        // 上下文爆了：这不是死路，别把整个任务连同已经做完的活一起抛掉。
        // 大型项目里一次任务可能已经跑了几十步、写了十几个文件，就为最后一步喂多了几万字符
        // 而全盘失败，用户等于白干一场。这里就地抢救：强行把预算砍半 + 只留最近 1 轮工具原文
        // 重截历史，能压出空间就重试本步。连压 3 次还塞不进去才认输——那是真的没救了。
        if (isContextOverflowError(e) && ctxRescues < 3 && Date.now() < deadline - 20000) {
          ctxRescues++;
          const before = historyChars(history);
          // 逐次收紧：预算按 1/2、1/4、1/8 砍，保留轮数也一路收到 1
          const shrunk = Math.max(20000, Math.floor(ctxBudget(config) / Math.pow(2, ctxRescues)));
          const saved = trimHistory(history, shrunk, Math.max(1, 3 - ctxRescues));
          // 截工具输出还不够（大头在对话轮里）就再强压一次摘要，把早期轮次浓缩掉
          if (historyChars(history) > shrunk) {
            try {
              await compactHistory(history, {
                emit,
                stats,
                force: true,
                budgetOverride: shrunk,
              });
            } catch (ce) { console.warn("[agent] 抢救式压缩失败:", ce.message); }
          }
          const after = historyChars(history);
          trimmedChars += saved;
          console.warn(`[agent] 上下文撞上模型上限，已抢救压缩 ${before} → ${after} 字符（第 ${ctxRescues} 次），重试本步`);
          // 一个字都没压掉 = 再重试也是同一个 400，别空转烧钱，直接认输走收尾
          if (after >= before) {
            stopNote = `上下文超出模型上限，且历史已无可压缩空间（约 ${Math.round(after / 1000)} 千字符）`;
            break;
          }
          emit({
            type: "status",
            text: `上下文超出模型上限，已自动压缩历史（${Math.round(before / 1000)} → ${Math.round(after / 1000)} 千字符）并重试本步，任务继续`,
            depth,
          });
          emit({ type: "trim", chars: trimmedChars, depth });
          step--; // 重试当前步，已完成的工作全部保留
          continue;
        }
        // 服务端硬错误（Service is too busy / 欠费 / 5xx 等）：llm 层同渠道重试用尽才会走到这。
        // 配了备用渠道就换道重试本步；没配就照旧抛出，任务如实失败——这是用户钦定的默认行为
        if (Date.now() < deadline - 30000 &&
            switchToBackup(`主模型持续报错（${String(e.message || e).slice(0, 120)}）`)) {
          step--;
          continue;
        }
        throw e;
      } finally {
        clearTimeout(stallTimer);
        clearInterval(heartbeat);
      }

      if (result.usage) {
        stats.prompt += result.usage.prompt;
        stats.completion += result.usage.completion;
        stats.cached = (stats.cached || 0) + (result.usage.cached || 0);
        stats.calls++;
      }
      history.push({
        role: "assistant",
        text: result.text,
        toolCalls: result.toolCalls,
        raw: result.raw,
      });
      if (result.text) finalText = result.text;

      if (!result.toolCalls.length) {
        // 成果核验：声称已生成的文件不在磁盘上、或者只是个 0 字节空壳 → 打回去重做（最多打回 2 次）
        const bad = await missingDeliverables(result.text, workspace);
        if (bad.length && honestyRetries < 2 && Date.now() < deadline - 30000) {
          honestyRetries++;
          const gone = bad.filter((b) => b.why === "missing").map((b) => b.name);
          const empty = bad.filter((b) => b.why === "empty").map((b) => b.name);
          const parts = [];
          if (gone.length) parts.push(`磁盘上根本不存在：${gone.slice(0, 5).join("、")}`);
          if (empty.length) parts.push(`文件在但是 0 字节空文件：${empty.slice(0, 5).join("、")}`);
          const list = parts.join("；");
          history.push({
            role: "user",
            content: `【系统自动核验】你上一条回复声称已生成/可获取这些文件，但核验不通过——${list}。在文字里写命令和"✅ 生成成功"不等于执行；写出来是空文件也不算交付。现在立即用 write_file / run_node / run_shell 真实生成一遍，写完用 read_file 或 list_files 读回来确认内容真的在里面，再如实汇报。如果执行失败，就如实报告失败原因和报错内容。严禁再声称不存在或空的文件已生成。`,
          });
          emit({ type: "text", delta: `\n\n> ⚠️ **成果核验未通过**：${list}，已自动打回要求真实执行。\n\n`, depth });
          continue;
        }
        break;
      }

      const runOne = async (tc) => {
        if (stopSignal && stopSignal.aborted) return { id: tc.id, content: "（用户已停止任务，该工具未执行）", isError: true };
        emit({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          depth,
          purpose: tc.input.purpose || tc.input.expert || tc.input.name || tc.input.path || tc.input.url || "",
          input_preview: previewInput(tc),
        });
        const loopKey = tc.name + "\u0000" + JSON.stringify(tc.input || {});
        const seen = loopHist.get(loopKey);
        let r;
        if (!allowedTools.has(tc.name)) {
          r = { content: "当前模式/分派策略不允许调用工具：" + tc.name, isError: true };
        } else if (seen && seen.streak >= 4 && tc.name !== "ask_user") {
          // 同一调用已连续 4 次拿到一模一样的结果，第 5 次不再执行——结果不会变，只会烧钱
          r = { content: `【系统拦截】你已用完全相同的参数连续 ${seen.streak} 次调用 ${tc.name}，每次结果都一模一样，本次未执行。别再重复同样的动作：换参数、换工具或换一条实现路径；确实无路可走就停止并如实说明卡在哪里。`, isError: true };
        } else {
          try {
            r = await runToolCall(tc, { emit, depth, deadline, stats, stopSignal, user, authorizationUser, projectContext, sec, taskLabel, runToken, baseDir, workspace, llmOverride: L, askUser, sessionId });
          } catch (e) {
            // 工具抛出来的异常在这里就地变成一条工具结果。让它往上冒的话，下面那条
            // history.push({role:"tool"}) 就跑不到，历史里留下一条配不上对的 assistant——
            // 会话落盘之后每次请求都 400。报错本身也该让模型看见，它才知道要换条路。
            r = { content: `（${tc.name} 执行时抛出异常：${(e && e.message) || e}）`, isError: true };
          }
          if (r.extendMs) deadline += r.extendMs; // 等用户回答的时间不算任务运行时间
          const sig = String(r.content).slice(0, 2000);
          loopHist.set(loopKey, { sig, streak: seen && seen.sig === sig ? seen.streak + 1 : 1 });
        }
        errStreaks.set(tc.name, r.isError ? (errStreaks.get(tc.name) || 0) + 1 : 0);
        emit({
          type: "tool_result",
          id: tc.id,
          name: tc.name,
          depth,
          isError: r.isError,
          recovery_key: require("crypto").createHash("sha256").update(
            ["write_file", "edit_file"].includes(tc.name) ? "file:" + String(tc.input?.path) :
            tc.name + ":" + JSON.stringify(Object.fromEntries(Object.entries(tc.input || {}).filter(([key]) => key !== "purpose").sort(([a], [b]) => a.localeCompare(b))))
          ).digest("hex"),
          preview: String(r.content).slice(0, 800),
        });
        if (!r.isError) {
          const srcs = collectSources(tc.name, tc.input, r.content);
          if (srcs.length) emit({ type: "sources", items: srcs, depth });
        }
        return { id: tc.id, name: tc.name, content: String(r.content), isError: r.isError };
      };

      // 一批全是只读工具（搜索/抓网页/读文件）就并发跑。深度研究经常一口气要抓五个链接，
      // 串行是五次网络等待叠加，并发只花最慢那一次。只要里面有一个会动文件、跑命令或委派专家，
      // 整批退回串行——那些工具的先后顺序本身就是语义，打乱了就是改了它的意思。
      const canParallel = result.toolCalls.length > 1 && result.toolCalls.every((tc) => READ_ONLY_TOOLS.includes(tc.name));
      let toolResults = [];
      try {
        if (canParallel) {
          // 本地文件读取用高并发，网络请求用低并发防止被限流。上限可在 config.agent 里调
          const hasNetwork = result.toolCalls.some((tc) => NETWORK_TOOLS.includes(tc.name));
          const cfgA = config.agent || {};
          const limit = hasNetwork
            ? Math.max(1, Number(cfgA.parallel_network) || PARALLEL_MAX)
            : Math.max(1, Number(cfgA.parallel_local) || PARALLEL_MAX_LOCAL);
          emit({ type: "parallel", count: result.toolCalls.length, depth });
          toolResults = await mapPool(result.toolCalls, limit, runOne);
        } else {
          for (const tc of result.toolCalls) toolResults.push(await runOne(tc));
        }
      } catch (e) {
        // 兜底的第二道：无论如何都别让「已 push 的 assistant + 没 push 的工具结果」这种
        // 半截状态留在历史里落盘。缺谁补谁，push 完再把异常抛上去。
        const done = new Set(toolResults.map((r) => r.id));
        for (const tc of result.toolCalls) {
          if (!done.has(tc.id)) toolResults.push({ id: tc.id, name: tc.name, content: `（${tc.name} 未拿到结果：${(e && e.message) || e}）`, isError: true });
        }
        history.push({ role: "tool", results: toolResults });
        throw e;
      }
      history.push({ role: "tool", results: toolResults });
      await emitFiles();

      // 循环检测的提醒紧跟在工具结果后面注入，模型下一步就能看到；同时在界面明说，别让用户干瞪着它转圈
      const nudges = [];
      for (const [k, v] of loopHist) if (v.streak >= 3 && !loopNudged.has("c:" + k)) { loopNudged.add("c:" + k); nudges.push(`用完全相同的参数调用 ${k.split("\u0000")[0]} 已连续 ${v.streak} 次拿到完全相同的结果`); }
      for (const [name, n] of errStreaks) if (n >= 4 && !loopNudged.has("e:" + name)) { loopNudged.add("e:" + name); nudges.push(`${name} 已连续失败 ${n} 次`); }
      if (nudges.length) {
        history.push({ role: "user", content: `【系统·循环检测】${nudges.join("；")}。这是在死路上空转，时间和费用都在烧：立即换思路——换参数、换工具或换一条实现路径；实在无路可走就停下收尾，如实说明卡在哪里，严禁再重复同样的动作。` });
        emit({ type: "text", delta: `\n\n> ⚠️ **循环检测**：${nudges.join("；")}，已提醒换思路。\n\n`, depth });
      }

      if (step === maxSteps - 1) stopNote = `已达最大步数（${maxSteps} 步）`;
    }

    // 只有「跑满上限」才值得续：手动停止是用户不想再花钱，模型响应超时是模型挂了，续也白续
    const continuable = stopNote.startsWith("已达最大步数") || stopNote.startsWith("已达最大运行时间");
    if (!(continuable && roundsUsed < autoRounds && !(stopSignal && stopSignal.aborted))) break;
    roundsUsed++;
    deadline = Date.now() + (config.agent.max_runtime_ms || 1800000); // 新一轮把时间预算重新拉满
    emit({ type: "auto_continue", round: roundsUsed, total: autoRounds, note: stopNote, depth });
    // 进度档由框架亲手喂进去，不指望模型自己想起来去读——续跑第一步就该看到现场
    let progressDoc = "";
    const progressPath = path.join(baseDir || ".tmp", "PROGRESS.md");
    try {
      const ws = workspace || getWorkspaceDir();
      const raw = (await readProgressFile(ws, progressPath, 20000)).trim();
      if (raw) progressDoc = raw.length > 4000 ? raw.slice(0, 4000) + "\n…（进度档过长已截断，完整内容 read_file 自取）" : raw;
    } catch {}
    history.push({
      role: "user",
      content: progressDoc
        ? `【系统·自动续跑 第 ${roundsUsed}/${autoRounds} 轮】上一轮${stopNote}，任务还没做完，继续。以下是 ${progressPath} 的当前内容：\n\n${progressDoc}\n\n只做其中还没完成的部分，绝不重做已完成的事。每完成一个里程碑就 edit_file 更新 ${progressPath}。全部完成后正常总结收尾。`
        : `【系统·自动续跑 第 ${roundsUsed}/${autoRounds} 轮】上一轮${stopNote}，任务还没做完，继续。还没有 ${progressPath}——先 list_files 看现场确认已经做到哪一步，立即补建这份进度清单，然后只做剩下的部分，绝不重做已完成的事。全部完成后正常总结收尾。`,
    });
    stopNote = "";
    }

    if (stopNote) {
      emit({ type: "limit", note: stopNote, depth });
      // 撞上限时，finalText 往往是半句过程叙述（"我先看一下这个文件"），直接抛给用户等于没有交代。
      // 再花一次调用让它把话说完：做到哪、有什么、还差什么。手动停止的不做——用户喊停就是不想再花钱。
      // 手动停止不花钱；模型响应超时也跳过——模型都挂起了，再拿它写收尾只是多等一轮超时
      if (!(stopSignal && stopSignal.aborted) && !stopNote.startsWith("模型响应超时")) {
        const wrapped = await wrapUp({ history, system, stopNote, emit, depth, stats, llmOverride: L });
        if (wrapped) finalText = wrapped;
      }
      const notice = `⚠️ ${stopNote}，任务强制收尾。如需继续，可提高设置中的上限或让我接着上次进度做。`;
      finalText = finalText ? `${finalText}\n\n${notice}` : notice;
    }

    const usage = {
      prompt: stats.prompt,
      completion: stats.completion,
      cached: stats.cached || 0, // 其中命中缓存、按约 1/10 计费的那部分
      calls: stats.calls,
      elapsed_ms: Date.now() - stats.startedAt,
    };
    if (depth === 0) {
      emit({ type: "usage", model: L.model, provider: L.provider, ...usage });
    }
    return { finalText, usage, stopped: stopNote || null };
    } catch (e) {
      // 任务半路抛错（渠道挂了、上下文压不下去等）：抛错之前模型已经吐过 token，
      // 账不能因为最后一步失败就一笔不记。usage 挂在错误对象上供外层记账，
      // 顶层再补发一次 usage 事件——失败收场的消耗显示要和成功收场一样。
      const usage = {
        prompt: stats.prompt,
        completion: stats.completion,
        cached: stats.cached || 0,
        calls: stats.calls,
        elapsed_ms: Date.now() - stats.startedAt,
      };
      if (e && typeof e === "object") e.usage = usage;
      if (depth === 0 && usage.calls > 0) {
        emit({ type: "usage", model: L.model, provider: L.provider, ...usage });
      }
      throw e;
    } finally {
      unwatchSleep();
      releaseAwake();
    }
  }

  // Only outer user tasks own Git. Experts call the inner runTask directly;
  // Web Goal/interject rounds reuse a live scope, never pull/commit mid-task.
  const gitScopes = new WeakSet();
  async function withTaskGit(args, work) {
    const workspace = args.workspace || getWorkspaceDir();
    return require("./lib/task-git").runWithTaskGit({
      workspace, config, emit: args.emit, signal: args.stopSignal,
      mode: args.mode, projectContext: args.projectContext,
    }, async scope => {
      gitScopes.add(scope);
      try { return await work({ ...args, ...scope, workspace, gitScope: scope }); }
      finally { gitScopes.delete(scope); }
    });
  }
  return {
    runTask: args => gitScopes.has(args.gitScope) ? runTask(args) : withTaskGit(args, runTask),
    withTaskGit, getSkills,
  };
}

// 并发上限分两档：本地读文件只等磁盘，开大没有副作用，8 路一起读明显更快；
// 抓页面是等网络，开太多既没有更快，还容易被对方站点当成扫站封 IP，仍然守在 3。
// 一批里只要混进一个联网工具，整批按联网档限流——宁可慢一点也别把对方站点惹了。
const PARALLEL_MAX = 3;
const PARALLEL_MAX_LOCAL = 8;
const NETWORK_TOOLS = ["fetch_url", "render_page", "web_search"];

/** 限流并发跑一批，结果按原顺序返回（工具结果的顺序要和 tool_calls 对得上） */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

function previewInput(tc) {
  if (tc.name === "run_node") return (tc.input.code || "").slice(0, 1500);
  if (tc.name === "run_shell") return (tc.input.command || "").slice(0, 1500);
  if (tc.name === "delegate_to_expert") return `委派给「${tc.input.expert}」：\n${(tc.input.task || "").slice(0, 800)}`;
  if (tc.name === "delegate_to_team") return `委派给专家团「${tc.input.team}」：\n${(tc.input.task || "").slice(0, 800)}`;
  try {
    return JSON.stringify(tc.input).slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * 从一次工具调用里挖出"这一步真访问了哪些网页"，给回复底下的「来源」用。
 * 只认工具层的实际入参与实际返回，不认模型嘴上说参考了什么——那种"来源"经常是编的。
 */
function collectSources(name, input, content) {
  const text = String(content || "");
  if (name === "fetch_url" || name === "render_page") {
    const url = String(input?.url || "");
    // 抓失败的不算来源——放进「来源」里等于告诉用户"我看过这页"，其实没看到
    if (!/^https?:\/\//i.test(url) || /没能拿到正文/.test(text.slice(0, 200))) return [];
    const title = (text.match(/^HTTP\s+\d+\s*·\s*([^\n（(]+)/) || [])[1] || "";
    return [{ url, title: title.trim().slice(0, 80) }];
  }
  if (name === "web_search") {
    // webSearch 的输出是「序号. 标题 \n 缩进的 URL \n 摘要」
    return [...text.matchAll(/^\s*\d+\.\s*(.+)\n\s+(https?:\/\/\S+)/gm)]
      .map((m) => ({ title: m[1].trim().slice(0, 80), url: m[2] }))
      .slice(0, 10);
  }
  return [];
}

// 简单测试方法：用于模型测试，只发送消息并返回流式响应
async function runSimpleTest(message, testConfig, signal) {
  const { modelProvider, modelEndpoint } = require("./lib/model-protocol");
  const { modelEvents } = require("./lib/model-stream");
  const { model, base_url, api_key } = testConfig;
  const anthropic = modelProvider(testConfig) === "anthropic";
  signal?.throwIfAborted();

  const response = await fetch(modelEndpoint(base_url, anthropic ? "anthropic" : "openai"), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(anthropic ? { 'x-api-key': api_key, 'anthropic-version': '2023-06-01' } : { 'Authorization': `Bearer ${api_key}` }),
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: message }],
      stream: true,
      max_tokens: 50,
    }),
  });

  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
  }

  async function* generateChunks() {
    let stopped = false;
    for await (const event of modelEvents(response, { signal })) {
      const choice = event.choices?.[0];
      if (event.type === "error" || event.error || choice?.error || choice?.finish_reason === "error") throw new Error("模型测试：上游流返回错误");
      const content = anthropic
        ? (event.type === "content_block_start" && event.content_block?.type === "text" ? event.content_block.text : event.type === "content_block_delta" && event.delta?.type === "text_delta" ? event.delta.text : "")
        : choice?.delta?.content;
      if (content) yield content;
      if (anthropic && event.type === "message_stop") { stopped = true; break; }
    }
    if (anthropic && !stopped) throw new Error("模型测试：Messages 流提前结束");
  }

  return generateChunks();
}

module.exports = {
  createAgentRuntime,
  missingDeliverables,
  trimHistory,
  historyChars,
  collectSources,
  mapPool,
  PARALLEL_MAX,
  runSimpleTest,
  compactHistoryStandalone,
  ctxBudget
};
