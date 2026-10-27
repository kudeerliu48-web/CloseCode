---
name: pdf-convert
description: PDF与Word、Excel互转，支持格式保留和批量转换
builtin: true
---

# PDF格式转换技能

本技能提供PDF与Office文档（Word、Excel）之间的双向转换。

## 核心功能

### 1. Word → PDF
使用 `run_shell` 调用 LibreOffice 无头模式：
```bash
# Linux/Mac
libreoffice --headless --convert-to pdf document.docx --outdir ./output

# Windows（需要安装LibreOffice）
"C:\Program Files\LibreOffice\program\soffice.exe" --headless --convert-to pdf document.docx --outdir output
```

或使用在线API方案（通过 `fetch_url` 调用转换服务）。

### 2. PDF → Word
方案A：使用LibreOffice反向转换（质量有限）
```bash
libreoffice --headless --convert-to docx document.pdf --outdir ./output
```

方案B：使用 `pdf-lib` + `docx` 手动重建文档
```javascript
const { PDFDocument } = require('pdf-lib');
const { Document, Paragraph, TextRun } = require('docx');
const fs = require('fs').promises;

async function pdfToWord(pdfPath, docxPath) {
  // 1. 先用pdftotext提取文本
  const { execSync } = require('child_process');
  const text = execSync(`pdftotext -layout "${pdfPath}" -`).toString();
  
  // 2. 构建Word文档
  const doc = new Document({
    sections: [{
      children: text.split('\n').map(line => 
        new Paragraph({ children: [new TextRun(line)] })
      )
    }]
  });
  
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(docxPath, buffer);
}
```

### 3. Excel → PDF
```bash
libreoffice --headless --convert-to pdf spreadsheet.xlsx --outdir ./output
```

### 4. PDF → Excel（仅限表格型PDF）
使用 `tabula-java` 或 Python `tabula-py` 提取表格：
```bash
# 需要Java环境
java -jar tabula-java.jar -o output.csv input.pdf
```

或通过 `run_node` 调用在线表格识别API。

## 批量转换

```javascript
const fs = require('fs').promises;
const { execSync } = require('child_process');
const path = require('path');

async function batchConvertToPDF(inputDir, outputDir) {
  const files = await fs.readdir(inputDir);
  const officeFiles = files.filter(f => 
    /\.(docx?|xlsx?|pptx?)$/i.test(f)
  );
  
  for (const file of officeFiles) {
    const inputPath = path.join(inputDir, file);
    const cmd = `libreoffice --headless --convert-to pdf "${inputPath}" --outdir "${outputDir}"`;
    
    try {
      execSync(cmd, { timeout: 30000 });
      console.log(`✓ ${file} → PDF`);
    } catch (err) {
      console.error(`✗ ${file} 转换失败: ${err.message}`);
    }
  }
}
```

## 转换质量说明

| 转换方向 | 质量 | 说明 |
|---------|------|------|
| Word → PDF | ★★★★★ | 排版保留良好 |
| Excel → PDF | ★★★★☆ | 表格、图表保留 |
| PDF → Word | ★★☆☆☆ | 纯文本可用，复杂排版会丢失 |
| PDF → Excel | ★★☆☆☆ | 仅适合规则表格，需要人工校验 |

## 依赖安装

**LibreOffice**（推荐方案）：
- Ubuntu: `sudo apt install libreoffice`
- macOS: `brew install --cask libreoffice`
- Windows: 下载安装包 https://www.libreoffice.org/

**Poppler**（pdftotext工具）：
- Ubuntu: `sudo apt install poppler-utils`
- macOS: `brew install poppler`
- Windows: 下载 Xpdf tools

## 使用建议

1. **Word → PDF**：首选LibreOffice，排版最稳定
2. **PDF → Word**：仅用于提取文本内容，不要期望完美还原排版
3. **复杂表格PDF → Excel**：建议人工复制粘贴，自动转换准确率低
4. **批量转换**：设置超时时间，大文件可能需要较长处理时间

## 输出规范

- 转换后的文件保持原文件名，仅替换扩展名
- 转换失败时保留原文件，并记录错误日志
- 批量转换完成后生成转换报告（成功N个，失败M个）
