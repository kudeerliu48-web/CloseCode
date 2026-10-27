---
name: today-weather
description: 查询今日天气信息，支持指定城市或自动定位
---

# 今日天气查询技能

## 功能说明
查询指定城市或自动定位的今日天气信息，包括温度、天气状况、风力、湿度、空气质量等关键指标。

## 使用场景
- 用户问"今天天气怎么样"
- 用户问"北京今天天气"
- 用户问"明天要不要带伞"
- 需要天气信息辅助决策（出行、穿衣等）

## 执行流程

### 1. 确定查询城市
- **有明确城市名**：直接使用（如"北京天气" → 北京）
- **没有指定城市**：尝试通过 IP 定位获取当前城市
- **定位失败**：询问用户城市，或默认使用北京

### 2. 获取天气数据
优先级顺序尝试以下数据源：

#### 方案A：天气 API（推荐）
```javascript
// 免费天气 API 示例
const apis = [
  'https://wttr.in/${city}?format=j1',  // wttr.in 支持中文城市
  'https://api.qweather.com/v7/weather/now',  // 和风天气
  'https://devapi.qweather.com/v7/weather/3d'  // 和风天气 3天预报
];
```

使用 `fetch_url` 调用：
1. 先尝试 wttr.in（无需 API key，支持中文）
2. 失败则搜索该城市的天气信息网页
3. 从网页中提取结构化数据

#### 方案B：搜索引擎 + 网页抓取
```javascript
// 1. 搜索 "${city}天气"
web_search({ query: `${city}天气 今日`, count: 3 })

// 2. 抓取权威源（优先级排序）
// - 中国天气网 weather.com.cn
// - 天气网 tianqi.com  
// - 百度天气
fetch_url(搜索结果中的权威链接)

// 3. 提取关键信息
// 温度范围、天气状况、风力、湿度、空气质量、穿衣建议
```

### 3. 结构化输出
将获取的数据整理成以下格式：

```markdown
## 📍 {城市} · 今日天气

**{日期} {星期}**

### 🌡️ 温度与天气
- **当前温度**：{实时温度}°C
- **温度范围**：{最低温}°C ~ {最高温}°C
- **天气状况**：{晴/多云/雨等} {emoji}
- **体感温度**：{体感温度}°C

### 💨 风力与湿度
- **风力风向**：{风向} {风力等级}
- **相对湿度**：{湿度}%
- **气压**：{气压} hPa（如有）

### 🏭 空气质量
- **AQI 指数**：{数值} ({优/良/轻度污染等})
- **首要污染物**：{PM2.5/PM10/O3等}（如有）

### 💡 生活建议
- **穿衣建议**：{根据温度给出}
- **出行提示**：{是否需要雨具、防晒等}
- **健康提示**：{空气质量相关建议}

---
*数据更新时间：{时间}*  
*数据来源：{来源链接}*
```

### 4. 特殊情况处理

**查询失败时**：
```markdown
未能获取 {城市} 的实时天气数据。

建议：
1. 手动访问 [中国天气网](http://www.weather.com.cn/) 查询
2. 或提供更具体的城市名称（如"北京市海淀区"）

已尝试的数据源：
- wttr.in: {失败原因}
- 搜索引擎: {失败原因}
```

**多个同名城市**：
```markdown
找到多个匹配的城市：
1. 北京市（直辖市）
2. 吉林省辽源市北京路

请明确选择：[用 ask_user 弹选项]
```

## 代码实现示例

### 方法1：使用 wttr.in API
```javascript
const city = '北京';
const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`;

fetch_url({ url: url }).then(data => {
  const current = data.current_condition[0];
  const today = data.weather[0];
  
  return {
    temperature: current.temp_C,
    feelsLike: current.FeelsLikeC,
    weather: current.lang_zh[0].value,
    humidity: current.humidity,
    windSpeed: current.windspeedKmph,
    windDir: current.winddirDegree,
    tempMin: today.mintempC,
    tempMax: today.maxtempC
  };
});
```

### 方法2：搜索 + 网页提取
```javascript
// 1. 搜索
const results = await web_search({ 
  query: `${city}天气 实时`, 
  count: 3 
});

// 2. 抓取第一个权威来源
const weatherPage = await fetch_url({ 
  url: results[0].url 
});

// 3. 从 HTML 中提取（用正则或关键词定位）
// 温度通常在 <span class="temp">25</span> 或类似结构
// 天气状况在 <div class="weather">晴</div>
```

## 注意事项

1. **时效性**：天气数据有时效性，显示更新时间
2. **容错性**：至少准备 2 个数据源，一个失败立即切换
3. **隐私**：自动定位时说明数据来源（IP 定位），不要传输用户隐私数据
4. **引用来源**：天气数据必须标注来源链接
5. **不编造数据**：查不到就如实说查不到，不能编造温度数值
6. **emoji 适配**：根据天气状况添加对应 emoji（☀️🌤️⛅☁️🌧️⛈️❄️等）

## 适配建议

### 天气状况 emoji 映射
```javascript
const weatherEmoji = {
  '晴': '☀️',
  '多云': '⛅',
  '阴': '☁️',
  '小雨': '🌦️',
  '中雨': '🌧️',
  '大雨': '⛈️',
  '雪': '❄️',
  '雾': '🌫️',
  '霾': '😷'
};
```

### 穿衣建议逻辑
```javascript
function getDressingAdvice(temp) {
  if (temp < 5) return '羽绒服、厚外套';
  if (temp < 15) return '夹克、薄毛衣';
  if (temp < 22) return '长袖衬衫、薄外套';
  if (temp < 28) return '短袖、长裤';
  return '短袖短裤、防晒';
}
```

### AQI 等级判断
```javascript
function getAQILevel(aqi) {
  if (aqi <= 50) return { level: '优', color: '🟢', advice: '空气质量令人满意，可正常户外活动' };
  if (aqi <= 100) return { level: '良', color: '🟡', advice: '空气质量可接受，敏感人群应减少户外活动' };
  if (aqi <= 150) return { level: '轻度污染', color: '🟠', advice: '儿童、老人及心脏病患者应减少户外活动' };
  if (aqi <= 200) return { level: '中度污染', color: '🔴', advice: '避免长时间户外活动' };
  if (aqi <= 300) return { level: '重度污染', color: '🟣', advice: '尽量避免户外活动，外出佩戴口罩' };
  return { level: '严重污染', color: '🟤', advice: '避免户外活动，关闭门窗' };
}
```

## 交付检查清单
- [ ] 成功获取到真实天气数据（不是示例数据）
- [ ] 温度、天气状况、风力至少有其中 3 项
- [ ] 标注了数据来源和更新时间
- [ ] 输出格式清晰，移动端可读
- [ ] 查询失败时给出了替代方案
- [ ] 没有编造任何数值

## 扩展功能（可选）
- 未来 3-7 天预报
- 小时级天气变化
- 日出日落时间
- 紫外线指数
- 生成天气信息图（SVG）
- 语音播报文案优化