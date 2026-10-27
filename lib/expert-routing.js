"use strict";
/** 每轮只做一次、零模型费用的保守分派；显式选择优先，不把问答强行升级为团队任务。 */
function normalizeDelegation(value) {
  if (value == null) return { type: "auto" };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("专家选择必须是对象");
  const type = value.type;
  if (!["auto", "none", "expert", "team"].includes(type)) throw new Error("不支持的专家分派类型");
  if (type === "auto" || type === "none") return { type };
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 100) throw new Error("请选择有效的专家或团队名称");
  return { type, name: value.name.trim() };
}
/** 正式名称优先；只接受唯一的花名/展示名，不做模糊猜测。 */
function resolveExpert(value, experts = []) {
  const raw = typeof value === "string" ? value.trim() : "";
  const name = raw.replace(/^(?:「([^」]+)」|“([^”]+)”|"([^"]+)")$/, (_, a, b, c) => a || b || c).trim();
  const available = experts.map(e => e.name).join("、") || "（当前没有配置专家）";
  const exact = experts.filter(e => e.name === name);
  const compact = s => String(s).replace(/\s+/g, "").replace(/•/g, "·");
  const candidates = exact.length ? exact : experts.filter(e => {
    const alias = typeof e.alias === "string" ? e.alias.trim() : "";
    if (!alias) return false;
    return [alias, e.name + alias, e.name + "·" + alias, e.name + "（" + alias + "）", e.name + "(" + alias + ")", e.name + "「" + alias + "」"]
      .some(label => compact(label) === compact(name));
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw new Error("专家名称有歧义：" + raw + "。请使用正式名称：" + candidates.map(e => e.name).join("、"));
  throw new Error("专家不存在：" + raw + "。可用的正式名称：" + available + "。请从列表中选择，不要编造名称。");
}
function membersOf(team, experts) {
  return [...new Set((Array.isArray(team.members) ? team.members : []).map(n => {
    try { return resolveExpert(n, experts); } catch { return null; }
  }).filter(Boolean))];
}
function validateDelegation(value, { mode = "craft", experts = [], teams = [] } = {}) {
  const selection = normalizeDelegation(value);
  if (selection.type === "auto" || selection.type === "none") return selection;
  if (!["craft", "goal"].includes(mode)) throw new Error("专家/团队执行需要 Craft 或 Goal 模式，请先切换执行模式");
  if (selection.type === "expert") {
    selection.name = resolveExpert(selection.name, experts).name;
  } else {
    const team = teams.find(t => t.name === selection.name);
    if (!team) throw new Error("专家团不存在：" + selection.name);
    if (membersOf(team, experts).length < 2) throw new Error("专家团至少需要 2 位有效且不重复的成员：" + selection.name);
  }
  return selection;
}
function selectDelegation({ delegation, message = "", mode = "craft", experts = [], teams = [], autoDelegate = true }) {
  const selected = validateDelegation(delegation, { mode, experts, teams });
  if (!["craft", "goal"].includes(mode)) return null;
  if (selected.type === "none") return { type: "none", reason: "本轮由主助手直接处理", source: "manual" };
  if (selected.type !== "auto") return { ...selected, source: "manual", reason: "用户指定，系统直接分派" };
  // 只分析本轮用户正文，不把附件名、代码片段或历史里的词语当作新指令。
  const text = String(message).replace(/^\s*【任务类型：[^】]*】\s*/, "").replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, "").replace(/（已上传文件：[^）]*）/g, "").trim();
  if (/(?:不要|不用|无需|不必|禁止).{0,8}(?:委派|专家|团队|组团)|(?:你|主助手|主模型)自己(?:直接)?(?:做|处理|完成)|do not delegate|without (?:experts|delegation)/i.test(text)) {
    return { type: "none", source: "request", reason: "用户要求不委派" };
  }
  // 兼容旧版召唤模板。只认明确指令+引号中的名称，不对普通提及或说明性问题执行。
  const named = /^(?:请)?(?:把(?:下面这个|这个|以下|下面的)?任务(?:整体)?委派给|(?:使用|调用|召唤)|让)(专家团|团队|专家)[「“"]([^」”"\n]+)[」”"]/u.exec(text);
  const direct = /^(?:请)?委派给[「“"]([^」”"\n]+)[」”"]/u.exec(text);
  if (direct) {
    const choice = validateDelegation({ type: "expert", name: direct[1] }, { mode, experts, teams });
    return { ...choice, source: "request", reason: "用户明确点名" };
  }
  if (named) {
    const choice = validateDelegation({ type: named[1] === "专家" ? "expert" : "team", name: named[2] }, { mode, experts, teams });
    return { ...choice, source: "request", reason: "用户明确点名" };
  }
  if (!autoDelegate || !text || /^(?:请|帮我)?(?:解释|介绍|说明|什么是|为什么|如何|怎么|能否|是否|请问)|^(?:what|why|how|can you explain)\b/i.test(text)) return null;
  const action = /(?:帮我|请|需要|我要|给我).{0,20}(?:做|制作|生成|写|开发|实现|设计|搭建|分析|调研|研究|审查|测试|整理|输出)|^(?:做|制作|生成|写|开发|实现|设计|搭建|分析|调研|研究|审查|测试|整理|输出)|^(?:build|create|implement|develop|write|generate|review|analyze|research|test)\b/i.test(text);
  if (!action) return null;
  const full = /完整|整套|端到端|从零|一站式|全流程|并.{0,8}(?:测试|审查)|开发.{0,15}测试|调研.{0,20}(?:报告|PPT|演示)|end.to.end/i.test(text);
  const rules = [
    [/(?:^(?:请|帮我|请帮我)?\s*审查.{0,10}代码|^review.*code|^代码审查|^code review)/i, "代码审查员"],
    [/(?:^(?:请|帮我|请帮我)?(?:写|生成|制作|补充|开发)?\s*(?:单元测试|测试用例|自动化测试)|^write.*(?:unit test|test case))/i, "测试工程师"],
    [/(?:架构设计|系统架构)/, "架构师"],

    [/(?:全栈|前后端|full.?stack)/i, "全栈工程师", "全栈交付组", true],
    [/(?:前端|React|Vue|界面|frontend)/i, "前端工程师", "前端开发组", full],
    [/(?:后端|接口|API|backend)/i, "后端工程师", "后端开发组", full],
    [/(?:PPT|演示文稿|幻灯片|slides)/i, "PPT设计师", "汇报三件套", full],
    [/(?:网页|落地页|HTML|landing page)/i, "网页设计师", "网页交付组", full],
    [/(?:多平台|公众号.*小红书|小红书.*公众号)/, "公众号编辑", "内容发布组", true],
    [/(?:调研报告|研究报告|带.{0,6}图表.{0,8}报告)/, "深度研究员", "调研出报告", true],
    [/(?:竞品|竞争对手)/, "竞品分析师"],
    [/(?:深度调研|深入研究)/, "深度研究员"],
    [/(?:数据分析|分析.{0,12}数据|Excel|电子表格)/i, "数据分析师"],
    [/(?:可视化|图表|统计图)/, "数据可视化师"],
    [/(?:会议纪要)/, "会议纪要师"],
    [/(?:周报)/, "周报助手"],
    [/(?:小红书)/, "小红书运营"],
    [/(?:公众号)/, "公众号编辑"],
    [/(?:Word|文案|正式报告|文档)/i, "文案写手"],
    [/(?:调研|资料搜集)/, "调研专员"],
  ];
  for (const [match, expert, team, useTeam] of rules) {
    if (!match.test(text)) continue;
    const group = useTeam && teams.find(t => t.name === team && membersOf(t, experts).length >= 2);
    const choice = group ? { type: "team", name: group.name } : experts.some(e => e.name === expert) ? { type: "expert", name: expert } : null;
    if (choice) return { ...choice, source: "auto", reason: group ? "匹配多阶段交付任务" : "匹配专业执行任务" };
  }
  return null; // 低置信度不猜：仍允许主模型按任务需要自主委派。
}
function delegationBrief(history) {
  const last = history.map(h => h.role).lastIndexOf("user");
  const task = last >= 0 ? String(history[last].content || "") : "";
  const context = history.slice(0, last).filter(h => h.role === "user" || h.role === "assistant")
    .slice(-6).map(h => (h.role === "user" ? "用户：" : "协调者：") + String(h.content || h.text || "").slice(-2000)).join("\n\n").slice(-8000);
  return (context ? "【最近对话背景，仅供理解；以本轮任务为准】\n" + context + "\n\n" : "") + "【本轮任务】\n" + task;
}
module.exports = { resolveExpert, normalizeDelegation, validateDelegation, selectDelegation, membersOf, delegationBrief };
