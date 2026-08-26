const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const skillRoot = path.join(root, "skills", "investment-analysis");
const read = (relativePath) => fs.readFileSync(path.join(skillRoot, relativePath), "utf8");

const requiredFiles = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/investment-banking-slides.md",
  "assets/slides/base-deck.html",
  "assets/slides/ms-research.css",
  "assets/slides/style-packs/morgan-stanley/style-lock.yml",
  "assets/slides/style-packs/morgan-stanley/style.css",
  "assets/slides/style-packs/morgan-stanley/templates.html",
  "assets/slides/style-packs/morgan-stanley/layout-index.json",
  "scripts/init_deck.js",
  "scripts/audit_public_equity.py",
  "scripts/audit_research_deck.js",
  "scripts/qa_deck.js",
  "scripts/export_pdf.js",
];

for (const relativePath of requiredFiles) {
  assert.ok(
    fs.statSync(path.join(skillRoot, relativePath)).isFile(),
    `investment-analysis release is missing ${relativePath}`,
  );
}

const skill = read("SKILL.md");
const agent = read("agents/openai.yaml");
const slides = read("references/investment-banking-slides.md");
const initDeck = read("scripts/init_deck.js");

assert.match(agent, /default_prompt: "Use \$domi:investment-analysis\b/);
assert.doesNotMatch(agent, /default_prompt: "Use \$investment-analysis\b/);
assert.match(skill, /slides\/PPT 默认表示报告形态，交付 Morgan Stanley 风格 HTML \+ PDF/);
assert.match(skill, /HTML是唯一事实源/);
assert.match(slides, /DOMI_INVESTMENT_ANALYSIS_ROOT/);
assert.doesNotMatch(slides, /(?:node|python3)\s+~\/\.codex\/skills\/investment-analysis/);
assert.match(slides, /用户未明确要求 PPTX 时，HTML \+ PDF 是 slides 报告的默认且必须交付格式/);
assert.match(slides, /Morgan Stanley 风格应为 `792 x 612 pt \(letter\)`/);
assert.match(slides, /中文字体使用楷体优先/);
assert.match(slides, /英文和数字优先使用 `Calibri`/);
assert.match(initDeck, /const style = .*"morgan-stanley"/);
assert.match(initDeck, /style !== "morgan-stanley"/);

console.log("investment-analysis slides contract tests passed");
