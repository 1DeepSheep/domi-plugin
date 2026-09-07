#!/usr/bin/env node
"use strict";

// This checks review coverage and literal destinations, never semantic truth.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { TextDecoder } = require("node:util");
const SCHEMA = "asr.notes-coverage.v1";
const PARSER_VERSION = "source-intervals-v1";
const COVERED_ROLES = new Set(["current_transcript", "historical_record", "user_correction"]);
const EXCLUSION_KINDS = new Set(["non_substantive", "mode_excluded", "duplicate", "unintelligible", "out_of_scope"]);
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const nonempty = value => typeof value === "string" && Boolean(value.trim());
class NotesCoverageError extends Error {
  constructor(message, report) { super(message); this.name = "NotesCoverageError"; this.code = "NOTES_COVERAGE_INVALID"; this.report = report; }
}
function requireValue(ok, message) { if (!ok) throw new NotesCoverageError(message); }
function readArtifact(value) {
  requireValue(value && path.isAbsolute(value.path || ""), "Artifact path must be absolute");
  const stat = fs.lstatSync(value.path);
  requireValue(stat.isFile() && stat.size > 0, `Artifact must be a nonempty regular file: ${value.path}`);
  const bytes = fs.readFileSync(value.path);
  requireValue(/^[a-f0-9]{64}$/.test(value.sha256 || "") && Number.isSafeInteger(value.bytes) && value.bytes === bytes.length && value.sha256 === sha256(bytes), `Artifact changed: ${value.path}`);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
function lineOffsets(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}
function lineAt(starts, offset) {
  let lo = 0, hi = starts.length;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid; }
  return lo + 1;
}
function validateLimits({ maxLines = 40, maxChars = 4000 } = {}) {
  requireValue(Number.isInteger(maxLines) && maxLines > 0 && maxLines <= 40, "maxLines must be between 1 and 40");
  requireValue(Number.isInteger(maxChars) && maxChars >= 2 && maxChars <= 4000, "maxChars must be between 2 and 4000");
  return { maxLines, maxChars };
}
function segmentSource(source, limits) {
  const text = readArtifact(source), starts = lineOffsets(text), segments = [];
  for (let start = 0; start < text.length;) {
    const firstLine = lineAt(starts, start);
    let end = Math.min(text.length, start + limits.maxChars, starts[firstLine - 1 + limits.maxLines] ?? text.length);
    // Offset units are UTF-16 code units. Never cut a supplementary character.
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    const hash = sha256(text.slice(start, end));
    segments.push({ segmentId: `${source.sourceId}:${start}-${end}:${hash.slice(0, 16)}`, start, end,
      lines: [firstLine, lineAt(starts, end - 1)], sha256: hash,
      review: { status: "pending", reviewer: null, claimIds: [], exclusions: [] } });
    start = end;
  }
  return { sourceId: source.sourceId, role: source.role, path: source.path, sha256: source.sha256, bytes: source.bytes,
    lineCount: starts.length, characterCount: text.length, segments };
}
function prepareNotesCoverage({ workflowRunId, sources, maxLines = 40, maxChars = 4000 }) {
  requireValue(nonempty(workflowRunId), "workflowRunId required");
  requireValue(Array.isArray(sources), "sources array required");
  const limits = validateLimits({ maxLines, maxChars }), selected = sources.filter(source => COVERED_ROLES.has(source.role));
  requireValue(selected.some(source => source.role === "current_transcript"), "Coverage requires the canonical current transcript");
  requireValue(selected.every(source => nonempty(source.sourceId)) && new Set(selected.map(source => source.sourceId)).size === selected.length, "Coverage source IDs must be unique");
  return { schema: SCHEMA, workflowRunId, parserVersion: PARSER_VERSION, limits,
    sources: selected.map(source => segmentSource(source, limits)) };
}
function sourceRefRange(text, ref) {
  if (ref.start !== undefined || ref.end !== undefined) {
    requireValue(Number.isInteger(ref.start) && Number.isInteger(ref.end) && ref.start >= 0 && ref.end > ref.start && ref.end <= text.length, "Source character range out of bounds");
    if (ref.quote !== undefined) requireValue(nonempty(ref.quote) && text.slice(ref.start, ref.end).includes(ref.quote), "Source quote differs from indexed range");
    return [ref.start, ref.end];
  }
  const parsed = String(ref.locator || "").match(/^L?(\d+)(?:-L?(\d+))?$/);
  const lines = ref.lines || (parsed && [Number(parsed[1]), Number(parsed[2] || parsed[1])]);
  const starts = lineOffsets(text);
  requireValue(Array.isArray(lines) && lines.length >= 1 && lines.length <= 2, "Coverage requires explicit source lines or start/end; timestamps alone are insufficient");
  const [from, to = from] = lines;
  requireValue(Number.isInteger(from) && Number.isInteger(to) && from > 0 && to >= from && to <= starts.length, "Source line locator out of bounds");
  const range = [starts[from - 1], starts[to] ?? text.length];
  if (ref.quote !== undefined) requireValue(nonempty(ref.quote) && text.slice(...range).replace(/\r\n/g, "\n").includes(ref.quote), "Source quote differs from indexed lines");
  return range;
}
function visibleNotesLines(text) {
  let fence = null, frontmatter = false, comment = false;
  return text.split(/\r?\n/).map((line, i) => {
    if (i === 0 && line.replace(/^\uFEFF/, "") === "---") { frontmatter = true; return ""; }
    if (frontmatter) { if (/^(?:---|\.\.\.)\s*$/.test(line)) frontmatter = false; return ""; }
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker && !fence) { fence = marker[1]; return ""; }
    if (fence) { if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null; return ""; }
    if (comment || line.includes("<!--")) { comment = !line.includes("-->"); return ""; }
    if (/^(?: {4}|\t)/.test(line) || /^ {0,3}#{1,6}(?:\s|$)/.test(line) || /^\s*(?:(?:[-*_]\s*){3,}|\|?[\s:|-]+\|?)$/.test(line)) return "";
    return line;
  });
}
function checkNotesCoverage(index, { notes, requireCoverage = false } = {}) {
  const report = { ok: false, status: "blocked", coverageVerified: false, notesBindingsVerified: false,
    mechanicalChecksPassed: false, semanticReviewRequired: true, currentFactsVerified: false, missing: [], invalid: [] };
  const invalid = (location, message) => report.invalid.push({ location, message });
  const missing = (location, message) => report.missing.push({ location, message });
  if (!index.coverage) {
    if (requireCoverage) missing("coverage", "New ASR notes require a source coverage artifact; prepare and review every segment");
    else { report.ok = true; report.status = "legacy-unverified"; }
    return report;
  }
  let coverage, expected, notesText, texts;
  try {
    coverage = JSON.parse(readArtifact(index.coverage));
    requireValue(coverage.schema === SCHEMA && coverage.parserVersion === PARSER_VERSION && coverage.workflowRunId === index.workflowRunId, "Coverage schema/parserVersion/run mismatch");
    expected = prepareNotesCoverage({ workflowRunId: index.workflowRunId, sources: index.sources, ...validateLimits(coverage.limits) });
    notesText = readArtifact(notes);
    texts = new Map(expected.sources.map(source => [source.sourceId, readArtifact(source)]));
  } catch (error) { invalid("coverage", error.message); return report; }
  const visible = visibleNotesLines(notesText), noteLines = notesText.split(/\r?\n/);
  const claims = new Map(), sources = new Map(index.sources.map(source => [source.sourceId, source]));
  if (!Array.isArray(index.claims)) { invalid("claims", "Existing claims array required (may be empty only when all source content is explicitly excluded)"); return report; }
  for (const [i, claim] of index.claims.entries()) {
    const at = `claims[${i}]`;
    if (!claim || !nonempty(claim.claimId) || claims.has(claim.claimId)) { invalid(at, "Missing or duplicate claimId"); continue; }
    if (!Array.isArray(claim.sourceRefs) || !claim.sourceRefs.length || claim.sourceRefs.some(ref => !ref || !nonempty(ref.sourceId))) { invalid(`${at}.sourceRefs`, "Claim requires valid source references"); continue; }
    claims.set(claim.claimId, claim);
    if (!Array.isArray(claim.notesRefs) || !claim.notesRefs.length) { missing(`${at}.notesRefs`, "Bind this claim to a literal excerpt in the current notes body"); continue; }
    for (const [n, ref] of claim.notesRefs.entries()) {
      if (!ref || !Array.isArray(ref.lines) || ref.lines.length < 1 || ref.lines.length > 2) { invalid(`${at}.notesRefs[${n}]`, "Notes reference requires a one- or two-element line range"); continue; }
      const loc = `${at}.notesRefs[${n}]`, [from, to = from] = Array.isArray(ref.lines) ? ref.lines : [];
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > noteLines.length || !nonempty(ref.quote)) { invalid(loc, "Notes reference requires in-bounds lines and a nonempty literal quote"); continue; }
      if (!visible.slice(from - 1, to).join("\n").includes(ref.quote)) invalid(loc, "Notes quote does not occur in the referenced readable body (not headings, code, frontmatter or comments)");
    }
  }
  if (!Array.isArray(coverage.sources) || coverage.sources.length !== expected.sources.length) invalid("coverage.sources", "Coverage must contain every required source exactly once");
  for (const [s, expectedSource] of expected.sources.entries()) {
    const loc = `coverage.sources[${s}]`, actual = coverage.sources?.[s];
    if (!actual) { missing(loc, `Missing source ${expectedSource.sourceId}`); continue; }
    for (const key of ["sourceId", "role", "path", "sha256", "bytes", "lineCount", "characterCount"]) if (actual[key] !== expectedSource[key]) invalid(`${loc}.${key}`, "Coverage source identity/content changed");
    if (!Array.isArray(actual.segments) || actual.segments.length !== expectedSource.segments.length) invalid(`${loc}.segments`, "Fixed source segments were omitted or changed; prepare again");
    const text = texts.get(expectedSource.sourceId), starts = lineOffsets(text);
    for (const [j, segment] of expectedSource.segments.entries()) {
      const at = `${loc}.segments[${j}]`, saved = actual.segments?.[j];
      if (!saved) { missing(at, `Missing source range ${segment.start}-${segment.end}`); continue; }
      for (const key of ["segmentId", "start", "end", "sha256", "lines"]) if (JSON.stringify(saved[key]) !== JSON.stringify(segment[key])) invalid(`${at}.${key}`, "Deterministic source range changed");
      const review = saved.review;
      if (review?.status !== "reviewed" || review.reviewer !== "model") { missing(`${at}.review`, "Source segment has not been reviewed by the model"); continue; }
      if (!Array.isArray(review.claimIds) || !Array.isArray(review.exclusions)) { invalid(`${at}.review`, "claimIds and exclusions arrays required"); continue; }
      const ranges = [];
      for (const id of review.claimIds) {
        const claim = claims.get(id);
        if (!claim) { invalid(`${at}.review.claimIds`, `Unknown claim ${id}`); continue; }
        let intersects = false;
        for (const ref of claim.sourceRefs || []) {
          if (ref.sourceId !== expectedSource.sourceId) continue;
          try {
            const [from, to] = sourceRefRange(text, ref);
            if (from < segment.end && to > segment.start) { ranges.push([Math.max(from, segment.start), Math.min(to, segment.end)]); intersects = true; }
          } catch (error) { invalid(`${at}.review.claimIds:${id}`, error.message); }
        }
        if (!intersects) invalid(`${at}.review.claimIds:${id}`, "Claim has no source range intersecting this segment");
      }
      for (const [e, excluded] of review.exclusions.entries()) {
        if (!excluded || !Number.isInteger(excluded.start) || !Number.isInteger(excluded.end) || excluded.start < segment.start || excluded.end > segment.end || excluded.end <= excluded.start
          || !EXCLUSION_KINDS.has(excluded.kind) || !nonempty(excluded.reason) || excluded.materialToDecision === true) {
          invalid(`${at}.review.exclusions[${e}]`, "Exclusion needs an in-segment range, supported kind, semantic reason and no unresolved material information");
        } else ranges.push([excluded.start, excluded.end]);
      }
      ranges.sort((a, b) => a[0] - b[0]);
      let cursor = segment.start;
      for (const [from, to] of [...ranges, [segment.end, segment.end]]) {
        if (from > cursor && /\S/u.test(text.slice(cursor, from))) missing(`${at}.review`, `Unaccounted source characters ${cursor}-${from} (lines ${lineAt(starts, cursor)}-${lineAt(starts, from - 1)})`);
        cursor = Math.max(cursor, to);
      }
    }
  }
  // Unknown references must never count towards source coverage.
  for (const claim of claims.values()) for (const ref of claim.sourceRefs || []) if (!sources.has(ref.sourceId)) invalid(`claims:${claim.claimId}.sourceRefs`, `Unknown source ${ref.sourceId}`);
  report.ok = !report.missing.length && !report.invalid.length;
  if (report.ok) { report.status = "verified"; report.coverageVerified = true; report.notesBindingsVerified = true; report.mechanicalChecksPassed = true; }
  return report;
}

function main() {
  const [command, ...args] = process.argv.slice(2), flags = {};
  for (let i = 0; i < args.length; i++) {
    requireValue(args[i].startsWith("--"), "Expected --flag value");
    const key = args[i].slice(2);
    if (key === "allow-legacy") flags[key] = true;
    else { requireValue(args[i + 1] && !args[i + 1].startsWith("--"), "Expected --flag value"); flags[key] = args[++i]; }
  }
  requireValue(flags.index, "--index required");
  const index = JSON.parse(fs.readFileSync(flags.index, "utf8"));
  let result;
  if (command === "prepare") {
    requireValue(flags.output && path.isAbsolute(flags.output), "prepare requires an absolute new --output path");
    result = prepareNotesCoverage({ workflowRunId: index.workflowRunId, sources: index.sources,
      ...(flags["max-lines"] ? { maxLines: Number(flags["max-lines"]) } : {}), ...(flags["max-chars"] ? { maxChars: Number(flags["max-chars"]) } : {}) });
    // No overwrite: output cannot destroy a source, existing notes or prior review.
    const fd = fs.openSync(flags.output, "wx", 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(result, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    result = { ok: true, path: flags.output, sourceCount: result.sources.length, segmentCount: result.sources.reduce((n, s) => n + s.segments.length, 0), reviewRequired: true };
  } else if (command === "check") {
    requireValue(flags.notes, "check requires --notes");
    const notesPath = path.resolve(flags.notes), bytes = fs.readFileSync(notesPath);
    result = checkNotesCoverage(index, { notes: { path: notesPath, sha256: sha256(bytes), bytes: bytes.length }, requireCoverage: !flags["allow-legacy"] });
  } else throw new NotesCoverageError("Usage: notes-coverage.cjs prepare --index file --output new-file | check --index file --notes notes.md [--allow-legacy]");
  process.stdout.write(`${JSON.stringify(result)}\n`); if (!result.ok) process.exitCode = 1;
}
if (require.main === module) { try { main(); } catch (error) { process.stdout.write(`${JSON.stringify({ ok: false, code: error.code, error: error.message, ...(error.report ? { report: error.report } : {}) })}\n`); process.exitCode = 1; } }
module.exports = { prepareNotesCoverage, checkNotesCoverage, sourceRefRange, NotesCoverageError, SCHEMA, PARSER_VERSION };
