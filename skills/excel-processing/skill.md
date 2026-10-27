---
name: excel-processing
description: Excel数据处理、CSV/JSON互转、自动生成图表和数据报表
builtin: true
---

# Excel处理技能

本技能提供Excel数据的读写、格式化、转换、图表生成等自动化操作。

## 核心功能

### 1. 创建Excel工作簿
使用 `exceljs` 库（项目已安装）：
```javascript
const ExcelJS = require('exceljs');
const fs = require('fs').promises;

async function createExcel(data, outputPath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('数据表');
  
  // 设置列
  sheet.columns = [
    { header: '姓名', key: 'name', width: 15 },
    { header: '年龄', key: 'age', width: 10 },
    { header: '部门', key: 'dept', width: 20 },
    { header: '薪资', key: 'salary', width: 12 },
  ];
  
  // 添加数据
  sheet.addRows(data);
  
  // 格式化表头
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  sheet.getRow(1).font = { color: { argb: 'FFFFFFFF' } };
  
  // 设置数字格式
  sheet.getColumn('salary').numFmt = '¥#,##0.00';
  
  await workbook.xlsx.writeFile(outputPath);
}

const employees = [
  { name: '张三', age: 28, dept: '研发部', salary: 15000 },
  { name: '李四', age: 32, dept: '市场部', salary: 12000 },
];

createExcel(employees, 'employees.xlsx');
```

### 2. 读取Excel数据
```javascript
async function readExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  const sheet = workbook.getWorksheet(1); // 第一个工作表
  const data = [];
  
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // 跳过表头
    
    data.push({
      name: row.getCell(1).value,
      age: row.getCell(2).value,
      dept: row.getCell(3).value,
      salary: row.getCell(4).value,
    });
  });
  
  return data;
}
```

### 3. Excel ↔ CSV
```javascript
// Excel → CSV
async function excelToCSV(excelPath, csvPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  const sheet = workbook.getWorksheet(1);
  
  await workbook.csv.writeFile(csvPath, { sheetId: sheet.id });
}

// CSV → Excel
async function csvToExcel(csvPath, excelPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.csv.readFile(csvPath);
  await workbook.xlsx.writeFile(excelPath);
}
```

### 4. Excel ↔ JSON
```javascript
// Excel → JSON
async function excelToJSON(excelPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  const sheet = workbook.getWorksheet(1);
  
  const headers = [];
  const data = [];
  
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell(cell => headers.push(cell.value));
    } else {
      const rowData = {};
      row.eachCell((cell, colNumber) => {
        rowData[headers[colNumber - 1]] = cell.value;
      });
      data.push(rowData);
    }
  });
  
  return data;
}

// JSON → Excel
async function jsonToExcel(jsonData, excelPath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  
  if (jsonData.length === 0) return;
  
  // 使用第一个对象的键作为表头
  const headers = Object.keys(jsonData[0]);
  sheet.addRow(headers);
  
  jsonData.forEach(item => {
    sheet.addRow(headers.map(h => item[h]));
  });
  
  await workbook.xlsx.writeFile(excelPath);
}
```

### 5. 生成图表
```javascript
async function createChartExcel(data, outputPath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('销售数据');
  
  // 添加数据
  sheet.addRow(['月份', '销售额']);
  data.forEach(item => sheet.addRow([item.month, item.sales]));
  
  // 注意：exceljs不直接支持图表，需要使用其他方案：
  // 1. 导出数据后用Python的openpyxl生成图表
  // 2. 使用officegen库（支持图表）
  // 3. 预制带图表的模板，只更新数据
  
  await workbook.xlsx.writeFile(outputPath);
}

// 推荐方案：使用Python脚本生成图表
// 通过run_shell调用：
// python3 generate_chart.py --data sales.json --output report.xlsx --chart-type bar
```

### 6. 数据透视和统计
```javascript
async function createPivotReport(data, outputPath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('汇总报表');
  
  // 按部门汇总薪资
  const summary = data.reduce((acc, emp) => {
    if (!acc[emp.dept]) {
      acc[emp.dept] = { count: 0, total: 0 };
    }
    acc[emp.dept].count++;
    acc[emp.dept].total += emp.salary;
    return acc;
  }, {});
  
  // 输出汇总表
  sheet.columns = [
    { header: '部门', key: 'dept', width: 20 },
    { header: '人数', key: 'count', width: 10 },
    { header: '总薪资', key: 'total', width: 15 },
    { header: '平均薪资', key: 'avg', width: 15 },
  ];
  
  Object.entries(summary).forEach(([dept, stats]) => {
    sheet.addRow({
      dept,
      count: stats.count,
      total: stats.total,
      avg: stats.total / stats.count,
    });
  });
  
  // 添加公式
  const lastRow = sheet.rowCount + 1;
  sheet.getCell(`B${lastRow}`).value = { formula: `SUM(B2:B${lastRow-1})` };
  sheet.getCell(`C${lastRow}`).value = { formula: `SUM(C2:C${lastRow-1})` };
  
  await workbook.xlsx.writeFile(outputPath);
}
```

### 7. 样式和格式化
```javascript
async function formatExcel(workbook, sheet) {
  // 冻结首行
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  
  // 自动筛选
  sheet.autoFilter = 'A1:D1';
  
  // 条件格式（需要手动实现逻辑）
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    
    const salaryCell = row.getCell(4);
    const value = salaryCell.value;
    
    if (value > 15000) {
      salaryCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF90EE90' } // 绿色
      };
    } else if (value < 10000) {
      salaryCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF6B6B' } // 红色
      };
    }
  });
  
  // 边框
  sheet.eachRow(row => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
  });
}
```

## 高级功能

### 多工作表操作
```javascript
const workbook = new ExcelJS.Workbook();
const sheet1 = workbook.addWorksheet('原始数据');
const sheet2 = workbook.addWorksheet('统计分析');
const sheet3 = workbook.addWorksheet('图表');

// 工作表引用公式
sheet2.getCell('B2').value = { formula: '原始数据!A1' };
```

### 数据验证
```javascript
// 下拉列表
sheet.getColumn('dept').eachCell((cell, rowNumber) => {
  if (rowNumber === 1) return;
  cell.dataValidation = {
    type: 'list',
    allowBlank: false,
    formulae: ['"研发部,市场部,行政部"']
  };
});

// 数字范围
sheet.getColumn('age').eachCell((cell, rowNumber) => {
  if (rowNumber === 1) return;
  cell.dataValidation = {
    type: 'whole',
    operator: 'between',
    formulae: [18, 65],
    showErrorMessage: true,
    errorTitle: '输入错误',
    error: '年龄必须在18-65之间'
  };
});
```

## 性能优化

```javascript
// 流式写入大文件
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
  filename: 'large.xlsx'
});

const sheet = workbook.addWorksheet('Data');
sheet.columns = [ /* ... */ ];

for (let i = 0; i < 1000000; i++) {
  sheet.addRow([i, `Item ${i}`, Math.random() * 1000]).commit();
}

await workbook.commit();
```

## 使用场景

1. **数据导入导出**：数据库 ↔ Excel ↔ JSON/CSV
2. **报表生成**：定期生成销售、财务、统计报表
3. **数据清洗**：读取Excel，处理后写入新文件
4. **批量数据处理**：批量更新价格、计算统计指标

## 依赖安装

```bash
# 项目已安装
npm install exceljs

# 图表生成（可选）
npm install officegen  # 支持生成带图表的Excel
```

## 注意事项

- Excel文件格式：`.xlsx`（推荐）比 `.xls` 更现代，支持更大数据量
- 大文件处理：超过10万行使用流式API
- 公式计算：exceljs只写入公式，不计算结果（Excel打开时自动计算）
- 图表：exceljs不支持图表，推荐用Python的openpyxl或预制模板

## 输出规范

- 工作表命名清晰（如"原始数据"、"月度汇总"）
- 表头使用加粗、背景色区分
- 数字格式化（货币、百分比、日期）
- 包含数据源和生成时间说明
- 完成后报告行数、列数、工作表数量
