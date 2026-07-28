#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MARKER = "domi-task-board-v1";
const LOCAL_DOCUMENT_NAME = "0.待办事项.md";
const STATUSES = new Set(["open", "in_progress", "done", "ignored"]);
const PRIORITIES = new Set(["P1", "P2", "P3"]);
const SOURCE_KINDS = new Set(["project", "person", "news", "manual"]);
const ACTION_KINDS = new Set(["schedule", "research", "contact", "review", "custom"]);
const CATEGORIES = new Set([
  "key-milestone",
  "new-entry",
  "relationship-follow-up",
  "project-follow-up"
]);
const LEGACY_CATEGORIES = new Map([
  ["relationship-milestone", "key-milestone"],
  ["new-project-meeting", "new-entry"],
  ["new-person-meeting", "new-entry"],
  ["person-update", "relationship-follow-up"],
  ["stale-relationship", "relationship-follow-up"],
  ["project-update", "project-follow-up"],
  ["stale-project", "project-follow-up"]
]);

function singleLine(value, limit = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function isoTime(value, fallback = null) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeTask(value = {}, now = new Date().toISOString()) {
  const id = singleLine(value.id, 120);
  const title = singleLine(value.title, 160);
  if (!id || !title) return null;
  const status = STATUSES.has(value.status) ? value.status : "open";
  const priority = PRIORITIES.has(value.priority) ? value.priority : "P3";
  const sourceKind = SOURCE_KINDS.has(value.source?.kind) ? value.source.kind : "manual";
  const dueAt = isoTime(value.dueAt);
  const category = CATEGORIES.has(value.category)
    ? value.category
    : LEGACY_CATEGORIES.get(value.category)
      || (dueAt
        ? "key-milestone"
        : sourceKind === "person"
          ? "relationship-follow-up"
          : "project-follow-up");
  const actionKind = ACTION_KINDS.has(value.suggestedAction?.kind)
    ? value.suggestedAction.kind
    : "custom";
  const task = {
    id,
    title,
    summary: singleLine(value.summary, 500),
    reason: singleLine(value.reason, 800),
    priority,
    category,
    status,
    signalKey: singleLine(value.signalKey, 160),
    source: {
      kind: sourceKind,
      recordId: singleLine(value.source?.recordId, 160),
      displayName: singleLine(value.source?.displayName, 160)
    },
    dueAt,
    suggestedAction: {
      kind: actionKind,
      label: singleLine(value.suggestedAction?.label, 80) || "执行",
      prompt: String(value.suggestedAction?.prompt || "").trim().slice(0, 4000)
    },
    createdAt: isoTime(value.createdAt, now),
    updatedAt: isoTime(value.updatedAt, now)
  };
  if (status === "ignored") task.ignoredAt = isoTime(value.ignoredAt, task.updatedAt);
  if (status === "done") task.completedAt = isoTime(value.completedAt, task.updatedAt);
  return task;
}

function normalizeLedger(value = {}, now = new Date().toISOString()) {
  const seen = new Set();
  const tasks = (Array.isArray(value.tasks) ? value.tasks : [])
    .map((task) => normalizeTask(task, now))
    .filter((task) => task && !seen.has(task.id) && seen.add(task.id));
  return {
    schemaVersion: 1,
    updatedAt: isoTime(value.updatedAt, now),
    tasks
  };
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function encodeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

function parseAttributes(value) {
  const attributes = {};
  for (const match of String(value || "").matchAll(/([A-Za-z0-9_-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attributes[match[1]] = decodeXml(match[3]);
  }
  return attributes;
}

function parseLedgerDocument(value) {
  const candidates = typeof value === "string" ? [value] : collectStrings(value);
  for (const candidate of candidates) {
    if (!candidate.includes(MARKER)) continue;
    for (const match of candidate.matchAll(/<pre\b([^>]*)>\s*<code>([\s\S]*?)<\/code>\s*<\/pre>/gi)) {
      const attributes = parseAttributes(match[1]);
      if (String(attributes.caption || "").trim() !== MARKER) continue;
      try {
        const renderedCode = match[2].replace(/<br\s*\/?>/gi, "\n");
        const ledger = normalizeLedger(JSON.parse(decodeXml(renderedCode)));
        return {
          found: true,
          blockId: singleLine(attributes.id || attributes["block-id"], 200),
          ledger
        };
      } catch (error) {
        return {
          found: false,
          blockId: singleLine(attributes.id || attributes["block-id"], 200),
          ledger: normalizeLedger(),
          error: `待办事项账本 JSON 无法解析：${error.message}`
        };
      }
    }
  }
  return { found: false, blockId: "", ledger: normalizeLedger() };
}

function renderLedger(value) {
  const ledger = normalizeLedger(value);
  const json = JSON.stringify(ledger, null, 2);
  return `<pre lang="json" caption="${MARKER}"><code>${encodeXml(json)}</code></pre>`;
}

function resolveLocalDocumentPath(value) {
  const input = String(value || "");
  if (!path.isAbsolute(input) || path.basename(input) !== LOCAL_DOCUMENT_NAME) {
    throw new Error(`本地待办事项文档必须是绝对路径，且文件名为 ${LOCAL_DOCUMENT_NAME}`);
  }
  const requested = path.resolve(input);
  const stat = fs.lstatSync(requested);
  if (!stat.isFile()) throw new Error(`${LOCAL_DOCUMENT_NAME} 不是普通文件`);
  return requested;
}

function replaceLocalLedgerDocument(content, ledger) {
  let replaced = false;
  const next = String(content || "").replace(
    /<pre\b([^>]*)>\s*<code>[\s\S]*?<\/code>\s*<\/pre>/gi,
    (block, attributesText) => {
      if (replaced || String(parseAttributes(attributesText).caption || "").trim() !== MARKER) return block;
      replaced = true;
      return renderLedger(ledger);
    }
  );
  if (!replaced) throw new Error(`${LOCAL_DOCUMENT_NAME} 缺少 ${MARKER} 数据块`);
  return next;
}

function readLocalLedger(documentPath) {
  const resolved = resolveLocalDocumentPath(documentPath);
  const parsed = parseLedgerDocument(fs.readFileSync(resolved, "utf8"));
  if (!parsed.found) throw new Error(parsed.error || `${LOCAL_DOCUMENT_NAME} 待办事项数据块无法读取`);
  return parsed;
}

function writeLocalLedger(documentPath, ledger) {
  const resolved = resolveLocalDocumentPath(documentPath);
  const existing = fs.readFileSync(resolved, "utf8");
  const next = replaceLocalLedgerDocument(existing, ledger);
  const temporaryPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, next, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, resolved);
  fs.chmodSync(resolved, 0o600);
  return readLocalLedger(resolved);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const command = process.argv[2];
  const input = await readStdin();
  if (command === "parse") {
    let value = input;
    try {
      value = JSON.parse(input);
    } catch {
      // Raw XML is also accepted.
    }
    process.stdout.write(`${JSON.stringify(parseLedgerDocument(value), null, 2)}\n`);
    return;
  }
  if (command === "render") {
    process.stdout.write(`${renderLedger(JSON.parse(input))}\n`);
    return;
  }
  if (command === "local-read") {
    process.stdout.write(`${JSON.stringify(readLocalLedger(process.argv[3]), null, 2)}\n`);
    return;
  }
  if (command === "local-write") {
    process.stdout.write(`${JSON.stringify(writeLocalLedger(process.argv[3], JSON.parse(input)), null, 2)}\n`);
    return;
  }
  throw new Error("Usage: todo-ledger.js <parse|render|local-read|local-write> [0.待办事项.md]");
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MARKER,
  LOCAL_DOCUMENT_NAME,
  normalizeTask,
  normalizeLedger,
  parseLedgerDocument,
  readLocalLedger,
  renderLedger,
  replaceLocalLedgerDocument,
  writeLocalLedger
};
