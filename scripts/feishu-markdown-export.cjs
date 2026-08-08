#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownText(value) {
  return normalizeText(value)
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/gi, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, "");
}

function unquoteDestination(raw) {
  let value = String(raw || "").trim();
  if (value.startsWith("<") && value.includes(">")) value = value.slice(1, value.indexOf(">"));
  else value = value.replace(/\s+(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/, "");
  return value.trim();
}

function classifyImage(source, sourceDir) {
  const value = unquoteDestination(source);
  if (/^https?:\/\//i.test(value)) {
    return { kind: "remote", source: value, requiresRemoteFetchVerification: true };
  }
  if (/^data:/i.test(value)) return { kind: "embedded", source: value, contentHash: sha256(value) };
  let resolved;
  if (/^file:\/\//i.test(value)) {
    try {
      resolved = decodeURIComponent(new URL(value).pathname);
    } catch {
      throw Object.assign(new Error(`无法解析图片地址：${value}`), { code: "INVALID_IMAGE_PATH" });
    }
  } else {
    const decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    resolved = path.isAbsolute(decoded) ? decoded : path.resolve(sourceDir, decoded);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw Object.assign(new Error(`Markdown 引用的图片不存在：${value}`), {
      code: "MISSING_LOCAL_IMAGE",
      image: value
    });
  }
  return {
    kind: "local",
    source: value,
    resolvedPath: resolved,
    byteLength: fs.statSync(resolved).size,
    contentHash: sha256(fs.readFileSync(resolved))
  };
}

function parseMarkdown(content, sourcePath) {
  const normalized = normalizeText(content);
  const sourceDir = path.dirname(sourcePath);
  const codeBlocks = [];
  const withoutCode = normalized.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_match, language, body) => {
    codeBlocks.push({ language: language.trim(), contentHash: sha256(body) });
    return "\n";
  });
  const referenceDefinitions = new Map();
  for (const match of withoutCode.matchAll(/^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+.*)?$/gm)) {
    referenceDefinitions.set(match[1].trim().toLocaleLowerCase(), unquoteDestination(match[2]));
  }

  const indexedImages = [];
  const consumedImageRanges = [];
  for (const match of withoutCode.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    indexedImages.push({ index: match.index, image: { alt: match[1], ...classifyImage(match[2], sourceDir) } });
    consumedImageRanges.push([match.index, match.index + match[0].length]);
  }
  for (const match of withoutCode.matchAll(/!\[([^\]]*)\]\[([^\]]+)\]/g)) {
    const target = referenceDefinitions.get(match[2].trim().toLocaleLowerCase());
    if (!target) {
      throw Object.assign(new Error(`图片引用没有对应定义：[${match[2]}]`), {
        code: "UNRESOLVED_IMAGE_REFERENCE"
      });
    }
    indexedImages.push({ index: match.index, image: { alt: match[1], ...classifyImage(target, sourceDir) } });
    consumedImageRanges.push([match.index, match.index + match[0].length]);
  }
  for (const match of withoutCode.matchAll(/<img\b([^>]*)>/gi)) {
    const attributes = match[1];
    const src = attributes.match(/\bsrc=(?:"([^"]+)"|'([^']+)'|(\S+))/i);
    if (!src) throw Object.assign(new Error("HTML img 缺少 src"), { code: "INVALID_HTML_IMAGE" });
    const alt = attributes.match(/\balt=(?:"([^"]*)"|'([^']*)')/i);
    indexedImages.push({
      index: match.index,
      image: { alt: alt ? (alt[1] || alt[2] || "") : "", ...classifyImage(src[1] || src[2] || src[3], sourceDir) }
    });
    consumedImageRanges.push([match.index, match.index + match[0].length]);
  }
  const imageMasked = [...withoutCode];
  for (const [start, end] of consumedImageRanges) {
    for (let index = start; index < end; index += 1) imageMasked[index] = " ";
  }
  if (/!\[/.test(imageMasked.join(""))) {
    throw Object.assign(new Error("存在当前保真导出器无法解析的图片语法"), {
      code: "UNSUPPORTED_IMAGE_SYNTAX"
    });
  }
  const images = indexedImages.sort((left, right) => left.index - right.index).map((entry) => entry.image);

  const headings = [...withoutCode.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
    level: match[1].length,
    text: match[2].trim()
  }));
  const listItems = [...withoutCode.matchAll(/^\s*((?:[-+*])|(?:\d+[.)]))\s+(?:\[([ xX])\]\s*)?(.+)$/gm)].map((match) => ({
    type: /^\d/.test(match[1]) ? "ordered" : (match[2] === undefined ? "unordered" : "task"),
    checked: match[2] === undefined ? null : /x/i.test(match[2]),
    text: match[3].trim()
  }));
  const links = [...withoutCode.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({
    label: match[1],
    target: unquoteDestination(match[2])
  }));
  const tableRows = withoutCode.split("\n")
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
    .map((line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim()));

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceContentHash: sha256(Buffer.from(content)),
    semanticTextHash: sha256(markdownText(content)),
    counts: {
      headings: headings.length,
      paragraphs: withoutCode.split(/\n{2,}/).filter((block) => block.trim()).length,
      listItems: listItems.length,
      tables: tableRows.length ? 1 : 0,
      tableCells: tableRows.reduce((sum, row) => sum + row.length, 0),
      codeBlocks: codeBlocks.length,
      links: links.length,
      images: images.length,
      blockquotes: [...withoutCode.matchAll(/^\s*>/gm)].length
    },
    headings,
    listItems,
    tableCellHashes: tableRows.flat().map((cell) => sha256(cell)),
    codeBlocks,
    links,
    images
  };
}

function safeWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function buildJob(sourcePath, flags) {
  const absoluteSource = path.resolve(sourcePath);
  if (!fs.existsSync(absoluteSource) || !fs.statSync(absoluteSource).isFile()) {
    throw Object.assign(new Error("找不到源 Markdown 文件"), { code: "SOURCE_NOT_FOUND" });
  }
  if (!/\.md$/i.test(absoluteSource)) {
    throw Object.assign(new Error("保真导出只接受单篇 .md 文件"), { code: "SOURCE_NOT_MARKDOWN" });
  }
  const content = fs.readFileSync(absoluteSource, "utf8");
  const manifest = parseMarkdown(content, absoluteSource);
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactType: "domi.feishuMarkdownPreflight.v1",
    authorization: "none",
    hostMustUseOriginalUserIntent: true,
    hostMustUseCurrentOpenDocument: true,
    capability: "domi.feishuMarkdownExporter.v1",
    action: flags.action === "edit" ? "edit" : "create",
    sourcePath: absoluteSource,
    targetDocument: flags.target || null,
    targetTitle: flags.title || path.basename(absoluteSource, path.extname(absoluteSource)),
    manifest
  };
}

function compareManifest(source, fetched) {
  const mismatches = [];
  for (const key of Object.keys(source.counts)) {
    if (source.counts[key] !== fetched.counts[key]) mismatches.push(`counts.${key}`);
  }
  if (source.semanticTextHash !== fetched.semanticTextHash) mismatches.push("semanticTextHash");
  if (JSON.stringify(source.headings) !== JSON.stringify(fetched.headings)) mismatches.push("headings");
  if (JSON.stringify(source.listItems) !== JSON.stringify(fetched.listItems)) mismatches.push("listItems");
  if (JSON.stringify(source.tableCellHashes) !== JSON.stringify(fetched.tableCellHashes)) mismatches.push("tableCells");
  if (JSON.stringify(source.codeBlocks) !== JSON.stringify(fetched.codeBlocks)) mismatches.push("codeBlocks");
  if (JSON.stringify(source.links) !== JSON.stringify(fetched.links)) mismatches.push("links");
  const sourceImages = source.images.map((image) => image.alt);
  const fetchedImages = fetched.images.map((image) => image.alt);
  if (JSON.stringify(sourceImages) !== JSON.stringify(fetchedImages)) mismatches.push("images");
  return mismatches;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0] || "prepare";
  if (command === "verify") {
    if (!flags.source || !flags.fetched) throw Object.assign(new Error("verify 需要 --source 和 --fetched"), { code: "MISSING_ARGUMENT" });
    const source = parseMarkdown(fs.readFileSync(path.resolve(flags.source), "utf8"), path.resolve(flags.source));
    const fetched = parseMarkdown(fs.readFileSync(path.resolve(flags.fetched), "utf8"), path.resolve(flags.fetched));
    const mismatches = compareManifest(source, fetched);
    print({ ok: mismatches.length === 0, status: mismatches.length ? "partial" : "verified", mismatches });
    if (mismatches.length) process.exitCode = 1;
    return;
  }
  if (!flags.source) throw Object.assign(new Error("需要 --source <单篇 Markdown 文件>"), { code: "MISSING_SOURCE" });
  const job = buildJob(flags.source, flags);
  if (flags.out) safeWriteJson(path.resolve(flags.out), job);
  if (command === "prepare") {
    print({
      ok: true,
      status: "ready_for_app_handoff",
      authorization: "none",
      capability: job.capability,
      manifest: job.manifest.counts,
      outputWritten: Boolean(flags.out)
    });
    return;
  }
  if (command !== "export") throw Object.assign(new Error(`未知命令：${command}`), { code: "UNKNOWN_COMMAND" });
  print({
    ok: false,
    code: "FEISHU_EXPORT_HANDOFF_REQUIRED",
    status: "not_exported",
    requiredCapability: job.capability,
    manifest: job.manifest.counts,
    message: "保真预检已完成。飞书写入只能由 domi App host 根据用户原始明确指令执行；Codex 不接收写凭证，也不会改用低保真直写。"
  });
  process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    print({ ok: false, code: error?.code || "FEISHU_EXPORT_ERROR", error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}

module.exports = {
  buildJob,
  compareManifest,
  parseMarkdown,
  SCHEMA_VERSION
};
