// Opt-in macOS integration fixture, not a user deliverable or a QA approval.
// Requires installed Kaiti SC/Calibri, Playwright and DOMI_PDF_PYTHON with fitz.
// Run directly; open its PDF contact sheet before explicitly recording review.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { inspectRenderedFonts } = require("../skills/slides/scripts/qa_deck.js");

(async () => {
  assert.ok(process.env.DOMI_PDF_PYTHON, "Set an isolated Python runtime containing PyMuPDF");
  const { chromium } = require(path.join(process.env.CODEX_NODE_MODULES, "playwright"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-export-proof-"));
  const html = path.join(root, "synthetic.html"), pdf = path.join(root, "synthetic.pdf");
  const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const installedFont = process.env.DOMI_TEST_CALIBRI || "/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts/Calibri.ttf";
  const preparedFont = path.join(root, "Calibri-outline.ttf");
  const originalHash = hash(installedFont);
  const prepare = spawnSync(process.env.DOMI_PDF_PYTHON, [path.resolve(__dirname, "../skills/slides/scripts/prepare-font.py"), installedFont, preparedFont], { encoding: "utf8" });
  assert.equal(prepare.status, 0, prepare.stderr);
  assert.equal(hash(installedFont), originalHash);
  const latinFont = fs.readFileSync(preparedFont).toString("base64");
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:Calibri;src:url(data:font/ttf;base64,${latinFont})}
    @page{size:11in 8.5in;margin:0}*{box-sizing:border-box}body{margin:0}
    .slide{width:1056px;height:816px;padding:55px;page-break-after:always;background:white;color:#083d77}
    h1{font:700 40px "Kaiti SC"}p{font:24px Calibri}section:last-child{page-break-after:auto}
    </style><section class="slide"><h1>工程回归：中文真实粗体</h1><p>Synthetic exporter fixture — page 1 / 2</p></section>
    <section class="slide"><h1>最终文件：字体与分页验证</h1><p>Synthetic exporter fixture — page 2 / 2</p></section>`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(require("node:url").pathToFileURL(html).href);
    await page.evaluate(() => document.fonts.ready);
    const samples = await page.locator(".slide *").evaluateAll(nodes => nodes.map((node, domIndex) => ({
      text: node.textContent, fontWeight: getComputedStyle(node).fontWeight, domIndex
    })));
    assert.deepEqual(await inspectRenderedFonts(page, samples, "Calibri", "Kaiti SC"), []);
    await page.locator(".slide").first().screenshot({ path: path.join(root, "html.png") });
  } finally { await browser.close(); }
  const htmlHash = hash(html), sheet = path.join(root, "html.png");
  const audit = path.join(root, "synthetic-audit.json"), manifest = path.join(root, "synthetic-manifest.json");
  // Synthetic upstream evidence isolates exporter mechanics; it is not the
  // actual content/style QA used for a real deck (this fixture is deliberately sparse).
  json(audit, { contractVersion: "DOMI_SLIDES_CONTENT_AUDIT_V1", status: "passed", failures: [], warnings: [], artifacts: { html: { sha256: htmlHash } } });
  json(manifest, { contractVersion: "DOMI_SLIDES_CONTACT_SHEET_V1", htmlSha256: htmlHash, pages: 2, contactSheetSha256: hash(sheet) });
  const receipt = path.join(root, "synthetic.qa-receipt.json");
  json(receipt, { contract: "DOMI_SLIDES_QA_RECEIPT_V1", qaVersion: 4, pages: 2, strict: true, status: "passed",
    failures: 0, whitespaceWarnings: 0, layoutWarnings: 0, fontFailures: 0, structuralFailures: [], unresolvedPlaceholders: [],
    fontSummary: { expectedLatinFont: "Calibri", expectedCjkFont: "Kaiti SC", trueCjkBoldChecked: true, actualRenderedFontsChecked: 4, renderedMismatches: [], boldCjkTargets: 2 },
    details: [1, 2].map(page => ({ page, width: 1056, height: 816, hasLayoutDeclaration: true, template: "synthetic", overflowX: false, overflowY: false, outOfBounds: [] })),
    html: { path: html, sha256: htmlHash },
    contentAudit: { path: audit, sha256: hash(audit), contractVersion: "DOMI_SLIDES_CONTENT_AUDIT_V1", status: "passed", htmlSha256: htmlHash },
    contactSheet: { path: sheet, sha256: hash(sheet), contractVersion: "DOMI_SLIDES_CONTACT_SHEET_V1", htmlSha256: htmlHash, pages: 2, manifestPath: manifest, manifestSha256: hash(manifest) },
    visualReview: { status: "passed", htmlSha256: htmlHash, contactSheetSha256: hash(sheet), reviewer: "Synthetic test fixture", notes: "Synthetic upstream fields isolate export mechanics, not content approval.", reviewedPages: [1, 2] }
  });
  const exporter = path.resolve(__dirname, "../skills/slides/scripts/export_pdf.js");
  const first = spawnSync(process.execPath, [exporter, html, pdf], { encoding: "utf8", env: process.env });
  assert.equal(first.status, 1);
  assert.match(first.stderr, /Rendered the final PDF/);
  const proof = JSON.parse(fs.readFileSync(`${pdf}.proof.json`, "utf8"));
  assert.equal(proof.status, "passed", JSON.stringify(proof.failures));
  assert.equal(proof.pages.length, 2);
  assert.ok(proof.fonts.every(page => page.fonts.every(font => font.embedded)));
  const second = spawnSync(process.execPath, [exporter, html, pdf], { encoding: "utf8", env: process.env });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /explicit page-by-page visual review/);
  assert.equal(JSON.parse(fs.readFileSync(receipt)).pdfVisualReview, undefined);
  console.log(JSON.stringify({ root, pdf, sheet: `${pdf}.contact-sheet.png`, result: "actual fonts/rendering passed; review intentionally pending" }));
})().catch(error => { console.error(error); process.exitCode = 1; });
