#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

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
    console.error("Usage: node qa_deck.js <deck.html> [--require-latin-font Calibri] [--require-cjk-font STKaiti]");
    process.exit(2);
  }

  function optionValue(name) {
    const index = args.indexOf(name);
    if (index === -1) return "";
    return args[index + 1] || "";
  }

  const expectedLatinFont = optionValue("--require-latin-font") || process.env.DECK_REQUIRE_LATIN_FONT || "";
  const expectedCjkFont = optionValue("--require-cjk-font") || process.env.DECK_REQUIRE_CJK_FONT || "";

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

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 });
  await page.goto(`file://${input}`, { waitUntil: "networkidle" });
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
      let contentBottom = rect.top;
      for (const el of children) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        contentBottom = Math.max(contentBottom, r.bottom);
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
      const usedHeightRatio = Math.max(0, Math.min(1, (contentBottom - rect.top) / rect.height));
      const whitespaceWarning = index > 0 && usedHeightRatio < 0.72;
      const title = slide.querySelector(".page-title, .cover-title")?.textContent?.trim() || "";

      return {
        page: index + 1,
        template: slide.dataset.template || slide.getAttribute("data-template") || "unspecified",
        title,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        overflowX,
        overflowY,
        usedHeightRatio: Number(usedHeightRatio.toFixed(2)),
        whitespaceWarning,
        metricStripCount: slide.querySelectorAll(".metric-strip").length,
        outOfBounds,
      };
    });

    const fontTargets = [...document.querySelectorAll(".slide *")].filter((el) => {
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
      if (fontSamples.length < 24) fontSamples.push(sample);

      if (expectedLatinFont && /[A-Za-z0-9]/.test(text) && !fontFamily.toLowerCase().includes(expectedLatinFont.toLowerCase())) {
        if (latinMismatches.length < 30) latinMismatches.push(sample);
      }
      if (expectedCjkFont && /[\u3400-\u9FFF]/.test(text) && !fontFamily.toLowerCase().includes(expectedCjkFont.toLowerCase())) {
        if (cjkMismatches.length < 30) cjkMismatches.push(sample);
      }
    }

    return {
      slideReport,
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

  const report = qa.slideReport;

  await browser.close();

  const failures = report.filter((item) => item.overflowX || item.overflowY || item.outOfBounds.length);
  const warnings = report.filter((item) => item.whitespaceWarning);
  const fontFailures = [
    ...qa.fontReport.latinMismatches,
    ...qa.fontReport.cjkMismatches,
  ];
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

  const summary = {
    pages: report.length,
    failures: failures.length,
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

  console.log(JSON.stringify(summary, null, 2));
  if (failures.length || fontFailures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
