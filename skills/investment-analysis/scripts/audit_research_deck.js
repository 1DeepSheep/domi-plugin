#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function usage() {
  console.error("Usage: audit_research_deck.js --research <research.md> [--contract <slide_contract.md>] [--html <deck.html>] [--mode prospectus] [--strict --evidence <evidence_ledger.md> --entities <entity_map.md> --policy <calculation_policy.md> --checklist <disclosure_checklist.md>]");
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = { mode: "prospectus" };
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  const val = args[i + 1];
  if (key === "--research") opts.research = val, i += 1;
  else if (key === "--contract") opts.contract = val, i += 1;
  else if (key === "--html") opts.html = val, i += 1;
  else if (key === "--mode") opts.mode = val, i += 1;
  else if (key === "--evidence") opts.evidence = val, i += 1;
  else if (key === "--entities") opts.entities = val, i += 1;
  else if (key === "--policy") opts.policy = val, i += 1;
  else if (key === "--checklist") opts.checklist = val, i += 1;
  else if (key === "--strict") opts.strict = true;
  else usage();
}
if (!opts.research) usage();

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    return null;
  }
}

function hasAny(text, needles) {
  return needles.some((n) => text.includes(n));
}

function semanticNormalize(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[`*_#>]/g, "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。；：、,.!?！？;:“”‘’"'（）()【】\[\]—–-]/g, "")
    .toLowerCase();
}

function regexAny(text, regexes) {
  return regexes.some((regex) => regex.test(text));
}

function checkControlFile(label, file, signals) {
  if (!file) {
    failures.push(`strict mode requires --${label} <file>`);
    return;
  }
  const content = read(file);
  if (!content) {
    failures.push(`${label} file not readable: ${file}`);
    return;
  }
  for (const [signalLabel, needles] of signals) {
    if (!hasAny(content, needles)) failures.push(`${label} missing field/signals: ${signalLabel}`);
  }
}

const failures = [];
const warnings = [];
const research = read(opts.research);
if (!research) {
  failures.push(`research file not readable: ${opts.research}`);
} else {
  const lines = research.split(/\r?\n/).filter((l) => l.trim()).length;
  const minLines = opts.mode === "prospectus" ? 180 : 100;
  if (lines < minLines) failures.push(`research too short: ${lines} non-empty lines; expected >= ${minLines} for ${opts.mode}`);

  const requiredSections = [
    ["业务与商业模式", ["业务", "商业模式", "收入来源"]],
    ["关键经营指标", ["经营指标", "KPI", "运营指标", "ARPU", "ARPC", "销量", "客户数"]],
    ["核心财务画像/三张表", ["利润表", "资产负债表", "现金流", "财务模型"]],
    ["成本费用与UE", ["成本", "费用", "UE", "单位经济", "毛利"]],
    ["财务质量/working capital", ["财务质量", "working capital", "营运资金", "应收", "应付", "DSO", "DPO"]],
    ["客户/供应商", ["客户", "供应商", "前五大", "五大客户", "五大供应商"]],
    ["融资与股东回报", ["融资", "股东回报", "IRR", "老股", "投前", "投后"]],
    ["股东结构与解禁", ["股东结构", "解禁", "禁售", "锁定"]],
    ["竞争与行业格局", ["竞争", "竞对", "行业格局", "市场份额"]],
    ["市场观点与外部争议", ["市场观点", "外部观点", "外部争议", "媒体", "估值争议"]],
    ["风险/验证清单", ["风险", "验证清单", "跟踪指标", "后续验证"]],
  ];
  for (const [label, needles] of requiredSections) {
    if (!hasAny(research, needles)) failures.push(`missing research section/signals: ${label}`);
  }

  const tableCount = (research.match(/\|[^\n]*\|/g) || []).length;
  if (tableCount < 25) warnings.push(`few markdown table rows: ${tableCount}; verify key analysis is quantified`);

  if (opts.mode === "prospectus") {
    const directAnswerChecks = [
      ["highest return multiple", [/倍数.{0,30}最高/, /最高.{0,30}倍数/]],
      ["highest IRR", [/IRR.{0,30}最高/i, /最高.{0,30}IRR/i, /年化内部收益率.{0,30}最高/]],
      ["highest round absolute value creation", [/(整轮|轮次).{0,40}(绝对|账面).{0,20}最高/, /(绝对|账面).{0,20}最高.{0,30}(整轮|轮次)/]],
      ["highest institution absolute value creation", [/(机构|投资人).{0,40}(绝对|账面).{0,20}最高/, /(绝对|账面).{0,20}最高.{0,30}(机构|投资人)/]],
      ["largest external investor", [/最大外部.{0,20}投资/, /外部.{0,20}最大.{0,20}投资/]],
    ];
    for (const [label, regexes] of directAnswerChecks) {
      if (!regexAny(research, regexes)) failures.push(`missing explicit financing direct answer: ${label}`);
    }
    if (research.includes("发行价") && !hasAny(research, ["发行市值", "发行时市值"])) {
      failures.push("issue price is present but issue market cap is missing; return terminal value is incomplete");
    }
    if (/未实现增值/.test(research) && !/发行价口径.{0,20}(账面增值|持股市值)/.test(research)) {
      warnings.push("'未实现增值' found without explicit issue-price book-gain terminology");
    }
    if (/(最近|最后|C-\d+|B[+-]?\d*).{0,30}(回报锚|收益锚|估值锚)/i.test(research)) {
      warnings.push("private-round valuation anchor detected; ensure it is used only for financing price path, not IPO return terminal value");
    }
  }
}

if (opts.strict) {
  checkControlFile("evidence", opts.evidence, [
    ["claim/source", ["claim_id", "来源文件", "source"]],
    ["page/section", ["页码", "章节", "page"]],
    ["period/unit", ["期间", "单位", "period", "unit"]],
  ]);
  checkControlFile("entities", opts.entities, [
    ["raw/display names", ["raw_name", "display_name", "招股书原名", "统一展示名"]],
    ["evidence/confidence", ["evidence", "confidence", "证据", "置信度"]],
    ["aliases/parent", ["aliases", "parent", "别名", "控制集团", "品牌"]],
  ]);
  checkControlFile("policy", opts.policy, [
    ["terminal value", ["Terminal value", "终值口径", "发行市值"]],
    ["IRR date rule", ["投资日期", "协议日", "IRR"]],
    ["realized/book terminology", ["已实现", "账面增值", "持股市值"]],
  ]);
  checkControlFile("checklist", opts.checklist, [
    ["status", ["complete", "not disclosed", "needs verification", "状态"]],
    ["customer/supplier", ["客户", "供应商", "customer", "supplier"]],
    ["financing/competition/statements", ["融资", "竞对", "财务报表", "financing", "competition"]],
  ]);
}

let contractText = null;
if (opts.contract) {
  const contract = read(opts.contract);
  contractText = contract;
  if (!contract) {
    failures.push(`contract file not readable: ${opts.contract}`);
  } else {
    const lines = contract.split(/\r?\n/).filter((l) => l.trim()).length;
    if (lines < 80) failures.push(`slide contract too short: ${lines} non-empty lines; likely page-list only`);
    const requiredContractSignals = [
      ["观点标题/thesis", ["观点标题", "thesis", "Thesis"]],
      ["底稿映射", ["底稿", "research", "对应章节", "mapping", "映射"]],
      ["必须保留数据", ["必须保留", "关键数字", "must", "保留数字"]],
      ["主图/主表", ["主图", "主表", "chart", "table", "exhibit"]],
      ["来源", ["来源", "source", "Source"]],
      ["删减说明", ["删减", "omit", "取舍", "遗漏"]],
      ["必须出现/直接答案", ["必须出现", "must appear", "直接答案"]],
    ];
    for (const [label, needles] of requiredContractSignals) {
      if (!hasAny(contract, needles)) failures.push(`slide contract missing field: ${label}`);
    }
    if (!hasAny(contract, ["覆盖矩阵", "coverage matrix", "coverage", "覆盖"])) {
      failures.push("missing coverage matrix in slide contract");
    }
  }
}

if (opts.html) {
  const html = read(opts.html);
  if (!html) {
    warnings.push(`html file not readable: ${opts.html}`);
  } else {
    const genericBrandSignals = ["Investment Analysis", "CODEX INVESTMENT", "CODEX INVESTMENT-ANALYSIS"];
    const hits = genericBrandSignals.filter((s) => html.includes(s));
    if (hits.length) warnings.push(`generic/old brand placeholders found: ${hits.join(", ")}`);
    const slideCount = (html.match(/class=["'][^"']*\bslide\b/g) || []).length;
    const templateCount = new Set([...html.matchAll(/data-template=["']([^"']+)/g)].map((m) => m[1])).size;
    if (slideCount >= 12 && templateCount < 5) warnings.push(`low layout variety: ${templateCount} templates across ${slideCount} slides`);

    if (contractText) {
      const mustAppear = [];
      for (const line of contractText.split(/\r?\n/)) {
        const match = line.match(/(?:必须出现|must appear)\s*[:：]\s*(.+)$/i);
        if (!match) continue;
        for (const phrase of match[1].split("||")) {
          const clean = phrase.trim().replace(/^[`'"“”]+|[`'"“”]+$/g, "");
          if (clean && !/^无$|^n\/?a$/i.test(clean)) mustAppear.push(clean);
        }
      }
      if (!mustAppear.length) failures.push("slide contract has no parseable must-appear phrases");
      const normalizedHtml = semanticNormalize(html);
      for (const phrase of mustAppear) {
        if (!normalizedHtml.includes(semanticNormalize(phrase))) failures.push(`must-appear phrase missing from HTML: ${phrase}`);
      }
    }

    const acronymRules = [
      ["OCF", "Operating Cash Flow", "经营现金流"],
      ["FV", "Fair Value", "公允价值"],
      ["DSO", "Days Sales Outstanding", "应收周转天数"],
      ["DPO", "Days Payable Outstanding", "应付周转天数"],
      ["GM", "Gross Margin", "毛利率"],
      ["R&D", "Research and Development", "研发"],
      ["IPO", "Initial Public Offering", "首次公开募股"],
      ["SOP", "Start of Production", "量产"],
      ["ARR", "Annual Recurring Revenue", "年度经常性收入"],
    ];
    const visibleText = html.replace(/<[^>]+>/g, " ");
    for (const [abbr, english, chinese] of acronymRules) {
      const present = new RegExp(`(^|[^A-Za-z])${abbr.replace(/[&]/g, "\\&")}([^A-Za-z]|$)`, "i").test(visibleText);
      if (present && (!visibleText.includes(english) || !visibleText.includes(chinese))) {
        const message = `acronym ${abbr} appears without both '${english}' and Chinese meaning '${chinese}'`;
        if (opts.strict) failures.push(message); else warnings.push(message);
      }
    }
  }
}

const result = {
  research: opts.research ? path.resolve(opts.research) : null,
  contract: opts.contract ? path.resolve(opts.contract) : null,
  html: opts.html ? path.resolve(opts.html) : null,
  evidence: opts.evidence ? path.resolve(opts.evidence) : null,
  entities: opts.entities ? path.resolve(opts.entities) : null,
  policy: opts.policy ? path.resolve(opts.policy) : null,
  checklist: opts.checklist ? path.resolve(opts.checklist) : null,
  strict: Boolean(opts.strict),
  failures,
  warnings,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
