const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const skillRoot = path.join(root, "skills", "slides");
const read = (relativePath) => fs.readFileSync(path.join(skillRoot, relativePath), "utf8");

const requiredFiles = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/investment-banking-slides.md",
  "references/morgan-stanley-ibd-template-notes.md",
  "assets/slides/base-deck.html",
  "assets/slides/ms-research.css",
  "assets/slides/page-templates.html",
  "assets/slides/style-packs/morgan-stanley/style-lock.yml",
  "assets/slides/style-packs/morgan-stanley/style.css",
  "assets/slides/style-packs/morgan-stanley/templates.html",
  "assets/slides/style-packs/morgan-stanley/layout-index.json",
  "assets/slides/style-packs/morgan-stanley/layout-recipes.md",
  "assets/slides/style-packs/morgan-stanley/chart-recipes.md",
  "scripts/init_deck.js",
  "scripts/audit_research_deck.js",
  "scripts/qa_deck.js",
  "scripts/export_pdf.js",
  "scripts/pdf-proof.py",
  "scripts/prepare-font.py",
];

for (const relativePath of requiredFiles) {
  assert.ok(
    fs.statSync(path.join(skillRoot, relativePath)).isFile(),
    `slides release is missing ${relativePath}`,
  );
}

const skill = read("SKILL.md");
const agent = read("agents/openai.yaml");
const slides = read("references/investment-banking-slides.md");
const initDeck = read("scripts/init_deck.js");
const qaDeck = read("scripts/qa_deck.js");
const exportPdf = read("scripts/export_pdf.js");
const auditDeck = read("scripts/audit_research_deck.js");
const {
  renderedFontMatches,
  structuralFailuresFor,
  validContactSheetManifest,
  validateContentAudit,
} = require(path.join(skillRoot, "scripts", "qa_deck.js"));

assert.equal(renderedFontMatches([{ familyName: "Kaiti SC", postScriptName: "STKaitiSC-Regular", glyphCount: 12 }], "Calibri"), false);
assert.equal(renderedFontMatches([{ familyName: "Arial", postScriptName: "ArialMT", glyphCount: 12 }], "Calibri"), false);
assert.equal(renderedFontMatches([{ familyName: "Calibri", postScriptName: "Calibri-Bold", glyphCount: 12 }], "Calibri"), true);
assert.equal(renderedFontMatches([{ familyName: "Calibri", postScriptName: "Calibri", glyphCount: 0 }], "Calibri"), false);
const {
  isPdf,
  isPptx,
  preparePptxEvidence,
} = require(path.join(skillRoot, "scripts", "export_pdf.js"));
const sha256 = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

assert.match(agent, /default_prompt: "Use \$domi:slides\b/);
assert.doesNotMatch(agent, /default_prompt: "Use \$slides\b/);
assert.match(skill, /所有演示文稿任务的唯一制作与验收层/);
assert.match(skill, /默认交付 HTML \+ PDF/);
assert.match(skill, /只有用户明确要求 PPTX/);
assert.match(skill, /通用 `presentations` 只能.*实现后端/);
assert.match(skill, /个人 Skill.*也必须叠加本 Skill/);
assert.match(skill, /明显低密度.*均视为失败/);
assert.match(slides, /DOMI_SLIDES_ROOT/);
assert.doesNotMatch(slides, /(?:node|python3)\s+~\/\.codex\/skills\/(?:investment-analysis|slides)/);
assert.match(slides, /用户未明确要求 PPTX 时，HTML \+ PDF 是 slides 报告的默认且必须交付格式/);
assert.match(slides, /Morgan Stanley 风格应为 `792 x 612 pt \(letter\)`/);
assert.match(slides, /中文字体使用楷体优先/);
assert.match(slides, /英文和数字优先使用 `Calibri`/);
assert.match(initDeck, /const style = .*"morgan-stanley"/);
assert.match(initDeck, /style !== "morgan-stanley"/);
assert.match(initDeck, /DOMI_SLIDES_STYLE_LOCK_V1/);
assert.match(qaDeck, /args\.includes\("--strict"\)/);
assert.match(qaDeck, /strictFailures/);
assert.match(qaDeck, /DOMI_SLIDES_QA_RECEIPT_V1/);
assert.match(qaDeck, /DOMI_SLIDES_CONTENT_AUDIT_V1/);
assert.match(qaDeck, /DOMI_SLIDES_CONTACT_SHEET_V1/);
assert.match(qaDeck, /--visual-review-status/);
assert.match(qaDeck, /contact sheet was generated or refreshed/);
assert.match(auditDeck, /DOMI_SLIDES_CONTENT_AUDIT_V1/);
assert.match(auditDeck, /--output/);
assert.match(exportPdf, /Strict QA receipt.*does not match the final HTML/);
assert.match(exportPdf, /validStrictReceipt/);
assert.match(exportPdf, /receipt\.pdf = \{ path: output, sha256: sha256\(output\) \}/);
assert.match(exportPdf, /receipt\.pptx = pptxEvidence\.evidence\.pptx/);
assert.match(exportPdf, /DOMI_SLIDES_PPTX_CONTACT_SHEET_V1/);
assert.match(exportPdf, /--pptx-contact-sheet/);
assert.match(exportPdf, /--pdf-visual-review-status/);
assert.match(qaDeck, /qaVersion: 4/);
assert.match(qaDeck, /trueCjkBoldChecked/);
assert.match(qaDeck, /syntheticCjkBold/);

assert.deepEqual(
  structuralFailuresFor("<html></html>", []),
  { failures: ["no .slide elements found"], unresolvedPlaceholders: [] },
);
const unresolved = structuralFailuresFor(
  '<section class="slide">{{company_name}}</section>',
  [{ page: 1, template: "unspecified", hasLayoutDeclaration: false }],
);
assert.match(unresolved.failures.join("\n"), /unresolved placeholders/);
assert.match(unresolved.failures.join("\n"), /missing data-template or data-layout/);
assert.match(unresolved.failures.join("\n"), /all slides use the unspecified layout/);
assert.deepEqual(unresolved.unresolvedPlaceholders, ["{{company_name}}"]);
assert.deepEqual(
  structuralFailuresFor(
    '<section class="slide" data-template="ms-cover"></section>',
    [{ page: 1, template: "ms-cover", hasLayoutDeclaration: true }],
  ),
  { failures: [], unresolvedPlaceholders: [] },
);

const qaFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-slides-qa-contract-"));
try {
  const htmlPath = path.join(qaFixtureRoot, "deck.html");
  fs.writeFileSync(htmlPath, '<section class="slide" data-template="ms-cover">complete</section>');
  const htmlSha256 = sha256(htmlPath);
  const auditPath = path.join(qaFixtureRoot, "deck.content-audit.json");
  fs.writeFileSync(auditPath, JSON.stringify({
    contractVersion: "DOMI_SLIDES_CONTENT_AUDIT_V1",
    status: "passed",
    failures: [],
    warnings: [],
    artifacts: { html: { path: htmlPath, sha256: htmlSha256 } },
  }));
  assert.equal(validateContentAudit(auditPath, htmlPath, htmlSha256).ok, true);
  assert.equal(validateContentAudit(auditPath, htmlPath, `${htmlSha256}stale`).ok, false);

  const contactSheetPath = path.join(qaFixtureRoot, "deck.contact-sheet.png");
  fs.writeFileSync(contactSheetPath, "rendered contact sheet");
  const manifestPath = `${contactSheetPath}.manifest.json`;
  fs.writeFileSync(manifestPath, JSON.stringify({
    contractVersion: "DOMI_SLIDES_CONTACT_SHEET_V1",
    htmlSha256,
    pages: 1,
    contactSheetSha256: sha256(contactSheetPath),
  }));
  assert.ok(validContactSheetManifest(manifestPath, contactSheetPath, htmlSha256, 1));
  fs.appendFileSync(contactSheetPath, "tampered");
  assert.equal(validContactSheetManifest(manifestPath, contactSheetPath, htmlSha256, 1), null);
} finally {
  fs.rmSync(qaFixtureRoot, { recursive: true, force: true });
}

const pptxFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-slides-pptx-proof-"));
try {
  const pptxPath = path.join(pptxFixtureRoot, "deck.pptx");
  const contactSheetPath = path.join(pptxFixtureRoot, "deck-pptx-contact-sheet.png");
  fs.writeFileSync(pptxPath, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("fixture")]));
  fs.writeFileSync(contactSheetPath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("fixture"),
  ]));
  assert.equal(isPptx(pptxPath), true);
  assert.equal(isPdf(pptxPath), false);
  const baseArgs = [
    "deck.html",
    "deck.pdf",
    "--pptx", pptxPath,
    "--pptx-contact-sheet", contactSheetPath,
    "--pptx-visual-review-status", "passed",
    "--pptx-visual-reviewer", "Codex QA",
    "--pptx-visual-review-notes", "已逐页检查最终 PPTX 渲染页面并确认通过。",
  ];
  assert.match(
    preparePptxEvidence({ args: baseArgs, receipt: { pages: 1 } }).error,
    /manifest was created or refreshed/,
  );
  const prepared = preparePptxEvidence({ args: baseArgs, receipt: { pages: 1 } });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.evidence.visualReview.status, "passed");
  assert.deepEqual(prepared.evidence.visualReview.reviewedPages, [1]);
  fs.appendFileSync(contactSheetPath, "tampered");
  assert.match(
    preparePptxEvidence({ args: baseArgs, receipt: { pages: 1 } }).error,
    /manifest was created or refreshed/,
  );
} finally {
  fs.rmSync(pptxFixtureRoot, { recursive: true, force: true });
}

const initializedDeckDir = fs.mkdtempSync(path.join(os.tmpdir(), "domi-slides-init-"));
try {
  childProcess.execFileSync(
    process.execPath,
    [path.join(skillRoot, "scripts", "init_deck.js"), initializedDeckDir, "standalone"],
    { stdio: "pipe" },
  );
  const initializedHtml = fs.readFileSync(path.join(initializedDeckDir, "standalone.html"), "utf8");
  const styleMatch = initializedHtml.match(
    /<style\b[^>]*data-domi-style-lock="DOMI_SLIDES_STYLE_LOCK_V1"[^>]*data-domi-style-pack="morgan-stanley"[^>]*data-domi-style-sha256="([a-f0-9]{64})"[^>]*>([\s\S]*?)<\/style>/i,
  );
  assert.ok(styleMatch, "initialized HTML must contain the inline Morgan Stanley style lock");
  assert.equal(
    styleMatch[1],
    crypto.createHash("sha256").update(styleMatch[2].trim(), "utf8").digest("hex"),
    "inline style-lock hash must bind the exact embedded CSS",
  );
  assert.match(styleMatch[2], /@page\s*\{[\s\S]*size:\s*11in 8\.5in/);
  assert.match(styleMatch[2], /--style-pack\s*:\s*"morgan-stanley"/);
  assert.doesNotMatch(initializedHtml, /<link\b[^>]*rel=["']stylesheet["']/i);
  assert.doesNotMatch(initializedHtml, /@import\s+/i);
  assert.ok(fs.existsSync(path.join(initializedDeckDir, "style-packs", "morgan-stanley", "style.css")));
  assert.ok(fs.existsSync(path.join(initializedDeckDir, "page-templates.html")));
  const researchPath = path.join(initializedDeckDir, "research.md");
  fs.writeFileSync(researchPath, [
    "核心结论 产品 证据 数据 风险 验证 来源",
    ...Array.from({ length: 80 }, (_, index) => `| ${index + 1} | synthetic audit fixture |`),
  ].join("\n"));
  const auditHtmlPath = path.join(initializedDeckDir, "embedded-font.html");
  fs.writeFileSync(auditHtmlPath, '<style>@font-face{src:url(data:font/ttf;base64,AA/OCF/GM/IPO/ARR/AA)}</style><script>const FV = 1;</script><section class="slide" data-template="test">产品结论与证据</section>');
  const audit = JSON.parse(childProcess.execFileSync(process.execPath, [
    path.join(skillRoot, "scripts", "audit_research_deck.js"), "--research", researchPath,
    "--html", auditHtmlPath, "--mode", "generic",
  ], { encoding: "utf8" }));
  assert.deepEqual(audit.warnings, [], "embedded fonts and script text are not visible slide acronyms");
} finally {
  fs.rmSync(initializedDeckDir, { recursive: true, force: true });
}

console.log("standalone slides skill contract tests passed");
