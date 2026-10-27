---
name: word-processing
description: Word文档模板填充、格式排版、Markdown互转，自动化文档生成
builtin: true
---

# Word文档处理技能

本技能提供Word文档的模板填充、格式处理、Markdown互转等自动化操作。

## 核心功能

### 1. Word模板填充
使用 `docx` 库填充占位符：
```javascript
const fs = require('fs').promises;
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } = require('docx');

async function fillTemplate(templatePath, data, outputPath) {
  // 简单变量替换（推荐使用docxtemplater库）
  const PizZip = require('pizzip');
  const Docxtemplater = require('docxtemplater');
  
  const content = await fs.readFile(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });
  
  // 填充数据：{name: '张三', date: '2024-01-01', items: [{...}]}
  doc.render(data);
  
  const buf = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  });
  
  await fs.writeFile(outputPath, buf);
}

// 示例：合同模板
const contractData = {
  partyA: '北京科技有限公司',
  partyB: '上海贸易公司',
  amount: '100,000',
  date: '2024年1月1日',
  items: [
    { name: '服务费', price: '50,000' },
    { name: '咨询费', price: '50,000' }
  ]
};

fillTemplate('contract_template.docx', contractData, 'contract_final.docx');
```

### 2. 创建格式化Word文档
```javascript
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } = require('docx');
const fs = require('fs').promises;

async function createFormattedDoc(content, outputPath) {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // 标题
        new Paragraph({
          text: content.title,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
        }),
        
        // 正文段落
        ...content.paragraphs.map(p => new Paragraph({
          children: [new TextRun({
            text: p,
            font: '宋体',
            size: 24, // 12pt = 24 half-points
          })],
          spacing: { before: 200, after: 200 },
        })),
        
        // 表格
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: content.table.map(row => new TableRow({
            children: row.map(cell => new TableCell({
              children: [new Paragraph(cell)],
            })),
          })),
        }),
      ],
    }],
  });
  
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputPath, buffer);
}
```

### 3. Markdown → Word
```javascript
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const fs = require('fs').promises;

async function markdownToWord(mdPath, docxPath) {
  const md = await fs.readFile(mdPath, 'utf-8');
  const lines = md.split('\n');
  
  const children = [];
  
  for (const line of lines) {
    if (line.startsWith('# ')) {
      children.push(new Paragraph({
        text: line.slice(2),
        heading: HeadingLevel.HEADING_1,
      }));
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({
        text: line.slice(3),
        heading: HeadingLevel.HEADING_2,
      }));
    } else if (line.startsWith('### ')) {
      children.push(new Paragraph({
        text: line.slice(4),
        heading: HeadingLevel.HEADING_3,
      }));
    } else if (line.trim()) {
      // 处理粗体、斜体等（简化版）
      const runs = [];
      const boldRegex = /\*\*(.*?)\*\*/g;
      let lastIndex = 0;
      let match;
      
      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          runs.push(new TextRun(line.slice(lastIndex, match.index)));
        }
        runs.push(new TextRun({ text: match[1], bold: true }));
        lastIndex = match.index + match[0].length;
      }
      
      if (lastIndex < line.length) {
        runs.push(new TextRun(line.slice(lastIndex)));
      }
      
      children.push(new Paragraph({ children: runs }));
    }
  }
  
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(docxPath, buffer);
}
```

### 4. Word → Markdown
```bash
# 使用pandoc工具
pandoc document.docx -o output.md

# 或mammoth库（Node.js）
const mammoth = require('mammoth');
const result = await mammoth.convertToMarkdown({ path: 'document.docx' });
console.log(result.value); // Markdown文本
```

## 模板语法（docxtemplater）

在Word模板中使用占位符：

```
合同编号：{contractNo}
甲方：{partyA}
乙方：{partyB}

{#items}
- {name}: ¥{price}
{/items}

总计：¥{total}
```

## 格式规范

**字体设置**：
- 中文：宋体/黑体
- 英文：Times New Roman / Arial
- 代码：Consolas / Courier New

**段落间距**：
- 标题前：400（0.5行）
- 标题后：200（0.25行）
- 正文前后：200

**页边距**（常用值）：
- A4纸张：上下2.54cm，左右3.18cm
- 设置：`{ top: 1440, right: 1800, bottom: 1440, left: 1800 }` // 1440 = 1 inch

## 依赖安装

```bash
# 核心库（项目已安装）
npm install docx

# 模板填充（需要安装）
npm install docxtemplater pizzip

# Markdown转换
npm install mammoth    # Word → Markdown
npm install turndown   # HTML → Markdown（配合docx使用）

# 系统工具
# pandoc（推荐用于复杂文档转换）
brew install pandoc  # macOS
```

## 使用场景

1. **批量生成合同**：从Excel数据表读取，填充合同模板
2. **报告自动化**：将数据分析结果生成格式化Word报告
3. **文档转换**：Markdown笔记转Word文档，方便打印
4. **模板管理**：维护标准化的公司文档模板

## 注意事项

- `docxtemplater` 不支持复杂格式（如嵌套表格），保持模板简单
- 图片插入需要使用 `docx.ImageRun`，支持PNG/JPG
- 处理大文档时注意内存占用，考虑流式处理
- Word → Markdown 转换会丢失部分格式（如页眉页脚、批注）

## 输出规范

- 生成的文档使用描述性文件名（如 `合同_张三_20240101.docx`）
- 包含元数据（作者、创建时间、标题）
- 统一字体和段落格式
- 完成后报告文档页数、字数
