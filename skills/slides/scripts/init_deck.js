#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const INLINE_STYLE_LOCK_CONTRACT = "DOMI_SLIDES_STYLE_LOCK_V1";

function usage() {
  console.error("Usage: node init_deck.js <output-dir> <deck-name> [--style morgan-stanley]");
  process.exit(2);
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function inlineStyleLock(slidesRoot, stylePackRoot, style) {
  const sharedCss = fs.readFileSync(path.join(slidesRoot, "ms-research.css"), "utf8").trim();
  const packCss = fs.readFileSync(path.join(stylePackRoot, "style.css"), "utf8")
    .replace(/@import\s+(?:url\(\s*)?["']?\.\.\/\.\.\/ms-research\.css["']?\s*\)?\s*;/gi, "")
    .trim();
  const css = [
    `/* ${INLINE_STYLE_LOCK_CONTRACT}: self-contained ${style} style pack */`,
    sharedCss,
    packCss,
  ].join("\n\n");
  if (!/--style-pack\s*:\s*["']morgan-stanley["']/i.test(css)) {
    throw new Error(`Style pack ${style} is missing its CSS style-lock marker.`);
  }
  return [
    `<style id="domi-slides-style-lock" data-domi-style-lock="${INLINE_STYLE_LOCK_CONTRACT}" data-domi-style-pack="${style}" data-domi-style-sha256="${sha256(css)}">`,
    css,
    "</style>",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) usage();

  const outDir = path.resolve(args[0]);
  const deckName = args[1].replace(/\.html$/i, "");
  const styleFlagIndex = args.indexOf("--style");
  const style = styleFlagIndex >= 0 ? args[styleFlagIndex + 1] : "morgan-stanley";
  if (!style) usage();
  if (style !== "morgan-stanley") {
    console.error(`Unknown style pack: ${style}`);
    process.exit(2);
  }

  const skillRoot = path.resolve(__dirname, "..");
  const slidesRoot = path.join(skillRoot, "assets", "slides");
  const stylePackRoot = path.join(slidesRoot, "style-packs", style);
  const htmlOut = path.join(outDir, `${deckName}.html`);

  fs.mkdirSync(outDir, { recursive: true });
  copyRecursive(path.join(slidesRoot, "ms-research.css"), path.join(outDir, "ms-research.css"));
  copyRecursive(path.join(slidesRoot, "page-templates.html"), path.join(outDir, "page-templates.html"));
  copyRecursive(stylePackRoot, path.join(outDir, "style-packs", style));

  let html = fs.readFileSync(path.join(slidesRoot, "base-deck.html"), "utf8");
  const externalStyleLink = /<link\b[^>]*href=["']\.\/style-packs\/morgan-stanley\/style\.css["'][^>]*>/i;
  if (!externalStyleLink.test(html)) {
    throw new Error("Base deck is missing the Morgan Stanley style-pack link placeholder.");
  }
  html = html.replace(externalStyleLink, inlineStyleLock(slidesRoot, stylePackRoot, style));
  fs.writeFileSync(htmlOut, html);

  console.log(`Initialized ${style} deck: ${htmlOut}`);
  console.log(`Self-contained style lock: ${INLINE_STYLE_LOCK_CONTRACT}`);
  console.log(`Templates copied: ${path.join(outDir, "page-templates.html")}`);
  console.log(`Style lock: ${path.join(outDir, "style-packs", style, "style-lock.yml")}`);
}

main();
