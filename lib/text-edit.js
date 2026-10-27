"use strict";
// Never use fuzzy/semantic matching to write source code. Only unique exact or
// formatting-equivalent blocks are eligible; all offsets refer to ORIGINAL bytes.
function linesOf(text) {
  const lines = []; let offset = 0;
  for (const part of text.split(/(?<=\n)/)) {
    const eol = part.endsWith("\r\n") ? "\r\n" : part.endsWith("\n") ? "\n" : "";
    lines.push({ text: eol ? part.slice(0, -eol.length) : part, start: offset, end: offset + part.length, eol }); offset += part.length;
  }
  return lines;
}
function occurrences(source, needle) {
  const hits = []; let at = 0;
  while ((at = source.indexOf(needle, at)) !== -1) { hits.push({ start: at, end: at + needle.length }); at += 1; }
  return hits;
}
function normalized(text) {
  const lines = linesOf(text); let norm = "";
  for (const l of lines) { l.normalStart = norm.length; norm += l.text + (l.eol ? "\n" : ""); }
  return { text: norm, original: position => {
    if (position === norm.length) return text.length;
    let lo = 0, hi = lines.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (lines[mid].normalStart <= position) lo = mid; else hi = mid - 1; }
    return lines[lo].start + position - lines[lo].normalStart;
  } };
}
const indent = s => /^[\t ]*/.exec(s)[0];
const width = s => { let n = 0; for (const c of s) n += c === "\t" ? 4 - n % 4 : 1; return n; };
const content = s => s.replace(/^[\t ]+|[\t ]+$/g, "");
// Markdown table padding is presentation, but whitespace inside a cell (including
// inline code) is content. Recognize only complete, explicit pipe-delimited rows.
function tableCells(text) {
  const row = content(text);
  if (!row.startsWith("|") || !row.endsWith("|")) return null;
  const cells = []; let cell = "", code = 0, lastSeparator = -1;
  for (let i = 1; i < row.length; i++) {
    const ch = row[i];
    if (ch === "\\" && !code && i + 1 < row.length) { cell += ch + row[++i]; continue; }
    if (ch === String.fromCharCode(96)) {
      let end = i + 1; while (row[end] === ch) end++;
      const size = end - i;
      if (!code) code = size; else if (code === size) code = 0;
      cell += row.slice(i, end); i = end - 1; continue;
    }
    if (ch === "|" && !code) { cells.push(content(cell)); cell = ""; lastSeparator = i; }
    else cell += ch;
  }
  return !code && lastSeparator === row.length - 1 && cells.length >= 2 ? cells : null;
}
function markdownTableRows(lines) {
  const rows = new Map(), candidates = []; let fence = null, html = null;
  for (const line of lines) {
    const text = line.text;
    if (html) { if (new RegExp("</" + html + "\\s*>", "i").test(text)) html = null; candidates.push(null); continue; }
    if (fence) {
      const close = /^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      candidates.push(null); continue;
    }
    const open = /^[ ]{0,3}(`{3,}|~{3,})/.exec(text);
    if (open) { fence = open[1]; candidates.push(null); continue; }
    const tag = /<(pre|script|style|textarea)(?:\s|>)/i.exec(text);
    if (tag) { if (!new RegExp("</" + tag[1] + "\\s*>", "i").test(text)) html = tag[1]; candidates.push(null); continue; }
    // Four-space/tab indentation denotes code, not a top-level Markdown table.
    candidates.push(width(indent(text)) >= 4 ? null : tableCells(text));
  }
  for (let i = 1; i < candidates.length; i++) {
    const header = candidates[i - 1], divider = candidates[i];
    if (!header || !divider || header.length !== divider.length || !divider.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
    rows.set(i - 1, header); rows.set(i, divider);
    for (let j = i + 1; j < candidates.length && candidates[j]?.length === header.length; j++) rows.set(j, candidates[j]);
  }
  return rows;
}
function formattingMatches(source, needle, markdown = false) {
  const file = linesOf(source), old = linesOf(needle), result = [];
  const tables = markdown ? markdownTableRows(file) : null;
  const trailingNewline = /\n$/.test(needle);
  if (trailingNewline && old.at(-1).text === "" && !old.at(-1).eol) old.pop();
  // Do not use indentation fallback for substrings/isolated tokens.
  if ((!markdown && old.length < 2) || old.every(l => !content(l.text))) return result;
  for (let i = 0; i + old.length <= file.length; i++) {
    let shift = null, good = true, tableMatched = false;
    for (let j = 0; j < old.length; j++) {
      if (content(old[j].text) !== content(file[i + j].text)) {
        const actualCells = tables?.get(i + j), wantedCells = actualCells && tableCells(old[j].text);
        if (!wantedCells || JSON.stringify(actualCells) !== JSON.stringify(wantedCells)) { good = false; break; }
        tableMatched = true;
      }
      if (!content(old[j].text)) continue;
      const delta = width(indent(file[i + j].text)) - width(indent(old[j].text));
      if (shift === null) shift = delta;
      else if (shift !== delta) { good = false; break; } // relative nesting MUST agree
    }
    const last = file[i + old.length - 1];
    if (good && (!markdown || tableMatched) && (!trailingNewline || last.eol)) result.push({ start: file[i].start, end: trailingNewline ? last.end : last.start + last.text.length, shift: shift || 0, baseIndent: indent(file[i].text) });
  }
  return result;
}
function diagnostic(source, needle) {
  const lines = linesOf(source), wanted = needle.replace(/\r\n/g, "\n").split("\n");
  const first = wanted.find(l => content(l));
  const i = first ? lines.findIndex(l => content(l.text).includes(content(first).slice(0, 60))) : -1;
  if (i < 0) return "没有找到可靠的上下文，请先 read_file 读取当前文件；未修改任何内容。";
  const count = Math.min(wanted.length, 14), actual = lines.slice(i, i + count).map(l => l.text);
  const excerpt = actual.map((l, j) => "第 " + (i + j + 1) + " 行: " + l).join("\n").slice(0, 3500);
  const mismatch = actual.findIndex((l, j) => content(l) !== content(wanted[j] || ""));
  const detail = mismatch < 0 ? "可能是相对缩进不同，不能安全推断。" : "首个内容差异在第 " + (i + mismatch + 1) + " 行（标点、引号和代码内容不会被自动忽略）。";
  return detail + "\n当前真实内容：\n" + excerpt + "\n请按此片段或 read_file 的 start_line=" + (i + 1) + ", end_line=" + (i + wanted.length) + " 重试；未修改任何内容。";
}
function planTextEdit(source, { old_text, new_text, replace_all = false } = {}, label = "文件") {
  if (typeof old_text !== "string" || !old_text) throw Error("old_text 必须是非空字符串；请先读取要修改的原文。");
  if (typeof new_text !== "string") throw Error("new_text 必须显式传入字符串；需要删除时传空字符串，不会将遗漏参数当成删除。");
  if (typeof replace_all !== "boolean") throw Error("replace_all 必须是布尔值。");
  let hits = occurrences(source, old_text), strategy = "exact";
  if (!hits.length) {
    const s = normalized(source), n = old_text.replace(/\r\n/g, "\n");
    hits = occurrences(s.text, n).map(h => ({ start: s.original(h.start), end: s.original(h.end) })); strategy = "newline";
  }
  if (!hits.length) { hits = formattingMatches(source, old_text); strategy = "indent"; }
  if (!hits.length && /\.(?:md|markdown|mdown)$/i.test(label)) { hits = formattingMatches(source, old_text, true); strategy = "markdown-table"; }
  if (!hits.length) throw Error("没找到可安全替换的 old_text（已兼容 CRLF/LF、整段等量缩进、行尾空格及 Markdown 表格单元格边缘空白）。\n" + diagnostic(source, old_text));
  if (hits.length > 1 && !replace_all) throw Error("old_text 在 " + label + " 里出现了 " + hits.length + " 次，不唯一，不敢猜改哪一处。多带几行上下文；确实全改才传 replace_all=true。");
  for (let i = 1; i < hits.length; i++) if (hits[i].start < hits[i - 1].end) throw Error("匹配片段互相重叠，请增加上下文，未修改文件。");
  let output = source;
  for (const h of [...hits].reverse()) {
    const fragment = source.slice(h.start, h.end);
    const eol = fragment.match(/\r?\n/)?.[0] || source.match(/\r?\n/)?.[0] || "\n";
    let replacement = new_text.replace(/\r\n/g, "\n");
    if (["indent", "markdown-table"].includes(strategy) && h.shift) replacement = replacement.split("\n").map(line => {
      if (!line.trim()) return line;
      const prefix = indent(line), target = width(prefix) + h.shift;
      if (target < 0) throw Error("新文本缩进无法安全对齐，请按文件原始缩进重试；未修改文件。");
      const adjusted = h.baseIndent.includes("\t") && target % 4 === 0 ? "\t".repeat(target / 4) : " ".repeat(target);
      return adjusted + line.slice(prefix.length);
    }).join("\n");
    replacement = replacement.replace(/\n/g, eol);
    output = output.slice(0, h.start) + replacement + output.slice(h.end);
  }
  return { output, hits: hits.length, line: source.slice(0, hits[0].start).split("\n").length, strategy };
}
module.exports = { planTextEdit };
