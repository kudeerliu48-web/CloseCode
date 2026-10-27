---
name: gpt-image-2
description: 通过 DoCode 中转站（https://docode.cc）调用 gpt-image-2 生图。用户给提示词后，必须先用当前对话模型优化 prompt，再向用户索取 DoCode API Key（未提供则先停下来要 Key），然后 POST /v1/images/generations 出图并保存到工作目录。适用于海报、配图、封面、商品图、概念图。用户说「用 gpt-image-2 画」「gpt-image2」「DoCode 生图」「docode 出图」时必须加载本技能，不要改用 generate_image。
---

# gpt-image-2 生图（DoCode 中转站）

用**当前对话模型**优化用户提示词，再拿用户提供的 DoCode API Key，调用 gpt-image-2 出图。

**不要**走平台自带的 `generate_image` 工具——那是另一套图像模型配置，和本技能无关。

## 适用场景

- 用户说「用 gpt-image-2 画一张…」「gpt-image2 生图」「走 DoCode 出图」
- 用户给了一段提示词，要出海报 / 配图 / 封面 / 商品图 / 概念图
- 用户明确指定中转站是 https://docode.cc
- 用户输入 `/gpt-image-2`

不适用于：用户只要平台默认图像模型、或明确要求 HTML 排版截图（那是 `html_to_image`）。

## 红线（必须遵守）

1. **API Key 绝不能**写入 `remember`、技能文件、PROGRESS、日志、交付文档。记忆是明文，还会进系统提示词。
2. Key 只存在**当前这一轮对话**的工具调用参数里。用户说「记住我的 Key」→ 拒绝，并说明下次还要再贴一次。
3. 对用户回显时把 Key 打码：`sk-****` + 后 4 位。完整 Key 不要出现在最终回复里。
4. 不生成暴力、色情、未成年人性化、真实公众人物仿冒、侵权品牌内容。
5. 未拿到 Key 之前，**禁止**调用生图接口，也禁止用假数据假装生成成功。
6. 没有真实写出 png 文件，绝不能说「已生成」。

## 操作步骤（按顺序，一步都不要跳）

### 第 0 步：拿 API Key

按下面优先级取，取到就进入第 1 步：

1. 用户**本轮消息**里已经贴了 `sk-` 开头的 Key
2. **同一段对话**里用户刚才给过（还在上下文中）
3. 都没有 → **立刻停下来向用户要 Key**，不要先优化、不要先问风格、不要先生成。话术固定：

> 要用 gpt-image-2 出图，需要你的 DoCode API Key。
> 打开 https://docode.cc → 控制台 → 令牌管理，复制 Key 发给我。
> 只在这次对话里用，不会写入长期记忆，也不会存进文件。

拿到 Key 后马上继续，不要再确认「要不要开始」。

Key 校验：去掉首尾空格和换行；应以 `sk-` 开头。明显残缺（特别短、含空格/换行）就让用户重新复制，不要拿残 Key 去打接口。

### 第 1 步：读懂需求（自己定默认，不要把选择题丢给用户）

从用户描述抽出：

| 维度 | 没有说时的默认 |
|---|---|
| 主体 | 没有主体就无法画 → 这时才问「画什么」 |
| 风格 | 按用途猜：海报偏设计、配图偏摄影/插画、商品偏棚拍 |
| 构图 | 海报/头图偏横版，小红书/手机壁纸偏竖版，其余方形 |
| 画质 | **1K**（快、省额度）。用户说高清/印刷/4K 再升 |
| 张数 | **1 张**。用户说「来 3 张」最多 4 张，禁止一次超过 4 |
| 文件名 | 英文短横线，描述性，如 `neon-cat-alley.png` |

尺寸对照（用户没指定像素时用）：

| 用途 | 画质 | size | 模型 |
|---|---|---|---|
| 默认 / 头像 / 方形配图 | 1K | `1024x1024` | `gpt-image-2` |
| 公众号头图 / 横幅 | 1K | `1536x1024` | `gpt-image-2` |
| 小红书封面 / 竖版海报 | 1K | `1024x1536` | `gpt-image-2` |
| 用户要 2K | 2K | `2048x2048`（方）/`2560x1440`（横） | `gpt-image-2-2k` |
| 用户要 4K / 印刷 | 4K | `2880x2880`（方）/`3840x2160`（横） | `gpt-image-2-4k` |

用户说「透明背景」→ 请求体加 `"background": "transparent"`。
用户说「质量高一点」但没说 2K/4K → 仍用 `gpt-image-2`，加 `"quality": "high"`。

### 第 2 步：用【当前对话模型】优化提示词（本技能的核心）

**禁止**把用户原文原样丢给生图接口。
**禁止**再去调另一个 LLM 接口做优化——优化就是你（当前对话模型）自己写。

产出一份**最终生图 prompt**，必须覆盖：

1. **主体**：是什么、数量、关键外观（颜色/材质/年龄段/品种）
2. **动作 / 状态**
3. **场景与背景**（干净还是环境，远处有什么）
4. **构图**：特写 / 中景 / 全景，镜头（平视/俯视/35mm/85mm）
5. **光线与氛围**：黄金时刻、棚拍柔光、霓虹、阴天……
6. **风格**：摄影 / 扁平插画 / 3D / 国风水墨 / 赛博朋克……
7. **画质词（少而准）**：`highly detailed, sharp focus, professional`；不要堆 20 个 8k/masterpiece
8. **画面文字**：用户要图上出现的字，**原样写进 prompt**，并说明位置、字号气质（粗标题/手写/衬线），语言与要渲染的文字一致

语言策略：

- 默认：**详细中文主体描述 + 少量英文风格/镜头词**。gpt-image-2 中文理解强，图上要出中文时必须用中文 prompt。
- 用户原文已经是高质量英文，且画面不需要中文文字 → 可保持英文，只补构图和光线。
- 删掉空话（「高质量图片」「帮我画一张」），补上可画的细节。
- 不要在 prompt 里写 size、model、API Key。

优化示例：

```
用户：画一只赛博朋克的猫
最终 prompt：
一只短毛黑猫蹲在雨后的霓虹小巷台阶上，青色与品红霓虹灯映在湿润的沥青路面和猫眼里，
身穿微型未来感皮夹克，耳朵上有细小电子耳标。低机位中景，35mm，浅景深，
电影感，水汽和轻微镜头光晕，高度细节，写实摄影。
cyberpunk night alley, cinematic lighting, sharp focus
```

对用户展示时用三行（最终回复里也要有）：

- 原始需求：…
- 优化后 prompt：…
- 参数：模型 / size / 画质

### 第 3 步：调用 DoCode 生图接口

Base URL 以用户指定为准：**https://docode.cc**
OpenAI 兼容地址：`https://docode.cc/v1`
生图路径：`POST /v1/images/generations`

主端点：`https://docode.cc/v1/images/generations`
主端点失败（连不上、404、502）再试：`https://api.docode.cc/v1/images/generations`

鉴权：

```
Authorization: Bearer <用户的 Key>
Content-Type: application/json
```

请求体（按需增减字段，不要传空字段）：

```json
{
  "model": "gpt-image-2",
  "prompt": "<第 2 步优化后的完整 prompt>",
  "n": 1,
  "size": "1024x1024",
  "quality": "high"
}
```

模型名只允许：

- `gpt-image-2`（默认，1K/通用）
- `gpt-image-2-1k`
- `gpt-image-2-2k`
- `gpt-image-2-4k`

`n` 默认 1，上限 4。
超时：**180 秒**（2K/4K 经常要 30–60s，短超时会误判失败）。

用 `run_node` 发请求（Windows 下 curl 传中文 JSON 容易坏，不要用 cmd 拼 JSON）。Key 只出现在这次 `run_node` 的代码字符串里，不要 `console.log` 完整 Key。

DoCode 生图接口参考（来自 https://img.docode.cc/guide）：

- 生图 Key 用于 `https://api.docode.cc/v1/images/generations`（以及主站兼容地址 `https://docode.cc/v1/images/generations`）
- 可选模型：`gpt-image-2`（1K/2K/4K）、`gpt-image-2-1k`、`gpt-image-2-2k`、`gpt-image-2-4k`
- 1K 示例：`1024×1024`（1:1）、`1824×1024`（16:9）
- 2K 示例：`2048×2048`（1:1）、`2560×1440`（16:9）
- 4K 示例：`2880×2880`（1:1）、`3840×2160`（16:9）

### 第 4 步：把返回值存成图片

返回可能是：

- `data[0].b64_json` → Base64 解码写成 `.png`
- `data[0].url` → 再 GET 下载
- 个别网关包一层 `{ data: { data: [...] } }`，两种都要认
- 有的把图放在 `b64_json` / `b64` / `image` 字段

保存到**工作目录根目录**，相对文件名，例如 `neon-cat-alley.png`。
禁止 `image1.png`、`output.png` 这种空名字。
禁止再复制一份到别处。

存盘后必须 `list_files` 确认文件在、大小不是 0。

### 第 5 步：失败处理（同一处最多 3 次，然后换路）

| 情况 | 做法 |
|---|---|
| 401 / invalid_api_key | 告诉用户 Key 无效或复制不完整，请回 https://docode.cc 令牌管理重拷。不要重试同一把坏 Key 第三次 |
| 402 / insufficient_quota | 额度不足，让用户去 https://docode.cc 充值或换 Key |
| 400 / 模型不存在 | 把 `gpt-image-2-2k` 等后缀模型改回 `gpt-image-2`，size 改回 `1024x1024` 再试一次 |
| 主端点连不上 / 404 / 502 | 换 `https://api.docode.cc/v1/images/generations` |
| content_policy / safety | 改写 prompt 去掉敏感词，说明「内容策略拦截，已改写后重试」；仍失败就停，不要循环硬打 |
| 超时 | 降到 1K + `1024x1024` 再试一次 |
| 返回 JSON 但没有图 | 把错误字段（error.message）原文给用户看，中文解释 |

成功之前，禁止说「已生成」。

### 第 6 步：交付

最终回复用中文，结构：

```markdown
## 图片已生成

- **文件**：`文件名.png`（右侧文件面板可预览）
- **模型**：gpt-image-2
- **尺寸**：1024×1024
- **接口**：https://docode.cc/v1/images/generations

**原始需求**：…
**优化后 prompt**：…

不满意的话直接说要改哪（光线 / 构图 / 风格 / 文字），我改 prompt 再出一张。
```

## 代码模板（直接放进 run_node）

把 `USER_API_KEY`、`FINAL_PROMPT`、`OUT_FILE`、`MODEL`、`SIZE` 换成这一次的真实值。
**不要** `console.log(apiKey)`。

```javascript
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const apiKey = 'USER_API_KEY'; // 仅本次调用，禁止打印
const prompt = `FINAL_PROMPT`;
const outFile = 'OUT_FILE.png';
const model = 'gpt-image-2';
const size = '1024x1024';
const n = 1;
const quality = 'high';
const background = ''; // 需要透明时改成 'transparent'，否则保持空字符串

const endpoints = [
  'https://docode.cc/v1/images/generations',
  'https://api.docode.cc/v1/images/generations'
];

function request(urlStr, { method, headers, body, timeout }) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: method || 'GET',
      headers: headers || {},
      timeout: timeout || 180000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout ' + urlStr));
    });
    if (body) req.write(body);
    req.end();
  });
}

function pickImagePayload(json) {
  if (!json) return [];
  const d = json.data && json.data.data ? json.data.data : json.data;
  if (Array.isArray(d)) return d;
  if (d && (d.b64_json || d.b64 || d.url || d.image)) return [d];
  return [];
}

(async () => {
  const payload = {
    model,
    prompt,
    n,
    size,
    quality
  };
  if (background) payload.background = background;
  const body = JSON.stringify(payload);
  let lastErr = '';

  for (const url of endpoints) {
    try {
      const res = await request(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body,
        timeout: 180000
      });
      const text = res.buffer.toString('utf8');
      let json = null;
      try { json = JSON.parse(text); } catch (e) { json = null; }

      if (res.status < 200 || res.status >= 300) {
        const msg = (json && (json.error && (json.error.message || json.error) || json.message)) || text.slice(0, 500);
        lastErr = 'HTTP ' + res.status + ' @ ' + url + ' · ' + msg;
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          console.log(JSON.stringify({ ok: false, fatal: true, error: lastErr }));
          return;
        }
        continue;
      }

      const items = pickImagePayload(json);
      if (!items.length) {
        lastErr = '无图像数据 @ ' + url + ' · ' + text.slice(0, 400);
        continue;
      }

      const saved = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const name = items.length === 1 ? outFile : outFile.replace(/\.png$/i, '-' + (i + 1) + '.png');
        const b64 = item.b64_json || item.b64 || item.image;
        if (b64 && typeof b64 === 'string' && !/^https?:/i.test(b64)) {
          const raw = b64.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(name, Buffer.from(raw, 'base64'));
        } else if (item.url) {
          const img = await request(item.url, { method: 'GET', timeout: 120000 });
          if (img.status < 200 || img.status >= 300) throw new Error('下载失败 HTTP ' + img.status);
          fs.writeFileSync(name, img.buffer);
        } else {
          lastErr = '条目无法识别';
          continue;
        }
        const st = fs.statSync(name);
        saved.push({ file: name, bytes: st.size });
      }

      if (!saved.length) continue;
      console.log(JSON.stringify({
        ok: true,
        endpoint: url,
        model,
        size,
        files: saved
      }));
      return;
    } catch (e) {
      lastErr = String(e && e.message ? e.message : e);
    }
  }

  console.log(JSON.stringify({ ok: false, error: lastErr || 'unknown' }));
})();
```

`run_node` 的 `purpose` 写成「调用 DoCode gpt-image-2 生图」，不要把 prompt 全文或 Key 写进 purpose。

## 质量标准

- 未拿到 Key 就出图 → 不合格
- 用户原文没优化就 POST → 不合格
- 把 Key 写入记忆 / 文件 / 最终回复全文 → 不合格
- 声称已生成但工作目录没有对应 png / 文件为 0 字节 → 不合格（红线：不许虚构）
- 文件名无意义、一次超过 4 张、走了 `generate_image` → 不合格
- 最终回复没有「优化后 prompt」和文件名 → 不合格

## 触发口令（给 agent 判断）

以下情况**必须** use_skill `gpt-image-2`：

- /gpt-image-2
- gpt-image2 / gpt-image-2
- DoCode 生图 / docode.cc 出图
- 「用我的 docode key 画一张」
