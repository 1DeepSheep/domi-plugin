#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROFILE = "structured-notes";
const MAIN_HEADINGS = new Set([
  "团队背景", "团队", "产品与技术", "商业化", "商业化与增长", "商业进展", "市场与行业", "市场与竞争", "融资情况", "融资", "其他"
]);
const INTERNAL_DELIVERY_HEADINGS = new Set([
  "来源与记录边界", "来源及记录边界", "信息来源与记录边界", "来源与整理边界", "来源与记录范围",
  "来源与核验说明", "来源与核验边界", "纪要来源与边界", "记录边界说明", "纪要整理说明",
  "整理与核验说明", "核验与整理说明", "ASR纠错说明", "核心修正项",
  "来源与证据边界", "数字审计与冲突清单", "数字核验与冲突清单"
]);
const OPENING_METADATA = /^(?:会议日期|会议时间|录音日期|访谈日期|交流日期|会议性质|会议类型|会议形式|交流性质|访谈性质|时间|主题|会议主题)[ \t]*[：:]/;
const BROAD_DATA_CATEGORY = String.raw`(?:经营|技术|客户|融资|财务|收入|成本|销量|留存)`;
const BROAD_DATA_SCOPE = new RegExp(String.raw`((?:${BROAD_DATA_CATEGORY}[ \t、，,及与和]*){3,})(?:等)?(?:数据|信息|数字|内容)[ \t]*(?:均|全部)`);
const SOURCE_TIME = String.raw`\d{1,3}:[0-5]\d(?::[0-5]\d)?`;
const SOURCE_TIME_LOCATOR = new RegExp(String.raw`[（(【](?:原文(?:逐字稿|转写稿)?|逐字稿|转写稿|原始转写)(?:定位|时间戳|时间|片段|位置)?[ \t：:]*${SOURCE_TIME}(?:[ \t]*(?:[-–—~～]|至)[ \t]*${SOURCE_TIME})?[ \t]*[）)】]|[（(【]录音(?:定位|时间戳|片段|位置)[ \t：:]*${SOURCE_TIME}(?:[ \t]*(?:[-–—~～]|至)[ \t]*${SOURCE_TIME})?[ \t]*[）)】]`, "g");

// This is a conservative exclusion scanner, not a Markdown renderer. Preserve
// offsets while masking code, quotations and links so an editorial lint cannot
// mistake a quoted fact, URL or a syntax example for the author's own prose.
function deliveryVisibleText(text) {
  const output = text.split("");
  const mask = (start, end) => { for (let i = start; i < end; i++) if (!/[\r\n]/.test(text[i])) output[i] = " "; };
  const balancedEnd = (start, open, close) => {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "\\") { i++; continue; }
      if (text[i] === open) depth++;
      if (text[i] === close && --depth === 0) return i + 1;
    }
    return -1;
  };
  for (let i = 0; i < text.length;) {
    let end = -1;
    if (text[i] === "\\") end = Math.min(text.length, i + 2);
    else if (text[i] === "`") {
      const run = text.slice(i).match(/^`+/)[0];
      let cursor = i + run.length;
      while (cursor < text.length) {
        const found = text.indexOf("`", cursor);
        if (found < 0) break;
        const next = text.slice(found).match(/^`+/)[0];
        if (next.length === run.length) { end = found + next.length; break; }
        cursor = found + next.length;
      }
      if (end < 0) end = text.length;
    } else if (text.startsWith("<!--", i)) {
      const close = text.indexOf("-->", i + 4); end = close < 0 ? text.length : close + 3;
    } else if (text[i] === "<") {
      const code = text.slice(i).match(/^<(code|pre)(?:\s[^>]*|)>/i);
      if (code) {
        const close = new RegExp(`</${code[1]}\\s*>`, "i").exec(text.slice(i + code[0].length));
        end = close ? i + code[0].length + close.index + close[0].length : text.length;
      } else {
        if (/^<(?:\/?[A-Za-z]|[^\s<>]+@)/.test(text.slice(i))) {
          let quote = null;
          for (let cursor = i + 1; cursor < text.length; cursor++) {
            const char = text[cursor];
            if (quote) { if (char === quote) quote = null; }
            else if (char === '"' || char === "'") quote = char;
            else if (char === ">") { end = cursor + 1; break; }
          }
          if (end < 0) end = text.length;
        }
      }
    } else if (/[“「『"]/u.test(text[i])) {
      const closeChar = { "“": "”", "「": "」", "『": "』", '"': '"' }[text[i]];
      for (let cursor = i + 1; cursor < text.length; cursor++) {
        if (text[cursor] === "\\") { cursor++; continue; }
        if (text[cursor] === closeChar) { end = cursor + 1; break; }
      }
      if (end < 0) end = text.length;
    } else if (text[i] === "[") {
      const labelEnd = balancedEnd(i, "[", "]");
      if (labelEnd > 0 && text[labelEnd] === "(") end = balancedEnd(labelEnd, "(", ")");
      else if (labelEnd > 0 && text[labelEnd] === "[") end = balancedEnd(labelEnd, "[", "]");
      else if (labelEnd > 0) end = labelEnd; // Conservatively protect shortcut reference labels too.
    } else if (/^https?:\/\//i.test(text.slice(i))) {
      end = i + text.slice(i).match(/^\S+/)[0].length;
    }
    if (end > i) { mask(i, end); i = end; } else i++;
  }
  return output.join("");
}

function deliveryVisibleLines(lines) {
  const visible = lines.map(item => " ".repeat(item.text.length));
  let paragraph = [], lazyQuote = false;
  const flush = () => {
    if (!paragraph.length) return;
    const masked = deliveryVisibleText(paragraph.map(index => lines[index].text).join("\n")).split("\n");
    paragraph.forEach((index, offset) => { visible[index] = masked[offset]; });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const item = lines[index];
    const listStart = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(item.text);
    const boundary = !item.text.trim() || item.heading || item.separator || item.protected || listStart
      || /^ {0,3}\[[^\]]+\]:/.test(item.text);
    if (/^ {0,3}>/.test(item.text)) {
      flush(); lazyQuote = true; continue;
    }
    // CommonMark permits paragraph continuation without another > marker.
    // Keep it opaque until a blank line or an explicit block boundary.
    if (lazyQuote && item.text.trim() && (!boundary || /^(?: {4}|\t)/.test(item.text))) { flush(); continue; }
    lazyQuote = false;
    // Indented code cannot interrupt an open paragraph. Its line may continue
    // an inline code span, quote or link; blank-separated code stays opaque.
    if (paragraph.length && item.text.trim() && /^(?: {4}|\t)/.test(item.text)) {
      paragraph.push(index); continue;
    }
    if (boundary) flush();
    if (item.protected || !item.text.trim() || item.separator || /^ {0,3}\[[^\]]+\]:/.test(item.text)) continue;
    if (item.heading) { visible[index] = deliveryVisibleText(item.text); continue; }
    paragraph.push(index);
  }
  flush();
  return visible;
}

function inspectNotesDelivery(markdown) {
  const { lines, headings } = parse(markdown), issues = [], reviewCandidates = [];
  const visibleLines = deliveryVisibleLines(lines);
  const titleIndex = headings[0].index;
  let opening = true;
  const add = (item, rule, reason, start = 0, length = item.text.length) => {
    issues.push({ line: item.line, column: start + 1, endColumn: start + length + 1, rule, reason });
  };
  const paragraphFrom = (item, firstLine) => {
    let paragraph = firstLine;
    for (const next of lines.slice(item.line, item.line + 3)) {
      if (!next.text.trim() || next.heading || next.protected || next.separator
        || /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(next.text)) break;
      paragraph += visibleLines[next.line - 1].trim();
    }
    return paragraph;
  };
  for (const item of lines.slice(titleIndex + 1)) {
    if (item.heading) {
      opening = false;
      if (INTERNAL_DELIVERY_HEADINGS.has(item.heading.key)) add(item, "internal-process-section",
        "内部来源/整理过程章节不属于最终纪要。先将其中实质事实及必要限定移入对应主题，再将过程信息保留于独立证据记录；不要整节删除事实。");
      continue;
    }
    if (item.protected || /^ {0,3}\[[^\]]+\]:/.test(item.text)) continue;
    const visible = visibleLines[item.line - 1];
    const prose = visible.trim().replace(/^(?:[-+*]|\d+[.)])[ \t]+/, "")
      .replace(/\*\*|__/g, "").trim();
    if (opening && OPENING_METADATA.test(prose)) add(item, "opening-meeting-metadata",
      "最终纪要开头不重复时间、主题、会议日期、性质等元数据；保留参会人，将有业务意义的日期、时段或背景并入相应事实，勿由格式程序删除。");
    else if (prose && !/^(?:参会人|参会人员|与会者|访谈对象|交流对象)[ \t]*[：:]/.test(prose)) opening = false;
    const disclaimer = prose.replace(/^(?:说明|注|备注|记录说明|口径说明)[ \t]*[：:][ \t]*/, "");
    let repeatedNarrativeBoundary = false;
    if (/^下文保留双方判断和分歧[。；;]/.test(disclaimer)) {
      // Match one known whole-document wrapper, including a softly wrapped
      // paragraph. Do not classify business facts merely mentioning reports.
      const paragraph = paragraphFrom(item, disclaimer);
      repeatedNarrativeBoundary = /均按现场自述、转述或估算记录/.test(paragraph)
        && /未取得底层报表/.test(paragraph);
    }
    let broadScopeBoundary = false;
    if (/^(?:口径说明|记录口径|数据口径说明)[ \t]*[：:]/.test(prose)) {
      const paragraph = paragraphFrom(item, prose), scope = BROAD_DATA_SCOPE.exec(paragraph);
      // Require a labelled, multi-domain whole-notes scope AND oral sourcing
      // AND blanket verification language, not a single metric's limitation.
      broadScopeBoundary = scope && new Set(scope[1].match(new RegExp(BROAD_DATA_CATEGORY, "g"))).size >= 3
        && /(?:均|全部)(?:为|来自|依据|根据).{0,30}(?:会中|现场|受访者).{0,8}(?:陈述|口述|自述|转述)/.test(paragraph)
        && /(?:未经|尚未).{0,60}(?:合同|财务底稿|财务报表|底层报表|独立技术测试).{0,24}(?:验证|核验|核实)/.test(paragraph);
    }
    if (repeatedNarrativeBoundary || broadScopeBoundary || (/^(?:本(?:次)?(?:会议)?纪要|本记录|本文|本稿|全文(?:内容)?|(?:以下|以上)(?:内容|记录|纪要))(?:全部内容|所有内容)?[ \t，,：:]*(?:仅|只|均|未经|未作|未做|未进行|不作|不做|不进行|不构成|不代表|不等同于|依据|根据|基于|系|是|中的|所涉|所述)/.test(disclaimer)
      && /(?:仅(?:依据|根据|基于|反映).{0,35}(?:会中|会议|交流|访谈|录音|逐字稿|转写|原文|嘉宾|受访者).{0,45}(?:整理|陈述|信息|观点|口述)|(?:未经|未作|未做|未进行|不作|不做|不进行).{0,8}(?:独立|外部)(?:核验|核实|验证)|不(?:构成|代表|等同于).{0,12}(?:投资建议|已核实事实|事实认定|独立验证|已验证事实))/.test(disclaimer))) {
      add(item, "global-process-disclaimer",
        "请审改面向全篇的通用来源/核验免责声明；具体事实的归因、估算、计划、冲突口径和适用条件仍须保留，过程信息移入独立证据记录。");
    }
    if (/^建议(?:同步)?索取[ \t]*[：:]/.test(prose)) reviewCandidates.push({
      line: item.line, column: 1, endColumn: item.text.length + 1, rule: "unattributed-follow-up-suggestion",
      reason: "核对这项建议是否来自真实会中请求或承诺。若有来源，保留并补明提出方、事项及条件；若为整理时追加的建议，不混入会议事实。此候选不认定内容错误，不阻断检查或授权删除。"
    });
    SOURCE_TIME_LOCATOR.lastIndex = 0;
    for (const match of visible.matchAll(SOURCE_TIME_LOCATOR)) add(item, "explicit-source-time-locator",
      "原文/逐字稿时间定位应保留在 sourceRefs 或独立证据记录，不作为纪要正文括号尾注；不要删除事实中的实际时间、日期或业务条件。", match.index, match[0].length);
  }
  return { issues, reviewCandidates };
}

class NotesFormatError extends Error {
  constructor(message, code = "DOMI_NOTES_FORMAT_AMBIGUOUS", issues = []) {
    super(message);
    this.name = "NotesFormatError";
    this.code = code;
    this.issues = issues;
  }
}

function fail(message, line, code) {
  throw new NotesFormatError(message, code, line ? [{ line, reason: message }] : []);
}

function linesOf(markdown) {
  const lines = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match;
  while ((match = pattern.exec(markdown)) && match[0]) {
    lines.push({ text: match[1], eol: match[2], line: lines.length + 1, protected: false });
  }
  return lines;
}

function headingKey(text) {
  return text.replace(/[ \t]+#+[ \t]*$/, "").trim()
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/^(?:[一二三四五六七八九十]+[、.．]|\d+[、.．]|[（(][一二三四五六七八九十\d]+[）)])[ \t]*/, "")
    .trim();
}

function parse(markdown) {
  const lines = linesOf(markdown), headings = [];
  let frontmatter = false, fence = null, html = null, listOpen = false;
  for (let index = 0; index < lines.length; index += 1) {
    const item = lines[index], text = item.text;
    if (index === 0 && text.replace(/^\uFEFF/, "") === "---") {
      frontmatter = true; item.protected = true; continue;
    }
    if (frontmatter) {
      item.protected = true;
      if (/^(?:---|\.\.\.)[ \t]*$/.test(text)) frontmatter = false;
      continue;
    }
    if (fence) {
      item.protected = true;
      const close = text.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }
    if (html) {
      item.protected = true;
      if (html.test(text)) html = null;
      continue;
    }
    const opening = text.match(/^ {0,3}(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/);
    if (opening) {
      if (/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(text)) listOpen = true;
      fence = { char: opening[1][0], length: opening[1].length };
      item.protected = true; continue;
    }
    const htmlOpen = text.match(/^ {0,3}<(pre|script|style|textarea|div)(?:\s|>)/i);
    if (/^ {0,3}<!--/.test(text)) {
      item.protected = true;
      if (!text.includes("-->")) html = /-->/;
      continue;
    }
    if (htmlOpen) {
      item.protected = true;
      const end = new RegExp(`</${htmlOpen[1]}\\s*>`, "i");
      if (!end.test(text)) html = end;
      continue;
    }
    if (/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+\S/.test(text)) listOpen = true;
    else if (/^\S/.test(text)) listOpen = false;
    // Four-space/tab code and blockquote containers stay opaque. One to three
    // spaces still form legal top-level ATX headings in CommonMark.
    if (/^(?: {4}|\t)/.test(text) || /^ {0,3}>/.test(text)) { item.protected = true; continue; }
    const heading = text.match(/^( {0,3})(#{1,6})([ \t]+)(.*)$/);
    if (heading) {
      if (heading[1] && listOpen) fail("An indented heading may belong to a list; confirm its container before formatting.", item.line);
      if (!heading[4].trim()) fail("Empty document heading requires review.", item.line);
      const value = { index, line: item.line, indent: heading[1], level: heading[2].length,
        tail: heading[3] + heading[4], key: headingKey(heading[4]) };
      headings.push(value); item.heading = value;
    }
    item.separator = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(text);
    item.setext = /^ {0,3}(?:=+|-{1,2})[ \t]*$/.test(text);
  }
  if (frontmatter || fence || html) fail("Unclosed frontmatter, code fence or HTML block; formatting stopped.");
  if (!headings.length) fail("An explicit ATX document title is required; a prose or Setext title will not be guessed.");
  const first = lines.find(item => !item.protected && item.text.trim());
  if (first !== lines[headings[0].index]) fail("The first document content must be its explicit title.", first?.line);
  return { lines, headings };
}

function outline(headings, requestedMode) {
  const title = headings[0], body = headings.slice(1);
  title.role = "title"; title.target = 4;
  if (MAIN_HEADINGS.has(title.key)) fail("The first heading looks like a section, not a document title.", title.line);
  let mode = requestedMode;
  if (mode === "auto") {
    // A topic named “融资情况” inside a generic chapter is not evidence that
    // the whole document uses the fixed investment-interview template.
    const mainLevel = Math.min(...body.map(heading => heading.level));
    mode = body.some(heading => heading.level === mainLevel && MAIN_HEADINGS.has(heading.key)) ? "A" : "B";
  }
  // Formatting never imposes the mode-A semantic chapter template on an
  // already explicit canonical outline, including custom chapter names.
  if (title.level === 4 && body.every(heading => [4, 5].includes(heading.level))) {
    if (body.length && body[0].level !== 4) fail("A subsection precedes its parent section; structure is ambiguous.", body[0].line);
    for (const heading of body) {
      heading.role = heading.level === 4 ? "main" : "sub";
      heading.target = heading.level;
    }
    return mode;
  }
  if (mode === "A") {
    const mainLevel = Math.min(...body.map(heading => heading.level));
    let current = null, childLevel = null;
    for (const heading of body) {
      if (heading.level === mainLevel && MAIN_HEADINGS.has(heading.key)) {
        heading.role = "main"; heading.target = 4; current = heading; childLevel = null;
      } else {
        if (!current || heading.level <= current.level) {
          fail("Unknown same-level section in mode A; confirm the section or explicitly choose mode B.", heading.line);
        }
        if (childLevel !== null && childLevel !== heading.level) {
          fail("More than two section tiers cannot be flattened without losing structure.", heading.line);
        }
        childLevel = heading.level; heading.role = "sub"; heading.target = 5;
      }
    }
  } else {
    const levels = [...new Set(body.map(heading => heading.level))].sort((a, b) => a - b);
    if (levels.length > 2) fail("More than two section tiers cannot be flattened without losing structure.", body[0]?.line);
    if (body.length && body[0].level !== levels[0]) fail("A subsection precedes its parent section; structure is ambiguous.", body[0].line);
    for (const heading of body) {
      heading.role = heading.level === levels[0] ? "main" : "sub";
      heading.target = heading.role === "main" ? 4 : 5;
    }
  }
  return mode;
}

function formatNotesMarkdown(markdown, options = {}) {
  if (options.profile !== PROFILE) fail("Explicit profile structured-notes is required.", null, "DOMI_NOTES_FORMAT_PROFILE_REQUIRED");
  if (typeof markdown !== "string") fail("Markdown must be a string.", null, "DOMI_NOTES_FORMAT_INVALID_INPUT");
  const requestedMode = options.mode || "auto";
  if (!["A", "B", "auto"].includes(requestedMode)) fail("mode must be A, B or auto.", null, "DOMI_NOTES_FORMAT_INVALID_INPUT");
  const { lines, headings } = parse(markdown);
  const mode = outline(headings, requestedMode), issues = [];
  const eol = lines.find(item => item.eol)?.eol || "\n";
  for (const heading of headings) {
    if (heading.level !== heading.target) issues.push({ line: heading.line, rule: "heading-level", expected: heading.target, actual: heading.level });
    lines[heading.index].text = heading.indent + "#".repeat(heading.target) + heading.tail;
  }
  // A bare dash line following prose can be a Setext heading. It is safe to
  // repair only when its location establishes a section boundary.
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].setext && !lines[index].protected && lines[index - 1]?.text.trim()
      && !lines[index - 1].protected && !lines[index - 1].heading) {
      fail("A Setext heading requires an explicit ATX hierarchy before formatting.", lines[index].line);
    }
    if (!lines[index].separator || lines[index].protected) continue;
    const previous = lines[index - 1];
    const next = lines.slice(index + 1).find(item => item.text.trim() && !item.separator);
    if (previous?.text.trim() && !previous.separator && !previous.heading
      && !previous.protected && next?.heading?.role !== "main") {
      fail("A possible Setext heading is not at a known section boundary; structure requires review.", lines[index].line);
    }
  }
  const output = [], blank = () => ({ text: "", eol });
  let mainCount = 0;
  for (const item of lines) {
    if (item.heading?.role === "main") {
      let cursor = output.length - 1, separatorFound = false;
      while (cursor >= 0 && (!output[cursor].text.trim() || (output[cursor].separator && !output[cursor].protected))) {
        if (output[cursor].separator) separatorFound = true;
        cursor -= 1;
      }
      if (mainCount > 0 || separatorFound) {
        const previousBoundary = output.slice(cursor + 1).map(line => line.text + line.eol).join("");
        const boundary = eol + "---" + eol + eol;
        if (previousBoundary !== boundary) issues.push({ line: item.line, rule: "section-separator" });
        output.splice(cursor + 1);
        if (output.length && !output[output.length - 1].eol) output[output.length - 1].eol = eol;
        output.push(blank(), { text: "---", eol, separator: true }, blank());
      }
      mainCount += 1;
    }
    output.push(item);
  }
  // Separators already present elsewhere keep their text, with blank lines to
  // prevent the renderer from interpreting surrounding prose as Setext titles.
  const spaced = [];
  for (let index = 0; index < output.length; index += 1) {
    const item = output[index];
    if (item.separator && !item.protected) {
      if (spaced.length && spaced[spaced.length - 1].text.trim()) { spaced.push(blank()); issues.push({ line: item.line, rule: "separator-spacing" }); }
      spaced.push(item);
      if (output[index + 1]?.text.trim()) { spaced.push(blank()); issues.push({ line: item.line, rule: "separator-spacing" }); }
    } else spaced.push(item);
  }
  const result = spaced.map(item => item.text + item.eol).join("");
  return { markdown: result, changed: result !== markdown, profile: PROFILE, mode,
    headings: headings.map(({ line, role, target }) => ({ line, role, level: target })), issues };
}

function checkNotesFormat(markdown, options = {}) {
  try {
    const result = formatNotesMarkdown(markdown, options);
    const delivery = inspectNotesDelivery(markdown);
    return { ok: !result.changed && !delivery.issues.length, changed: result.changed,
      formatOk: !result.changed, deliveryOk: delivery.issues.length === 0, profile: result.profile, mode: result.mode,
      headings: result.headings, issues: [...result.issues, ...delivery.issues],
      ...(delivery.reviewCandidates.length ? { reviewCandidates: delivery.reviewCandidates } : {}),
      ...(delivery.issues.length ? { code: "DOMI_NOTES_DELIVERY_INVALID",
        error: "纪要交付检查未通过：按 issues 行列定位审改正文，保留实质事实及必要限定；format 只修格式，不会删除交付噪音。" } : {}) };
  } catch (error) {
    if (!(error instanceof NotesFormatError)) throw error;
    return { ok: false, changed: false, profile: options.profile, mode: options.mode || "auto",
      code: error.code, error: error.message, issues: error.issues };
  }
}

function main(argv) {
  const command = argv.shift(), flags = {};
  while (argv.length) {
    const flag = argv.shift();
    if (flag === "--force") { flags.force = true; continue; }
    if (!/^--(?:input|output|profile|mode)$/.test(flag) || !argv.length || argv[0].startsWith("--")) fail("Invalid CLI arguments.", null, "DOMI_NOTES_FORMAT_INVALID_INPUT");
    flags[flag.slice(2)] = argv.shift();
  }
  if (!["check", "format"].includes(command) || !flags.input) fail("Usage: notes-format.cjs check|format --input file --profile structured-notes [--mode A|B|auto] [--output file]", null, "DOMI_NOTES_FORMAT_INVALID_INPUT");
  const bytes = fs.readFileSync(path.resolve(flags.input)), markdown = bytes.toString("utf8");
  if (!Buffer.from(markdown).equals(bytes)) fail("Input must be valid UTF-8.", null, "DOMI_NOTES_FORMAT_INVALID_INPUT");
  if (command === "check") {
    const result = checkNotesFormat(markdown, flags);
    process.stdout.write(JSON.stringify(result) + "\n");
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const result = formatNotesMarkdown(markdown, flags);
  if (flags.output) {
    const target = path.resolve(flags.output), temporary = `${target}.${crypto.randomUUID()}.tmp`;
    const samePath = target === path.resolve(flags.input);
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) fail("Output must not be a symbolic link.", null, "DOMI_NOTES_FORMAT_INVALID_INPUT");
    if (!samePath && fs.existsSync(target) && !flags.force) fail("Output already exists; choose a new path or explicitly use --force.", null, "DOMI_NOTES_FORMAT_OUTPUT_EXISTS");
    try {
      fs.writeFileSync(temporary, result.markdown, { encoding: "utf8", mode: samePath ? fs.statSync(target).mode & 0o777 : 0o600, flag: "wx" });
      if (samePath && !fs.readFileSync(target).equals(bytes)) fail("Input changed while formatting; no replacement was made.", null, "DOMI_NOTES_FORMAT_CONCURRENT_EDIT");
      if (samePath || flags.force) fs.renameSync(temporary, target);
      else fs.linkSync(temporary, target); // Atomic no-clobber publication.
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    const { markdown: _markdown, ...metadata } = result;
    process.stdout.write(JSON.stringify({ ok: true, ...metadata, output: target }) + "\n");
  } else process.stdout.write(result.markdown);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: error.code || "DOMI_NOTES_FORMAT_IO_ERROR", error: error.message, issues: error.issues || [] }) + "\n");
    process.exitCode = 1;
  }
}

module.exports = { NotesFormatError, formatNotesMarkdown, checkNotesFormat };
