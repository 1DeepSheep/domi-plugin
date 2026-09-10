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

test("delivery check reports opening meeting shell without changing dates, nature or participant bytes", () => {
  const source = "#### 20260910-合成项目纪要\n参会人：创始人甲、投资人乙\n**会议日期：**2026年9月10日\n- **会议性质**：产品交流\n#### 产品与技术\n- 产品计划2027年第一季度上线。\n";
  const formatted = format(source, options("A"));
  assert.equal(formatted.markdown, source);
  assert.equal(formatted.changed, false, "formatter remains lossless even for rejected delivery prose");
  const report = check(source, options("A"));
  assert.equal(report.ok, false);
  assert.equal(report.formatOk, true);
  assert.equal(report.deliveryOk, false);
  assert.equal(report.code, "DOMI_NOTES_DELIVERY_INVALID");
  assert.deepEqual(report.issues.map(issue => [issue.line, issue.rule]), [
    [3, "opening-meeting-metadata"], [4, "opening-meeting-metadata"]
  ]);
  assert(report.issues.every(issue => issue.column === 1 && issue.endColumn > 1));
});

test("dedicated internal process sections block delivery but retain their substantive facts", () => {
  for (const heading of ["来源与记录边界", "七、来源及记录边界", "来源与核验说明", "核心修正项",
    "来源与证据边界", "七、数字审计与冲突清单", "数字核验与冲突清单"]) {
    const source = `#### 合成项目纪要\n参会人：甲、乙\n#### 产品与技术\n- 交付2026年Q4开始。\n\n---\n\n#### ${heading}\n- 公司表示已签订3份合同，金额仅为框架上限。\n`;
    const report = check(source, options("B"));
    assert.equal(report.code, "DOMI_NOTES_DELIVERY_INVALID");
    assert.equal(report.issues[0].line, 8);
    assert.equal(report.issues[0].rule, "internal-process-section");
    assert.match(report.issues[0].reason, /先将其中实质事实/);
    assert.equal(format(source, options("B")).markdown, source);
  }
});

test("opening time and topic labels are review errors while business topics and schedules remain intact", () => {
  const source = "#### 合成项目纪要\n**时间：**2026年9月10日\n**主题：**产品能力和商业进展\n参会人：创始人甲、投资人乙\n#### 产品与技术\n- 主题：面向工业设备的故障检测。\n- 时间：2027年第一季度试点，前提是客户完成验收。\n";
  const report = check(source, options("A"));
  assert.equal(report.code, "DOMI_NOTES_DELIVERY_INVALID");
  assert.deepEqual(report.issues.map(issue => [issue.line, issue.rule]), [
    [2, "opening-meeting-metadata"], [3, "opening-meeting-metadata"]
  ]);
  assert.equal(format(source, options("A")).markdown, source);
  const body = source.replace(/^\*\*(?:时间|主题)：.*\n/gm, "");
  assert.equal(check(body, options("A")).ok, true);
});

test("labelled whole-notes data scope is rejected without requiring a 本文 prefix", () => {
  for (const text of [
    "口径说明：除“资料库既有研究核验”明确标注的内容外，经营、技术、客户及融资数据均为创始人甲会中陈述，未经合同、财务底稿或独立技术测试验证。",
    "**口径说明：**除“资料库既有研究核验”明确标注的内容外，\n经营、技术、客户及融资数据均为创始人甲会中陈述，\n未经合同、财务底稿或独立技术测试验证。",
    "记录口径：经营、客户和融资信息全部来自嘉宾现场口述，尚未经财务报表核验。"
  ]) {
    const source = `#### 合成项目纪要\n参会人：甲、乙\n${text}\n#### 产品与技术\n- 公司预计明年进入试点，仍需客户验收。\n`;
    const report = check(source, options("A"));
    assert.equal(report.code, "DOMI_NOTES_DELIVERY_INVALID", text);
    assert.deepEqual(report.issues.map(issue => [issue.line, issue.rule]), [[3, "global-process-disclaimer"]]);
    assert.equal(format(source, options("A")).markdown, source);
  }
});

test("metric limitations and attributed meeting requests never become whole-notes delivery errors", () => {
  const source = [
    "#### 合成项目纪要", "参会人：甲、乙", "#### 商业化",
    "- 口径说明：收入约500万元，为创始人甲会中估算，未经财务底稿验证。",
    "- 口径说明：经营、客户及融资数据按月整理，财务底稿尚未交齐，交割因此延期。",
    "- 口径说明：技术、技术、技术数据均为嘉宾会中陈述，未经独立技术测试验证。",
    "- 投资人乙建议同步索取：试点合同和收入明细；公司承诺本周提供。",
    "- 会中要求补充：验收条件与客户反馈，不要求提供客户个人信息。",
    "##### 合同审计与争议处理", "- 客户合同的审计范围仍需双方律师确认。", ""
  ].join("\n");
  const report = check(source, options("A"));
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.reviewCandidates, undefined);
  assert.equal(format(source, options("A")).markdown, source);
});

test("unattributed material requests are nonblocking source-review candidates and never silently removed", () => {
  const source = "#### 合成项目纪要\n#### 其他\n- **建议同步索取：**试点合同、收入明细与客户反馈。\n";
  const report = check(source, options("A"));
  assert.equal(report.ok, true);
  assert.equal(report.deliveryOk, true);
  assert.equal(report.code, undefined);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.reviewCandidates.map(issue => [issue.line, issue.rule]), [[3, "unattributed-follow-up-suggestion"]]);
  assert.match(report.reviewCandidates[0].reason, /真实会中请求或承诺/);
  assert.equal(format(source, options("A")).markdown, source);
});

test("new delivery patterns remain opaque in multiline quotations, code and source links", () => {
  const noise = "口径说明：经营、技术、客户及融资数据均为嘉宾会中陈述，未经合同、财务底稿或独立技术测试验证。";
  for (const protectedText of [
    `合同引文：“第一行\n    第二行\n${noise}”`,
    `示例：\`第一行\n\t第二行\n${noise}\``,
    `[原文摘录：\n    第二行\n${noise}](https://example.test)`,
    `> 附件原文：\n${noise}\n建议同步索取：客户合同。`,
    '```markdown\n#### 数字审计与冲突清单\n#### 来源与证据边界\n主题：业务说明\n```'
  ]) {
    const source = `#### 合成项目纪要\n#### 产品与技术\n${protectedText}\n`;
    const report = check(source, options("A"));
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(report.reviewCandidates, undefined);
    assert.equal(format(source, options("A")).markdown, source);
  }
});

test("limited global disclaimer patterns are review errors, not deletion instructions", () => {
  for (const text of [
    "本纪要仅依据本次交流内容整理，不构成独立核验。",
    "以下内容仅反映受访者陈述，不代表已核实事实。",
    "说明：本记录未经独立验证，不构成投资建议。",
    "**备注：**本文未进行独立核验。",
    "下文保留双方判断和分歧。收入、留存、融资、销量及成本等均按现场自述、转述或估算记录，未取得底层报表；明确写作“计划”“假设”的内容不代表已经实现。",
    "下文保留双方判断和分歧。\n收入、留存、融资、销量及成本等均按现场自述、转述或估算记录，未取得底层报表；\n明确写作“计划”“假设”的内容不代表已经实现。"
  ]) {
    const source = `#### 合成访谈纪要\n参会人：甲、乙\n#### 产品与技术\n${text}\n`;
    const report = check(source, options("B"));
    assert.equal(report.ok, false, text);
    assert.equal(report.issues[0].rule, "global-process-disclaimer");
    assert.equal(report.issues[0].line, 4);
    assert.equal(format(source, options("B")).markdown, source);
  }
});

test("explicit transcript time locators expose exact line and column without changing source text", () => {
  for (const locator of ["（原文00:12:30–00:13:05）", "(逐字稿：02:31-03:20)", "【转写稿定位 01:22】", "（录音时间戳：01:12:03）"]) {
    const line = `- 公司计划2027年交付${locator}，首批仅3家客户。`;
    const source = `#### 合成访谈纪要\n#### 产品与技术\n${line}\n`;
    const report = check(source, options("A"));
    assert.equal(report.ok, false, locator);
    assert.deepEqual(report.issues.map(issue => [issue.line, issue.column, issue.endColumn, issue.rule]),
      [[3, line.indexOf(locator) + 1, line.indexOf(locator) + locator.length + 1, "explicit-source-time-locator"]]);
    assert.equal(format(source, options("A")).markdown, source);
  }
});

test("business dates, action times, ratios, estimates, attribution and applicable conditions remain valid", () => {
  const source = [
    "#### 合成访谈纪要", "参会人：甲、乙", "#### 产品与技术",
    "- 公司表示2026年9月30日前交付，前提是客户完成验收。",
    "- 营业时间（09:00–18:00），分成比例（1:3），计划下一轮会议（14:30–15:00）。",
    "- 下一次会议日期：2026年10月1日；录音时间（10:00–11:00）由会务确认。",
    "- 原文给出的营业时间为09:00–18:00；该时间不表示全天候服务。",
    "- 收入约500万元，为公司估算、尚未经审计；不等同于已回款金额。",
    "- 实验没有独立核验，由合作方复测；不代表该功能已进入量产。",
    "- 客户未提供底层报表，交割因此延期。",
    "##### 数据来源与使用边界", "- 客户数据仅用于本地推理；2027年Q1上线仍取决于合规验收。", ""
  ].join("\n");
  assert.equal(check(source, options("A")).ok, true);
  assert.equal(format(source, options("A")).markdown, source);
});

test("quoted facts, code, frontmatter and links cannot be mistaken for authored delivery noise", () => {
  const source = [
    "---", "会议日期: 2026-09-10", "locator: '（原文00:12）'", "---",
    "#### 合成访谈纪要", "参会人：甲、乙", "#### 产品与技术",
    '> 会议性质：甲方要求保留的原始引文。',
    '> #### 来源与记录边界',
    '> 以下内容未经独立核验。（原文00:12）',
    '- 合同写明“以下内容未经独立核验。（原文00:12）”，客户尚未签署。',
    '- 示例代码：`（原文00:12）`；多反引号：`` `（原文00:12）` ``。',
    '- [引用（原文00:12）](https://example.test/a_(b) "（逐字稿00:14）")',
    '- [原始链接][source]；https://example.test/（原文00:12）',
    '- [引用（原文00:12）]',
    '[source]: https://example.test/（原文00:12） "source locator"',
    '<span data-value=">（原文00:12）">业务范围仍限于本地。</span>',
    '<code>（原文00:12）</code>',
    '```markdown', '#### 来源与记录边界', '会议日期：2026-09-10', '（原文00:12）', '```',
    '    #### 来源与记录边界', '    （原文00:12）', ''
  ].join("\n");
  const report = check(source, options("B"));
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(format(source, options("B")).markdown, source);
});

test("checking nested markup and escapes keeps locator offsets while ignoring reference labels", () => {
  const source = "#### 合成纪要\n#### 产品与技术\n- [**引用（原文00:12）**](https://example.test)；**真实正文**（原文00:22）。\n";
  const report = check(source, options("A"));
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].column, source.split("\n")[2].indexOf("（原文00:22）") + 1);
});

test("multiline inline code, quotations and links stay protected until their closing marker", () => {
  for (const protectedText of [
    '示例：`第一行\n（逐字稿00:12）`',
    '示例：`第一行\n    第二行\n（逐字稿00:12）`',
    '示例：`第一行\n\t第二行\n（逐字稿00:12）`',
    '示例：``第一行 `代码`\n（逐字稿00:12）``',
    '[原文摘录：\n（逐字稿00:12）](https://example.test)',
    '[原文摘录：\n    第二行\n（逐字稿00:12）](https://example.test)',
    '[原文摘录：\n\t第二行\n（逐字稿00:12）](https://example.test)',
    '[原文摘录：\n（逐字稿00:12）][source]',
    '“客户文档原文：\n以下内容未经独立核验。”',
    '“客户来函：\n    第二行\n以下内容未经独立核验。”',
    '“客户来函：\n\t第二行\n以下内容未经独立核验。”',
    '「客户文档原文：\n以下内容未经独立核验。」',
    '原文："客户文档 \\"中的说明\n以下内容未经独立核验。（逐字稿00:12）"',
    '示例：<code>第一行\n（逐字稿00:12）</code>',
    '客户范围：<span title="第一行\n（逐字稿00:12）">有效</span>'
  ]) {
    const clean = `#### 测试纪要\n\n#### 产品讨论\n${protectedText}\n`;
    const cleanReport = check(clean, options("B"));
    assert.equal(cleanReport.ok, true, JSON.stringify({ protectedText, cleanReport }));
    assert.equal(format(clean, options("B")).markdown, clean);
    const source = clean.slice(0, -1) + ' 正文（逐字稿00:33）\n';
    const report = check(source, options("B"));
    const lastLine = source.trimEnd().split("\n").at(-1);
    assert.deepEqual(report.issues.map(issue => [issue.line, issue.column, issue.rule]), [[
      source.trimEnd().split("\n").length, lastLine.indexOf("（逐字稿00:33）") + 1, "explicit-source-time-locator"
    ]], protectedText);
    assert.equal(format(source, options("B")).markdown, source);
  }
});

test("lazy blockquote continuation is opaque but explicit paragraph and block boundaries resume checks", () => {
  const quoted = '> 客户文档原文：\n    合同附注继续：\n以下内容未经独立核验。\n（逐字稿00:12）';
  const clean = `#### 测试纪要\n\n#### 产品讨论\n${quoted}\n`;
  assert.equal(check(clean, options("B")).ok, true);
  assert.equal(format(clean, options("B")).markdown, clean);
  for (const boundary of ["\n", "##### 后续核验\n", "- "]) {
    const source = clean + boundary + "本纪要未经独立核验。\n";
    const report = check(source, options("B"));
    assert.deepEqual(report.issues.map(issue => [issue.line, issue.rule]), [[
      source.trimEnd().split("\n").length, "global-process-disclaimer"
    ]], boundary);
    assert.equal(format(source, options("B")).markdown, source);
  }
});

test("unclosed inline exclusions cannot conceal prose beyond paragraph or section boundaries", () => {
  for (const opening of ['示例：`未闭合', '原文："未闭合', '[未闭合标签']) {
    for (const boundary of ["\n\n", "\n##### 后续核验\n", "\n- "]) {
      const source = `#### 测试纪要\n\n#### 产品讨论\n${opening}${boundary}本纪要未经独立核验。\n`;
      const report = check(source, options("B"));
      assert.deepEqual(report.issues.map(issue => [issue.line, issue.rule]), [[
        source.trimEnd().split("\n").length, "global-process-disclaimer"
      ]], JSON.stringify({ opening, boundary }));
      assert.equal(format(source, options("B")).markdown, source);
    }
  }
});

test("CLI format preserves delivery noise and subsequent check blocks without writing reviewed files", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-notes-delivery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "notes.md");
  const source = "#### 合成纪要\n会议性质：创业项目交流\n#### 产品与技术\n- 已签3份框架协议（原文00:12）。\n";
  fs.writeFileSync(input, source);
  const run = command => spawnSync(process.execPath, [path.join(__dirname, "notes-format.cjs"), command,
    "--input", input, "--profile", "structured-notes", "--mode", "A"], { encoding: "utf8" });
  assert.equal(run("format").stdout, source);
  const checked = run("check");
  assert.equal(checked.status, 1);
  assert.equal(JSON.parse(checked.stdout).code, "DOMI_NOTES_DELIVERY_INVALID");
  assert.equal(fs.readFileSync(input, "utf8"), source);
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
