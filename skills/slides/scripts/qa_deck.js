#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function validateContentAudit(auditPath, htmlPath, htmlSha256) {
  if (!auditPath) {
    return { ok: false, error: "strict QA requires --content-audit <content-audit.json>", binding: null };
  }
  const resolved = path.resolve(auditPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, error: `content audit not found: ${resolved}`, binding: null };
  }
  const audit = readJson(resolved);
  if (!audit) {
    return { ok: false, error: `content audit is not valid JSON: ${resolved}`, binding: null };
  }
  const auditedHtml = audit?.artifacts?.html;
  const issues = [];
  if (audit.contractVersion !== "DOMI_SLIDES_CONTENT_AUDIT_V1") {
    issues.push("content audit contract is not DOMI_SLIDES_CONTENT_AUDIT_V1");
  }
  if (audit.status !== "passed") issues.push(`content audit status is ${audit.status || "missing"}`);
  if (!Array.isArray(audit.failures) || audit.failures.length) issues.push("content audit has failures or no failure ledger");
  if (!Array.isArray(audit.warnings) || audit.warnings.length) issues.push("content audit has warnings or no warning ledger");
  if (!auditedHtml?.path || path.resolve(auditedHtml.path) !== htmlPath) {
    issues.push("content audit points to a different HTML file");
  }
  if (!auditedHtml?.sha256 || auditedHtml.sha256 !== htmlSha256) {
    issues.push("content audit HTML hash is stale");
  }
  return {
    ok: issues.length === 0,
    error: issues.join("; "),
    binding: {
      path: resolved,
      sha256: sha256(resolved),
      contractVersion: audit.contractVersion || "",
      status: audit.status || "",
      htmlSha256: auditedHtml?.sha256 || "",
    },
  };
}

function validContactSheetManifest(manifestPath, contactSheetPath, htmlSha256, pages) {
  if (!fs.existsSync(contactSheetPath) || !fs.existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath);
  if (
    manifest?.contractVersion !== "DOMI_SLIDES_CONTACT_SHEET_V1"
    || manifest?.htmlSha256 !== htmlSha256
    || manifest?.pages !== pages
    || !manifest?.contactSheetSha256
    || manifest.contactSheetSha256 !== sha256(contactSheetPath)
  ) return null;
  return manifest;
}

function structuralFailuresFor(sourceHtml, report) {
  const failures = [];
  const unresolvedPlaceholders = [...new Set(
    [...String(sourceHtml || "").matchAll(/\{\{[^{}\r\n]{1,200}\}\}/g)].map((match) => match[0]),
  )];
  if (!report.length) failures.push("no .slide elements found");
  if (unresolvedPlaceholders.length) {
    failures.push(`unresolved placeholders found: ${unresolvedPlaceholders.join(", ")}`);
  }
  const missingLayoutPages = report.filter((item) => !item.hasLayoutDeclaration).map((item) => item.page);
  if (missingLayoutPages.length) {
    failures.push(`slides missing data-template or data-layout declarations: ${missingLayoutPages.join(", ")}`);
  }
  if (report.length && report.every((item) => item.template === "unspecified")) {
    failures.push("all slides use the unspecified layout");
  }
  return { failures, unresolvedPlaceholders };
}

function renderedFontMatches(fonts, expected) {
  const normalize = (value) => String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
  const wanted = normalize(expected);
  return !wanted || fonts.some((font) => font.glyphCount > 0 && (
    normalize(font.familyName) === wanted
    || normalize(font.postScriptName).startsWith(wanted)
  ));
}

async function inspectRenderedFonts(page, checks, expectedLatinFont, expectedCjkFont) {
  if (!checks.length || (!expectedLatinFont && !expectedCjkFont)) return [];
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeIds } = await session.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ".slide *" });
    const failures = [];
    // Bound concurrency instead of issuing an unbounded request burst for long decks.
    for (let start = 0; start < checks.length; start += 16) {
      await Promise.all(checks.slice(start, start + 16).map(async (sample) => {
        const nodeId = nodeIds[sample.domIndex];
        const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
        const latinMismatch = expectedLatinFont && /[A-Za-z0-9]/.test(sample.text)
          && !renderedFontMatches(fonts, expectedLatinFont);
        const cjkMismatch = expectedCjkFont && /[\u3400-\u9FFF]/.test(sample.text)
          && !renderedFontMatches(fonts, expectedCjkFont);
        const syntheticCjkBold = expectedCjkFont && /[\u3400-\u9FFF]/.test(sample.text)
          && Number(sample.fontWeight) >= 600
          && !fonts.some((font) => renderedFontMatches([font], expectedCjkFont) && /bold|demi|semibold|heavy|black/i.test(font.postScriptName));
        if (latinMismatch || cjkMismatch || syntheticCjkBold) failures.push({
          ...sample,
          actualFonts: fonts.filter((font) => font.glyphCount > 0).map((font) => font.familyName),
          error: syntheticCjkBold ? "Chinese bold text uses a regular font face; embed a real bold CJK face instead of synthetic bold." : `Rendered font does not match ${[latinMismatch && expectedLatinFont, cjkMismatch && expectedCjkFont].filter(Boolean).join(" / ")}; embed the actual font or choose an explicitly permitted fallback.`,
        });
      }));
    }
    return failures;
  } catch (error) {
    return [{ error: `Actual rendered-font verification failed: ${error.message}` }];
  } finally {
    await session.detach();
  }
}

async function renderContactSheet({ browser, page, outputPath, htmlSha256, pages }) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const images = [];
  const slides = page.locator(".slide");
  for (let index = 0; index < pages; index += 1) {
    const buffer = await slides.nth(index).screenshot({ type: "png", animations: "disabled" });
    images.push(buffer.toString("base64"));
  }

  const contactPage = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  await contactPage.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#dfe3e8;font-family:Arial,sans-serif}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}
.item{background:#fff;padding:8px;box-shadow:0 1px 5px rgba(0,0,0,.22)}
.label{font-size:16px;font-weight:700;color:#20252b;margin:0 0 7px}
img{display:block;width:100%;height:auto;border:1px solid #aeb5bc}
</style></head><body><main class="grid">${images.map((image, index) => (
    `<section class="item"><div class="label">Page ${index + 1}</div><img alt="Page ${index + 1}" src="data:image/png;base64,${image}"></section>`
  )).join("")}</main></body></html>`, { waitUntil: "load" });
  await contactPage.screenshot({ path: outputPath, type: "png", fullPage: true, animations: "disabled" });
  await contactPage.close();

  if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).isFile() || fs.statSync(outputPath).size === 0) {
    throw new Error(`contact sheet was not rendered: ${outputPath}`);
  }
  const manifestPath = `${outputPath}.manifest.json`;
  const manifest = {
    contractVersion: "DOMI_SLIDES_CONTACT_SHEET_V1",
    generatedAt: new Date().toISOString(),
    htmlSha256,
    pages,
    contactSheetSha256: sha256(outputPath),
  };
  writeJsonAtomic(manifestPath, manifest);
  return { manifest, manifestPath };
}

function loadPlaywright() {
  const candidates = [
    "playwright",
    process.env.CODEX_NODE_MODULES ? path.join(process.env.CODEX_NODE_MODULES, "playwright") : null,
    process.env.NODE_PATH ? path.join(process.env.NODE_PATH, "playwright") : null,
    path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (err) {
      // Try the next known runtime location.
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const [htmlPath] = args;
  if (!htmlPath) {
    console.error("Usage: node qa_deck.js <deck.html> [--strict] [--receipt <qa-receipt.json>] [--content-audit <content-audit.json>] [--contact-sheet <contact-sheet.png>] [--visual-review-status passed --visual-reviewer <name> --visual-review-notes <notes>] [--require-latin-font Calibri] [--require-cjk-font STKaiti]");
    process.exit(2);
  }

  function optionValue(name) {
    const index = args.indexOf(name);
    if (index === -1) return "";
    return args[index + 1] || "";
  }

  const strict = args.includes("--strict");
  const expectedLatinFont = optionValue("--require-latin-font") || process.env.DECK_REQUIRE_LATIN_FONT || (strict ? "Calibri" : "");
  const expectedCjkFont = optionValue("--require-cjk-font") || process.env.DECK_REQUIRE_CJK_FONT || (strict ? "Kaiti SC" : "");

  const playwright = loadPlaywright();
  if (!playwright) {
    console.error("Missing dependency: playwright. Install it in the working project or use Codex bundled workspace runtime.");
    process.exit(2);
  }
  const { chromium } = playwright;

  const input = path.resolve(htmlPath);
  if (!fs.existsSync(input)) {
    console.error(`HTML not found: ${input}`);
    process.exit(2);
  }
  const htmlSha256 = sha256(input);
  const sourceHtml = fs.readFileSync(input, "utf8");
  const contentAuditValidation = validateContentAudit(
    optionValue("--content-audit"),
    input,
    htmlSha256,
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(input).href, { waitUntil: "networkidle" });
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));

  const qa = await page.evaluate(({ expectedLatinFont, expectedCjkFont }) => {
    const tolerance = 2;
    const slides = [...document.querySelectorAll(".slide")];
    const slideReport = slides.map((slide, index) => {
      const rect = slide.getBoundingClientRect();
      const children = [...slide.querySelectorAll("*")].filter((el) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      });

      const outOfBounds = [];
      const contentRoot = slide.querySelector(".content") || slide;
      const contentRect = contentRoot.getBoundingClientRect();
      let contentBottom = contentRect.top;
      for (const el of children) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const belongsToContent = contentRoot === slide || contentRoot.contains(el);
        const hasDirectText = [...el.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
        );
        const isMeaningfulVisual = el.matches(
          "img,svg,canvas,table,figure,.note-box,.callout,.metric-strip,.chart,.exhibit"
        );
        if (belongsToContent && (hasDirectText || isMeaningfulVisual)) {
          contentBottom = Math.max(contentBottom, r.bottom);
        }
        if (
          r.left < rect.left - tolerance ||
          r.right > rect.right + tolerance ||
          r.top < rect.top - tolerance ||
          r.bottom > rect.bottom + tolerance
        ) {
          outOfBounds.push({
            tag: el.tagName.toLowerCase(),
            className: String(el.className || ""),
            text: (el.textContent || "").trim().slice(0, 80),
            left: Math.round(r.left - rect.left),
            top: Math.round(r.top - rect.top),
            right: Math.round(r.right - rect.left),
            bottom: Math.round(r.bottom - rect.top),
          });
        }
      }

      const overflowY = slide.scrollHeight > slide.clientHeight + tolerance;
      const overflowX = slide.scrollWidth > slide.clientWidth + tolerance;
      const footer = slide.querySelector(".footer")?.getBoundingClientRect();
      const usableBottom = footer?.top || rect.bottom;
      const usableHeight = Math.max(1, usableBottom - contentRect.top);
      const usedHeightRatio = Math.max(0, Math.min(1, (contentBottom - contentRect.top) / usableHeight));
      const density = slide.dataset.density || "";
      const whitespaceWarning = index > 0 && density !== "breathing" && usedHeightRatio < 0.72;
      const title = slide.querySelector(".page-title, .cover-title")?.textContent?.trim() || "";

      const templateAttribute = (slide.getAttribute("data-template") || "").trim();
      const layoutAttribute = (slide.getAttribute("data-layout") || "").trim();
      const layoutDeclaration = templateAttribute || layoutAttribute;
      return {
        page: index + 1,
        template: layoutDeclaration || "unspecified",
        templateAttribute,
        layoutAttribute,
        hasLayoutDeclaration: Boolean(layoutDeclaration && layoutDeclaration.toLowerCase() !== "unspecified"),
        title,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        overflowX,
        overflowY,
        usedHeightRatio: Number(usedHeightRatio.toFixed(2)),
        density,
        whitespaceWarning,
        metricStripCount: slide.querySelectorAll(".metric-strip").length,
        outOfBounds,
      };
    });

    const allElements = [...document.querySelectorAll(".slide *")];
    const fontTargets = allElements.filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      return [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    });

    const fontSamples = [];
    const uniqueFontFamilies = new Set();
    const latinMismatches = [];
    const cjkMismatches = [];
    const renderedChecks = [];

    for (const el of fontTargets) {
      const text = [...el.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 80);
      if (!text) continue;

      const cs = getComputedStyle(el);
      const fontFamily = cs.fontFamily || "";
      const fontWeight = cs.fontWeight || "";
      const pageEl = el.closest(".slide");
      const page = pageEl ? slides.indexOf(pageEl) + 1 : null;
      const sample = {
        page,
        tag: el.tagName.toLowerCase(),
        className: String(el.className || ""),
        text,
        fontFamily,
        fontWeight,
      };

      uniqueFontFamilies.add(fontFamily);
      if ((expectedLatinFont && /[A-Za-z0-9]/.test(text)) || (expectedCjkFont && /[\u3400-\u9FFF]/.test(text))) {
        renderedChecks.push({ ...sample, domIndex: allElements.indexOf(el) });
      }
      if (fontSamples.length < 24) fontSamples.push(sample);

      if (expectedLatinFont && /[A-Za-z0-9]/.test(text) && !fontFamily.toLowerCase().includes(expectedLatinFont.toLowerCase())) {
        if (latinMismatches.length < 30) latinMismatches.push(sample);
      }
      // CJK faces may use DeckCJKTitle aliases. The actual CDP font record,
      // not the alias in CSS, is authoritative for family and true bold.
    }

    return {
      slideReport,
      renderedChecks,
      fontReport: {
        expectedLatinFont,
        expectedCjkFont,
        checkedTargets: fontTargets.length,
        uniqueFontFamilies: [...uniqueFontFamilies].sort(),
        samples: fontSamples,
        latinMismatches,
        cjkMismatches,
      },
    };
  }, { expectedLatinFont, expectedCjkFont });

  qa.fontReport.renderedMismatches = await inspectRenderedFonts(page, qa.renderedChecks, expectedLatinFont, expectedCjkFont);
  qa.fontReport.actualRenderedFontsChecked = qa.renderedChecks.length;
  qa.fontReport.cjkTargets = qa.renderedChecks.filter((sample) => /[\u3400-\u9FFF]/.test(sample.text)).length;
  qa.fontReport.boldCjkTargets = qa.renderedChecks.filter((sample) => /[\u3400-\u9FFF]/.test(sample.text) && Number(sample.fontWeight) >= 600).length;
  qa.fontReport.trueCjkBoldChecked = true;

  const report = qa.slideReport;
  const contactSheetPath = path.resolve(
    optionValue("--contact-sheet") || input.replace(/\.html?$/i, "") + ".contact-sheet.png",
  );
  const contactSheetManifestPath = `${contactSheetPath}.manifest.json`;
  const existingContactSheet = report.length
    ? validContactSheetManifest(contactSheetManifestPath, contactSheetPath, htmlSha256, report.length)
    : null;
  let contactSheetWasRegenerated = false;
  let contactSheetManifest = existingContactSheet;
  if (report.length && (!existingContactSheet || args.includes("--regenerate-contact-sheet"))) {
    const rendered = await renderContactSheet({
      browser,
      page,
      outputPath: contactSheetPath,
      htmlSha256,
      pages: report.length,
    });
    contactSheetManifest = rendered.manifest;
    contactSheetWasRegenerated = true;
  }

  await browser.close();

  const failures = report.filter((item) => item.overflowX || item.overflowY || item.outOfBounds.length);
  const warnings = report.filter((item) => item.whitespaceWarning);
  const fontFailures = [
    ...qa.fontReport.latinMismatches,
    ...qa.fontReport.cjkMismatches,
    ...qa.fontReport.renderedMismatches,
  ];
  const structural = structuralFailuresFor(sourceHtml, report);
  const structuralFailures = structural.failures;
  const unresolvedPlaceholders = structural.unresolvedPlaceholders;
  const templateCounts = {};
  for (const item of report) {
    templateCounts[item.template] = (templateCounts[item.template] || 0) + 1;
  }

  const metricStripPages = report.filter((item) => item.metricStripCount > 0).map((item) => item.page);
  const metricStripRatio = report.length ? metricStripPages.length / report.length : 0;
  const consecutiveSameTemplates = [];
  let currentTemplate = "";
  let currentStart = 0;
  let currentCount = 0;
  for (const item of report) {
    if (item.template === currentTemplate) {
      currentCount += 1;
    } else {
      if (currentTemplate && currentTemplate !== "unspecified" && currentCount > 2) {
        consecutiveSameTemplates.push({
          template: currentTemplate,
          pages: [currentStart, currentStart + currentCount - 1],
          count: currentCount,
        });
      }
      currentTemplate = item.template;
      currentStart = item.page;
      currentCount = 1;
    }
  }
  if (currentTemplate && currentTemplate !== "unspecified" && currentCount > 2) {
    consecutiveSameTemplates.push({
      template: currentTemplate,
      pages: [currentStart, currentStart + currentCount - 1],
      count: currentCount,
    });
  }

  const uniqueSpecifiedTemplates = Object.keys(templateCounts).filter((template) => template !== "unspecified").length;
  const layoutWarnings = [];
  if (report.length >= 8 && metricStripRatio > 0.3) {
    layoutWarnings.push({
      type: "excessive_metric_strip_ratio",
      message: `Metric strips appear on ${metricStripPages.length}/${report.length} pages (${Math.round(metricStripRatio * 100)}%). Morgan Stanley style pack recommends <=30%.`,
      pages: metricStripPages,
    });
  }
  for (const run of consecutiveSameTemplates) {
    layoutWarnings.push({
      type: "consecutive_same_template",
      message: `${run.template} is used for ${run.count} consecutive pages (${run.pages[0]}-${run.pages[1]}). Vary layout family or merge pages.`,
      pages: run.pages,
    });
  }
  if (report.length >= 12 && uniqueSpecifiedTemplates < 5) {
    layoutWarnings.push({
      type: "low_layout_diversity",
      message: `Only ${uniqueSpecifiedTemplates} specified layout templates found across ${report.length} pages. Use at least five layout families for long decks.`,
      templates: templateCounts,
    });
  }

  const visualReviewStatus = optionValue("--visual-review-status").trim().toLowerCase();
  const visualReviewer = optionValue("--visual-reviewer").trim();
  const visualReviewNotes = optionValue("--visual-review-notes").trim();
  const visualReviewFailures = [];
  if (!report.length || !contactSheetManifest) {
    visualReviewFailures.push("contact sheet is unavailable");
  } else if (contactSheetWasRegenerated) {
    visualReviewFailures.push("contact sheet was generated or refreshed; inspect it page by page, then rerun strict QA with explicit visual review fields");
  } else {
    if (visualReviewStatus !== "passed") visualReviewFailures.push("--visual-review-status must be passed after inspection");
    if (visualReviewer.length < 2) visualReviewFailures.push("--visual-reviewer is required after inspection");
    if (visualReviewNotes.length < 12) visualReviewFailures.push("--visual-review-notes must record the completed page-by-page inspection");
  }
  const visualReviewPassed = visualReviewFailures.length === 0;

  const summary = {
    contract: "DOMI_SLIDES_QA_RECEIPT_V1",
    qaVersion: 4,
    strict,
    status: "pending",
    generatedAt: new Date().toISOString(),
    html: {
      path: input,
      sha256: htmlSha256,
    },
    contentAudit: contentAuditValidation.binding,
    contactSheet: contactSheetManifest ? {
      path: contactSheetPath,
      sha256: sha256(contactSheetPath),
      manifestPath: contactSheetManifestPath,
      manifestSha256: sha256(contactSheetManifestPath),
      contractVersion: contactSheetManifest.contractVersion,
      htmlSha256: contactSheetManifest.htmlSha256,
      pages: contactSheetManifest.pages,
      regeneratedThisRun: contactSheetWasRegenerated,
    } : null,
    visualReview: {
      status: visualReviewPassed ? "passed" : visualReviewStatus === "failed" ? "failed" : "pending",
      reviewer: visualReviewer,
      notes: visualReviewNotes,
      reviewedAt: visualReviewPassed ? new Date().toISOString() : null,
      reviewedPages: visualReviewPassed ? report.map((item) => item.page) : [],
      htmlSha256,
      contactSheetSha256: contactSheetManifest ? sha256(contactSheetPath) : "",
      failures: visualReviewFailures,
    },
    pages: report.length,
    failures: failures.length,
    structuralFailures,
    unresolvedPlaceholders,
    whitespaceWarnings: warnings.length,
    layoutWarnings: layoutWarnings.length,
    fontFailures: fontFailures.length,
    layoutSummary: {
      templateCounts,
      metricStripPages,
      metricStripRatio: Number(metricStripRatio.toFixed(2)),
      consecutiveSameTemplates,
      warnings: layoutWarnings,
    },
    fontSummary: qa.fontReport,
    details: report,
  };

  const strictFailures = strict ? [
    ...warnings,
    ...layoutWarnings,
    ...structuralFailures,
    ...(contentAuditValidation.ok ? [] : [contentAuditValidation.error]),
    ...visualReviewFailures,
  ] : [];
  summary.status = failures.length || fontFailures.length || strictFailures.length ? "failed" : "passed";
  const receiptPath = optionValue("--receipt")
    || (strict ? input.replace(/\.html?$/i, "") + ".qa-receipt.json" : "");
  if (receiptPath) writeJsonAtomic(path.resolve(receiptPath), summary);

  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== "passed") process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  inspectRenderedFonts,
  renderedFontMatches,
  structuralFailuresFor,
  validateContentAudit,
  validContactSheetManifest,
};
