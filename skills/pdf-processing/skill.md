---
name: pdf-processing
description: PDF文本提取、页面合并、拆分处理，支持批量操作
builtin: true
---

# PDF处理技能

本技能提供PDF文件的文本提取、合并、拆分等基础操作。

## 核心功能

### 1. PDF文本提取
使用 `run_shell` 调用 `pdftotext` 命令行工具：
```bash
pdftotext -layout input.pdf output.txt
```
- `-layout` 参数保持原始排版
- `-raw` 参数提取纯文本（不保持排版）
- `-f N -l M` 提取第N到第M页

### 2. PDF页面拆分
使用 `run_node` 调用 `pdf-lib` 库：
```javascript
const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;

async function splitPDF(inputPath, outputDir, ranges) {
  const pdfBytes = await fs.readFile(inputPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  for (const range of ranges) {
    const newPdf = await PDFDocument.create();
    const pages = await newPdf.copyPages(pdfDoc, range);
    pages.forEach(page => newPdf.addPage(page));
    
    const bytes = await newPdf.save();
    await fs.writeFile(`${outputDir}/split_${range.join('-')}.pdf`, bytes);
  }
}

// 示例：拆分第1-5页和第6-10页
splitPDF('input.pdf', './output', [[0,1,2,3,4], [5,6,7,8,9]]);
```

### 3. PDF页面合并
```javascript
const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;

async function mergePDFs(inputPaths, outputPath) {
  const mergedPdf = await PDFDocument.create();
  
  for (const path of inputPaths) {
    const pdfBytes = await fs.readFile(path);
    const pdf = await PDFDocument.load(pdfBytes);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach(page => mergedPdf.addPage(page));
  }
  
  const mergedBytes = await mergedPdf.save();
  await fs.writeFile(outputPath, mergedBytes);
}

mergePDFs(['file1.pdf', 'file2.pdf'], 'merged.pdf');
```

## 使用场景

1. **提取PDF内容**：将PDF转为文本进行分析、翻译、总结
2. **合并多个PDF**：将多份报告、发票合并为一个文件
3. **拆分大PDF**：按章节、页数范围拆分大文档
4. **提取特定页**：从PDF中提取需要的页面

## 注意事项

- `pdftotext` 需要系统安装 poppler-utils（Linux/Mac）或 Xpdf（Windows）
- `pdf-lib` 需要通过 `npm install pdf-lib` 安装（项目已包含）
- 对于扫描版PDF（图片），文本提取可能无效，需要OCR工具
- 处理大文件时注意内存占用

## 输出规范

- 提取的文本保存为 `.txt` 文件，UTF-8编码
- 拆分/合并后的PDF使用描述性文件名（如 `merged_report.pdf`, `chapter_1-5.pdf`）
- 操作完成后报告处理的页数、文件大小
