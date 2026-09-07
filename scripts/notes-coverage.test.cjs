"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { prepareNotesCoverage, checkNotesCoverage, sourceRefRange } = require("./notes-coverage.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function fixture(t, sourceText = "研发仍在继续。\n目前没有收入。\n", notesText = "#### 访谈纪要\n\n研发仍在继续，目前没有收入。\n", limits = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notes-coverage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const filename = path.join(root, name), text = typeof value === "string" ? value : JSON.stringify(value);
    fs.writeFileSync(filename, text); return { path: filename, sha256: hash(text), bytes: Buffer.byteLength(text) };
  };
  const source = { ...write("source.txt", sourceText), sourceId: "transcript", role: "current_transcript" };
  const notes = write("notes.md", notesText);
  const index = { workflowRunId: "synthetic-run", sources: [source], claims: [{ claimId: "c1", statement: "研发继续且没有收入",
    sourceRefs: [{ sourceId: source.sourceId, start: 0, end: sourceText.length }], notesRefs: [{ lines: [3, 3], quote: "研发仍在继续，目前没有收入。" }] }] };
  const coverage = prepareNotesCoverage({ ...index, ...limits });
  for (const s of coverage.sources) for (const segment of s.segments) segment.review = { status: "reviewed", reviewer: "model", claimIds: ["c1"], exclusions: [] };
  const refresh = () => { index.coverage = write("coverage.json", coverage); return checkNotesCoverage(index, { notes, requireCoverage: true }); };
  return { root, write, source, notes, index, coverage, refresh, sourceText };
}

test("bounded segmentation covers exact CRLF and long-line offsets without splitting surrogate pairs", t => {
  const text = `\uFEFF第一行\r\n${"😀".repeat(4001)}\n第三行\n`;
  const f = fixture(t, text, undefined, { maxLines: 2, maxChars: 40 });
  const source = f.coverage.sources[0];
  assert.equal(source.segments.map(s => text.slice(s.start, s.end)).join(""), text);
  for (const segment of source.segments) {
    assert.ok(segment.end - segment.start <= 40);
    assert.ok(segment.lines[1] - segment.lines[0] < 2);
    assert.doesNotMatch(text.slice(segment.start, segment.end), /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
  }
  assert.deepEqual(prepareNotesCoverage({ ...f.index, maxLines: 2, maxChars: 40 }), { ...f.coverage, sources: f.coverage.sources.map(s => ({ ...s, segments: s.segments.map(v => ({ ...v, review: { status: "pending", reviewer: null, claimIds: [], exclusions: [] } })) })) });
  assert.equal(f.refresh().ok, true);
});

test("callers cannot turn the full transcript into an oversized review segment", t => {
  const f = fixture(t);
  assert.throws(() => prepareNotesCoverage({ ...f.index, maxLines: 41 }), /between 1 and 40/);
  assert.throws(() => prepareNotesCoverage({ ...f.index, maxChars: 4001 }), /between 2 and 4000/);
  f.coverage.limits.maxLines = 100000;
  assert.equal(f.refresh().ok, false);
});

test("valid coverage certifies only mechanical range/excerpt checks, never semantic accuracy", t => {
  const f = fixture(t), report = f.refresh();
  assert.equal(report.ok, true); assert.equal(report.status, "verified");
  assert.equal(report.coverageVerified, true); assert.equal(report.notesBindingsVerified, true);
  assert.equal(report.semanticReviewRequired, true); assert.equal(report.currentFactsVerified, false);
  assert.equal(fs.readFileSync(f.source.path, "utf8"), f.sourceText);
});

test("omitted source blocks, pending reviews and uncovered characters identify exact locations", t => {
  const f = fixture(t, "第一事实。\n第二事实。\n第三事实。", undefined, { maxLines: 1 });
  f.coverage.sources[0].segments.pop();
  let report = f.refresh();
  assert.ok(report.missing.some(v => v.location.endsWith("segments[2]")));
  f.coverage.sources[0].segments[0].review.status = "pending";
  report = f.refresh(); assert.ok(report.missing.some(v => /not been reviewed/.test(v.message)));
  f.coverage.sources[0].segments[1].review.claimIds = [];
  report = f.refresh(); assert.ok(report.missing.some(v => /Unaccounted source characters 6-12/.test(v.message)));
});

test("every historical/correction source is included, external verification sources are not treated as meeting content", t => {
  const f = fixture(t);
  f.index.sources.push({ ...f.write("correction.txt", "更正后的数字。"), sourceId: "correction", role: "user_correction" });
  f.index.sources.push({ ...f.write("history.txt", "历史记录。"), sourceId: "history", role: "historical_record" });
  f.index.sources.push({ ...f.write("external.txt", "公开核验。"), sourceId: "external", role: "verification_only" });
  const fresh = prepareNotesCoverage(f.index);
  assert.deepEqual(fresh.sources.map(s => s.sourceId), ["transcript", "correction", "history"]);
  const report = f.refresh();
  assert.equal(report.ok, false); assert.equal(report.missing.filter(v => /Missing source/.test(v.message)).length, 2);
});

test("same-size changed source and tampered parser/range fail without changing any source", t => {
  const f = fixture(t); f.refresh();
  const original = fs.readFileSync(f.source.path), stat = fs.statSync(f.source.path);
  const changed = Buffer.from(original); changed[0] = 0x20;
  fs.writeFileSync(f.source.path, changed); fs.utimesSync(f.source.path, stat.atime, stat.mtime);
  assert.equal(checkNotesCoverage(f.index, { notes: f.notes, requireCoverage: true }).ok, false);
  assert.deepEqual(fs.readFileSync(f.source.path), changed);
  fs.writeFileSync(f.source.path, original);
  f.coverage.parserVersion = "different-parser"; assert.equal(f.refresh().ok, false);
  f.coverage.parserVersion = "source-intervals-v1";
  f.coverage.sources[0].segments[0].end--; assert.equal(f.refresh().ok, false);
});

test("claims cannot reference unknown IDs or timestamp-only ranges to certify full coverage", t => {
  const f = fixture(t);
  f.coverage.sources[0].segments[0].review.claimIds = ["missing"];
  assert.ok(f.refresh().invalid.some(v => /Unknown claim/.test(v.message)));
  f.coverage.sources[0].segments[0].review.claimIds = ["c1"];
  f.index.claims[0].sourceRefs = [{ sourceId: "transcript", locator: "00:00:01" }];
  assert.ok(f.refresh().invalid.some(v => /timestamps alone/.test(v.message)));
});

test("literal notes refs fail when absent, outside lines, deleted, or moved to another line", t => {
  const f = fixture(t); delete f.index.claims[0].notesRefs;
  assert.ok(f.refresh().missing.some(v => /notesRefs/.test(v.location)));
  f.index.claims[0].notesRefs = [{ lines: [100, 100], quote: "没有收入" }]; assert.equal(f.refresh().ok, false);
  f.index.claims[0].notesRefs = [{ lines: [3, 3], quote: "已有收入" }]; assert.equal(f.refresh().ok, false);
  f.index.claims[0].notesRefs = [{ lines: [2, 2], quote: "没有收入" }]; assert.equal(f.refresh().ok, false);
});

test("headings, code, frontmatter and hidden comments cannot be used as actual notes destinations", t => {
  const f = fixture(t);
  const samples = ["#### 没有收入\n", "---\nfact: 没有收入\n---\n", "```md\n没有收入\n```\n", "<!-- 没有收入 -->\n", "    没有收入\n"];
  for (const [i, text] of samples.entries()) {
    const notes = f.write(`protected-${i}.md`, text);
    f.index.claims[0].notesRefs = [{ lines: [1, text.split("\n").length], quote: "没有收入" }]; f.refresh();
    assert.equal(checkNotesCoverage(f.index, { notes, requireCoverage: true }).ok, false);
  }
});

test("all-greeting sources may be explicitly excluded; reasons and material conflicts are checked", t => {
  const f = fixture(t, "大家好。\n谢谢。\n");
  f.index.claims = [];
  const segment = f.coverage.sources[0].segments[0];
  segment.review = { status: "reviewed", reviewer: "model", claimIds: [], exclusions: [{ start: segment.start, end: segment.end, kind: "non_substantive", reason: "仅问候与致谢，没有事实信息。" }] };
  assert.equal(f.refresh().ok, true);
  segment.review.exclusions[0].reason = ""; assert.equal(f.refresh().ok, false);
  segment.review.exclusions[0].reason = "可能影响判断";
  segment.review.exclusions[0].materialToDecision = true; assert.equal(f.refresh().ok, false);
});

test("stale notes and coverage hashes block; missing legacy coverage is explicitly unverified", t => {
  const f = fixture(t); f.refresh(); fs.appendFileSync(f.notes.path, "并发修订\n");
  assert.equal(checkNotesCoverage(f.index, { notes: f.notes, requireCoverage: true }).ok, false);
  delete f.index.coverage;
  const legacy = checkNotesCoverage(f.index, { notes: f.notes });
  assert.equal(legacy.ok, true); assert.equal(legacy.status, "legacy-unverified"); assert.equal(legacy.coverageVerified, false);
  assert.equal(checkNotesCoverage(f.index, { notes: f.notes, requireCoverage: true }).ok, false);
});

test("source ranges support full line and precise character locators with literal validation", () => {
  const text = "第一行\r\n第二行\n";
  assert.deepEqual(sourceRefRange(text, { lines: [1, 2], quote: "第一行\n第二行" }), [0, text.length]);
  assert.deepEqual(sourceRefRange(text, { start: 5, end: 8, quote: "第二行" }), [5, 8]);
  assert.throws(() => sourceRefRange(text, { start: 0, end: 999 }), /out of bounds/);
});

test("CLI prepare creates pending coverage without overwriting inputs; check is strict unless explicitly legacy", t => {
  const f = fixture(t), index = f.write("index.json", f.index), output = path.join(f.root, "prepared.json"), script = path.join(__dirname, "notes-coverage.cjs");
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  assert.equal(run("prepare", "--index", index.path, "--output", output).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(output)).sources[0].segments[0].review.status, "pending");
  assert.notEqual(run("prepare", "--index", index.path, "--output", index.path).status, 0);
  assert.equal(hash(fs.readFileSync(index.path)), index.sha256);
  assert.notEqual(run("check", "--index", index.path, "--notes", f.notes.path).status, 0);
  const legacy = run("check", "--index", index.path, "--notes", f.notes.path, "--allow-legacy");
  assert.equal(legacy.status, 0); assert.equal(JSON.parse(legacy.stdout).status, "legacy-unverified");
});
