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

function matchesBoundFile(binding) {
  return Boolean(
    binding?.path
    && binding?.sha256
    && fs.existsSync(binding.path)
    && fs.statSync(binding.path).isFile()
    && sha256(binding.path) === binding.sha256
  );
}

function startsWithBytes(filePath, signature) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(signature.length);
    const bytesRead = fs.readSync(fd, buffer, 0, signature.length, 0);
    fs.closeSync(fd);
    return bytesRead === signature.length && buffer.equals(signature);
  } catch {
    return false;
  }
}

function isPdf(filePath) {
  return startsWithBytes(filePath, Buffer.from("%PDF-", "ascii"));
}

function isPptx(filePath) {
  return startsWithBytes(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}

function isRenderedContactSheet(filePath) {
  return startsWithBytes(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    || startsWithBytes(filePath, Buffer.from([0xff, 0xd8, 0xff]))
    || isPdf(filePath);
}

function validPageDetails(receipt) {
  if (!Number.isInteger(receipt?.pages) || receipt.pages <= 0) return false;
  if (receipt.failures !== 0 || receipt.whitespaceWarnings !== 0 || receipt.layoutWarnings !== 0 || receipt.fontFailures !== 0) {
    return false;
  }
  if (!Array.isArray(receipt.structuralFailures) || receipt.structuralFailures.length) return false;
  if (!Array.isArray(receipt.unresolvedPlaceholders) || receipt.unresolvedPlaceholders.length) return false;
  if (!Array.isArray(receipt.details) || receipt.details.length !== receipt.pages) return false;
  return receipt.details.every((page, index) => (
    page?.page === index + 1
    && page?.hasLayoutDeclaration === true
    && page?.template
    && page.template !== "unspecified"
    && page.overflowX === false
    && page.overflowY === false
    && Array.isArray(page.outOfBounds)
    && page.outOfBounds.length === 0
  ));
}

function validStrictReceipt(receipt, input) {
  const htmlSha256 = sha256(input);
  const reviewedPages = receipt?.visualReview?.reviewedPages;
  const allPagesReviewed = Array.isArray(reviewedPages)
    && reviewedPages.length === receipt?.pages
    && reviewedPages.every((pageNumber, index) => pageNumber === index + 1);
  if (
    receipt?.contract !== "DOMI_SLIDES_QA_RECEIPT_V1"
    || receipt?.qaVersion !== 3
    || !receipt?.fontSummary?.expectedLatinFont
    || !(receipt?.fontSummary?.actualRenderedFontsChecked > 0)
    || !Array.isArray(receipt?.fontSummary?.renderedMismatches)
    || receipt.fontSummary.renderedMismatches.length !== 0
    || receipt?.strict !== true
    || receipt?.status !== "passed"
    || receipt?.html?.sha256 !== htmlSha256
    || !validPageDetails(receipt)
    || !matchesBoundFile(receipt?.contentAudit)
    || receipt?.contentAudit?.contractVersion !== "DOMI_SLIDES_CONTENT_AUDIT_V1"
    || receipt?.contentAudit?.status !== "passed"
    || receipt?.contentAudit?.htmlSha256 !== htmlSha256
    || !matchesBoundFile(receipt?.contactSheet)
    || receipt?.contactSheet?.contractVersion !== "DOMI_SLIDES_CONTACT_SHEET_V1"
    || receipt?.contactSheet?.htmlSha256 !== htmlSha256
    || receipt?.contactSheet?.pages !== receipt?.pages
    || receipt?.visualReview?.status !== "passed"
    || receipt?.visualReview?.htmlSha256 !== htmlSha256
    || receipt?.visualReview?.contactSheetSha256 !== receipt?.contactSheet?.sha256
    || typeof receipt?.visualReview?.reviewer !== "string"
    || receipt.visualReview.reviewer.trim().length < 2
    || typeof receipt?.visualReview?.notes !== "string"
    || receipt.visualReview.notes.trim().length < 12
    || !allPagesReviewed
  ) return false;

  const contentAudit = readJson(receipt.contentAudit.path);
  const contactManifest = readJson(receipt.contactSheet.manifestPath);
  return Boolean(
    contentAudit?.contractVersion === "DOMI_SLIDES_CONTENT_AUDIT_V1"
    && contentAudit?.status === "passed"
    && Array.isArray(contentAudit?.failures)
    && contentAudit.failures.length === 0
    && Array.isArray(contentAudit?.warnings)
    && contentAudit.warnings.length === 0
    && contentAudit?.artifacts?.html?.sha256 === htmlSha256
    && receipt.contactSheet?.manifestPath
    && receipt.contactSheet?.manifestSha256
    && matchesBoundFile({
      path: receipt.contactSheet.manifestPath,
      sha256: receipt.contactSheet.manifestSha256,
    })
    && contactManifest?.contractVersion === "DOMI_SLIDES_CONTACT_SHEET_V1"
    && contactManifest?.htmlSha256 === htmlSha256
    && contactManifest?.pages === receipt.pages
    && contactManifest?.contactSheetSha256 === receipt.contactSheet.sha256
  );
}

function preparePptxEvidence({ args, receipt }) {
  function optionValue(name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] || "" : "";
  }
  const pptxOptionIndex = args.indexOf("--pptx");
  if (pptxOptionIndex < 0) return { ok: true, evidence: null };
  const pptxValue = optionValue("--pptx");
  if (!pptxValue || pptxValue.startsWith("--")) {
    return { ok: false, error: "--pptx requires the final PowerPoint file path." };
  }
  const pptxPath = path.resolve(pptxValue);
  if (!fs.existsSync(pptxPath) || !fs.statSync(pptxPath).isFile() || !isPptx(pptxPath)) {
    return { ok: false, error: "Final PPTX is missing or is not a valid Office ZIP file." };
  }

  const contactValue = optionValue("--pptx-contact-sheet");
  const contactSheetPath = contactValue ? path.resolve(contactValue) : "";
  if (!contactSheetPath || !fs.existsSync(contactSheetPath) || !fs.statSync(contactSheetPath).isFile() || !isRenderedContactSheet(contactSheetPath)) {
    return { ok: false, error: "Explicit PPTX delivery requires --pptx-contact-sheet <rendered PNG/JPEG/PDF>." };
  }
  if (receipt?.contactSheet?.path && path.resolve(receipt.contactSheet.path) === contactSheetPath) {
    return { ok: false, error: "PPTX visual evidence must use a separately rendered contact sheet, not the HTML QA contact sheet." };
  }

  const pptxSha256 = sha256(pptxPath);
  const contactSheetSha256 = sha256(contactSheetPath);
  const manifestPath = `${contactSheetPath}.pptx-manifest.json`;
  const manifest = readJson(manifestPath);
  if (
    manifest?.contractVersion !== "DOMI_SLIDES_PPTX_CONTACT_SHEET_V1"
    || manifest?.pptxSha256 !== pptxSha256
    || manifest?.contactSheetSha256 !== contactSheetSha256
    || manifest?.pages !== receipt.pages
  ) {
    writeJsonAtomic(manifestPath, {
      contractVersion: "DOMI_SLIDES_PPTX_CONTACT_SHEET_V1",
      generatedAt: new Date().toISOString(),
      pptxSha256,
      contactSheetSha256,
      pages: receipt.pages,
    });
    return {
      ok: false,
      error: "PPTX contact-sheet manifest was created or refreshed. Inspect every rendered PPTX page, then rerun with explicit PPTX visual-review fields.",
    };
  }

  const reviewStatus = optionValue("--pptx-visual-review-status").trim().toLowerCase();
  const reviewer = optionValue("--pptx-visual-reviewer").trim();
  const notes = optionValue("--pptx-visual-review-notes").trim();
  if (reviewStatus !== "passed" || reviewer.length < 2 || notes.length < 12) {
    return {
      ok: false,
      error: "PPTX visual review requires status=passed, a reviewer, and page-by-page review notes after inspecting the bound contact sheet.",
    };
  }

  return {
    ok: true,
    evidence: {
      pptx: { path: pptxPath, sha256: pptxSha256 },
      contactSheet: {
        path: contactSheetPath,
        sha256: contactSheetSha256,
        manifestPath,
        manifestSha256: sha256(manifestPath),
        contractVersion: "DOMI_SLIDES_PPTX_CONTACT_SHEET_V1",
        pptxSha256,
        pages: receipt.pages,
      },
      visualReview: {
        status: "passed",
        reviewer,
        notes,
        reviewedAt: new Date().toISOString(),
        reviewedPages: Array.from({ length: receipt.pages }, (_, index) => index + 1),
        pptxSha256,
        contactSheetSha256,
      },
    },
  };
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
  const [htmlPath, pdfPath] = args;
  if (!htmlPath || !pdfPath) {
    console.error("Usage: node export_pdf.js <deck.html> <out.pdf> [--receipt <qa-receipt.json>] [--pptx <final.pptx> --pptx-contact-sheet <rendered.png|jpg|pdf> --pptx-visual-review-status passed --pptx-visual-reviewer <name> --pptx-visual-review-notes <notes>]");
    process.exit(2);
  }

  const playwright = loadPlaywright();
  if (!playwright) {
    console.error("Missing dependency: playwright. Install it in the working project or use Codex bundled workspace runtime.");
    process.exit(2);
  }
  const { chromium } = playwright;

  const input = path.resolve(htmlPath);
  const output = path.resolve(pdfPath);
  if (!fs.existsSync(input)) {
    console.error(`HTML not found: ${input}`);
    process.exit(2);
  }

  const receiptOptionIndex = args.indexOf("--receipt");
  const receiptPath = path.resolve(
    receiptOptionIndex >= 0 && args[receiptOptionIndex + 1]
      ? args[receiptOptionIndex + 1]
      : input.replace(/\.html?$/i, "") + ".qa-receipt.json"
  );
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch {
    console.error(`Strict QA receipt not found or unreadable: ${receiptPath}`);
    process.exit(1);
  }
  if (!validStrictReceipt(receipt, input)) {
    console.error("Strict QA receipt does not match the final HTML, content audit, contact sheet, or visual review. Run qa_deck.js --strict again before export.");
    process.exit(1);
  }
  const pptxEvidence = preparePptxEvidence({ args, receipt });
  if (!pptxEvidence.ok) {
    console.error(pptxEvidence.error);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(input).href, { waitUntil: "networkidle" });
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: output,
    width: "11in",
    height: "8.5in",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  await browser.close();
  if (!isPdf(output)) {
    console.error("PDF export did not produce a valid PDF signature; the QA receipt was not updated.");
    process.exit(1);
  }
  receipt.pdf = { path: output, sha256: sha256(output) };
  if (pptxEvidence.evidence) {
    receipt.pptx = pptxEvidence.evidence.pptx;
    receipt.pptxContactSheet = pptxEvidence.evidence.contactSheet;
    receipt.pptxVisualReview = pptxEvidence.evidence.visualReview;
  }
  receipt.exportedAt = new Date().toISOString();
  writeJsonAtomic(receiptPath, receipt);
  console.log(`Exported ${output}`);
  console.log(`Updated QA receipt ${receiptPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  isPdf,
  isPptx,
  isRenderedContactSheet,
  preparePptxEvidence,
  validPageDetails,
  validStrictReceipt,
};
