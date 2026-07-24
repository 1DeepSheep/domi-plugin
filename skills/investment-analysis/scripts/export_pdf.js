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
  const [htmlPath, pdfPath] = process.argv.slice(2);
  if (!htmlPath || !pdfPath) {
    console.error("Usage: node export_pdf.js <deck.html> <out.pdf>");
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

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 });
  await page.goto(`file://${input}`, { waitUntil: "networkidle" });
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
  console.log(`Exported ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
