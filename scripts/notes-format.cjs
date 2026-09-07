#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROFILE = "structured-notes";
const MAIN_HEADINGS = new Set([
  "团队背景", "团队", "产品与技术", "商业化", "商业化与增长", "商业进展", "市场与行业", "市场与竞争", "融资情况", "融资", "其他"
]);

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
    return { ok: !result.changed, changed: result.changed, profile: result.profile, mode: result.mode,
      headings: result.headings, issues: result.issues };
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
