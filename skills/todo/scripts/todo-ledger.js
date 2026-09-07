#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { acquireProcessLock } = require("../../../scripts/process-lock.cjs");

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
    purposeKey: singleLine(value.purposeKey, 160),
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function ledgerHash(ledger) { return sha256(stableJson(ledger)); }
const DAY = 86400000;
const taskKey = task => [task.category, task.source.kind, task.source.recordId, task.signalKey].join("|");
const contactKey = task => ["schedule", "contact"].includes(task.suggestedAction.kind)
  ? [task.source.kind, task.source.recordId, task.purposeKey || "contact"].join("|") : "";

// Semantic judgments arrive as an explicit reviewed proposal. This function only
// enforces dates, lifecycle, deduplication and quotas; it never certifies evidence.
function mergeLedger(input = {}) {
  const now = isoTime(input.now);
  if (!now) throw new Error("merge requires an explicit ISO now");
  if (!Array.isArray(input.candidates)) throw new Error("merge requires candidates[]");
  const ledger = normalizeLedger(input.ledger, now);
  const tasks = ledger.tasks.map(task => ({ ...task }));
  const diagnostics = [];
  const additions = [];
  const epoch = Date.parse(now);
  for (const candidate of input.candidates) {
    const raw = candidate?.task;
    const review = candidate?.review;
    if (!raw || review?.status !== "passed" || !Array.isArray(review.sourceRefs) || !review.sourceRefs.length
        || review.sourceRefs.some(ref => typeof ref !== "string" || !ref.trim())) {
      diagnostics.push({ id: raw?.id || null, reason: "semantic_review_required" }); continue;
    }
    const id = raw.id || `task-${sha256(JSON.stringify([raw.category, raw.source, raw.signalKey])).slice(0, 24)}`;
    const next = normalizeTask({ ...raw, id, status: "open", createdAt: now, updatedAt: now }, now);
    if (!next || !next.signalKey || !next.source.recordId || !next.reason || !next.suggestedAction.prompt) {
      diagnostics.push({ id, reason: "incomplete_candidate" }); continue;
    }
    if (raw.dueAt && (!next.dueAt || review.dateVerified !== true)) {
      diagnostics.push({ id, reason: "unverified_date" }); continue;
    }
    if (next.category === "new-entry") {
      const created = typeof review.sourceCreatedAt === "number" ? review.sourceCreatedAt : Date.parse(review.sourceCreatedAt);
      if (!Number.isFinite(created) || created > epoch || created < epoch - 28 * DAY || review.valueVerified !== true) {
        diagnostics.push({ id, reason: "new_entry_evidence_required" }); continue;
      }
    }
    const days = next.dueAt ? (Date.parse(next.dueAt) - epoch) / DAY : Infinity;
    if (next.dueAt && days <= 7) next.priority = "P1";
    else if (next.dueAt && days <= 14 && !review.majorEvent && !review.commitment) next.priority = "P2";
    else if (next.priority === "P1" && !review.majorEvent && !review.commitment) next.priority = "P2";
    let existing = tasks.find(task => taskKey(task) === taskKey(next));
    const byId = tasks.find(task => task.id === next.id);
    if (byId && existing !== byId) { diagnostics.push({ id, reason: "id_conflict" }); continue; }
    if (!existing && contactKey(next)) {
      existing = tasks.find(task => contactKey(task) === contactKey(next));
    }
    if (existing) {
      if (existing.status === "in_progress") { diagnostics.push({ id: existing.id, reason: "in_progress_preserved" }); continue; }
      if (existing.status === "ignored" && epoch - Date.parse(existing.ignoredAt) < 30 * DAY) {
        diagnostics.push({ id: existing.id, reason: "ignored_cooldown" }); continue;
      }
      if (existing.status === "done" && !(review.newEvent === true && existing.signalKey !== next.signalKey)) {
        diagnostics.push({ id: existing.id, reason: "completed_signal_preserved" }); continue;
      }
      const dueAt = review.dateCancelled === true ? null
        : review.dateChanged === true && review.dateVerified === true ? next.dueAt
          : existing.dueAt || next.dueAt;
      let category = next.category;
      const dueSoon = dueAt && (Date.parse(dueAt) - epoch) <= 14 * DAY;
      if (contactKey(existing) && contactKey(existing) === contactKey(next)) {
        if (dueSoon && [existing.category, next.category].includes("key-milestone")) category = "key-milestone";
        else if ([existing.category, next.category].includes("new-entry")) category = "new-entry";
        else category = existing.category;
      }
      const updated = normalizeTask({ ...existing, ...next, id: existing.id, category, dueAt,
        reason: existing.reason === next.reason ? next.reason : `${existing.reason}；${next.reason}`,
        status: review.signalInvalidated === true ? "done" : "open", createdAt: existing.createdAt,
        completedAt: review.signalInvalidated === true ? now : undefined, updatedAt: now }, now);
      tasks[tasks.indexOf(existing)] = updated;
      continue;
    }
    if (review.signalInvalidated === true) { diagnostics.push({ id, reason: "invalidated_signal" }); continue; }
    const duplicate = additions.find(item => taskKey(item.task) === taskKey(next) || (contactKey(next) && contactKey(item.task) === contactKey(next)));
    if (duplicate) {
      // Reuse the exact same merge rules for cross-category proposals before quotas.
      const merged = mergeLedger({ ledger: { tasks: [duplicate.task] }, now, candidates: [candidate] });
      duplicate.task = merged.ledger.tasks[0];
      diagnostics.push(...merged.diagnostics);
    } else additions.push({ task: next, strength: Number(review.evidenceStrength) || 0 });
  }
  const active = task => ["open", "in_progress"].includes(task.status);
  const count = category => tasks.filter(task => active(task) && (!category || task.category === category)).length;
  const priority = { P1: 0, P2: 1, P3: 2 };
  additions.sort((a, b) => priority[a.task.priority] - priority[b.task.priority]
    || (Date.parse(a.task.dueAt) || Infinity) - (Date.parse(b.task.dueAt) || Infinity)
    || b.strength - a.strength || a.task.id.localeCompare(b.task.id));
  const accept = item => {
    if (count() >= 12) return false;
    if (item.task.priority === "P1" && tasks.filter(task => active(task) && task.priority === "P1").length >= 4) item.task.priority = "P2";
    tasks.push(item.task); return true;
  };
  for (const category of CATEGORIES) {
    for (const item of additions.filter(item => item.task.category === category)) {
      if (count(category) >= 2 || !accept(item)) break;
    }
  }
  for (const item of additions) {
    if (tasks.includes(item.task)) continue;
    const otherCandidates = additions.some(other => !tasks.includes(other.task) && other.task.category !== item.task.category);
    if ((otherCandidates && count(item.task.category) >= 5) || !accept(item)) diagnostics.push({ id: item.task.id, reason: "quota_deferred" });
  }
  if (count() > 12) diagnostics.push({ reason: "existing_active_over_quota_preserved", count: count() });
  return { ledger: { schemaVersion: 1, updatedAt: now, tasks }, diagnostics };
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

function parseLedgerDocument(value, now = new Date().toISOString()) {
  const candidates = typeof value === "string" ? [value] : collectStrings(value);
  for (const candidate of candidates) {
    if (!candidate.includes(MARKER)) continue;
    const blocks = [...candidate.matchAll(/<pre\b([^>]*)>\s*<code>([\s\S]*?)<\/code>\s*<\/pre>/gi)]
      .filter(match => String(parseAttributes(match[1]).caption || "").trim() === MARKER);
    if (blocks.length > 1) return { found: false, blockId: "", ledger: normalizeLedger(), error: "待办事项包含多个账本数据块，停止写入" };
    for (const match of candidate.matchAll(/<pre\b([^>]*)>\s*<code>([\s\S]*?)<\/code>\s*<\/pre>/gi)) {
      const attributes = parseAttributes(match[1]);
      if (String(attributes.caption || "").trim() !== MARKER) continue;
      try {
        const renderedCode = match[2].replace(/<br\s*\/?>/gi, "\n");
        const ledger = normalizeLedger(JSON.parse(decodeXml(renderedCode)), now);
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
  // Legacy missing task timestamps must normalize identically across read/CAS.
  // The document timestamp is only fallback task metadata, never intake evidence.
  const stat = fs.statSync(resolved);
  const parsed = parseLedgerDocument(fs.readFileSync(resolved, "utf8"), stat.mtime.toISOString());
  if (!parsed.found) throw new Error(parsed.error || `${LOCAL_DOCUMENT_NAME} 待办事项数据块无法读取`);
  return { ...parsed, ledgerSha256: ledgerHash(parsed.ledger), documentSha256: sha256(fs.readFileSync(resolved)) };
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filePath);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}

function readRunReceipt(documentPath, runId) {
  const current = readLocalLedger(documentPath);
  const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(documentPath), ".domi-todo-last-run.json"), "utf8"));
  if (receipt.runId !== runId || receipt.schema !== "domi.todo-result.v1" || receipt.verified !== true
      || receipt.documentSha256 !== current.documentSha256 || receipt.ledgerSha256 !== current.ledgerSha256) {
    throw new Error("Todo run receipt does not match the requested run or current document; no success may be inferred");
  }
  return { ...current, receipt };
}

function mergeLocalLedger(documentPath, input) {
  const resolved = resolveLocalDocumentPath(documentPath);
  if (typeof input.runId !== "string" || !input.runId.trim()) throw new Error("local-merge requires runId");
  if (!/^[a-f0-9]{64}$/.test(input.expectedLedgerHash || "")) throw new Error("local-merge requires expectedLedgerHash from local-read");
  const lockPath = path.join(path.dirname(resolved), ".domi-todo-merge.lock");
  const release = acquireProcessLock(lockPath);
  try {
    const current = readLocalLedger(resolved);
    if (input.expectedLedgerHash !== current.ledgerSha256) throw new Error("Todo ledger changed; reread and merge current state before retrying");
    const result = mergeLedger({ ...input, ledger: current.ledger });
    // Detect edits made while preparing the merge; preserve the exact surrounding Markdown.
    if (sha256(fs.readFileSync(resolved)) !== current.documentSha256) throw new Error("Todo document changed during merge");
    const verified = writeLocalLedger(resolved, result.ledger);
    if (verified.ledgerSha256 !== ledgerHash(result.ledger)) throw new Error("Todo ledger readback differs from merged content");
    const receipt = { schema: "domi.todo-result.v1", runId: input.runId, verified: true,
      documentSha256: verified.documentSha256, ledgerSha256: verified.ledgerSha256,
      taskIds: verified.ledger.tasks.map(task => task.id), updatedAt: verified.ledger.updatedAt };
    atomicJson(path.join(path.dirname(resolved), ".domi-todo-last-run.json"), receipt);
    return { ...readRunReceipt(resolved, input.runId), diagnostics: result.diagnostics };
  } finally { release(); }
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
  if (!new Set(["parse", "render", "local-read", "local-write", "merge", "local-merge"]).has(command)) {
    throw new Error("Usage: todo-ledger.js <parse|render|local-read|local-write|merge|local-merge> [0.待办事项.md]");
  }
  // local-read is intentionally argument-only. Reading stdin first makes the
  // command wait forever when a parent process keeps its stdin pipe open.
  if (command === "local-read") {
    const runIndex = process.argv.indexOf("--run-id");
    const result = runIndex >= 0 ? readRunReceipt(process.argv[3], process.argv[runIndex + 1]) : readLocalLedger(process.argv[3]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const input = await readStdin();
  if (command === "merge" || command === "local-merge") {
    const value = JSON.parse(input);
    const result = command === "merge" ? mergeLedger(value) : mergeLocalLedger(process.argv[3], value);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
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
  if (command === "local-write") {
    process.stdout.write(`${JSON.stringify(writeLocalLedger(process.argv[3], JSON.parse(input)), null, 2)}\n`);
    return;
  }
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
  mergeLedger,
  mergeLocalLedger,
  readRunReceipt,
  stableJson,
  ledgerHash,
  parseLedgerDocument,
  readLocalLedger,
  renderLedger,
  replaceLocalLedgerDocument,
  writeLocalLedger
};
