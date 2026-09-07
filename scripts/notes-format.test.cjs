"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { formatNotesMarkdown: format, checkNotesFormat: check, NotesFormatError } = require("./notes-format.cjs");
const options = mode => ({ profile: "structured-notes", mode });

test("mode A repairs legacy heading levels and Setext-like boundaries without changing text", () => {
  const source = "# 20260907-示例科技-联创张某\n参会人：张某、李某\n\n## 团队背景\n**张某**\n- 2018–2021 年任职示例公司，负责 GPU 软件。\n---\n## 产品与技术\n### 推理产品\n**部署方式**\n- 私有化部署，不上传数据。\n\n## 商业化与增长\n| 指标 | 数值 |\n| --- | --- |\n| ARR | 1,200 万元 |\n\n## 市场与竞争\n竞争对手仍在验证中。\n## 融资情况\n本轮尚未交割。\n## 其他\n保留不确定性。\n";
  const result = format(source, options("A"));
  assert.equal(result.changed, true);
  assert.match(result.markdown, /^#### 20260907-示例科技-联创张某\n/);
  assert.match(result.markdown, /负责 GPU 软件。\n\n---\n\n#### 产品与技术/);
  assert.match(result.markdown, /##### 推理产品\n\*\*部署方式\*\*/);
  assert.ok(result.markdown.includes("| 指标 | 数值 |\n| --- | --- |\n| ARR | 1,200 万元 |"));
  assert.equal(result.markdown.match(/^---$/gm).length, 5);
  const payload = text => text.split("\n").filter(line => line.trim() && line !== "---")
    .map(line => line.replace(/^#{1,6}(?=\s)/, "")).join("\n");
  assert.equal(payload(result.markdown), payload(source));
  assert.deepEqual(format(result.markdown, options("A")).markdown, result.markdown);
  assert.equal(check(result.markdown, options("A")).ok, true);
});

test("mode B follows source hierarchy, accepts one title and keeps bold topics as prose", () => {
  assert.equal(check("#### 内部讨论纪要\n\n**决定**\n- 保留原计划。\n", options("B")).ok, true);
  const source = "# 行业专家访谈\n\n## 供需变化\n证据尚不充分。\n### 区域差异\n- 华东需求增加。\n\n## 后续行动\n**负责人**\n- 李某周五提供材料。";
  const result = format(source, options("B"));
  assert.match(result.markdown, /#### 供需变化\n证据尚不充分。\n##### 区域差异/);
  assert.match(result.markdown, /华东需求增加。\n\n---\n\n#### 后续行动\n\*\*负责人\*\*/);
  assert.equal(result.markdown.endsWith("- 李某周五提供材料。"), true);
  assert.equal(check(result.markdown, options("B")).ok, true);
});

test("auto recognizes legacy main aliases but never promotes a named financing subsection", () => {
  const legacy = "# 公司纪要\n## 团队\n事实。\n## 产品与技术\n事实。\n## 商业进展\n事实。\n## 市场与行业\n事实。\n## 融资\n事实。\n";
  const modeA = format(legacy, options("auto"));
  assert.equal(modeA.mode, "A");
  assert.equal(modeA.headings.filter(item => item.role === "main").length, 5);
  let generic = "# 通用会议纪要\n";
  for (let index = 1; index <= 8; index += 1) {
    generic += `## 自定义主题${index}\n原文主题${index}。\n`;
    if (index === 3) generic += "### 1.融资情况\n该话题属于当前讨论主题。\n";
  }
  const modeB = format(generic, options("auto"));
  assert.equal(modeB.mode, "B");
  assert.equal(modeB.headings.filter(item => item.role === "main").length, 8);
  assert.equal(modeB.headings.filter(item => item.role === "sub").length, 1);
  assert.match(modeB.markdown, /##### 1\.融资情况/);
  assert.equal(modeB.markdown.match(/^---$/gm).length, 7);
  assert.equal(check(modeB.markdown, options("auto")).ok, true);
});

test("frontmatter, fenced code, indented code, HTML, list code and blockquotes remain byte-identical", () => {
  const protectedParts = [
    "---\ntitle: '# 原始名称'\ndescription: |\n  ---\n  # YAML 内的文字\n---\n",
    "````markdown\n# 代码中的标题\n---\n```\n仍是代码\n````\n",
    "~~~text\n## 也不是板块\n---\n~~~\n",
    "    # 缩进代码\n    ---\n",
    "<pre>\n# HTML 内代码\n---\n</pre>\n",
    "- ```markdown\n  # 列表中的代码\n  ---\n  ```\n",
    "> # 引用中的标题\n> ---\n"
  ];
  const source = protectedParts[0] + "# 会议纪要\n\n## 第一章\n" + protectedParts.slice(1).join("\n") + "\n## 第二章\n原文。\n";
  const result = format(source, options("B"));
  for (const content of protectedParts) assert.ok(result.markdown.includes(content), content);
  assert.equal(result.headings.length, 3);
  assert.equal(check(result.markdown, options("B")).ok, true);
});

test("unknown same-level mode A headings, orphan subsections and three tiers fail instead of guessing", () => {
  const ambiguous = "# 公司纪要\n## 团队背景\n事实。\n## 尚未确认的板块\n其他事实。\n";
  assert.throws(() => format(ambiguous, options("A")), error => error instanceof NotesFormatError
    && error.code === "DOMI_NOTES_FORMAT_AMBIGUOUS" && error.issues[0].line === 4);
  assert.equal(check(ambiguous, options("auto")).ok, false);
  assert.equal(check(ambiguous, options("auto")).code, "DOMI_NOTES_FORMAT_AMBIGUOUS");
  assert.equal(format(ambiguous, options("B")).mode, "B");
  assert.throws(() => format("# 纪要\n### 子节\n## 主节\n", options("B")), /precedes/);
  assert.throws(() => format("# 纪要\n## 主题\n### 分组\n#### 更细层级\n", options("B")), /two section tiers/);
  assert.throws(() => format("# 纪要\n## 团队背景\n### 成员\n#### 更细层级\n", options("A")), /two section tiers/);
});

test("check rejects missing section separators and accepts canonical layout without imposing chapter counts", () => {
  const missing = "#### 访谈\n#### 讨论一\n正文一。\n#### 讨论二\n正文二。\n";
  const failed = check(missing, options("B"));
  assert.equal(failed.ok, false);
  assert.equal(failed.changed, true);
  assert.ok(failed.issues.some(issue => issue.rule === "section-separator"));
  assert.equal(check(format(missing, options("B")).markdown, options("B")).ok, true);
  assert.equal(check("#### 一段纪要\n事实。", options("B")).ok, true);
});

test("duplicate section rules collapse safely; existing first-section divider remains and gets spacing", () => {
  const source = "# 纪要\n参会人：甲。\n---\n## 第一节\n正文。\n\n***\n---\n\n## 第二节\n正文。\n";
  const result = format(source, options("B"));
  assert.equal(result.markdown.match(/^---$/gm).length, 2);
  assert.match(result.markdown, /参会人：甲。\n\n---\n\n#### 第一节/);
  assert.equal(check(result.markdown, options("B")).ok, true);
});

test("unknown Setext intent and unterminated protected blocks stop formatting", () => {
  for (const source of ["标题\n===\n正文", "#### 标题\n\nUnexpected big heading\n===\n", "#### 标题\n\nUnexpected heading\n--\n", "# 标题\n正文\n---\n另一段正文。", "---\nkey: value\n# 标题", "# 标题\n```\n# 文本"]) {
    assert.throws(() => format(source, options("B")), NotesFormatError);
  }
});

test("legal one-to-three-space ATX headings cannot bypass the gate; ambiguous list headings stop", () => {
  const bypass = "#### Notes\n\n#### 团队背景\n\n  ## Person\n\ntext\n";
  assert.equal(check(bypass, options("auto")).ok, false);
  for (const indent of [" ", "  ", "   "]) {
    const source = `${indent}# Notes\n\n${indent}## First\ntext\n${indent}### Child\nchild text\n${indent}## Second\ntext\n`;
    const result = format(source, options("B"));
    assert.match(result.markdown, new RegExp(`^${indent}#### Notes`));
    assert.ok(result.markdown.includes(`${indent}##### Child`));
    assert.equal(check(result.markdown, options("B")).ok, true);
  }
  assert.throws(() => format("# Notes\n## Topic\n- List item\n\n  ## Nested heading\n", options("B")), /list/);
  assert.equal(check("#### Notes\n\n    # Indented code\n    ===\n", options("B")).ok, true);
});

test("mode A respects canonical-named children and permits already-canonical custom chapters", () => {
  const source = "# 纪要\n## 团队背景\n### 商业化\n这是团队讨论中的子话题。\n## 产品与技术\n正文。\n";
  const result = format(source, options("A"));
  assert.equal(result.headings.filter(item => item.role === "main").length, 2);
  assert.match(result.markdown, /#### 团队背景\n##### 商业化\n这是团队讨论中的子话题。/);
  const canonical = "#### 纪要\n\n#### 自定义访谈主题\n##### 融资情况\n保持父子关系。\n\n---\n\n#### 其他自定义主题\n正文。\n";
  assert.equal(check(canonical, options("A")).ok, true);
  assert.equal(format(canonical, options("auto")).changed, false);
});

test("CRLF, mixed code-block line endings, trailing spaces and heading text are preserved", () => {
  const code = "```\n# 字符串\r\n---\n```\r\n";
  const source = "---\r\nkey: value\r\n---\r\n# 标题 ##\r\n\r\n## 一、团队背景\r\n正文保留空格。  \r\n" + code + "## 产品与技术\r\n内容。";
  const result = format(source, options("A"));
  assert.ok(result.markdown.includes(code));
  assert.ok(result.markdown.startsWith("---\r\nkey: value\r\n---\r\n#### 标题 ##\r\n"));
  assert.ok(result.markdown.includes("正文保留空格。  \r\n"));
  assert.ok(result.markdown.includes("\r\n\r\n---\r\n\r\n#### 产品与技术"));
  assert.equal(format(result.markdown, options("A")).changed, false);
});

test("explicit structured-notes profile prevents incidental changes to other document types", () => {
  for (const profile of [undefined, "investment-review", "ic-memo", "transcript"]) {
    assert.equal(check("# 文档\n正文", { profile, mode: "B" }).code, "DOMI_NOTES_FORMAT_PROFILE_REQUIRED");
    assert.throws(() => format("# 文档\n正文", { profile }), NotesFormatError);
  }
});

test("real CLI checks and formats synthetic files, with invalid-input and ambiguity exit codes", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-notes-format-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "input.md"), output = path.join(root, "output.md");
  const source = "# 纪要\n## 讨论一\n原文甲。\n## 讨论二\n原文乙。\n";
  fs.writeFileSync(input, source);
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, "notes-format.cjs"), ...args], { encoding: "utf8" });
  const checked = run("check", "--input", input, "--profile", "structured-notes", "--mode", "B");
  assert.equal(checked.status, 1);
  assert.equal(JSON.parse(checked.stdout).ok, false);
  const formatted = run("format", "--input", input, "--output", output, "--profile", "structured-notes", "--mode", "B");
  assert.equal(formatted.status, 0, formatted.stdout + formatted.stderr);
  assert.equal(JSON.parse(formatted.stdout).changed, true);
  assert.equal(fs.readFileSync(input, "utf8"), source);
  assert.equal(run("check", "--input", output, "--profile", "structured-notes", "--mode", "B").status, 0);
  const saved = fs.readFileSync(output, "utf8");
  assert.equal(run("format", "--input", input, "--output", output, "--profile", "structured-notes", "--mode", "B").status, 1);
  assert.equal(fs.readFileSync(output, "utf8"), saved);
  assert.equal(run("format", "--input", input, "--output", output, "--profile", "structured-notes", "--mode", "B", "--force").status, 0);
  const missingProfile = run("format", "--input", input, "--output", output);
  assert.equal(missingProfile.status, 1);
  assert.equal(JSON.parse(missingProfile.stdout).code, "DOMI_NOTES_FORMAT_PROFILE_REQUIRED");
  fs.writeFileSync(input, "# 纪要\n## 团队背景\n## 未确认板块\n");
  const ambiguous = run("format", "--input", input, "--output", output, "--profile", "structured-notes", "--mode", "A");
  assert.equal(ambiguous.status, 1);
  assert.equal(JSON.parse(ambiguous.stdout).code, "DOMI_NOTES_FORMAT_AMBIGUOUS");
});

test("same-path CLI formatting detects an external edit before replacement", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-notes-concurrent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "input.md"), hook = path.join(root, "hook.cjs");
  fs.writeFileSync(input, "# 纪要\n正文。\n");
  fs.writeFileSync(hook, `const fs=require('node:fs'); const write=fs.writeFileSync; fs.writeFileSync=function(file,...args){const result=write.call(this,file,...args);if(String(file).endsWith('.tmp'))write(${JSON.stringify(input)},'External edit must survive.');return result;};`);
  const result = spawnSync(process.execPath, ["--require", hook, path.join(__dirname, "notes-format.cjs"), "format", "--input", input, "--output", input, "--profile", "structured-notes", "--mode", "B"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).code, "DOMI_NOTES_FORMAT_CONCURRENT_EDIT");
  assert.equal(fs.readFileSync(input, "utf8"), "External edit must survive.");
  assert.deepEqual(fs.readdirSync(root).sort(), ["hook.cjs", "input.md"]);
});
