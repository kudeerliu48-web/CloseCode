"use strict";
/**
 * Agent 技能工具集 — 全部在 workspace 目录内操作。
 * run_node 是核心：agent 写 JS 代码生成 PPT/Word/Excel/图表/数据处理结果。
 */

const fs = require("fs");
const path = require("path");
const { DATA_DIR, dataPath, appPath } = require("./paths");
const { spawn } = require("child_process");
const { runProcess } = require("./lib/async-process");
const { StringDecoder } = require("string_decoder");
const security = require("./security");
const memory = require("./memory");
const bgProc = require("./bg-processes");
const { shellPath } = require("./lib/shell-runner");

// 工作空间可切换（默认项目内 workspace/；可在设置里改成任意文件夹）
let workspaceDir = dataPath("workspace");

function getWorkspaceDir() {
  return workspaceDir;
}
function setWorkspaceDir(dir) {
  if (!dir || !path.isAbsolute(dir)) throw new Error("工作空间必须是绝对路径，如 D:\\我的工作区");
  fs.mkdirSync(dir, { recursive: true }); // 无权限/非法路径会在这里抛错
  workspaceDir = path.resolve(dir);
  return workspaceDir;
}
function tmpDir(ws) {
  return path.join(ws || workspaceDir, ".tmp");
}

function ensureDirs(ws) {
  const workspace = ws || workspaceDir;
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(tmpDir(workspace), { recursive: true });
}

async function ensureDirsAsync(ws) {
  await fs.promises.mkdir(tmpDir(ws), { recursive: true });
}

// Serialise mutations of the same real file across concurrent agent tasks.
const fileEdits = new Map();
function withFileEdit(file, action) {
  const key = require("./lib/workspace-scope").key(file);
  const previous = fileEdits.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  fileEdits.set(key, next);
  return next.finally(() => { if (fileEdits.get(key) === next) fileEdits.delete(key); });
}

/** 项目归属专用路径检查（成果、会话等），不作为普通文件工具的目录访问策略。 */
function safePath(rel, ws) {
  const workspace = ws || workspaceDir;
  const p = path.resolve(workspace, String(rel || ".").replace(/\\/g, "/"));
  if (!require("./lib/workspace-scope").contains(workspace, p)) {
    throw new Error(`路径越界，只允许访问 workspace 内: ${rel}`);
  }
  return p;
}

const TOOL_DEFS = [
  {
    name: "run_node",
    description:
      "在工作目录(workspace)中执行一段 Node.js (CommonJS) 代码并返回 stdout/stderr。可以 require 以下已安装的库：pptxgenjs(生成PPT)、docx(生成Word)、exceljs(生成Excel)，以及 Node 内置模块(fs/path等)。生成的成果文件必须写到当前工作目录(直接用相对路径/文件名即可，不要写绝对路径)。用于数据处理、文件生成、计算等一切需要编程的任务。输出太长时只回「开头 + 结尾 + 省略了多少 + 全文日志路径」，中间那段不是没有、是在那个文件里，需要就 read_file 或 grep 它，别拿结尾当全部内容。",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "要执行的完整 CommonJS 代码" },
        purpose: { type: "string", description: "一句话说明这段代码做什么（展示给用户）" },
      },
      required: ["code"],
    },
  },
  {
    name: "run_shell",
    description:
      "在工作目录(workspace)中执行一条 shell 命令（macOS/Linux 走 zsh/bash，Windows 走 cmd），返回 stdout/stderr。可以使用系统已安装的命令行工具（git、curl、ffmpeg、lark-cli 等）。适合调用现成 CLI、管道/批量文件操作；需要写程序逻辑时优先用 run_node。命令不要做交互式输入（没有 stdin）。多行 Python 代码优先 write_file 保存 .py 再运行；Windows 兼容单条 Python -c 多行参数（可前置 cd /d），直接传递完整源码，不经过 cmd 截断。支持尾缀 2>&1 合并输出与 | more [+0] 无交互全文输出，不等待翻页，退出码仍取 Python；其他多行复合语法请先保存脚本。输出太长时只回「开头 + 结尾 + 省略了多少 + 全文日志路径」，中间那段不是没有、是在那个文件里，需要就 read_file 或 grep 它，别拿结尾当全部内容。\n\n**后台模式**：启动 dev server / 数据库等常驻进程时传 detach:true，约 3 秒返回 PID 和日志，不代表服务已就绪。常见 dev/serve 命令在未指定 detach 时自动后台；测试/构建仍等待退出。Python 默认 UTF-8 无缓冲，旧 GBK 程序可显式选 encoding:gb18030。优先通过 cwd 指定目录，命令内 cd 不会改变后续文件工具的路径基准。",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的完整 shell 命令（可含管道、&& 串联）" },
        purpose: { type: "string", description: "一句话说明这条命令做什么（展示给用户）" },
        detach: { type: "boolean", description: "true = 后台启动并返回 PID/日志；false = 强制等待结束。省略时只自动识别常见服务命令，测试和构建仍前台执行" },
        cwd: { type: "string", description: "本条命令工作目录相对当前项目根目录，默认 .；可指定普通外部目录或绝对路径，无需目录授权但保留核心保护。辅助目录需显式填写，不改变后续工具路径或项目归属" },
        encoding: { type: "string", enum: ["utf8", "gb18030"], description: "输出编码，默认 utf8（Python/Node）。仅旧 GBK 程序显式选择 gb18030" },
      },
      required: ["command"],
    },
  },
  {
    name: "write_file",
    description:
      "写文件（.md 报告、.txt、.csv、.html、代码文件都行）。路径默认相对于当前项目根目录；普通外部绝对路径无需目录授权，保留核心保护与写入权限检查。任务辅助文件须显式填写辅助目录前缀。**只用于新建**；改已有文件的局部内容用 edit_file。写长文档时用 append:true 一节一节续写，不用把前文重新吐一遍。写完会自动做语法/结构自检（JS/JSON/HTML/Markdown），有问题会直接告诉你。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对路径，如 report.md" },
        content: { type: "string" },
        append: { type: "boolean", description: "true = 追加到文件末尾（长文档分节写、日志累积用），默认 false 覆盖" },
        overwrite: { type: "boolean", description: "只在「明知故犯地整篇重写一个已有文件」时传 true。不传的话，一次把现成文件砍掉四成以上的写入会被直接拦下——那多半是没读全就重写，内容就此丢了" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "改已有文件里的一段内容（精确优先、安全兼容格式差异）。改代码、改文档的既有内容一律用它，不要用 write_file 整篇重写——重写会把你没看过的部分一起弄没。old_text 从 read_file 的当前内容复制，带足上下文保证唯一。自动兼容 CRLF/LF、Markdown 表格单元格边缘空白、整段等量缩进及行尾空格；不会忽略标点、引号、代码内容或不同相对缩进。失败时按返回的实际片段修正后重试，不要重复同一旧文本。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对路径" },
        old_text: { type: "string", description: "要被替换掉的当前原文，带足上下文保证唯一；整段格式差异可自动兼容，内容必须一致" },
        new_text: { type: "string", description: "替换成的新内容（想删掉就传空字符串）" },
        replace_all: { type: "boolean", description: "全文替换所有匹配（改变量名这类才用），默认 false" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "read_file",
    description: "读取已存在的文本文件（最多 50000 字符）。相对路径以当前项目根目录为基准；辅助文件需带实际辅助目录前缀。只能使用用户给出或工具确认存在的文件名，不能猜测未生成的报告名。FILE_NOT_FOUND 时按诊断先核对目录/生成命令，不要重复读取。大文件用 start_line/end_line。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对路径" },
        start_line: { type: "number", description: "从第几行开始读（1 起，可选）" },
        end_line: { type: "number", description: "读到第几行为止（含，可选）" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description:
      "在指定目录按内容搜索，默认当前项目根目录；搜索本项目用 dir: '.'，不要用 '..'（那是项目外的上级目录）。返回 文件:行号: 命中行。找函数定义、找某个字符串在哪些文件里用到、改名前找全部调用点，用它，比一个个 read_file 快得多。自动跳过 node_modules/.git/二进制文件。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "要搜的内容（默认按字面量搜）" },
        regex: { type: "boolean", description: "把 query 当正则处理，默认 false" },
        dir: { type: "string", description: "要搜索的目录，相对当前项目根目录，默认 .；.. 会越出项目" },
        ext: { type: "string", description: "只搜某类扩展名，逗号分隔，如 js,ts,md" },
        max: { type: "number", description: "最多返回多少条命中，默认 60" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_files",
    description: "列出指定目录的实际文件（名称、大小、修改时间），默认当前项目根目录；查看本项目用 dir: '.'，不要用 '..'（会越出项目）。核对文件名时先列目录，不要猜测。看结构时 depth 可调到 2-3。",
    input_schema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "相对当前项目根目录的路径，默认 .；.. 是项目外上级目录" },
        depth: { type: "number", description: "递归几层，默认 1（只列当前层），最多 3" },
      },
    },
  },
  {
    name: "remember",
    description:
      "把一条**本项目跨任务都成立**的长期信息记进记忆（用户的偏好、习惯、常用路径、身份、明确的纠正）。用户说「以后都这样」「记住我喜欢…」「别再…」时必须调用。只记结论、一句话，不要记这次任务的过程；绝不记密钥、密码、令牌。",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "一句话结论，如「周报只要三段：进展/问题/下周计划」" },
        shared: { type: "boolean", description: "true = 本项目内所有账号都适用（团队约定，不跨项目）；默认只记给当前用户" },
      },
      required: ["text"],
    },
  },
  {
    name: "forget",
    description: "删掉之前记住的某条长期记忆（用户说「不用记这个了」「我改主意了」时用）。按内容匹配，只能删本项目内共享的和当前用户自己的。",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "要忘掉的那条记忆的内容（可以只给关键片段）" } },
      required: ["text"],
    },
  },
  {
    name: "check_page",
    description:
      "验收一个做好的网页：静态体检（DOCTYPE/viewport/标题/标签闭合/外链资源/本地引用是否存在/正文是否空壳）+ 真浏览器打开一遍（拿标题、正文长度、控制台报错）。**交付 HTML 之前必须跑一次**——白屏和 JS 报错光看源码看不出来。",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "workspace 里的 .html 相对路径" } },
      required: ["path"],
    },
  },
  {
    name: "save_skill",
    description:
      "创建或更新一个技能包（保存到 skills/<名称>/skill.md，立即可用）。content 必须包含 frontmatter（---\\nname: 名称\\ndescription: 一句话描述\\n---）和详细指南正文。用于把成熟的工作方法沉淀为可复用技能。",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名（小写字母/数字/连字符，如 market-research）" },
        content: { type: "string", description: "skill.md 完整内容（含 frontmatter）" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "library_list",
    description: "列出用户资料库中的参考文件与灵感笔记（跨项目共享的长期沉淀素材）。任务涉及用户的偏好、过往素材、参考资料时先查这里。",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "library_read",
    description: "读取资料库中的一个文本文件内容（最多返回前 50000 字符）。文件名来自 library_list 的结果。",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "资料库中的文件名" } },
      required: ["name"],
    },
  },
  {
    name: "fetch_url",
    description:
      "抓取一个 URL 的内容（最多 20000 字符）。带真实浏览器请求头，网页会去掉导航/页脚只留正文，JSON 接口原样返回——查资料和直接调数据接口都用它。静态 HTML 是空壳时会自动用内置浏览器渲染一遍再读；地址是 PDF/图片/压缩包时会自动下载到工作目录并告诉你文件名（不会把二进制乱码返回给你）。要抓多个地址就在同一轮里一次性发多个 fetch_url，系统会并发执行。",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        render: { type: "boolean", description: "是否允许在抓到空壳时自动渲染兜底，默认 true" },
      },
      required: ["url"],
    },
  },
  {
    name: "render_page",
    description:
      "用内置浏览器真实打开一个页面、等 JS 渲染完再取正文。专治 fetch_url 只拿到空壳的动态站点（B 站、微博、各类单页应用）。比 fetch_url 慢几秒，所以先用 fetch_url，读不到再用它。",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        wait_ms: { type: "number", description: "每轮等待渲染的毫秒数，默认 2500，内容多的页面可调大" },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description:
      "联网搜索，返回结果列表（标题、链接、摘要）。用于查资料、找参考来源、了解最新信息；需要某条结果的全文时再用 fetch_url 抓取其 URL。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        count: { type: "number", description: "结果条数，默认 5，最多 10" },
      },
      required: ["query"],
    },
  },
  {
    name: "gen_diagram",
    description:
      "文本→图：流程图/架构图/时序图/数据图表一律用它画，不要手写 SVG。kind: mermaid(流程/时序/类图/甘特/状态) | dot(Graphviz，架构/依赖/拓扑) | echarts(数据图表，source 传 option 对象) | plantuml(UML) | svg(已有 SVG 转 PNG)。生成 <filename>.svg，环境允许时同时出 <filename>.png（插入飞书/Word/PPT 用 PNG）。",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["mermaid", "dot", "echarts", "plantuml", "svg"], description: "图的类型" },
        source: {
          type: "string",
          description: "图源码：mermaid/dot/plantuml 语法原文；echarts 传 option 的 JSON 或 JS 对象字面量（不要带 echarts.init 代码）；svg 传完整 <svg> 内容",
        },
        filename: { type: "string", description: "输出文件名，不带扩展名，如 architecture" },
        width: { type: "number", description: "宽 px，仅 echarts 用（默认 800）" },
        height: { type: "number", description: "高 px，仅 echarts 用（默认 500）" },
      },
      required: ["kind", "source", "filename"],
    },
  },
  {
    name: "look_at_image",
    description:
      "看一张图（截图、照片、设计稿），带着一个具体的问题去看，拿回一段文字答案。用户粘贴或上传了图片就用它——" +
      "read_file 读图只会读出一堆乱码。问题越具体越有用：「报错信息一字不差抄下来」「这个页面分几块、各是什么」" +
      "远好过「看看这张图」；想问好几件事就分几次调，一次一张图。" +
      "图片本身不会进对话历史（那样每一步都要重发一遍，又贵又会让纯文本的主模型直接报错），进历史的只有你拿回的这段文字——" +
      "所以该抄下来的细节（报错原文、数字、文案）要在问题里明确要求抄全，看完这一次就得把要用的东西都拿到手。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "图片相对路径。用户上传的图在工作空间里，名字不确定就先 list_files" },
        question: { type: "string", description: "关于这张图的具体问题（必填）" },
      },
      required: ["path", "question"],
    },
  },
  {
    name: "generate_image",
    description:
      "用用户在设置中单独配置的生图模型生成图片，保存到工作空间。普通 GPT、Claude、Gemini、Grok 和国模只负责对话与决定何时调用本工具；生图 Key 不会改变当前对话模型。" +
      "适合配图、海报、封面、商品图和纯画面。需要先在 设置 → 模型设置 → 生图 配置 API Key，拉取并保存生图模型。" +
      "不要先说自己不会生图、不能生图或只能提供提示词；如果工具返回未配置，直接告诉用户需要配置生图 API Key，并说明设置路径。", 
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "画面描述，越具体越好（主体/风格/构图/光线）" },
        filename: { type: "string", description: "保存文件名（可选，默认 image_时间戳.png）" },
        size: { type: "string", description: "尺寸如 1024x1024（可选，仅 OpenAI 兼容渠道生效）" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_video",
    description:
      "用用户配置的视频模型生成一段短视频，保存到工作空间（生成通常要 1~5 分钟，请耐心等待返回）。需要先在 设置 → 模型 → 视频模型 配置渠道，未配置时会明确报错。",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "视频内容描述（画面/动作/镜头）" },
        filename: { type: "string", description: "保存文件名（可选，默认 video_时间戳.mp4）" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "html_to_image",
    description:
      "把工作空间里的一个本地 HTML 文件用真浏览器渲染成 PNG 图片（桌面版专属）：先 write_file 写一个排版好的 HTML" +
      "（<style> 里内联全部样式，画布尺寸用 body{width:...px;height:...px;margin:0} 定死），再用本工具截图。" +
      "做小红书卡片、公众号头图、视频分镜卡时它跟 generate_image（AI 作画）是两条路：本工具是「设计稿」——文字清晰、版式配色全听你的、风格偏平面；" +
      "generate_image 是「画」——有质感有氛围，中文标题能不能写对看渠道（豆包 Seedream 5 这类新模型已经可以）。" +
      "**两条路的成品差别大到会返工，用户没点名走哪条时先用 ask_user 问一句**，点了名就照他说的做。",
    input_schema: {
      type: "object",
      properties: {
        html_file: { type: "string", description: "HTML 文件路径（工作空间内的相对路径）" },
        filename: { type: "string", description: "输出 PNG 文件名（可选，默认 card_时间戳.png）" },
        width: { type: "number", description: "视口宽 px（默认 1242）" },
        height: { type: "number", description: "视口高 px（默认 1656。常用：小红书 3:4=1242x1656，公众号头图 2.35:1=1200x511，视频封面 16:9=1920x1080）" },
        full_page: { type: "boolean", description: "true 时按页面实际内容高度整页截（适合长图/万字长文截图）" },
        wait_ms: { type: "number", description: "加载后等待毫秒再截（默认 500；页面有网络字体/大图时加大到 2000+）" },
      },
      required: ["html_file"],
    },
  },
  {
    name: "text_to_speech",
    description:
      "用用户配置的语音合成模型把文字念成音频文件，保存到工作空间。视频配音、播客旁白就用它。需要先在 设置 → 模型 → 语音合成 配置渠道，未配置时会明确报错。",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "要念的文字（上限 5000 字，超长请分段多次合成）" },
        filename: { type: "string", description: "保存文件名（可选，默认 speech_时间戳.mp3）" },
        voice: { type: "string", description: "音色名（可选，默认用设置里配的；如 OpenAI 系的 alloy/nova、通义的 Cherry/Serena）" },
        speed: { type: "number", description: "语速 0.5~2.0（可选，仅 OpenAI 兼容渠道生效）" },
      },
      required: ["text"],
    },
  },
  {
    name: "desktop_pet",
    description:
      "把用户给的一张图片做成【桌面宠物】——一个常驻桌面角落的透明小挂件，实时显示你正在干什么（干活转圈 / 有问题要问时跳起来并弹系统通知 / 完成撒花 / 出错掉汗）。用户点它开关主窗口，拖动换位置。\n" +
      "什么时候用：用户说「把这张图做成桌面宠物」「用我朋友的照片弄个桌宠」「搞个挂件放桌面」这类话时。**默认是没有宠物的**，只有用户开口要才做，不要主动创建。\n" +
      "怎么用：先让用户在输入框上传一张图（人像/宠物照/表情包都行），图会落到工作空间；再带着文件名调 action=\"create\"。图片只存用户本机，不上传任何服务器。\n" +
      "只在桌面版（npm run app）里有效；纯服务端模式下会如实报错，那时要老实告诉用户做不了。",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "show", "hide", "remove", "status"],
          description: "create=用图片做一只（要带 image）；show/hide=显示或收起；remove=撤掉并删掉本机存的照片；status=看看现在什么情况",
        },
        image: { type: "string", description: "图片文件名或相对路径（相对工作空间）。仅 action=create 时必填" },
        scale: { type: "number", description: "大小倍率 0.6~2，默认 1。用户嫌大嫌小时调这个" },
      },
      required: ["action"],
    },
  },
  {
    name: "detect_project_type",
    description:
      "检测当前工作目录的项目类型（构建型前端项目 vs 单文件 HTML vs Node.js 后端等），返回项目特征、启动命令、构建命令。" +
      "用于判断该如何交付和验证项目：Vue/React 等构建型项目必须启动 dev server 才能预览，单文件 HTML 可以直接打开，Node 后端需要 npm start。" +
      "遇到不熟悉的项目结构时先调这个工具确认类型，再决定下一步操作。",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_background_processes",
    description:
      "列出当前会话启动的所有后台进程（通过 run_shell detach:true 启动的 dev server、数据库等）。" +
      "返回每个进程的 PID、启动命令、运行时长、日志文件路径。用于检查哪些进程还在运行、排查启动失败原因。",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "kill_background_process",
    description:
      "停止一个后台进程。传入 PID（从 list_background_processes 获取）。用于清理不再需要的 dev server、解决端口冲突等。",
    input_schema: {
      type: "object",
      properties: {
        pid: { type: "number", description: "要停止的进程 PID" },
      },
      required: ["pid"],
    },
  },
  {
    name: "read_process_log",
    description:
      "读取后台进程的完整日志输出（stdout + stderr）。用于排查 dev server 启动失败、运行时报错等问题。" +
      "传入 PID，返回该进程的日志文件内容（最近 2000 行）。",
    input_schema: {
      type: "object",
      properties: {
        pid: { type: "number", description: "进程 PID" },
      },
      required: ["pid"],
    },
  },
];


// ---------- 图像 / 视频 生成（渠道协议：OpenAI 兼容 images API、DashScope 原生、火山方舟异步任务） ----------

function safeOutName(name, ext, stem) {
  let n = String(name || "").trim().replace(/[\/\\:*?"<>|]/g, "_").slice(0, 80);
  if (!n) n = `${stem}_${Date.now()}${ext}`;
  if (!n.toLowerCase().endsWith(ext)) n += ext;
  return n;
}

/**
 * 只重试「重来一次可能就好」的失败：5xx、429、以及网络层的连接错误。
 * 4xx 是参数错、没余额、内容被拒——重试多少次都是同一个答案，立刻返回。
 * 超时（AbortError）也不重试：那是上面设的总时限已经到了，再发一次只会立刻再失败。
 */
const retryableStatus = (s) => s === 429 || (s >= 500 && s < 600);
async function fetchRetry(url, init, { tries = 3, baseMs = 1500, label = "接口" } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, baseMs * 2 ** (i - 1)));
    try {
      const r = await fetch(url, init);
      if (r.ok || !retryableStatus(r.status) || i === tries - 1) return r; // 最后一次把真实响应还回去，错误信息照旧完整
      console.warn(`[tools] ${label} 返回 ${r.status}，${baseMs * 2 ** i}ms 后重试（第 ${i + 2}/${tries} 次）`);
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (e.name === "AbortError" || i === tries - 1) throw e;
      console.warn(`[tools] ${label} ${e.message}，重试（第 ${i + 2}/${tries} 次）`);
      lastErr = e;
    }
  }
  throw lastErr;
}

async function downloadToWorkspace(url, fname, dir, ws) {
  // 图/视频已经生成完、钱也花掉了，栽在最后一步下载上最不值——这一步尤其该重试
  const r = await fetchRetry(url, { signal: AbortSignal.timeout(180000) }, { label: "下载生成结果" });
  if (!r.ok) throw new Error(`下载生成结果失败 HTTP ${r.status}`);
  const workspace = ws || workspaceDir;
  await ensureDirsAsync(workspace);
  await fs.promises.writeFile(path.join(dir || workspace, fname), Buffer.from(await r.arrayBuffer()));
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" };

/**
 * 大图先缩到长边 1568（视觉模型再大也看不出更多东西，只是更贵更慢，还容易撞上游的体积上限）。
 * 用 Electron 自带的 nativeImage，不引任何图像库；跑在纯 node 里（测试、CLI）时缩不动就原样发。
 */
async function shrinkForVision(abs) {
  const raw = await fs.promises.readFile(abs);
  const ext = (abs.split(".").pop() || "png").toLowerCase();
  const mime = IMAGE_MIME[ext] || "image/png";
  const asis = { b64: raw.toString("base64"), mime, note: "" };
  if (raw.length <= 900 * 1024) return asis;
  try {
    const { nativeImage } = require("electron");
  let img = nativeImage.createFromBuffer(raw);
    if (img.isEmpty()) return asis;
    const sz = img.getSize();
    if (Math.max(sz.width, sz.height) > 1568) {
      img = img.resize(sz.width >= sz.height ? { width: 1568, quality: "good" } : { height: 1568, quality: "good" });
    }
    const jpg = img.toJPEG(82);
    if (!jpg || !jpg.length || jpg.length >= raw.length) return asis;
    return { b64: jpg.toString("base64"), mime: "image/jpeg", note: `（原图 ${sz.width}×${sz.height}、${Math.round(raw.length / 1024)}KB，压缩后再看的）` };
  } catch {
    return asis;
  }
}

/**
 * 带着一个问题去看一张图，返回文字答案。
 *
 * 为什么是「工具」而不是把图塞进对话历史：历史是每一步都要整份重发的，图又是 token 大户，
 * 一张截图能把刚做完的上下文成本优化整个推翻；而且多数纯文本模型收到图直接 400，
 * 会话是落盘的，于是那个会话就永久废了。走工具这条路，进历史的只有一段纯文本答案——
 * 便宜、能命中缓存、上下文紧张时还能被裁掉。
 */
async function lookAtImage(opts, input, timeoutMs, resolveFile) {
  const rel = String(input.path || "").trim();
  const q = String(input.question || "").trim();
  if (!rel) return { content: "缺少 path（要看哪张图，工作空间里的相对路径）", isError: true };
  if (!q) return { content: "缺少 question：看图必须带着具体问题去问（「报错写的什么」「这页分几块」），空看一眼拿不回有用的东西。", isError: true };

  // 优先使用独立视觉配置；未完整配置时继承当前任务实际运行的模型。
  const vision = opts.media?.vision || {};
  const hasVision = !!(String(vision.base_url || "").trim() && String(vision.model || "").trim() && String(vision.api_key || "").trim());
  const { modelProvider, modelEndpoint } = require("./lib/model-protocol");
  const visionProvider = modelProvider(vision);
  const cfg = hasVision ? { ...vision, provider: visionProvider, series: visionProvider === "anthropic" ? vision.series : "custom" } : (opts.currentModel || {});
  if (!String(cfg.base_url || "").trim() || !String(cfg.model || "").trim() || (cfg.series !== "custom" && !["openai", "anthropic"].includes(cfg.provider))) {
    return { content: "识图模型的请求配置缺失或协议不支持。请在模型设置的视觉页签配置支持图片的模型，或清除视觉配置后切换当前会话模型；不会改用其他视觉渠道。", isError: true };
  }

  let p;
  try { p = await resolveFile(rel); } catch (e) { return { content: e.message, isError: true }; }
  let stat;
  try { stat = await fs.promises.stat(p); }
  catch (error) { if (error.code === "ENOENT") return { content: `找不到图片 ${rel}。用户上传的图在工作空间里，先 list_files 看看真实文件名。`, isError: true }; throw error; }
  if (stat.isDirectory()) return { content: `${rel} 是个目录，不是图片。`, isError: true };
  if (!IMAGE_EXT.test(p)) return { content: `${rel} 不是图片（支持 png / jpg / webp / gif / bmp）。文本文件用 read_file。`, isError: true };

  const { b64, mime, note } = await shrinkForVision(p);
  if (b64.length > 12 * 1048576) {
    return { content: `${path.basename(p)} 太大了（编码后约 ${Math.round(b64.length / 1048576)}MB），上游收不下。先缩小再看。`, isError: true };
  }
  const chatEndpoint = modelEndpoint(cfg.base_url);
  const timeoutSignal = AbortSignal.timeout(Math.max(timeoutMs || 0, 120000));
  const callerSignal = opts.stopSignal || opts.signal;
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  const anthropic = modelProvider(cfg) === "anthropic";
  // DoCode 的 deepseek-v4.1-flash 与 Claude Code 一样走 Anthropic Messages 兼容协议。
  // 该模型在 chat/completions 会返回 200 + 空 choices；不能把 HTTP 200 当作识图成功。
  const messagesCompat = new URL(chatEndpoint).hostname === "docode.cc" && String(cfg.model || "").toLowerCase() === "deepseek-v4.1-flash";
  const url = (messagesCompat || anthropic) ? modelEndpoint(cfg.base_url, "anthropic") : chatEndpoint;
  const key = String(cfg.api_key || "").trim();
  const headers = messagesCompat
    ? { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" }
    : anthropic
      ? { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  const body = (messagesCompat || anthropic)
    ? { model: cfg.model, max_tokens: 2000, ...(messagesCompat ? { stream: true } : {}), messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime, data: b64 } }, { type: "text", text: q }] }] }
    : { model: cfg.model, max_tokens: 2000, messages: [{ role: "user", content: [{ type: "text", text: q }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }] };

  let r;
  try {
    signal.throwIfAborted();
    // 不使用带错误日志的重试器：上游异常可能回显请求凭据。
    r = await fetch(url, { method: "POST", headers, signal, body: JSON.stringify(body) });
  } catch (e) {
    return { content: "识图模型看图请求失败，请检查所选识图模型的连接配置后重试。未切换其他渠道。", isError: true };
  }
  let j;
  if (messagesCompat && r.ok) {
    try { j = require("./lib/vision-messages").parseVisionMessages(await r.text()); }
    catch (e) { return { content: e.message === "识图流提前结束，未收到完整回答。" ? e.message : "识图响应为空、不完整或返回服务错误，未切换模型或重试。", isError: true }; }
  } else {
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok) {
    // 服务端故障不代表协议或视觉能力不兼容；不回显可能含密钥的响应。
    if (r.status >= 500) {
      return { content: `识图模型看图服务暂不可用（HTTP ${r.status}），请稍后重试。未切换模型、端点或其他渠道。`, isError: true };
    }
    if (/image|vision|multimodal|不支持|unsupported/i.test(JSON.stringify(j))) {
      return {
        content: "识图模型不支持看图。请在模型设置的视觉页签配置支持图片的模型，或清除视觉配置后切换当前会话模型。不要重复调用，也不要改用其他视觉渠道。",
        isError: true,
      };
    }
    return { content: `识图模型看图错误（HTTP ${r.status}），请检查所选识图模型的配置。未切换其他渠道。`, isError: true };
  }
  let text = (anthropic || messagesCompat)
    ? (j.content || []).map((c) => (c && c.type === "text" ? c.text : "")).join("")
    : (((j.choices || [])[0] || {}).message || {}).content;
  if (Array.isArray(text)) text = text.map((c) => (typeof c === "string" ? c : (c || {}).text || "")).join("");
  text = String(text || "").trim();
  if (!text) return { content: "视觉模型没返回内容（可能被内容策略拦了）。换个问法再试一次。", isError: true };
  return { content: `【看图】${path.basename(p)}${note}\n问：${q}\n答：${text}`, isError: false };
}

async function generateImage(media, input, timeoutMs, saveDir, ws) {
  const cfg = (media || {}).image || {};
  if (!cfg.base_url || !cfg.api_key || !cfg.model) {
    return { content: "当前未配置生图 API Key，暂时不能调用生图模型。请打开「设置 → 模型设置 → 生图」，填写 Key，点击「拉取生图模型」并保存后，再直接告诉我想生成的画面。", isError: true };
  }
  const prompt = String(input.prompt || "").trim();
  if (!prompt) return { content: "缺少 prompt（画面描述）", isError: true };
  const base = String(cfg.base_url).trim().replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${String(cfg.api_key || "").trim()}` };
  const signal = AbortSignal.timeout(Math.max(timeoutMs || 0, 300000));
  const fname = safeOutName(input.filename, ".png", "image");
  let imgUrl = null, b64 = null;
  if (/dashscope/i.test(base)) {
    // DashScope 原生（qwen-image 系）：multimodal-generation，同步返回图片 URL
    // 生图慢又贵，上游一抖整轮就白跑：真实数据里 15 次调用失败 9 次，其中 8 次是
    // 上游 500 InternalServiceError，纯属临时故障。模型拿到失败通常不会重来，而是
    // 改用别的方案交差，用户就永远拿不到那张图。所以重试这件事得工具自己扛。
    const r = await fetchRetry(`${base}/services/aigc/multimodal-generation/generation`, {
      method: "POST", headers, signal,
      body: JSON.stringify({ model: cfg.model, input: { messages: [{ role: "user", content: [{ text: prompt }] }] }, parameters: { watermark: false } }),
    }, { label: "图像接口" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { content: `图像接口错误 ${r.status}: ${JSON.stringify(j).slice(0, 300)}`, isError: true };
    const parts = ((((j.output || {}).choices || [])[0] || {}).message || {}).content || [];
    imgUrl = (parts.find((c) => c.image) || {}).image;
    if (!imgUrl) return { content: "图像接口没有返回图片：" + JSON.stringify(j).slice(0, 300), isError: true };
  } else {
    // OpenAI 兼容 /images/generations（OpenAI、new-api 等聚合网关通用）
    const r = await fetchRetry(`${base}/images/generations`, {
      method: "POST", headers, signal,
      body: JSON.stringify({ model: cfg.model, prompt, n: 1, ...(input.size ? { size: String(input.size) } : {}) }),
    }, { label: "图像接口" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { content: `图像接口错误 ${r.status}: ${JSON.stringify(j).slice(0, 300)}`, isError: true };
    const d = (j.data || [])[0] || {};
    imgUrl = d.url;
    b64 = d.b64_json;
    if (!imgUrl && !b64) return { content: "图像接口没有返回图片：" + JSON.stringify(j).slice(0, 300), isError: true };
  }
  if (b64) {
    const workspace = ws || workspaceDir;
    await ensureDirsAsync(workspace);
    await fs.promises.writeFile(path.join(saveDir || workspace, fname), Buffer.from(b64, "base64"));
  } else await downloadToWorkspace(imgUrl, fname, saveDir, ws);
  security.audit("图像生成", `${cfg.model}: ${prompt.slice(0, 120)} → ${fname}`, "放行");
  return { content: `图片已生成并存入工作空间：${fname}（模型 ${cfg.model}）`, isError: false };
}

async function generateVideo(media, input, opts = {}) {
  const cfg = (media || {}).video || {};
  if (!cfg.base_url || !cfg.model) {
    return { content: "视频模型未配置：请在 设置 → 模型 → 视频模型 填写接口地址 / API Key / 模型名后再用。", isError: true };
  }
  const prompt = String(input.prompt || "").trim();
  if (!prompt) return { content: "缺少 prompt（视频内容描述）", isError: true };
  const base = String(cfg.base_url).trim().replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${String(cfg.api_key || "").trim()}` };
  const headers = { "Content-Type": "application/json", ...auth };
  const fname = safeOutName(input.filename, ".mp4", "video");
  // 轮询异步任务：5 秒一查，上限 10 分钟，任务停止信号可中断
  const poll = async (check) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 600000) {
      if (opts.stopSignal && opts.stopSignal.aborted) throw new Error("任务已被停止");
      const got = await check();
      if (got) return got;
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error("视频生成超时（10 分钟未完成，可稍后到渠道控制台查看任务）");
  };
  let videoUrl;
  if (/dashscope/i.test(base)) {
    // DashScope 万相（wan 系）：异步提交 + /tasks 轮询
    const r = await fetch(`${base}/services/aigc/video-generation/video-synthesis`, {
      method: "POST", headers: { ...headers, "X-DashScope-Async": "enable" }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model: cfg.model, input: { prompt }, parameters: {} }),
    });
    const j = await r.json().catch(() => ({}));
    const taskId = ((j || {}).output || {}).task_id;
    if (!r.ok || !taskId) return { content: `视频接口错误 ${r.status}: ${JSON.stringify(j).slice(0, 300)}`, isError: true };
    videoUrl = await poll(async () => {
      const s = await fetch(`${base}/tasks/${taskId}`, { headers: auth, signal: AbortSignal.timeout(30000) }).then((x) => x.json());
      const st = ((s || {}).output || {}).task_status;
      if (st === "SUCCEEDED") return s.output.video_url;
      if (st === "FAILED" || st === "CANCELED") throw new Error("视频任务失败：" + JSON.stringify(s.output).slice(0, 200));
      return null;
    });
  } else if (/volces|\/ark\b|ark\./i.test(base)) {
    // 火山方舟（Seedance 系）：contents/generations/tasks 异步 + 轮询
    const r = await fetch(`${base}/contents/generations/tasks`, {
      method: "POST", headers, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model: cfg.model, content: [{ type: "text", text: prompt }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) return { content: `视频接口错误 ${r.status}: ${JSON.stringify(j).slice(0, 300)}`, isError: true };
    videoUrl = await poll(async () => {
      const s = await fetch(`${base}/contents/generations/tasks/${j.id}`, { headers: auth, signal: AbortSignal.timeout(30000) }).then((x) => x.json());
      if (s.status === "succeeded") return ((s.content || {}).video_url) || null;
      if (s.status === "failed" || s.status === "cancelled") throw new Error("视频任务失败：" + JSON.stringify(s.error || s).slice(0, 200));
      return null;
    });
  } else {
    return {
      content: "视频渠道暂支持两种协议：DashScope 万相（接口地址含 dashscope，如 https://dashscope.aliyuncs.com/api/v1）或 火山方舟 Seedance（地址含 volces/ark，如 https://ark.cn-beijing.volces.com/api/v3）。当前接口地址两者都不是。",
      isError: true,
    };
  }
  if (!videoUrl) return { content: "视频任务完成但没有返回视频地址", isError: true };
  await downloadToWorkspace(videoUrl, fname, opts.saveDir, opts.workspace);
  security.audit("视频生成", `${cfg.model}: ${prompt.slice(0, 120)} → ${fname}`, "放行");
  return { content: `视频已生成并存入工作空间：${fname}（模型 ${cfg.model}）`, isError: false };
}

/** HTML → PNG：真浏览器离屏渲染（htmlshot.js，只有桌面版才有渲染器） */
async function htmlToImage(input, resolveFile, saveDir, ws) {
  const rel = String(input.html_file || "").trim();
  if (!rel) return { content: "缺少 html_file（工作空间里的 HTML 文件路径）", isError: true };
  let p;
  try { p = await resolveFile(rel); } catch (e) { return { content: e.message, isError: true }; }
  try { await fs.promises.access(p); }
  catch (error) { if (error.code === "ENOENT") return { content: `文件不存在：${rel}（先用 write_file 把排版 HTML 写进工作空间）`, isError: true }; throw error; }
  const fname = safeOutName(input.filename, ".png", "card");
  let buf;
  try {
    const { renderHtmlToPng } = require("./htmlshot");
    buf = await renderHtmlToPng(p, {
      width: input.width || 1242,
      height: input.height || 1656,
      fullPage: !!input.full_page,
      waitMs: input.wait_ms || 500,
    });
  } catch (e) {
    return { content: `HTML 截图失败：${e.message}`, isError: true };
  }
  const workspace = ws || workspaceDir;
  await ensureDirsAsync(workspace);
  await fs.promises.writeFile(path.join(saveDir || workspace, fname), buf);
  security.audit("HTML截图", `${rel} → ${fname}`, "放行");
  return { content: `已把 ${rel} 渲染成图片：${fname}（${input.width || 1242}x${input.full_page ? "整页" : input.height || 1656}）`, isError: false };
}

/** 文字 → 语音（渠道协议：OpenAI 兼容 /audio/speech、DashScope 原生 qwen-tts） */
async function textToSpeech(media, input, timeoutMs, saveDir, ws) {
  const cfg = (media || {}).tts || {};
  if (!cfg.base_url || !cfg.model) {
    return { content: "语音合成未配置：请在 设置 → 模型 → 语音合成 填写接口地址 / API Key / 模型名后再用。", isError: true };
  }
  const text = String(input.text || "").trim();
  if (!text) return { content: "缺少 text（要念的文字）", isError: true };
  if (text.length > 5000) return { content: `文字太长（${text.length} 字，上限 5000），请分段多次合成再拼接`, isError: true };
  const base = String(cfg.base_url).trim().replace(/\/+$/, "");
  const voice = String(input.voice || cfg.voice || "").trim();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${String(cfg.api_key || "").trim()}` };
  const signal = AbortSignal.timeout(Math.max(timeoutMs || 0, 300000));
  let fname;
  if (/dashscope/i.test(base)) {
    // DashScope 原生（qwen-tts / qwen3-tts-flash 系）：multimodal-generation，返回音频 URL（wav）
    fname = safeOutName(input.filename, ".wav", "speech");
    const r = await fetch(`${base}/services/aigc/multimodal-generation/generation`, {
      method: "POST", headers, signal,
      body: JSON.stringify({ model: cfg.model, input: { text, ...(voice ? { voice } : {}) } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { content: `语音接口错误 ${r.status}: ${JSON.stringify(j).slice(0, 300)}`, isError: true };
    const url = (((j.output || {}).audio || {}).url) || "";
    if (!url) return { content: "语音接口没有返回音频：" + JSON.stringify(j).slice(0, 300), isError: true };
    await downloadToWorkspace(url, fname, saveDir, ws);
  } else {
    // OpenAI 兼容 /audio/speech（OpenAI、new-api 等聚合网关通用）：直接返回音频二进制
    fname = safeOutName(input.filename, ".mp3", "speech");
    const r = await fetch(`${base}/audio/speech`, {
      method: "POST", headers, signal,
      body: JSON.stringify({
        model: cfg.model, input: text,
        ...(voice ? { voice } : {}),
        ...(input.speed ? { speed: Math.min(Math.max(Number(input.speed) || 1, 0.5), 2) } : {}),
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { content: `语音接口错误 ${r.status}: ${t.slice(0, 300)}`, isError: true };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 200) return { content: "语音接口返回的音频为空", isError: true };
    const workspace = ws || workspaceDir;
    await ensureDirsAsync(workspace);
    await fs.promises.writeFile(path.join(saveDir || workspace, fname), buf);
  }
  security.audit("语音合成", `${cfg.model}: ${text.slice(0, 80)} → ${fname}`, "放行");
  return { content: `语音已合成并存入工作空间：${fname}（模型 ${cfg.model}${voice ? "，音色 " + voice : ""}，约 ${text.length} 字）`, isError: false };
}

/**
 * 上机前先编译一遍。模型最常翻车的写法是在 run_node 里用模板字符串拼 HTML——
 * 网页正文里的反引号、${...}、</script> 会把外层模板字面量提前截断，剩下的正文变成裸代码，
 * 必然 SyntaxError。与其烧一次进程去撞、再把一坨 stderr 丢回去让它自己猜，
 * 不如当场把出错行和正确做法一起说清楚。返回 null 表示语法没问题。
 */
function precheckSyntax(code, ws) {
  try {
    // compileFunction 把代码当函数体编译：顶层 return 合法、顶层 await 非法，和 CommonJS 语义一致
    require("vm").compileFunction(code, [], { filename: "script.cjs" });
    return null;
  } catch (e) {
    if (!(e instanceof SyntaxError)) return null; // 只拦语法错，其它一律照常执行
    const m = /script\.cjs:(\d+)/.exec(e.stack || "");
    const line = m ? Number(m[1]) : 0;
    const src = code.split("\n");
    let msg = `❌ 代码没有执行：语法错误${line ? `（第 ${line} 行）` : ""}\n`;
    if (line) {
      for (let i = Math.max(0, line - 2); i < Math.min(src.length, line + 1); i++) {
        msg += `${i + 1 === line ? ">" : " "} ${i + 1} | ${src[i]}\n`;
      }
    }
    msg += `SyntaxError: ${e.message}\n`;
    // 代码里有反引号 + 写的是网页/文本类文件 → 几乎可以确定是模板字符串被正文截断
    if (code.includes("`") && /\.(html?|md|markdown|css|json|txt|xml|svg)\b/i.test(code)) {
      msg += `\n【最可能的原因】你在用模板字符串（反引号）拼网页/文本正文。正文里只要出现反引号、\${...} 或 </script>，外层模板字面量就会被提前截断，后面的正文全变成裸代码。
【正确做法】HTML / Markdown / CSS / JSON / 纯文本一律改用 write_file 工具直接写内容，不要在 run_node 里拼。run_node 只留给真需要跑逻辑的活（pptxgenjs 出 PPT、docx 出 Word、exceljs 出 Excel、批量处理、算数据）。
现在直接改用 write_file 重写这个文件，不要再试着转义模板字符串。`;
    } else {
      msg += `\n先把这一行的语法改对再重跑；不确定就把这段逻辑拆小、分几次执行。`;
    }
    return msg;
  }
}

// ---------- 子进程输出：头 + 尾 + 全文落盘 ----------
// 原来是 `out += d` 攒全文、末了 out.slice(0, 20000)，三个毛病：
//  ① 切了一个字的提示都没有——模型看到的就是「输出只有这些」，然后拿半截日志下结论。
//     静默截断比截断本身更坏，跟「标签说一套、实际跑一套」是同一类错；
//  ② 长输出的要害几乎都在尾巴上（报错栈、失败汇总、退出原因），只留头等于把答案扔了；
//  ③ 攒全文没有上限。server 跑在 Electron 主进程里，一条 `cat 大文件` 就能把整个应用撑爆。
// 现在内存只留「头 + 滚动的尾」，超预算就把全文写进 .tmp 下的日志（.tmp 不进产出列表，
// 不会污染文件面板），回给模型的是 头 + 省略了多少 + 尾 + 全文路径，要看中间自己去读那个文件。
const OUT_SPILL_AT = 256 * 1024; // 攒到这么多就别再往内存里堆，转成边收边写文件

/** .tmp 里的输出日志攒着不清会一直长；只删我们自己写的、三天前的 */
function pruneOldOutLogs(ws) {
  try {
    const dead = Date.now() - 3 * 24 * 3600 * 1000;
    for (const n of fs.readdirSync(tmpDir(ws))) {
      if (!/^(node|shell)(-err)?-out-.+\.log$/.test(n)) continue;
      const p = path.join(tmpDir(ws), n);
      if (fs.statSync(p).mtimeMs < dead) fs.rmSync(p, { force: true });
    }
  } catch {}
}

function makeOutSink(kind, headMax, tailMax, ws) {
  const dec = new StringDecoder("utf8"); // 一个中文字被切在两个 chunk 中间会变乱码，必须按流解码
  let head = "", tail = "", total = 0, file = null, rel = "", buf = [], bufLen = 0;
  let opening = null, spillFailed = false;
  async function pruneOldOutLogsAsync() {
    try {
      const dead = Date.now() - 3 * 24 * 3600 * 1000;
      for (const name of await fs.promises.readdir(tmpDir(ws))) {
        if (!/^(node|shell)(-err)?-out-.+\.log$/.test(name)) continue;
        const p = path.join(tmpDir(ws), name);
        if ((await fs.promises.stat(p)).mtimeMs < dead) await fs.promises.rm(p, { force: true });
      }
    } catch {}
  }
  async function openSpill() {
    if (file) return;
    if (opening) return opening;
    opening = (async () => {
      try {
        await ensureDirsAsync(ws);
        await pruneOldOutLogsAsync();
        const name = `${kind}-out-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}.log`;
        const handle = await fs.promises.open(path.join(tmpDir(ws), name), "wx");
        try {
          if (buf.length) await handle.writeFile(buf.join(""), "utf8");
        } catch (error) {
          await handle.close().catch(() => {});
          throw error;
        }
        file = handle;
        rel = ".tmp/" + name;
      } catch {
        spillFailed = true;
        rel = "";
      } finally {
        buf = [];
        bufLen = 0;
      }
    })();
    await opening;
  }
  async function take(str) {
    if (!str) return;
    total += str.length;
    if (head.length < headMax) head += str.slice(0, headMax - head.length);
    tail = tail.length + str.length > tailMax ? (tail + str).slice(-tailMax) : tail + str;
    if (file) {
      try { await file.writeFile(str, "utf8"); }
      catch {
        spillFailed = true;
        rel = "";
        await file.close().catch(() => {});
        file = null;
      }
      return;
    }
    if (spillFailed) return;
    buf.push(str);
    bufLen += str.length;
    if (bufLen > OUT_SPILL_AT) await openSpill();
  }
  return {
    write: (chunk) => take(dec.write(chunk)),
    writeText: take,
    /** 收尾并给出要回填进工具结果的文本：没超预算就是原文，超了就是 头 + 省略说明 + 尾 */
    async render() {
      await take(dec.end());
      if (!file && !spillFailed && total <= headMax + tailMax) return buf.join("");
      if (!file && !spillFailed) await openSpill(); // 没到落盘阈值但超了回显预算：也存一份，省略掉的部分得有地方可看
      if (file) {
        await file.close();
        file = null;
      }
      const omitted = total - head.length - tail.length;
      return (
        head +
        `\n\n…〔中间省略 ${omitted} 字符；本次输出共 ${total} 字符。` +
        (rel
          ? `全文已存到 ${rel}，要看省略掉的部分就 read_file 读它，或用 run_shell grep 它`
          : "全文落盘失败，现在只剩这里的头和尾") +
        `。下面这段是结尾，不是全部内容〕\n\n` +
        tail
      );
    },
  };
}

async function runNode(code, timeoutMs, cwd, ws, stopSignal = null) {
  const workspace = ws || workspaceDir;
  if (stopSignal?.aborted) return { content: "任务已被停止，该脚本未执行。", isError: true };
  await ensureDirsAsync(workspace);
  // 脚本在 workspace/.tmp 下执行，向上解析不到本项目的 node_modules；软链一份进去，
  // require("docx"/"pptxgenjs"/"exceljs") 才能稳定命中（NODE_PATH 只是兜底）
  const link = path.join(tmpDir(workspace), "node_modules");
  try { await fs.promises.access(link); }
  catch {
    try { await fs.promises.symlink(appPath("node_modules"), link, "junction"); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const file = path.join(tmpDir(workspace), `script_${Date.now()}_${Math.floor(Math.random() * 1e6)}.cjs`);
  const out = makeOutSink("node", 8000, 8000, workspace);
  const err = makeOutSink("node-err", 4000, 6000, workspace);
  const env = { ...process.env, NODE_PATH: appPath("node_modules"), CLOSECODE_HOME: DATA_DIR, ELECTRON_RUN_AS_NODE: "1" };
  try {
    await fs.promises.writeFile(file, code, "utf8");
    if (stopSignal?.aborted) return { content: "（任务已被停止，该脚本未执行）", isError: true };

    // Syntax checking runs in a child process so parsing a large generated file cannot block Electron.
    const check = await runProcess(process.execPath, ["--check", file], {
      cwd: cwd || workspace, timeout: 15000, maxBuffer: 1024 * 1024, encoding: "utf8", env, signal: stopSignal,
    });
    if (check.error?.code === "ABORT_ERR") return { content: "任务已被停止，脚本未执行。", isError: true };
    if (check.error || check.status !== 0) {
      const detail = String(check.stderr || check.stdout || check.error?.message || "syntax check failed").trim();
      let content = `代码没有执行：语法错误\n${detail}\n`;
      if (code.includes("`") && /\.(html?|md|markdown|css|json|txt|xml|svg)\b/i.test(code)) {
        content += "\n可能是模板字符串里的反引号、${...} 或 </script> 把正文截断了。HTML / Markdown / CSS / JSON / 纯文本建议用 write_file 写入。\n";
      }
      return { content, isError: true };
    }
    if (stopSignal?.aborted) return { content: "任务已被停止，脚本未执行。", isError: true };

    const result = await runProcess(process.execPath, [file], {
      cwd: cwd || workspace, timeout: timeoutMs, maxBuffer: 0, captureOutput: false, encoding: "utf8", env,
      signal: stopSignal,
      onStdout: chunk => out.write(chunk),
      onStderr: chunk => err.write(chunk),
    });
    const stdout = await out.render(), stderr = await err.render();
    let content = "";
    if (stdout) content += `stdout:\n${stdout}\n`;
    if (stderr) content += `stderr:\n${stderr}\n`;
    if (result.error?.code === "ETIMEDOUT") content += "(执行超时，已请求停止进程)\n";
    if (result.error?.code === "ABORT_ERR") content += "(任务已被停止)\n";
    if (result.error && !["ETIMEDOUT", "ABORT_ERR"].includes(result.error.code)) content += `process error: ${result.error.message}\n`;
    content += `exit code: ${result.status}`;
    return { content, isError: result.status !== 0 || !!result.error };
  } finally {
    await fs.promises.rm(file, { force: true }).catch(() => {});
  }
}

// Shell 生命周期独立管理，编码与超时/取消/后台日志共用同一条路径。
async function runShell(command, timeoutMs, cwd, ws, detach, sessionId = null, stopSignal = null, extra = {}) {
  const workspace = ws || workspaceDir;
  await ensureDirsAsync(workspace);
  return require("./lib/shell-runner").runShell({
    command, timeoutMs, cwd: cwd || workspace, workspace, detach, sessionId, stopSignal,
    dataDir: DATA_DIR, logDir: dataPath("data", "logs"), createSink: makeOutSink, registry: bgProc, ...extra,
  });
}

/**
 * 检测项目类型：靠特征文件判断，不靠模型猜。
 * 构建型项目（Vue/React/Vite/Next）和单文件 HTML 的交付方式完全不同——
 * 前者必须起 dev server 才能看，后者直接开文件就行，判错了用户就是一脸白屏。
 */
async function detectProjectType(dir) {
  const has = async (p) => { try { await fs.promises.access(path.join(dir, p)); return true; } catch { return false; } };
  const readJson = async (p) => { try { return JSON.parse(await fs.promises.readFile(path.join(dir, p), "utf8")); } catch { return null; } };

  const pkg = await readJson("package.json");
  const scripts = (pkg && pkg.scripts) || {};
  const deps = { ...((pkg && pkg.dependencies) || {}), ...((pkg && pkg.devDependencies) || {}) };
  const dep = (n) => Object.prototype.hasOwnProperty.call(deps, n);

  // dev 命令按 scripts 里真有的挑，别硬报一个 package.json 里不存在的脚本名
  const devScript = ["dev", "serve", "start"].find((s) => scripts[s]);
  const buildScript = ["build"].find((s) => scripts[s]);
  const pm = await has("pnpm-lock.yaml") ? "pnpm" : await has("yarn.lock") ? "yarn" : "npm";
  const runPrefix = pm === "npm" ? "npm run" : pm;

  const lines = [];
  let type = "unknown";
  let needsDevServer = false;

  if (pkg) {
    // 框架识别：配置文件优先（最可靠），再看依赖
    if (await has("next.config.js") || await has("next.config.mjs") || await has("next.config.ts") || dep("next")) type = "next";
    else if (await has("nuxt.config.js") || await has("nuxt.config.ts") || dep("nuxt")) type = "nuxt";
    else if (await has("vue.config.js") || dep("vue")) type = "vue";
    else if (dep("react")) type = "react";
    else if (dep("svelte")) type = "svelte";
    else if (dep("vite")) type = "vite";
    else if (dep("express") || dep("koa") || dep("fastify") || dep("@nestjs/core")) type = "node-backend";
    else type = "node-other";

    needsDevServer = !["node-backend", "node-other"].includes(type);
    lines.push(`项目类型：${type}${needsDevServer ? "（构建型前端项目）" : ""}`);
    lines.push(`包管理器：${pm}${await has("node_modules") ? "" : "（⚠️ node_modules 不存在，先装依赖）"}`);
    if (devScript) lines.push(`启动命令：${runPrefix} ${devScript}${needsDevServer ? "  ← 必须用 run_shell 的 detach:true 起，它不会自己退出" : ""}`);
    else lines.push(`启动命令：package.json 里没有 dev/serve/start 脚本，可用脚本：${Object.keys(scripts).join("、") || "（无）"}`);
    if (buildScript) lines.push(`构建命令：${runPrefix} ${buildScript}（产物一般在 dist/ 或 .next/）`);
    if (!await has("node_modules")) lines.push(`装依赖命令：${pm} install（这个命令会正常退出，不要 detach）`);
    if (needsDevServer) {
      lines.push("");
      lines.push("⚠️ 交付要点：这类项目的 index.html 是空壳模板，直接预览或 check_page 只会看到白屏。");
      lines.push("必须先起 dev server，拿到 http://localhost:<端口> 这个地址，再用它验证和交付。");
    }
  } else if (await has("index.html")) {
    type = "single-html";
    lines.push("项目类型：single-html（静态页面，没有 package.json）");
    lines.push("交付方式：直接用 check_page 验证 index.html，成果区可以直接点开预览，不需要 dev server。");
  } else if (await has("requirements.txt") || await has("pyproject.toml") || await has("manage.py")) {
    type = "python";
    lines.push("项目类型：python");
    if (await has("manage.py")) lines.push("看着是 Django：启动用 python manage.py runserver（常驻进程，要 detach:true）");
    lines.push("装依赖：pip install -r requirements.txt");
  } else {
    lines.push("没识别出已知的项目类型（没有 package.json / index.html / requirements.txt）。");
    lines.push("先用 list_files 看看目录里到底有什么，再决定怎么做。");
  }

  // 端口线索：vite.config / .env 里常写死端口，提前说出来省一次翻找
  for (const f of ["vite.config.js", "vite.config.ts", "vue.config.js", ".env", ".env.local"]) {
    if (!await has(f)) continue;
    try {
      const m = (await fs.promises.readFile(path.join(dir, f), "utf8")).match(/port\s*[:=]\s*['"]?(\d{2,5})/i);
      if (m) { lines.push(`配置文件 ${f} 里指定了端口 ${m[1]}`); break; }
    } catch {}
  }

  return { content: lines.join("\n"), isError: false, projectType: type, needsDevServer };
}

// 资料库（与 server.js 的 /api/library 同一目录）：跨项目共享的参考文件 + 灵感笔记
const LIB_DIR = dataPath("data", "library");
const NOTES_FILE = dataPath("data", "inspirations.json");

async function libraryList() {
  let files = [];
  try {
    for (const entry of await fs.promises.readdir(LIB_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      try {
        const st = await fs.promises.stat(path.join(LIB_DIR, entry.name));
        files.push(`${entry.name}\t${st.size} 字节\t${st.mtime.toISOString()}`);
      } catch { /* A file may be removed while the list is loading. */ }
    }
  } catch {}
  let notes = [];
  try {
    notes = JSON.parse(await fs.promises.readFile(NOTES_FILE, "utf8"));
  } catch {}
  const parts = [];
  parts.push(files.length ? `【资料文件】（用 library_read 读取）\n${files.join("\n")}` : "【资料文件】（空）");
  parts.push(
    notes.length
      ? `【灵感笔记】\n${notes.map((n) => `- [${(n.at || "").slice(0, 10)}] ${n.text}`).join("\n")}`
      : "【灵感笔记】（空）"
  );
  return parts.join("\n\n");
}

async function libraryRead(name) {
  const base = path.basename(String(name || ""));
  if (!base || base.startsWith(".")) throw new Error("文件名不合法");
  const handle = await fs.promises.open(path.join(LIB_DIR, base), "r");
  try {
    // Up to four UTF-8 bytes per character; avoid loading an entire large upload.
    const buffer = Buffer.alloc(50000 * 4);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const decoder = new StringDecoder("utf8");
    return (decoder.write(buffer.subarray(0, offset)) + (offset < buffer.length ? decoder.end() : "")).slice(0, 50000);
  } finally {
    await handle.close();
  }
}

const LIST_SKIP = new Set([".tmp", "node_modules", ".git", ".DS_Store", ".history"]);

/** 列目录。depth>1 时递归展开——看项目结构时一次看清，比一层层 list_files 省好几轮 */
async function listFiles(target, depth = 1, allowed = () => true) {
  try { await fs.promises.access(target); } catch { return "（目录不存在）"; }
  const maxDepth = Math.min(Math.max(Number(depth) || 1, 1), 3);
  const out = [];
  let truncated = false;
  async function walk(dir, rel, d) {
    if (truncated) return;
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (LIST_SKIP.has(e.name)) continue;
      if (out.length >= 400) {
        truncated = true;
        return;
      }
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink() || !allowed(full)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      let st;
      try {
        st = await fs.promises.stat(full);
      } catch {
        continue;
      }
      if (e.isDirectory()) {
        out.push(`[目录] ${r}/`);
        if (d < maxDepth) await walk(full, r, d + 1);
      } else {
        out.push(`${r}\t${st.size} 字节\t${st.mtime.toISOString()}`);
      }
    }
  }
  await walk(target, "", 1);
  if (!out.length) return "（空目录）";
  return out.join("\n") + (truncated ? "\n（超过 400 项，后面的没列——用 dir 指到具体子目录再看）" : "");
}

/**
 * 路径指到了一个目录。以前这里什么都不拦，fs.readFileSync 直接抛 EISDIR，
 * 模型看到「illegal operation on a directory」根本不知道自己错在哪，
 * 于是掉头改用 write_file 整篇重写——上一次报告丢了三节就是这么丢的。
 * 现在当场说清楚：这是目录，里面有这些文件，你要的是哪个。
 */
async function dirInsteadOfFile(p, label) {
  let names = [];
  try {
    names = (await fs.promises
      .readdir(p, { withFileTypes: true }))
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name)
      .slice(0, 12);
  } catch {}
  return new Error(
    `${label} 是一个目录，不是文件。` +
      (names.length ? `里面有：${names.join("、")}。带上文件名再来一次（${label}/${names[0]}）。` : "这个目录是空的。") +
      `别因为这个就改用 write_file 整篇重写——那会把你没读过的内容一起抹掉。`
  );
}

/** 覆盖前留底：workspace/.history/<原路径>.<时间戳>，同一个文件只留最近 5 份 */
async function keepBackup(file, rel, ws) {
  if (String(rel).split(/[\\/]/)[0] === ".history") return "";
  try {
    const workspace = ws || workspaceDir;
    const scope = require("./lib/workspace-scope");
    // 外部写授权不连带授权备份路径；不让 ../ 或 .history 符号链接产生额外写入。
    if (!scope.contains(workspace, file)) return "";
    const sub = path.dirname(path.relative(workspace, file));
    const dir = path.join(workspace, ".history", sub);
    if (!scope.contains(workspace, dir) || security.coreProtectionReason(dir)) return "";
    await fs.promises.mkdir(dir, { recursive: true });
    const base = path.basename(rel);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.promises.copyFile(file, path.join(dir, `${base}.${stamp}`));
    const olds = (await fs.promises.readdir(dir)).filter((f) => f.startsWith(base + ".")).sort();
    for (const f of olds.slice(0, -5)) await fs.promises.rm(path.join(dir, f), { force: true });
    return path.join(".history", sub, `${base}.${stamp}`);
  } catch {
    return "";
  }
}

/** Exact-first, formatting-aware replacement. Ambiguity/content differences never write. */
async function editFile(file, label, input, ws) {
  let stat;
  try { stat = await fs.promises.stat(file); }
  catch (e) { if (e.code === "ENOENT") throw new Error(`文件不存在：${label}。新建文件请用 write_file。`); throw e; }
  if (stat.isDirectory()) throw await dirInsteadOfFile(file, label);
  const src = await fs.promises.readFile(file, "utf8");
  const edit = require("./lib/text-edit").planTextEdit(src, input, label);
  if (edit.output === src) return label + " 内容没有变化（new_text 和 old_text 一样）";
  await keepBackup(file, label, ws);
  // Recheck after the asynchronous backup too; it may take time on slow disks.
  if (await fs.promises.readFile(file, "utf8") !== src) throw new Error("文件已被外部修改，请重新 read_file 后再编辑；未覆盖外部内容。");
  await fs.promises.writeFile(file, edit.output, "utf8");
  const where = edit.hits > 1 ? "替换了 " + edit.hits + " 处" : "在第 " + edit.line + " 行替换了 1 处";
  const compatible = edit.strategy === "exact" ? "" : edit.strategy === "newline" ? "；已自动兼容换行符差异" : edit.strategy === "markdown-table" ? "；已按唯一表格上下文兼容单元格边缘空白差异" : "；已按唯一上下文兼容等量缩进/行尾空格差异";
  return "已修改 " + label + "：" + where + "，" + src.length + " → " + edit.output.length + " 字符" + compatible;
}

/**
 * 写完/改完立刻做一次自检。
 *
 * 「改完自检」写在提示词里是没用的——模型该忘还是忘，坏文件就这么交出去了。
 * 所以把它挪到工具里：写完当场查，坏了当场把错误和行号顶回去，它想装看不见都不行。
 * 只查便宜且确定的东西（语法、结构），不做风格评判。
 */
async function selfCheck(file, rel, ws) {
  const ext = path.extname(rel).toLowerCase();
  let src = "";
  try {
    src = await fs.promises.readFile(file, "utf8");
  } catch {
    return "";
  }
  if (ext === ".json") {
    try {
      JSON.parse(src);
    } catch (e) {
      return `\n⚠️ JSON 语法没过：${e.message}。先修好再往下走。`;
    }
    return "";
  }
  if ([".js", ".cjs", ".mjs"].includes(ext)) {
    // ELECTRON_RUN_AS_NODE 必须带上：桌面版里 execPath 是 Electron 二进制，不带的话每检查一个 .js
    // 就真的启动一个 Electron 实例去加载用户的文件——满屏弹 JavaScript error 弹窗，还把合法代码误判成语法错误
    const check = (f) =>
      runProcess(process.execPath, ["--check", f], {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
    let r = await check(file);
    // .js 里写 ESM（import/export）在 CJS 下必然报错，但项目可能本来就是 type:module —— 换成 .mjs 再判一次，别误伤
    if (!r.error && r.status !== 0 && /^\s*(import|export)\s/m.test(src)) {
      const alt = path.join(tmpDir(ws), `syntax-${require("crypto").randomUUID()}.mjs`);
      try {
        await fs.promises.mkdir(tmpDir(ws), { recursive: true });
        await fs.promises.writeFile(alt, src);
        if ((await check(alt)).status === 0) r = { status: 0 };
      } catch {}
      try { await fs.promises.rm(alt, { force: true }); } catch {}
    }
    if (r.error) return `\n⚠️ JS 语法自检未完成：${r.error.message}。文件已保存，请重新检查。`;
    if (r.status !== 0) {
      const msg = String(r.stderr || "").split("\n").filter((l) => l && !/^\s*at /.test(l)).slice(0, 6).join("\n");
      return `\n⚠️ JS 语法没过：\n${msg}\n先修好再往下走（用 edit_file 改那一行，别整篇重写）。`;
    }
    return "";
  }
  if (ext === ".py") {
    // 用 ast.parse 而不是 py_compile：后者会往 __pycache__ 写 .pyc 污染工作目录。
    // 本机没 python3 / spawn 失败一律跳过，环境问题不能报成语法错误
    try {
      const r = await runProcess(process.platform === "win32" ? "python" : "python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())", file], { encoding: "utf8", timeout: 15000 });
      if (r.status === 1 && /SyntaxError|IndentationError|TabError/.test(String(r.stderr))) {
        const msg = String(r.stderr).split("\n").filter((l) => l && !/^Traceback|^\s*File "<string>"/.test(l)).slice(-4).join("\n");
        return `\n⚠️ Python 语法没过：\n${msg}\n先修好再往下走。`;
      }
    } catch {}
    return "";
  }
  if ([".sh", ".bash", ".zsh"].includes(ext)) {
    try {
      const r = await runProcess(ext === ".zsh" ? "zsh" : "bash", ["-n", file], { encoding: "utf8", timeout: 10000 });
      if (!r.error && r.status !== 0 && r.stderr) {
        return `\n⚠️ Shell 脚本语法没过：\n${String(r.stderr).split("\n").filter(Boolean).slice(0, 4).join("\n")}\n先修好再往下走。`;
      }
    } catch {}
    return "";
  }
  if (ext === ".md") {
    const fences = (src.match(/^```/gm) || []).length;
    if (fences % 2 === 1) return "\n⚠️ Markdown 里有 ``` 代码围栏没闭合（奇数个），界面会把后面的正文整块吞掉。补上收尾的 ```。";
    return "";
  }
  if (ext === ".svg") {
    const orphan = orphanSvgStyleScopes(src);
    if (orphan.length) {
      return `\n⚠️ 这个 SVG 的样式作用域挂空了：<style> 里写了 ${orphan.slice(0, 4).map((n) => "#" + n).join("、")}，` +
        `<svg> 上却没有这个 id。样式一条都不生效，图会变成黑字、没底色、框线全丢。id 和选择器改成一致的。`;
    }
    // 独立的 .svg 文件同样没有外层页面给它变量，坏法和 HTML 一模一样
    const { missing } = await undefinedCssVars(src, path.dirname(file));
    if (missing.length) {
      return `\n⚠️ 这个 SVG 用了没定义的 CSS 变量：${missing.slice(0, 6).map((n) => "--" + n).join("、")}。` +
        `独立文件没有外层页面给它变量，var(--没定义的) 会让颜色回落到黑色，图上很可能黑底黑字。` +
        `在 <svg> 里自己写一段 <style>:root{--x:…}</style>，或者直接把颜色写死。`;
    }
    return "";
  }
  if (ext === ".html" || ext === ".htm") {
    const issues = (await auditHtml(src, path.dirname(file))).filter((x) => x.level === "错");
    if (issues.length) return `\n⚠️ 页面结构有问题：${issues.map((x) => x.msg).join("；")}。建议再跑一次 check_page 确认。`;
    return "";
  }
  return "";
}

/**
 * 查「用了但没定义」的 CSS 变量。
 *
 * 这是一条真出过事的坑：模型给回复正文里的内联 SVG 学会了用 var(--color-text-primary)
 * 这套语义变量（那是应用页面定义的，暗色模式会自动跟着变），然后把同一套写法带进了
 * 它自己写到磁盘的独立 HTML 文件里。那个文件根本没定义这些变量，于是
 * fill: var(--没定义的) 整条声明作废、回落到默认的黑色——底块黑的、字也是黑的，
 * 用户看到的就是一片黑。而且在应用内预览时是好的（变量从外层页面继承下来了），
 * 只有用浏览器打开才露馅，属于最难自己发现的那类。
 *
 * 判定很确定：var(--x) 没写兜底值、全文又找不到 --x: 的定义，就是错。
 * 带兜底值的 var(--x, #333) 不算问题——那正是该有的写法。
 */
async function undefinedCssVars(src, baseDir) {
  let defsSrc = src;
  let remoteCss = false;
  // 变量也可能定义在外链样式表里。本地的读进来一起看；远程的读不到，降级成「警」
  for (const m of src.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
    const href = (m[0].match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    if (/^https?:/i.test(href)) { remoteCss = true; continue; }
    try { defsSrc += await fs.promises.readFile(path.join(baseDir, href.split("?")[0]), "utf8"); } catch { remoteCss = true; }
  }
  const defined = new Set([...defsSrc.matchAll(/--([A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));
  const missing = new Set();
  for (const m of src.matchAll(/var\(\s*--([A-Za-z0-9_-]+)\s*([,)])/g)) {
    if (m[2] === ",") continue; // 写了兜底值，坏不了
    if (!defined.has(m[1])) missing.add(m[1]);
  }
  return { missing: [...missing], remoteCss };
}

/**
 * 查内联 SVG 里「作用域挂空了」的 <style>。
 *
 * 又一条真出过事的坑：gen_diagram 出来的 mermaid SVG，样式全部写成
 * `#<svg 自己的 id> .node rect{...}` 这种作用域选择器。模型把图往 HTML 报告里贴的时候，
 * 常常顺手"重命名 id 防冲突"——只改了 <svg id="…">、没改 <style> 里的选择器（或者反过来）。
 * 于是整张图的样式一条都不生效，mermaid 回落到浏览器默认值：黑字、没底色、框线全丢，
 * 用户打开就是"黑底黑字、排版乱成一团"。mermaid 每次渲染的 id 本来就是随机的、不会撞，
 * 压根不需要改名——贴进去时一个字符都不该动。
 *
 * 判定同样是确定的：选择器里写了 #foo，同一段 <svg> 里又没有 id="foo"，这条规则就是死的。
 * 只看 { 前面的选择器部分，值里的 #f0e9dc 这种十六进制颜色不会被误当成 id。
 */
function orphanSvgStyleScopes(src) {
  const bad = new Set();
  for (const m of String(src || "").matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    const svg = m[0];
    const styles = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((x) => x[1]).join("\n");
    if (!styles.trim()) continue;
    const ids = new Set([...svg.matchAll(/\sid=["']([^"']+)["']/g)].map((x) => x[1]));
    const selectors = styles.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((b) => b.split("{")[0]).join(",");
    for (const x of selectors.matchAll(/#([A-Za-z_][\w-]*)/g)) if (!ids.has(x[1])) bad.add(x[1]);
  }
  return [...bad];
}

/** 网页静态体检。只报能确定的问题，不做审美评判 */
async function auditHtml(src, baseDir) {
  const out = [];
  const add = (level, msg) => out.push({ level, msg });
  if (!/<!doctype\s+html/i.test(src)) add("警", "没有 <!DOCTYPE html>（浏览器会退到怪异模式，排版会走样）");
  if (!/<meta[^>]+name=["']viewport["']/i.test(src)) add("警", "没有 viewport meta，手机上会缩成一团");
  const title = (src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (!title || !title.trim()) add("警", "<title> 是空的（浏览器标签页和分享卡片都靠它）");
  // 标签闭合：只查结构性标签，查全了误报比真问题还多
  for (const tag of ["html", "head", "body", "div", "section", "main", "header", "footer", "table", "ul", "ol", "script", "style"]) {
    const open = (src.match(new RegExp(`<${tag}(\\s|>)`, "gi")) || []).length;
    const close = (src.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    if (open !== close) add("错", `<${tag}> 开 ${open} 个、闭 ${close} 个，对不上`);
  }
  // 外链资源：断网/发给别人就打不开了，单文件页面这是硬伤
  const ext = [...src.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]);
  const cdn = ext.filter((u) => !/^https?:\/\/(fonts\.googleapis|fonts\.gstatic)\./i.test(u));
  if (cdn.length) add("警", `引了 ${cdn.length} 个外部资源（${cdn[0].slice(0, 60)}…），断网或换台电脑就白屏；库和图片请内联或下载到本地`);
  // 本地引用的文件在不在
  const local = [...src.matchAll(/(?:src|href)=["'](?!https?:|data:|#|mailto:|javascript:)([^"']+)["']/gi)].map((m) => m[1]);
  for (const rel of local.slice(0, 40)) {
    const f = path.join(baseDir, rel.split("?")[0].split("#")[0]);
    try { await fs.promises.access(f); } catch { add("错", `引用了不存在的本地文件：${rel}`); }
  }
  const cssVar = await undefinedCssVars(src, baseDir);
  if (cssVar.missing.length) {
    const names = cssVar.missing.slice(0, 6).map((n) => "--" + n).join("、");
    const more = cssVar.missing.length > 6 ? `（共 ${cssVar.missing.length} 个）` : "";
    add(
      cssVar.remoteCss ? "警" : "错",
      `用了没定义的 CSS 变量：${names}${more}。var(--没定义的) 会让整条声明作废、回落到默认色——` +
        `文字和底色双双变黑，页面上就是一片看不清。要么在本文件的 :root 里把它们定义出来，` +
        `要么直接写死颜色值，或者至少写兜底 var(--x, #333)`
    );
  }
  const orphan = orphanSvgStyleScopes(src);
  if (orphan.length) {
    add(
      "错",
      `内联 SVG 的样式作用域挂空了：<style> 里写了 ${orphan.slice(0, 4).map((n) => "#" + n).join("、")}，` +
        `同一段 <svg> 里却没有这个 id。整张图的样式一条都不会生效，会回落成黑字、没底色、框线全丢。` +
        `把图原样贴回来（gen_diagram 的 id 本来就是随机的，不会撞，不用改名）`
    );
  }
  const text = src.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 30) add("警", "去掉标签后几乎没有正文（可能是内容全靠 JS 生成，也可能就是个空壳）");
  return out;
}

/** 验收网页：静态体检 + 真浏览器打开一遍（拿控制台报错） */
async function checkPage(file, rel) {
  const src = await fs.promises.readFile(file, "utf8");
  const issues = await auditHtml(src, path.dirname(file));
  const lines = [`【静态体检】${rel}（${Buffer.byteLength(src)} 字节）`];
  lines.push(issues.length ? issues.map((x) => `- [${x.level}] ${x.msg}`).join("\n") : "- 没发现结构问题");

  let electron = null;
  try {
    electron = require("electron");
  } catch {}
  if (!electron || !electron.BrowserWindow || !electron.app || !electron.app.isReady()) {
    lines.push("\n【浏览器实测】跳过（当前是命令行模式，没有内置浏览器）。交付前请在桌面版里再跑一次。");
    return lines.join("\n");
  }
  const win = new electron.BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const errs = [];
  try {
    // 控制台报错是白屏的头号原因，光看源码看不出来
    win.webContents.on("console-message", (_e, level, message) => {
      if (level >= 2) errs.push(String(message).slice(0, 300));
    });
    win.webContents.on("did-fail-load", (_e, code, desc, url) => errs.push(`资源加载失败 ${desc}（${String(url).slice(0, 80)}）`));
    await win.loadURL("file://" + file);
    await new Promise((r) => setTimeout(r, 1200));
    const info = await win.webContents.executeJavaScript(
      "({ t: document.title || '', n: (document.body ? document.body.innerText : '').trim().length, h: document.body ? document.body.scrollHeight : 0 })"
    );
    lines.push(`\n【浏览器实测】标题「${info.t}」· 可见正文 ${info.n} 字 · 页面高 ${info.h}px`);
    if (info.n < 20) lines.push("- [错] 打开后几乎没有可见内容（白屏）。多半是 JS 报错或 CSS 把内容藏了。");
    lines.push(errs.length ? `- [错] 控制台报错 ${errs.length} 条：\n  ${errs.slice(0, 5).join("\n  ")}` : "- 控制台没有报错");
  } catch (e) {
    lines.push(`\n【浏览器实测】打开失败：${e.message}`);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    if (!electron.BrowserWindow.getAllWindows().length) electron.app.quit();
  }
  return lines.join("\n");
}

const SEARCH_SKIP = new Set([".tmp", "node_modules", ".git", "dist", "build", ".next", "__pycache__", "venv", ".venv", ".cache"]);

/** 全文搜索：异步读取，逐项保留权限检查，不阻塞主进程等待磁盘。 */
function searchFiles(root, { query, regex, ext, max }, allowed = () => true) {
  if (!String(query || "")) throw new Error("query 是空的");
  // 文件工具传入逐项策略；不让预扫描/worker 越过保护边界。
  return searchFilesSingleThread(root, { query, regex, ext, max, allowed });
}

/** 单线程搜索（优化版）：直接遍历，避免 worker 开销 */
async function searchFilesSingleThread(root, { query, regex, ext, max, re, exts, limit, allowed = () => true }) {
  const q = query || "";
  if (!re) {
    try {
      re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    } catch (e) {
      throw new Error(`正则不合法：${e.message}`);
    }
  }
  if (!exts) {
    exts = String(ext || "")
      .split(",")
      .map((x) => x.trim().replace(/^\./, "").toLowerCase())
      .filter(Boolean);
  }
  if (!limit) {
    limit = Math.min(Math.max(Number(max) || 60, 1), 300);
  }

  const hits = [];
  let scanned = 0,
    truncated = false;
  async function walk(dir) {
    if (truncated) return;
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (truncated) return;
      if (SEARCH_SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink() || !allowed(full)) continue;
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      if (exts.length && !exts.includes(path.extname(e.name).slice(1).toLowerCase())) continue;
      let st;
      try {
        st = await fs.promises.stat(full);
      } catch {
        continue;
      }
      if (st.size > 2 * 1024 * 1024) continue; // 大文件多半是产物/数据，不是要找的代码
      let buf;
      try {
        buf = await fs.promises.readFile(full);
      } catch {
        continue;
      }
      if (buf.includes(0)) continue; // 二进制
      scanned++;
      const rel = path.relative(root, full) || e.name;
      const lines = buf.toString("utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        if (hits.length >= limit) {
          truncated = true;
          return;
        }
      }
    }
  }
  await walk(root);
  if (!hits.length) return `（没搜到「${q}」，扫了 ${scanned} 个文本文件）`;
  return (
    hits.join("\n") +
    (truncated
      ? `\n（到 ${limit} 条上限了，后面还有没列出来的——把关键词写细，或用 dir/ext 缩范围）`
      : `\n（共 ${hits.length} 条，扫了 ${scanned} 个文本文件）`)
  );
}

// 自报家门式的 UA（"Mozilla/5.0 (CloseCode)"）会被相当多的站点直接判成爬虫：
// B 站回 412 风控页、知乎/微信回跳转页。用真实浏览器的头，拿到的才是用户在浏览器里看到的东西。
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function browserHeaders(url) {
  const h = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };
  // 不少接口（B 站、微博、小红书）只认同源 Referer，缺了就当越权
  try {
    const u = new URL(url);
    h.Referer = `${u.protocol}//${u.host}/`;
    h.Origin = `${u.protocol}//${u.host}`;
  } catch {}
  return h;
}

/** 抓回来的东西是不是"没有正文"——SPA 只给了个空壳，或者被反爬挡了 */
function looksEmptyPage(text, status) {
  if (status >= 400) return true;
  const t = (text || "").trim();
  if (t.length < 200) return true;
  return /(请开启\s*JavaScript|enable\s+JavaScript|<noscript)/i.test(t) && t.length < 2000;
}

// PDF / 压缩包 / 图片这类东西按文本读出来是一堆乱码，20000 字乱码进上下文既污染判断又白烧钱。
// content-type 常常是错的（不少站点一律回 octet-stream 甚至 text/html），所以再看一眼文件头。
const BIN_CT = /^(image|audio|video|font)\/|^application\/(pdf|zip|gzip|x-[\w.+-]+|octet-stream|msword|vnd\.)/i;

function looksBinary(ct, buf) {
  if (BIN_CT.test(ct)) return true;
  const h = Buffer.from(buf.slice(0, 8));
  if (h.slice(0, 4).toString("latin1") === "%PDF") return true;
  if (h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5)) return true; // PK.. → zip/docx/xlsx/pptx
  if (h[0] === 0x89 && h.slice(1, 4).toString("latin1") === "PNG") return true;
  if (h[0] === 0xff && h[1] === 0xd8) return true; // jpeg
  if (h.slice(0, 3).toString("latin1") === "GIF") return true;
  return false;
}

/**
 * 按 URL 猜个文件名存进工作目录，重名不覆盖——目录里可能已经躺着用户自己的 report.pdf。
 * 用 wx 独占创建而不是"先看在不在再写"：只读工具是并发跑的，两条 fetch 撞同一个名字时
 * 检查和写入之间那道缝会让后一个把前一个盖掉。
 */
async function saveDownload(url, ct, buf, dir, ws) {
  const workspace = ws || workspaceDir;
  await ensureDirsAsync(workspace);
  let base = "";
  try { base = decodeURIComponent(path.basename(new URL(url).pathname || "")); } catch {}
  base = base.replace(/[\/\\:*?"<>|\s]/g, "_").slice(0, 80);
  if (!/\.[a-z0-9]{1,6}$/i.test(base)) {
    const m = /^(?:image|audio|video)\/([\w.+-]+)/i.exec(ct) || /^application\/(pdf|zip)/i.exec(ct);
    base = (base || "download") + (m ? "." + m[1].replace(/^x-/, "").replace(/\+.*$/, "") : ".bin");
  }
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const data = Buffer.from(buf);
  for (let i = 1; i < 50; i++) {
    const name = i === 1 ? base : `${stem}_${i}${ext}`;
    try {
      await fs.promises.writeFile(path.join(dir || workspace, name), data, { flag: "wx" });
      return name;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  const name = `${stem}_${Date.now()}${ext}`;
  await fs.promises.writeFile(path.join(dir || workspace, name), data);
  return name;
}

/**
 * 按真实字符集解码。fetch 的 .text() 一律当 UTF-8 读，
 * 遇到国内那些还在用 GBK 的老站点会整页乱码——模型看到的就是一堆问号，然后判定"这站抓不到"。
 */
function decodeBody(buf, ct) {
  let cs = (String(ct).match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!cs) cs = (Buffer.from(buf.slice(0, 4096)).toString("latin1").match(/charset=["']?([\w-]+)/i) || [])[1];
  cs = String(cs || "utf-8").toLowerCase();
  if (/^(utf-?8|us-ascii|ascii)$/.test(cs)) return Buffer.from(buf).toString("utf8");
  try {
    return new TextDecoder(cs).decode(buf);
  } catch {
    return Buffer.from(buf).toString("utf8");
  }
}

async function fetchUrl(url, { render, saveDir, workspace } = {}) {
  let resp;
  try {
    resp = await fetch(url, { redirect: "follow", headers: browserHeaders(url), signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new Error(`抓取失败：${e.name === "TimeoutError" ? "30 秒还没响应（站点太慢或需要代理）" : e.message}`);
  }
  const ct = resp.headers.get("content-type") || "";
  const declared = Number(resp.headers.get("content-length") || 0);
  if (declared > 30 * 1024 * 1024) {
    return `⚠️ 这个地址是个 ${(declared / 1048576).toFixed(1)} MB 的大文件（${ct || "类型未知"}），没有下载，它也不是网页正文。真需要的话用 run_shell 跑 \`curl -L -o 文件名 "${url}"\` 存下来再处理。`;
  }
  const buf = await resp.arrayBuffer();
  if (looksBinary(ct, buf)) {
    const name = await saveDownload(url, ct, buf, saveDir, workspace);
    const kind = /pdf/i.test(ct) || Buffer.from(buf.slice(0, 4)).toString("latin1") === "%PDF" ? "pdf" : "";
    return (
      `这不是网页，是二进制文件（${ct || "类型未知"}，${buf.byteLength} 字节），已下载到工作目录：${name}\n` +
      (kind === "pdf"
        ? `读它的文字：先 run_shell 跑 \`${process.platform === "win32" ? "where" : "which"} pdftotext\`，装了就 \`pdftotext -layout "${name}" -\`；没装就在 run_node 里解析。`
        : `按类型处理：Office 文档用 docx/exceljs 读，压缩包先 unzip，图片音视频直接当素材用。`) +
      `\n别再把这个地址当网页正文抓一遍了。`
    );
  }
  const body = decodeBody(buf, ct);
  // JSON 别去标签：那会把 {"a":"<b>"} 洗成一堆空格，接口返回值全废了
  if (ct.includes("json") || /^\s*[[{]/.test(body)) {
    return `HTTP ${resp.status}（${ct || "json"}）\n${body.slice(0, 20000)}`;
  }
  let text = body;
  if (ct.includes("html") || /<html/i.test(body)) {
    text = htmlToText(body);
  }
  // 标题写进首行：模型引用来源时有个人话名字，界面底下的「来源」也直接拿它当标签
  const title = pageTitle(body);
  const head = `HTTP ${resp.status}${title ? ` · ${title}` : ""}`;

  // 空壳/被拦：能渲染就渲染一遍，渲染不了也要把原因说清楚，别让模型以为"这个网站读不到"就此收手
  if (render !== false && looksEmptyPage(text, resp.status)) {
    const rendered = await renderPage(url).catch((e) => ({ error: e.message }));
    if (rendered && rendered.text && rendered.text.length > text.length) {
      return `HTTP ${resp.status}${rendered.title || title ? ` · ${rendered.title || title}` : ""}（静态 HTML 是空壳，已用内置浏览器渲染后读取）\n${rendered.text.slice(0, 20000)}`;
    }
    const why =
      resp.status === 412 || resp.status === 403
        ? `对方站点把这次请求判成了爬虫（HTTP ${resp.status}）`
        : resp.status >= 400
          ? `对方站点返回 HTTP ${resp.status}`
          : "这个页面的正文是 JavaScript 动态渲染的，静态 HTML 里没有内容";
    return (
      `⚠️ 没能拿到正文：${why}。${rendered && rendered.error ? `（渲染兜底也失败：${rendered.error}）` : ""}\n` +
      `别就此打住，换条路：① 找这个页面背后的数据接口直接请求（浏览器 F12 网络面板里那种 api 地址）；` +
      `② 用 run_shell 调本机已装的命令行工具（curl 带完整浏览器请求头、yt-dlp 取视频站元数据等）；` +
      `③ web_search 搜这个页面的内容，从能打开的镜像/转载页拿。至少换三种路子都不行，才算真做不到。\n` +
      `原始返回（前 2000 字）：\n${text.slice(0, 2000)}`
    );
  }
  return `${head}\n${text.slice(0, 20000)}`;
}

/** 从 HTML 里取 <title>，实体解码后压成一行 */
function pageTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (!m) return "";
  return m[1]
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// 导航、页头页脚、侧栏、表单：每页都有、每页都一样，抓十个页面等于把同一堆链接抄十遍。
// 20000 字的预算是有限的，噪声占掉的每一行都是正文没进去的一行。
const NOISE_TAGS = /<(script|style|noscript|template|svg|nav|header|footer|aside|form|iframe|select)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** 正文容器优先：<article> 最准，其次 <main>，都没有就退回 <body>。挑最长的那块，侧栏里的小 article 不算 */
function mainRegion(html) {
  for (const tag of ["article", "main"]) {
    const blocks = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((m) => m[1]);
    if (!blocks.length) continue;
    const best = blocks.sort((a, b) => b.length - a.length)[0];
    if (best && best.length > 400) return best;
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return body ? body[1] : html;
}

function htmlToText(html) {
  const cleaned = String(html || "").replace(/<!--[\s\S]*?-->/g, " ").replace(NOISE_TAGS, " ");
  const text = tagsToText(mainRegion(cleaned));
  // 抽过头了（结构不规范、正文压根不在 article/main 里）就退回整页：宁可带点噪声，也不能把内容弄丢
  if (text.length >= 200) return text;
  const full = tagsToText(cleaned);
  return full.length > text.length ? full : text;
}

function tagsToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 用内置浏览器真渲染一遍再取正文。
 * 应用本体跑在 Electron 主进程里，等于随身带了个 Chrome——不装 puppeteer 也能读动态页面。
 * CLI 模式下没有 Electron，如实抛错让上层换路子，不要假装读到了。
 */
async function renderPage(url, { waitMs = 2500, maxWaitMs = 12000 } = {}) {
  let electron;
  try {
    electron = require("electron");
  } catch {
    throw new Error("当前不在桌面应用里跑，没有内置浏览器可用");
  }
  if (!electron || !electron.BrowserWindow || !electron.app || !electron.app.isReady()) {
    throw new Error("内置浏览器不可用（命令行模式）");
  }
  const win = new electron.BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  try {
    win.webContents.setUserAgent(BROWSER_UA);
    await win.loadURL(url);
    let text = "";
    const deadline = Date.now() + maxWaitMs;
    // 首屏挂上以后正文还在异步请求，等到内容不再变长（或超时）为止
    for (let last = -1; Date.now() < deadline; ) {
      await new Promise((r) => setTimeout(r, waitMs));
      text = await win.webContents.executeJavaScript("document.body ? document.body.innerText : ''");
      if (text.length > 400 && text.length === last) break;
      last = text.length;
    }
    const title = await win.webContents.executeJavaScript("document.title || ''").catch(() => "");
    return { text: (text || "").replace(/\n{3,}/g, "\n\n").trim(), title: String(title || "").trim().slice(0, 80) };
  } finally {
    if (!win.isDestroyed()) win.destroy();
    // 渲染期间用户把主窗口关了：window-all-closed 那会儿这个隐藏窗口还活着，没触发退出。
    // 这里补一刀，免得应用变成看不见的僵尸进程。
    if (!electron.BrowserWindow.getAllWindows().length) electron.app.quit();
  }
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x?\w+;/g, " ").replace(/&[a-zA-Z]+\d*;/g, " ").replace(/\s{2,}/g, " ").trim();
}

// ---- 多 provider 搜索（Jina / Tavily / Brave / Bing中国），统一返回 [{title,url,desc}] ----
async function bingCnSearch(key, query, n) {
  // Bing中国版：免key，国内访问快，HTML解析
  const resp = await fetch("https://cn.bing.com/search?q=" + encodeURIComponent(query) + "&count=" + n, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Bing搜索失败（${resp.status}）`);
  const html = await resp.text();

  // 先按 b_algo 块切分，再从每块里提取链接和摘要。
  // 注意 li 上还挂着 data-id / iid 等属性，不能假定 class 后面紧跟 ">"
  const blocks = html.split(/<li class="b_algo[^>]*>/);
  const results = [];

  for (const block of blocks.slice(1, n + 1)) {
    // 提取链接和标题
    const linkMatch = block.match(/<h2[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/s);
    if (!linkMatch) continue;

    const url = linkMatch[1];
    const title = stripTags(linkMatch[2]).trim();

    // 提取摘要（可能在 b_caption 或 b_snippetText 里）
    const captionMatch = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>(.*?)<\/p>/s);
    const desc = captionMatch ? stripTags(captionMatch[1]).trim() : '';

    if (title && url.startsWith('http')) {
      results.push({ title, url, desc });
    }
  }

  if (results.length === 0) throw new Error('Bing无结果');
  return results;
}

async function jinaSearch(key, query, n) {
  const resp = await fetch("https://s.jina.ai/?q=" + encodeURIComponent(query), {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "X-Respond-With": "no-content" },
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Jina 搜索失败（${resp.status}）`);
  const data = (await resp.json()).data || [];
  return data.slice(0, n).map((r) => ({ title: r.title, url: r.url, desc: r.description || "" }));
}

async function tavilySearch(key, query, n) {
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: n, include_answer: false, search_depth: "basic" }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Tavily 搜索失败（${resp.status}）: ${(await resp.text().catch(() => "")).slice(0, 120)}`);
  const data = (await resp.json()).results || [];
  return data.slice(0, n).map((r) => ({ title: r.title, url: r.url, desc: r.content || "" }));
}

async function braveSearch(key, query, n) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}&text_decorations=false`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Brave 搜索失败（${resp.status}）: ${(await resp.text().catch(() => "")).slice(0, 120)}`);
  const data = ((await resp.json()).web || {}).results || [];
  return data.slice(0, n).map((r) => ({ title: r.title, url: r.url, desc: r.description || "" }));
}

const SEARCH_PROVIDERS = { 'bing-cn': bingCnSearch, jina: jinaSearch, tavily: tavilySearch, brave: braveSearch };

function searchProviderKey(cfg, provider) {
  // bing-cn 免 key
  if (provider === 'bing-cn') return 'no-key-needed';
  // 每个 provider 独立 key；jina 兼容旧字段 api_key / 环境变量
  if (provider === "jina") return cfg.jina_key || cfg.api_key || process.env.JINA_API_KEY || "";
  if (provider === "tavily") return cfg.tavily_key || process.env.TAVILY_API_KEY || "";
  if (provider === "brave") return cfg.brave_key || process.env.BRAVE_API_KEY || "";
  return "";
}

async function webSearch(query, count, searchCfg) {
  const n = Math.min(Math.max(+count || 5, 1), 10);
  const cfg = searchCfg || {};
  const provider = (cfg.provider || "bing-cn").toLowerCase(); // 默认用 Bing 中国版（快且免费）

  // 多引擎接力：配置的 provider 打头，其余有 key 的引擎依次顶上（谁被限流换下一个），
  // 全军覆没才退 DuckDuckGo 免费档；每一步的失败原因都记下来带给 agent
  const chain = [provider, ...Object.keys(SEARCH_PROVIDERS).filter((p) => p !== provider)];
  const errors = [];
  for (const p of chain) {
    const fn = SEARCH_PROVIDERS[p];
    const key = searchProviderKey(cfg, p);
    if (!fn || !key) continue;
    try {
      const items = await fn(key, query, n);
      if (items.length) {
        return items
          .map((r, i) => `${i + 1}. ${r.title || "(无标题)"}\n   ${r.url}\n   ${(r.desc || "").slice(0, 300)}`)
          .join("\n\n");
      }
      errors.push(`${p}: 无结果`);
    } catch (e) {
      errors.push(`${p}: ${String(e.message || e).slice(0, 100)}`);
    }
  }

  // 回退：DuckDuckGo HTML 版（免 key）
  let html = "";
  try {
    const resp = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(30000),
    });
    html = await resp.text();
  } catch (e) {
    errors.push(`duckduckgo: ${String(e.message || e).slice(0, 100)}`);
  }
  const titles = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  const results = titles.slice(0, n).map((m, i) => {
    let url = m[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    return `${i + 1}. ${stripTags(m[2])}\n   ${url}\n   ${stripTags((snippets[i] || ["", ""])[1]).slice(0, 300)}`;
  });
  if (results.length) return results.join("\n\n");
  if (html) errors.push("duckduckgo: 页面无结果（可能被反爬拦截）");

  // 兜底 2：百度 HTML 版（免 key；jina/DDG 在国内网络常整条不可达，百度是最后的保命通道）
  try {
    const resp = await fetch("https://www.baidu.com/s?wd=" + encodeURIComponent(query) + "&rn=" + n, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
      signal: AbortSignal.timeout(30000),
    });
    const bhtml = await resp.text();
    const items = [...bhtml.matchAll(/<h3[^>]*>\s*<a[^>]*?href="(http[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map((m) => ({ url: m[1], title: stripTags(m[2]).trim() }))
      .filter((r) => r.title);
    if (items.length) {
      return (
        "（以下来自百度，链接多为跳转链，用 fetch_url 打开会自动到达真实页面）\n\n" +
        items
          .slice(0, n)
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`)
          .join("\n\n")
      );
    }
    errors.push("baidu: 页面无结果");
  } catch (e) {
    errors.push(`baidu: ${String(e.message || e).slice(0, 100)}`);
  }
  return (
    "（本次搜索无结果" +
    (errors.length ? `。各引擎情况：${errors.join("；")}` : "") +
    "。可以等几十秒再试、换关键词，或用 fetch_url 直接访问已知的相关网站）"
  );
}

/** 拼错的工具名 → 最接近的真名。没有足够像的就返回空字符串，别乱猜误导模型。 */
function nearestTool(name, known) {
  const n = String(name || "");
  if (!Array.isArray(known) || !known.length || !n) return "";
  // MCP 全名是 mcp__<服务器>__<工具>，最常见的错法就是只写了最后一段
  const tail = known.find((k) => k.endsWith("__" + n));
  if (tail) return tail;
  const dist = (a, b) => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  };
  let best = "";
  let bd = Infinity;
  for (const k of known) {
    const d = dist(n, k);
    if (d < bd) { bd = d; best = k; }
  }
  return bd <= Math.max(2, Math.floor(n.length / 4)) ? best : "";
}

async function executeTool(name, input, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120000;
  // 安全中心策略（settings 里配置）；未传时用纯默认值（等价于旧行为 + 默认黑名单）
  const sec = opts.security || { ...security.DEFAULTS };
  // Fix C: 工作目录从调用方显式传入（runState.workspace），不再读全局 workspaceDir
  const ws = opts.workspace || workspaceDir;
  // Agent tasks work from the project root; baseDir holds per-session artifacts.
  // Explicit legacy tool callers can still use baseDir as their working directory.
  let fileBase = ws;
  if (opts.baseDir) {
    try {
      const b = path.resolve(ws, String(opts.baseDir));
      if (!require("./lib/workspace-scope").contains(ws, b)) throw new Error("成果目录越出本项目");
      await fs.promises.mkdir(b, { recursive: true });
      if (!opts.projectRoot) fileBase = b;
    } catch (e) { return { content: "成果目录不可用，已阻止工具执行：" + e.message, isError: true }; }
  }
  // 文件工具统一走策略解析：workspace 内默认放行、黑名单硬拦、workspace 外仅白名单
  const baseName = fileBase === ws ? "" : path.basename(fileBase);
  const fileContext = {
    user: opts.authorizationUser ?? opts.user ?? opts.memory?.user, runToken: opts.runToken, stopSignal: opts.stopSignal,
    access: ["write_file", "edit_file", "gen_diagram"].includes(name) ? "write" : "read",
  };
  const normalizeFileRel = (rel) => {
    // 相对路径已经是从成果子目录起算的，模型再在前面拼一遍目录名，
    // 落点就成了 任务_X/任务_X/…：任务目录建在任务目录里，产物就此和交付分了家。
    // "同名目录套同名目录"没有任何一种正当写法，直接剥掉这一层。
    if (baseName) {
      const s0 = String(rel || "").replace(/\\/g, "/");
      if (!path.isAbsolute(s0) && (s0 === baseName || s0.startsWith(baseName + "/"))) {
        const fixed = s0.slice(baseName.length).replace(/^\/+/, "");
        console.warn(`[tools] ${name}: 路径多套了一层成果目录，已纠正 ${s0} → ${fixed || "."}`);
        rel = fixed || ".";
      }
    }
    return rel;
  };
  const filePolicy = (rel, base = fileBase) => security.resolvePathWithPolicy(sec, rel, ws, base, fileContext);
  // Legacy file_blacklist no longer controls ordinary access, but diagnostics
  // must never disclose names the user explicitly marked private.
  const diagnosticAllowed = (candidate) => {
    if (!filePolicy(candidate).allowed) return false;
    let absolute;
    try { absolute = path.resolve(String(candidate)); } catch { return false; }
    return !(sec.file_blacklist || []).some(entry => {
      const raw = String(entry || '').trim();
      if (!raw) return false;
      const expanded = raw.startsWith('~') ? path.join(require('os').homedir(), raw.slice(1)) : raw;
      const blocked = path.resolve(expanded);
      const rel = path.relative(blocked, absolute);
      return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
    });
  };
  const resolveFile = async (rel) => {
    rel = normalizeFileRel(rel);
    const r = filePolicy(rel);
    if (!r.allowed) {
      security.audit("文件拦截", `${name}: ${rel}`, "拦截");
      throw new Error(`文件访问被安全中心拦截：${r.reason}`);
    }
    // 读取/编辑已有文件可兼容根目录同路径；新建产物绝不能因此改写根目录同名文件。
    // 兜底只认文件：兜到一个同名目录上，下游就是一句莫名其妙的 EISDIR
    const canReadRoot = ["read_file", "edit_file", "look_at_image", "check_page", "html_to_image"].includes(name);
    if (canReadRoot && fileBase !== ws) {
      let missing = false;
      try { await fs.promises.stat(r.path); }
      catch (error) { if (error.code === "ENOENT") missing = true; }
      if (missing) {
        const r2 = filePolicy(rel, ws);
        try { if (r2.allowed && (await fs.promises.stat(r2.path)).isFile()) return r2.path; } catch {}
      }
    }
    return r.path;
  };
  /**
   * 闸门统一走这里：拦下就返回一段给模型看的说明，放行返回 null。
   * run_shell 和 run_node 用的是同一套 —— 只守 shell 那扇门是守不住的，
   * 一句 require("child_process") 就从旁边过去了。
   */
  const passGate = async (verdict, label, text, { force = false } = {}) => {
    // force：权限档位（只看不动/每步都问）是用户当场选的档，不受安全闸门总开关影响
    if (verdict.action === "allow") return null;
    if (verdict.action === "deny") {
      security.audit(label + "拦截", text, "拦截");
      return { content: `${label}被安全中心拦截：${verdict.rule}（命中「${verdict.seg}」）`, isError: true };
    }
    security.audit(label + "审批", text, "等待审批");
    const waitMs = Math.min(
      (sec.approval_timeout_s || 120) * 1000,
      opts.deadline ? Math.max(5000, opts.deadline - Date.now() - 10000) : Infinity
    );
    if (name === "run_shell") opts.onStatus?.("命令等待安全审批，最长 " + Math.ceil(waitMs / 1000) + " 秒。", { phase: "approval" });
    const ok = await security.requestApproval(label + "执行", text, {
      timeoutMs: waitMs,
      stopSignal: opts.stopSignal,
      rule: verdict.rule || "",
      ruleKey: verdict.ruleKey || "",
      source: opts.taskLabel || "",
      user: fileContext.user,
      runToken: opts.runToken,
    });
    security.audit(label + "审批", text, ok ? "已批准" : "已拒绝");
    if (ok) return null;
    return {
      content: `${label}未获批准（${verdict.rule}）。已在界面弹出审批请求但被拒绝或超时。可以换一种不需要它的做法，或让用户在 设置 → 安全中心 调整名单。`,
      isError: true,
    };
  };
  try {
    const explicitPath = ["list_files", "search_files"].includes(name) ? (input.dir || ".") :
      ["read_file", "write_file", "edit_file", "look_at_image", "check_page"].includes(name) ? input.path :
      name === "html_to_image" ? input.html_file : null;
    if (explicitPath != null) {
      const result = await security.authorizeDirectoryPath(sec, normalizeFileRel(explicitPath), ws, fileBase, {
        ...fileContext, isDirectory: ["list_files", "search_files"].includes(name),
        source: opts.taskLabel || "", timeoutMs: Math.min((sec.approval_timeout_s || 120) * 1000,
          opts.deadline ? Math.max(1, opts.deadline - Date.now()) : Infinity),
      });
      if (!result.allowed) throw new Error("文件访问被安全中心拦截：" + result.reason);
    }
    await ensureDirsAsync(ws);
    switch (name) {
      case "run_node": {
        if (sec.runtime_node === false) {
          security.audit("命令拦截", "run_node（内置 Node.js 运行时已停用）", "拦截");
          return { content: "内置 Node.js 运行时已在 设置 → 安全中心 停用，无法执行代码。", isError: true };
        }
        const code = String(input.code || "");
        const blocked = await passGate(security.checkCode(sec, code, ws), "代码", code.slice(0, 500));
        if (blocked) return blocked;
        return await runNode(code, timeoutMs, fileBase, ws, opts.stopSignal);
      }
      case "run_shell": {
        const cmd = String(input.command || "");
        const shellWorkspace = require("./lib/shell-workspace");
        let cwd;
        try {
          cwd = shellWorkspace.resolveShellCwd(input.cwd ?? ".", fileBase, ws, security, sec);
          shellWorkspace.checkShellWorkspace(cmd, cwd, ws, security, sec);
        } catch (error) {
          return { isError: true, code: error.code || "SHELL_CWD_DENIED", content: error.message,
            projectRoot: error.projectRoot || ws, resolvedCwd: error.resolvedCwd, running: false, executed: false };
        }
        let inlinePlan;
        try { inlinePlan = require("./lib/windows-inline-command").windowsInlinePlan(cmd, cwd); }
        catch (error) { return { isError: true, code: error.code, content: error.message, running: false }; }
        const verdicts = [security.checkCommand(sec, cmd, cwd)];
        if (inlinePlan) {
          let resolved;
          try { resolved = { path: shellWorkspace.resolveShellCwd(inlinePlan.cwd, fileBase, ws, security, sec) }; }
          catch (error) {
            return { isError: true, code: error.code || "SHELL_CWD_DENIED", content: error.message,
              projectRoot: error.projectRoot || ws, resolvedCwd: error.resolvedCwd, running: false, executed: false };
          }
          // 不能因 python.exe/py/带引号的解释器路径而绕过运行时开关。
          if (sec.runtime_python === false) return { isError: true, content: "内置运行时 Python 已停用，命令未执行。" };
          verdicts.push(security.checkCommand(sec, inlinePlan.auditCommand, inlinePlan.cwd));
          verdicts.push(security.checkCode(sec, inlinePlan.code, inlinePlan.cwd));
        }
        // 使用原始源码审核，绝不只审核编码后的载荷；合并为一次审批，不重复弹窗。
        const verdict = verdicts.find(v => v.action === "deny") || verdicts.find(v => v.action === "ask" && !v.ruleKey) || verdicts.find(v => v.action === "ask") || verdicts[0];
        const blocked = await passGate(verdict, "命令", cmd, { force: true });
        if (blocked) return blocked;
        security.audit("命令执行", cmd, "放行");
        const remaining = opts.deadline == null ? timeoutMs : Math.min(timeoutMs, opts.deadline - Date.now());
        return await runShell(cmd, remaining, cwd, ws, input.detach, opts.sessionId, opts.stopSignal, { encoding: input.encoding || "utf8", onStatus: opts.onStatus });
      }
      case "gen_diagram": {
        const rel = String(input.filename || "diagram").replace(/\.(svg|png)$/i, "");
        const blocked = await passGate(security.checkWrite(sec, rel + ".svg"), "写文件", rel + ".svg", { force: true });
        if (blocked) return blocked;
        const { renderDiagram } = require("./diagram");
        const r = await renderDiagram({
          kind: input.kind, source: String(input.source || ""), width: input.width, height: input.height, theme: input.theme,
        });
        const svgPath = await resolveFile(rel + ".svg");
        await fs.promises.mkdir(path.dirname(svgPath), { recursive: true });
        await fs.promises.writeFile(svgPath, r.svg);
        let msg = `已生成 ${rel}.svg（${(Buffer.byteLength(r.svg) / 1024).toFixed(1)}KB）`;
        if (r.png) {
          await fs.promises.writeFile(await resolveFile(rel + ".png"), r.png);
          msg += `、${rel}.png（${(r.png.length / 1024).toFixed(1)}KB，插飞书/Word 用这个）`;
        }
        if (r.note) msg += `。${r.note}`;
        return { content: msg, isError: false };
      }
      case "write_file": {
        const rel = String(input.path || "");
        let p = await resolveFile(rel);
        const blocked = await passGate(security.checkWrite(sec, rel), "写文件", rel, { force: true });
        if (blocked) return blocked;
        p = await resolveFile(rel); // 等待其他审批期间可能撤销授权、停止任务或替换符号链接
        return await withFileEdit(p, async () => {
        p = await resolveFile(rel);
        let oldStat = null;
        try { oldStat = await fs.promises.stat(p); }
        catch (e) { if (e.code !== "ENOENT") throw e; }
        const existed = !!oldStat;
        if (oldStat?.isDirectory()) return { content: (await dirInsteadOfFile(p, rel)).message, isError: true };
        const oldSize = oldStat?.size || 0;
        await fs.promises.mkdir(path.dirname(p), { recursive: true });
        const body = String(input.content || "");
        const n = Buffer.byteLength(body);
        // 整篇重写把一个现成文件砍掉一大截 = 几乎肯定是没读全就重写，写下去就找不回来了。
        // 提示词里写一百遍「别整篇重写」也拦不住，只能在工具这一层真的不让它写。
        if (existed && !input.append && !input.overwrite && oldSize >= 800 && n < oldSize * 0.6) {
          return {
            content:
              `已拦截，一个字节都没写：${rel} 现在是 ${oldSize} 字节，你这次只给了 ${n} 字节，` +
              `写下去等于删掉 ${oldSize - n} 字节现成内容。\n` +
              `改局部用 edit_file；接着往后写用 append:true；` +
              `确实就是要整篇换掉（已经 read_file 读完全文、清楚自己要删什么），再传 overwrite:true 重来。`,
            isError: true,
          };
        }
        const bak = existed && !input.append ? await keepBackup(p, rel, ws) : "";
        if (input.append) {
          await fs.promises.appendFile(p, body, "utf8");
          const warn = await selfCheck(p, rel, ws);
          const newSize = (await fs.promises.stat(p)).size;
          return { content: `已追加到 ${rel}（+${n} 字节，现共 ${newSize} 字节）${warn}`, isError: !!warn };
        }
        await fs.promises.writeFile(p, body, "utf8");
        const warn = await selfCheck(p, rel, ws);
        // 覆盖和新建要说清楚：整篇重写一个已有文件，多半是该用 edit_file 却偷懒了
        return {
          content:
            (existed
              ? `已覆盖 ${rel}（原 ${oldSize} 字节 → 现 ${n} 字节）` +
                (bak ? `，原件留了一份在 ${bak}` : "") +
                `。提醒：改已有文件的局部内容用 edit_file，整篇重写会连你没读过的部分一起换掉。`
              : `已新建 ${rel}（${n} 字节）`) + warn,
          isError: !!warn,
        };
        });
      }
      case "edit_file": {
        const rel = String(input.path || "");
        let p = await resolveFile(rel);
        const blocked = await passGate(security.checkWrite(sec, rel), "改文件", rel, { force: true });
        if (blocked) return blocked;
        p = await resolveFile(rel);
        return await withFileEdit(p, async () => {
          p = await resolveFile(rel);
          const msg = await editFile(p, rel, input, ws);
          const warn = await selfCheck(p, rel, ws);
          return { content: msg + warn, isError: !!warn };
        });
      }
      case "read_file": {
        if (typeof input.path !== "string" || !input.path.trim()) return { content: "path 必须是非空文件路径。", isError: true };
        const p = await resolveFile(input.path);
        const missing = () => require("./lib/file-context").missingFileResult({
          requested: input.path, resolved: p, baseDir: fileBase, workspace: ws,
          allowed: diagnosticAllowed,
        });
        let stat;
        try { stat = await fs.promises.stat(p); }
        catch (error) { if (error.code === "ENOENT") return await missing(); throw error; }
        if (stat.isDirectory()) return { content: (await dirInsteadOfFile(p, String(input.path))).message, isError: true };
        // 按文本读一张 png，拿回来的是几万字符乱码：既看不出任何东西，还把上下文烧掉一大块
        if (IMAGE_EXT.test(p)) {
          return { content: `${input.path} 是图片，按文本读只会得到乱码。改用 look_at_image，并带上你想知道的具体问题。`, isError: true };
        }
        let content;
        try { content = await fs.promises.readFile(p, "utf8"); }
        catch (error) { if (error.code === "ENOENT") return await missing(); throw error; }
        const actual = path.resolve(fileBase, input.path) !== p ? "（已解析到实际文件：" + p + "）\n" : "";
        const s = Math.max(0, Number(input.start_line) || 0);
        const e = Math.max(0, Number(input.end_line) || 0);
        if (s || e) {
          const lines = content.split("\n");
          const from = Math.max(1, s || 1);
          if (from > lines.length) return { content: `${input.path} 只有 ${lines.length} 行，start_line=${from} 超出范围`, isError: true };
          const to = Math.min(lines.length, e || lines.length);
          const body = lines
            .slice(from - 1, to)
            .map((l, i) => `${from + i}\t${l}`)
            .join("\n");
          return { content: (actual + `（${input.path} 第 ${from}-${to} 行，全文共 ${lines.length} 行）\n${body}`).slice(0, 50000), isError: false, resolvedPath: p };
        }
        const cut = content.length > 50000;
        return {
          resolvedPath: p,
          content: actual + content.slice(0, 50000) + (cut ? `\n\n（文件 ${content.length} 字符，这里只给了前 50000。要看后面用 start_line/end_line）` : ""),
          isError: false,
        };
      }
      case "list_files":
        return { content: await listFiles(await resolveFile(input.dir || "."), input.depth, p => filePolicy(p).allowed), isError: false };
      case "search_files":
        return { content: await searchFiles(await resolveFile(input.dir || "."), input, p => filePolicy(p).allowed), isError: false };
      case "remember": {
        const r = memory.add({ text: input.text, user: opts.memory && opts.memory.user, shared: !!input.shared, workspace: ws });
        return { content: r.note, isError: !r.ok };
      }
      case "forget": {
        const r = memory.forget({ text: input.text, user: opts.memory && opts.memory.user, workspace: ws });
        return { content: r.note, isError: r.removed === 0 };
      }
      case "check_page": {
        const rel = String(input.path || "");
        const p = await resolveFile(rel);
        try { await fs.promises.access(p); }
        catch (error) { if (error.code === "ENOENT") return { content: `文件不存在：${rel}`, isError: true }; throw error; }
        const report = await checkPage(p, rel);
        // 体检查出毛病，是这个工具干成了它该干的活，不是它自己失败了。标成 isError 会连累三处：
        // errStreaks 把「改一次、测一次」记成连续失败去触发循环检测（真实数据里 15 次调用被记了
        // 8 次假失败）；trimHistory 把它当成不可重现的证据舍不得裁；模型看见红色的失败会倾向于
        // 重跑体检，而它其实该去改页面。问题写在报告正文里，模型看得懂。
        const bad = /\[错\]/.test(report);
        return { content: (bad ? "体检发现问题，需要你去改页面（工具本身跑通了，别重跑体检）：\n" : "") + report, isError: false };
      }
      case "save_skill": {
        const skills = require("./skills");
        const name = skills.userSkillName(input.name), fm = skills.parseFrontmatter(input.content);
        const existing = skills.getSkillFull(name);
        const saved = skills.saveSkill({name,description:fm.description,content:fm.content,original_name:existing?.name});
        return { content: `技能「${saved.name}」已保存并生效（skills/${saved.dir}/skill.md）`, isError: false };
      }
      case "library_list":
        return { content: await libraryList(), isError: false };
      case "library_read":
        return { content: await libraryRead(input.name), isError: false };
      case "look_at_image":
        return await lookAtImage(opts, input, timeoutMs, resolveFile);
      case "generate_image":
        return await generateImage(opts.media, input, timeoutMs, fileBase, ws);
      case "generate_video":
        return await generateVideo(opts.media, input, { ...opts, saveDir: fileBase, workspace: ws });
      case "html_to_image":
        return await htmlToImage(input, resolveFile, fileBase, ws);
      case "text_to_speech":
        return await textToSpeech(opts.media, input, timeoutMs, fileBase, ws);
      case "desktop_pet": {
        // 真正的活儿在 server.js（那儿才同时握着 config、data/ 和活着的 Electron 窗口），这里只转发
        if (!global.__wbPetTool) return { content: "桌面宠物功能没装起来（服务端未注册 desktop_pet 的实现）。", isError: true };
        return await global.__wbPetTool.run(input, fileBase, ws);
      }
      case "detect_project_type": {
        return await detectProjectType(fileBase);
      }
      case "list_background_processes": {
        bgProc.cleanup(); // 先把已经退出的记录扫掉，别报一堆死进程
        const all = bgProc.listForWorkspace(ws, opts.sessionId);
        if (!all.length) return { content: "当前没有正在运行的后台进程。", isError: false };
        const lines = all.map((p) => {
          const mins = Math.round((Date.now() - p.startTime) / 60000);
          const alive = bgProc.isAlive(p.pid);
          return [
            `PID ${p.pid}${alive ? "" : "（已退出）"}`,
            `  命令: ${p.command}`,
            `  已运行: ${mins < 1 ? "不到 1 分钟" : mins + " 分钟"}`,
            `  工作目录: ${p.projectDir || "（未记录）"}`,
            `  日志: ${p.logFile}`,
          ].join("\n");
        });
        return { content: `共 ${all.length} 个后台进程：\n\n${lines.join("\n\n")}`, isError: false };
      }
      case "kill_background_process": {
        const pid = parseInt(input.pid, 10);
        if (!Number.isInteger(pid) || pid <= 0) return { content: "pid 必须是正整数", isError: true };
        // 只允许停自己登记过的后台进程：拿这个工具去 kill 任意系统 PID 是另一回事
        const known = bgProc.listForWorkspace(ws, opts.sessionId).find((p) => p.pid === pid);
        if (!known) {
          return { content: `PID ${pid} 不在本应用启动的后台进程名单里，未执行。先用 list_background_processes 看看有哪些。`, isError: true };
        }
        if (!bgProc.isAlive(pid)) {
          bgProc.unregister(pid);
          return { content: `PID ${pid} 已经不在运行了，记录已清理。`, isError: false };
        }
        const ok = await bgProc.kill(pid);
        return {
          content: ok ? `已停止 PID ${pid}（${known.command}）。` : `停止 PID ${pid} 失败，可能需要手动在任务管理器里结束。`,
          isError: !ok,
        };
      }
      case "read_process_log": {
        const pid = parseInt(input.pid, 10);
        if (!Number.isInteger(pid) || pid <= 0) return { content: "pid 必须是正整数", isError: true };
        const known = bgProc.listForWorkspace(ws, opts.sessionId).find((p) => p.pid === pid);
        if (!known || !known.logFile) {
          return { content: `找不到 PID ${pid} 的日志记录。先用 list_background_processes 看看有哪些进程。`, isError: true };
        }
        let raw;
        try {
          const scope = require("./lib/workspace-scope");
          // 后台日志由 runner 写入应用日志目录，不一定在项目内。先按项目核验登记记录，
          // 再限制到项目或应用管理的日志文件；真实路径校验拒绝指向别的项目的链接。
          const managedLog = /^bg-[\w-]+\.log$/.test(path.basename(known.logFile)) &&
            scope.same(path.dirname(scope.realPath(known.logFile)), dataPath("data", "logs"));
          if (!scope.contains(ws, known.logFile) && !managedLog) throw new Error("日志不属于本项目的受管日志，拒绝读取");
          const handle = await fs.promises.open(known.logFile, "r");
          try {
            const stat = await handle.stat();
            const maxBytes = 512 * 1024;
            const start = Math.max(0, stat.size - maxBytes);
            const tail = Buffer.alloc(stat.size - start);
            const { bytesRead } = await handle.read(tail, 0, tail.length, start);
            raw = tail.subarray(0, bytesRead).toString("utf8");
            if (start) raw = "（前段日志按 512 KB 限制省略）\n" + raw;
          } finally { await handle.close(); }
        }
        catch (e) { return { content: `读日志失败：${e.message}（文件 ${known.logFile}）`, isError: true }; }
        const all = raw.split("\n");
        const lines = all.slice(-2000);
        const omitted = all.length - lines.length;
        return {
          content: `PID ${pid} 的日志（${known.logFile}）：\n` +
            (omitted > 0 ? `（前 ${omitted} 行已省略，完整内容在文件里）\n` : "") +
            "\n" + lines.join("\n"),
          isError: false,
        };
      }
      case "fetch_url": {
        const gate = security.checkUrl(sec, input.url);
        if (!gate.allowed) {
          security.audit("网络拦截", input.url, "拦截");
          return { content: `网络访问被安全中心拦截：${gate.reason}（设置 → 安全中心 → 网络安全）`, isError: true };
        }
        security.audit("网络访问", `网络访问已执行：${input.url}`, "放行");
        return { content: await fetchUrl(input.url, { render: input.render !== false, saveDir: fileBase, workspace: ws }), isError: false };
      }
      case "render_page": {
        const gate = security.checkUrl(sec, input.url);
        if (!gate.allowed) {
          security.audit("网络拦截", input.url, "拦截");
          return { content: `网络访问被安全中心拦截：${gate.reason}（设置 → 安全中心 → 网络安全）`, isError: true };
        }
        security.audit("网络访问", `浏览器渲染已执行：${input.url}`, "放行");
        try {
          const r = await renderPage(input.url, { waitMs: Math.min(Math.max(input.wait_ms || 2500, 500), 8000) });
          if (!r.text) return { content: "渲染成功但页面正文为空——多半是要登录，或者内容在 iframe / canvas 里。", isError: true };
          return { content: (r.title ? `HTTP 200 · ${r.title}\n` : "") + r.text.slice(0, 20000), isError: false };
        } catch (e) {
          return { content: `渲染失败：${e.message}`, isError: true };
        }
      }
      case "web_search":
        security.audit("网络访问", `联网搜索：${input.query}`, "放行");
        return { content: await webSearch(input.query, input.count, opts.search), isError: false };
      default: {
        // 模型常把 MCP 工具的前缀吃掉（调 directory_tree 而不是 mcp__filesystem__directory_tree），
        // 真实数据里这一种拼错白烧了 4 轮模型调用。光说「未知工具」它只能接着瞎猜，把最像的真名给它。
        const guess = nearestTool(name, opts.knownTools);
        return { content: `未知工具: ${name}` + (guess ? `。你是不是想调 ${guess}？工具名必须一字不差地写全。` : ""), isError: true };
      }
    }
  } catch (e) {
    return { content: `工具执行出错: ${e.message}`, isError: true };
  }
}

/** 列出 workspace 下的文件（含子目录，最深 3 层、最多 500 个；name 为相对路径。前端按目录分组展示，@ 补全同源） */
async function outputFiles(ws) {
  const workspace = ws || workspaceDir;
  await ensureDirsAsync(workspace);
  const out = [];
  const SKIP = new Set([".tmp", "node_modules", ".git"]);
  async function walk(dir, rel, depth) {
    if (depth > 3 || out.length >= 500) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= 500) return;
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, r, depth + 1);
      } else if (e.isFile()) {
        try {
          const st = await fs.promises.stat(full);
          out.push({ name: r, size: st.size, mtime: st.mtime.toISOString() });
        } catch {}
      }
    }
  }
  await walk(workspace, "", 1);
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

module.exports = {
  _internals: { fetchRetry, nearestTool, lookAtImage, shrinkForVision }, TOOL_DEFS, executeTool, outputFiles, safePath, fetchUrl, renderPage, htmlToText, getWorkspaceDir, setWorkspaceDir, SEARCH_PROVIDERS, searchProviderKey, shellPath };
