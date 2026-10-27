---
name: docode-pricing
description: 查询DoCode平台的AI模型价格倍率和详细定价信息
builtin: true
---

# DoCode模型定价查询技能

本技能用于查询DoCode平台（https://docode.cc）的AI模型价格倍率和详细定价信息。

## 核心功能

### 1. 查询价格倍率表
使用 `fetch_url` 工具获取定价页面：
```
使用 fetch_url 工具获取 https://docode.cc/pricing-list 页面内容
```

该页面包含各AI模型的价格倍率信息，包括：
- 模型名称（如 Claude Opus 5、GPT-4、Gemini等）
- 倍率系数
- 输入/输出价格
- 特殊说明

### 2. 价格计算
根据倍率和官方定价计算DoCode平台实际费用：
```
DoCode价格 = 官方价格 × 倍率
```

### 3. 模型对比
对比不同模型的性价比：
```
性价比 = 模型能力评分 / 单位价格
```

## 使用方法

**查询所有模型价格**：
```
请查询DoCode平台所有模型的价格倍率
```

**查询特定模型**：
```
Claude Opus 5 在DoCode平台的价格是多少？
GPT-4o 和 Claude Sonnet 4.5 哪个更便宜？
```

**价格对比分析**：
```
对比以下模型的价格：Claude Opus 5, GPT-4o, Gemini 2.5 Pro
哪些模型适合大量文本处理（性价比高）？
```

**计算使用成本**：
```
如果我每天处理100万tokens，用Claude Sonnet 4.5一个月要多少钱？
```

## 查询流程

1. **获取定价页面**
   ```
   使用 fetch_url 工具访问 https://docode.cc/pricing-list
   提取页面中的模型列表和倍率信息
   ```

2. **解析定价数据**
   - 提取模型名称
   - 提取倍率系数
   - 提取输入/输出价格（如果页面包含）
   - 提取备注说明

3. **格式化输出**
   以表格形式展示：
   ```
   | 模型名称 | 倍率 | 输入价格 | 输出价格 | 说明 |
   |---------|------|---------|---------|------|
   | Claude Opus 5 | 1.0x | $X/M tokens | $Y/M tokens | 旗舰模型 |
   | Claude Sonnet 4.5 | 0.8x | ... | ... | 性价比推荐 |
   ```

4. **提供建议**
   - 高性能任务推荐（代码生成、复杂推理）
   - 高并发任务推荐（批量处理、API服务）
   - 预算有限推荐（日常对话、内容审核）

## 输出格式

### 标准查询响应
```
DoCode平台模型定价（更新时间：YYYY-MM-DD）

【主流模型价格】
- Claude Opus 5: 倍率 1.0x
  输入: $X/M tokens | 输出: $Y/M tokens
  
- GPT-4o: 倍率 0.9x
  输入: $X/M tokens | 输出: $Y/M tokens

【性价比推荐】
1. 日常对话: Claude Haiku 4.5 (倍率最低)
2. 代码生成: Claude Sonnet 4.5 (性能/价格平衡)
3. 复杂推理: Claude Opus 5 (最强能力)

【注意事项】
- 价格为预估值，实际计费以平台为准
- 部分模型有最低消费或限流
- 价格可能随官方调整而变化
```

### 对比分析响应
```
【模型对比】Claude Opus 5 vs GPT-4o

性能对比：
- 代码能力: Claude Opus 5 ★★★★★ | GPT-4o ★★★★☆
- 推理能力: Claude Opus 5 ★★★★★ | GPT-4o ★★★★★
- 多语言: Claude Opus 5 ★★★★★ | GPT-4o ★★★★☆

价格对比：
- Claude Opus 5: $X/M (输入) $Y/M (输出) | 倍率 1.0x
- GPT-4o: $A/M (输入) $B/M (输出) | 倍率 0.9x

成本估算（按100万tokens/天）：
- Claude Opus 5: 约 $XX/月
- GPT-4o: 约 $YY/月
- 节省: $ZZ/月 (选择GPT-4o)

建议：
如果注重代码质量和多语言处理 → Claude Opus 5
如果注重成本且性能够用 → GPT-4o
```

## 数据来源

- **官方定价页**: https://docode.cc/pricing-list
- **更新频率**: 实时获取（每次查询时重新抓取）
- **数据准确性**: 以DoCode官网为准，本技能仅做信息聚合

## 注意事项

1. **价格时效性**：AI模型价格经常调整，查询时注明获取时间
2. **倍率解释**：倍率是基于官方定价的系数，如倍率1.0x表示与官方价格一致
3. **隐藏费用**：注意是否有最低消费、流量费、并发限制等
4. **汇率影响**：如果用户需要人民币报价，按当前汇率换算并说明
5. **网络访问**：如果fetch_url失败，提示用户检查网络或稍后重试

## 扩展功能

### 定价通知
```javascript
// 监控价格变化（需配合定时任务）
const lastPrice = await readFile('last_price.json');
const currentPrice = await fetchPricing();

if (JSON.stringify(lastPrice) !== JSON.stringify(currentPrice)) {
  console.log('⚠️ DoCode价格已更新！');
  // 发送通知或记录日志
}
```

### 成本计算器
```javascript
function calculateCost(model, inputTokens, outputTokens) {
  const pricing = {
    'claude-opus-5': { input: 15, output: 75, multiplier: 1.0 },
    'gpt-4o': { input: 5, output: 15, multiplier: 0.9 },
    // ...
  };
  
  const p = pricing[model];
  const inputCost = (inputTokens / 1_000_000) * p.input * p.multiplier;
  const outputCost = (outputTokens / 1_000_000) * p.output * p.multiplier;
  
  return { inputCost, outputCost, total: inputCost + outputCost };
}

// 示例：100万输入 + 50万输出 tokens
const cost = calculateCost('claude-opus-5', 1_000_000, 500_000);
console.log(`总成本: $${cost.total.toFixed(2)}`);
```

## 使用场景

1. **项目预算**：评估AI功能开发成本
2. **模型选型**：根据预算和性能要求选择合适模型
3. **成本优化**：对比不同模型的费用，优化API调用策略
4. **价格监控**：定期检查价格变化，及时调整预算

## 常见问题

**Q: 倍率是什么意思？**  
A: 倍率是DoCode平台相对于官方定价的系数。如官方价格$10/M，倍率1.2x，则DoCode价格为$12/M。

**Q: 为什么有些模型没有显示价格？**  
A: 可能是该模型暂未开放、需要企业账号，或页面数据尚未更新。

**Q: 价格包含税费吗？**  
A: 通常不含税，具体以DoCode平台结算页面为准。

**Q: 如何获取最新价格？**  
A: 直接询问"查询DoCode最新价格"，系统会实时抓取官网数据。

---

**技能维护**: 如DoCode官网改版导致抓取失败，需更新fetch_url的解析逻辑或提供备用API接口。
