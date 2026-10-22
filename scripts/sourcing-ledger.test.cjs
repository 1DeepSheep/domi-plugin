"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { spawnSync } = require("node:child_process");
const { SourcingLedger, LEASE_MS, RETRY_MS, MAX_DAILY_ATTEMPTS, dayKey } = require("./sourcing-ledger.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sourcing-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, "repository.sqlite3");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,created_at INTEGER,notes TEXT DEFAULT '',document_path TEXT DEFAULT '',updated_at INTEGER,revision INTEGER DEFAULT 1,aliases_json TEXT DEFAULT '[]',legal_name TEXT DEFAULT ''); CREATE TABLE people(id TEXT PRIMARY KEY,name TEXT,created_at INTEGER,organization TEXT DEFAULT '',document_path TEXT DEFAULT '',updated_at INTEGER);");
  let now = Date.parse("2026-10-21T07:00:00Z");
  const ledger = new SourcingLedger({ libraryDir: directory, databasePath, now: () => now });
  ledger.configure({ settings: { enabled: true } });
  t.after(() => database.close());
  return { directory, databasePath, database, ledger, now: () => now, advance: ms => now += ms, setNow: value => now = Date.parse(value) };
}
function candidate(extra = {}) {
  return { name: "Early Research", kind: "company", identityUrl: "https://example.org/company", founders: ["Person A"], sources: [{ url: "https://example.org/company", title: "Official", type: "official" }], summary: "Early project", discoveryPath: ["Lab", "Alumni page", "Homepage"], contactPaths: noMatch(), researchLinks: noMatch(), ...extra };
}
const noMatch = () => ({ status: "not_found", note: "合成测试：已检查当前项目库和人脉库的名称、团队与研究方向，未发现关联。", items: [] });
function receipt(run, extra = {}) {
  const focus = run.snapshot?.focusConfigured ? run.snapshot.focuses.find(item => item.enabled) : null;
  return { runId: run.runId, leaseToken: run.leaseToken, candidates: [], sources: [{ name: "Lab", type: "lab", url: "https://example.org/lab", status: "checked", ...(focus ? { focusIds: [focus.id] } : {}) }], completed: true, coverage: { checked: 1, failed: 0, pending: 0 }, ...extra };
}
function analysisFixture(t) {
  const f = fixture(t);
  f.database.prepare("INSERT INTO projects(id,name,created_at,notes) VALUES(?,?,?,?)").run("related-project", "Existing Scientific Tools", f.now() - 10000, "开发科学计算工具，面向材料研究客户。");
  f.database.prepare("INSERT INTO people(id,name,created_at,organization) VALUES(?,?,?,?)").run("contact-person", "Existing Researcher", f.now() - 10000, "合成实验室研究员，公开研究方向为科学计算。");
  f.database.exec("CREATE TABLE documents(id TEXT PRIMARY KEY,owner_type TEXT,owner_id TEXT,path TEXT,updated_at INTEGER)");
  const documentPath = path.join(f.directory, "contact-research.md");
  fs.writeFileSync(documentPath, "# Synthetic relationship\n\n与候选创始人共同参加过公开学术研讨。\n");
  f.database.prepare("INSERT INTO documents VALUES(?,?,?,?,?)").run("contact-note", "person", "contact-person", documentPath, f.now() - 10000);
  const via = { type: "person", id: "contact-person", name: "Wrong supplied contact name" };
  const target = { type: "project", id: "related-project", name: "Wrong supplied project name" };
  return { ...f, documentPath,
    contact: { via, chain: ["Existing Researcher", "公开研讨", "候选创始人"], basis: "library_record", reason: "库内纪要记载公开活动交集，认识程度仍需确认。", nextStep: "先询问库内联系人是否愿意介绍。", evidence: [{ kind: "library", entity: { ...via }, quote: "与候选创始人共同参加过公开学术研讨。", documentPath }] },
    link: { target, relation: "same_direction", reason: "同属科学计算工具。", difference: "候选的目标客户和产品形态仍需确认。", evidence: [{ kind: "library", entity: { ...target }, quote: "开发科学计算工具，面向材料研究客户。" }] }
  };
}
const found = item => ({ status: "found", note: "合成测试：已检查公开来源与库内记录。", items: [structuredClone(item)] });

test("contact paths and research links read canonical anchors and verified owned record/document quotes", t => {
  const f = analysisFixture(t), run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate({ contactPaths: found(f.contact), researchLinks: found(f.link) })] }));
  const stored = f.ledger.snapshot().candidates[0];
  assert.equal(stored.contactPaths.items[0].via.name, "Existing Researcher");
  assert.equal(stored.contactPaths.items[0].evidence[0].entity.name, "Existing Researcher");
  assert.equal(stored.researchLinks.items[0].target.name, "Existing Scientific Tools");
  assert.equal(stored.researchLinks.items[0].evidence[0].entity.name, "Existing Scientific Tools");
  assert.equal(stored.contactPaths.checkedAt, f.now());
  f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "idle");
});

test("analysis rejects invented anchors, borrowed owner documents and nonexistent quotes atomically", t => {
  const f = analysisFixture(t), run = f.ledger.begin();
  const fakeAnchor = structuredClone(f.contact); fakeAnchor.via.id = "invented";
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ contactPaths: found(fakeAnchor) })] })), { code: "sourcing_invalid_analysis_link" });
  const borrowed = structuredClone(f.link); borrowed.evidence = [{ ...f.contact.evidence[0], entity: { ...f.link.target } }];
  const missingQuote = structuredClone(f.contact); missingQuote.evidence[0].quote = "该联系人承诺直接引荐。";
  const borrowedIdentity = structuredClone(f.contact); borrowedIdentity.evidence = structuredClone(f.link.evidence);
  for (const [field, item] of [["researchLinks", borrowed], ["contactPaths", missingQuote], ["contactPaths", borrowedIdentity]]) {
    assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ [field]: found(item) })] })), { code: "sourcing_invalid_analysis_evidence" });
  }
  assert.deepEqual(f.ledger.snapshot().candidates, []);
});

test("newly added records cannot become historical contact anchors or research comparisons", t => {
  const f = analysisFixture(t), run = f.ledger.begin();
  f.database.prepare("INSERT INTO people(id,name,created_at,organization) VALUES(?,?,?,?)").run("new-contact", "New Person", f.now(), "Synthetic research organization");
  f.database.prepare("INSERT INTO projects(id,name,created_at,notes) VALUES(?,?,?,?)").run("new-project", "New Project", f.now(), "Synthetic scientific tools");
  const contact = { ...f.contact, via: { type: "person", id: "new-contact", name: "New Person" }, evidence: [{ kind: "library", entity: { type: "person", id: "new-contact" }, quote: "Synthetic research organization" }] };
  const link = { ...f.link, target: { type: "project", id: "new-project", name: "New Project" }, evidence: [{ kind: "library", entity: { type: "project", id: "new-project" }, quote: "Synthetic scientific tools" }] };
  for (const extra of [{ contactPaths: found(contact) }, { researchLinks: found(link) }]) {
    assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate(extra)] })), { code: "sourcing_invalid_analysis_link" });
  }
  assert.deepEqual(f.ledger.snapshot().candidates, []);
});

test("a candidate's matched project cannot serve as its own research comparison", t => {
  const f = analysisFixture(t);
  f.database.prepare("UPDATE projects SET notes=notes || ' https://example.org/company' WHERE id=?").run("related-project");
  const run = f.ledger.begin();
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ name: "Existing Scientific Tools", intake: { status: "matched", projectId: "related-project" }, researchLinks: found(f.link) })] })), { code: "sourcing_invalid_analysis_link" });
  assert.deepEqual(f.ledger.snapshot().candidates, []);
});

test("library evidence requires a registered owned text document inside the current library", t => {
  const f = analysisFixture(t), run = f.ledger.begin();
  const unregistered = path.join(f.directory, "unregistered.md"); fs.writeFileSync(unregistered, f.contact.evidence[0].quote);
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "sourcing-outside-evidence-"));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const outside = path.join(outsideDir, "outside.md"); fs.writeFileSync(outside, f.contact.evidence[0].quote);
  f.database.prepare("INSERT INTO documents VALUES(?,?,?,?,?)").run("outside", "person", "contact-person", outside, f.now());
  for (const documentPath of [unregistered, outside]) {
    const item = structuredClone(f.contact); item.evidence[0].documentPath = documentPath;
    assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ contactPaths: found(item) })] })), { code: "sourcing_invalid_analysis_evidence" });
  }
});

test("public overlaps require own library evidence plus a web citation listed in candidate sources", t => {
  const f = analysisFixture(t), run = f.ledger.begin();
  const item = { ...structuredClone(f.contact), basis: "public_overlap" };
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ contactPaths: found(item) })] })), { code: "sourcing_invalid_analysis_evidence" });
  item.evidence.push({ kind: "web", url: "https://example.org/event", quote: "公开嘉宾名单同时列出两人。" });
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ contactPaths: found(item) })] })), { code: "sourcing_invalid_analysis_evidence" });
  const sources = [...candidate().sources, { url: "https://example.org/event", type: "event", title: "Synthetic event" }];
  f.ledger.merge(receipt(run, { candidates: [candidate({ sources, contactPaths: found(item) })] }));
  assert.equal(f.ledger.snapshot().candidates[0].contactPaths.items[0].basis, "public_overlap");
  const webOnly = { ...structuredClone(f.link), evidence: [item.evidence[1]] };
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ sources, researchLinks: found(webOnly) })] })), { code: "sourcing_invalid_analysis_evidence" });
});

test("analysis states distinguish pending, substantiated no-match and invalid empty found claims", t => {
  const f = fixture(t), run = f.ledger.begin();
  for (const block of [
    { status: "found", items: [], note: "" }, { status: "not_found", items: [], note: " " },
    { status: "not_found", items: [{}], note: "checked" }, { status: "done", items: [], note: "checked" }
  ]) assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ contactPaths: block })] })), { code: "sourcing_invalid_analysis" });
  f.ledger.merge(receipt(run, { candidates: [candidate({ contactPaths: undefined, researchLinks: undefined })] }));
  const stored = f.ledger.snapshot().candidates[0];
  assert.deepEqual(stored.contactPaths, { status: "pending", note: "", items: [] });
  assert.deepEqual(stored.researchLinks, { status: "pending", note: "", items: [] });
  f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "partial");
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, undefined);
  assert.match(f.ledger.snapshot().run.error, /候选关联分析/);
  const retry = f.ledger.begin({ force: true });
  f.ledger.merge(receipt(retry, { candidates: [candidate({ id: stored.id })] }));
  f.ledger.complete(retry);
  assert.equal(f.ledger.snapshot().run.status, "idle");
});

test("omitted analysis keeps old timestamps but a new run needs explicit rechecking; same-run reuse is valid", t => {
  const f = fixture(t), first = f.ledger.begin();
  f.ledger.merge(receipt(first, { candidates: [candidate()] })); f.ledger.complete(first);
  const old = f.ledger.snapshot().candidates[0], lastSuccess = f.ledger.snapshot().run.lastSuccessAt;
  f.advance(86400000);
  const next = f.ledger.begin();
  f.ledger.merge(receipt(next, { candidates: [candidate({ contactPaths: undefined, researchLinks: undefined })] }));
  assert.deepEqual(f.ledger.snapshot().candidates[0].contactPaths, old.contactPaths);
  f.ledger.complete(next);
  assert.equal(f.ledger.snapshot().run.status, "partial");
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, lastSuccess);
  f.advance(1000);
  const retry = f.ledger.begin({ force: true });
  f.ledger.merge(receipt(retry, { candidates: [candidate({ contactPaths: { ...noMatch(), checkedAt: 99999999999999 } })], completed: false }));
  const checked = f.ledger.snapshot().candidates[0].contactPaths.checkedAt;
  assert.equal(checked, f.now());
  f.advance(1000);
  f.ledger.merge(receipt(retry, { candidates: [candidate({ contactPaths: undefined, researchLinks: undefined })] }));
  assert.equal(f.ledger.snapshot().candidates[0].contactPaths.checkedAt, checked);
  f.ledger.complete(retry);
  assert.equal(f.ledger.snapshot().run.status, "idle");
});

test("completion rechecks analysis evidence and old ledgers expose missing blocks as pending", t => {
  const f = analysisFixture(t), run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate({ contactPaths: found(f.contact), researchLinks: found(f.link) })] }));
  fs.writeFileSync(f.documentPath, "# Deleted relationship evidence\n");
  assert.throws(() => f.ledger.complete(run), { code: "sourcing_invalid_analysis_evidence" });
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, undefined);
  const persisted = f.ledger.read();
  delete persisted.candidates[0].contactPaths; delete persisted.candidates[0].researchLinks;
  f.ledger.write(persisted);
  assert.equal(f.ledger.snapshot().candidates[0].contactPaths.status, "pending");
  f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "partial");
});

for (const type of ["person", "project"]) test(`completion rejects a deleted ${type} analysis anchor after merge`, t => {
  const f = analysisFixture(t), run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate({ contactPaths: found(f.contact), researchLinks: found(f.link) })] }));
  f.database.prepare(`DELETE FROM ${type === "person" ? "people" : "projects"} WHERE id=?`).run(type === "person" ? "contact-person" : "related-project");
  assert.throws(() => f.ledger.complete(run), { code: "sourcing_invalid_analysis_link" });
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, undefined);
  assert.equal(f.ledger.snapshot().run.status, "running");
});

test("duplicate discoveries merge, provenance and first discovery remain stable", t => {
  const f = fixture(t), run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate()] }));
  f.advance(1000);
  f.ledger.merge(receipt(run, { candidates: [candidate({ sources: [{ url: "https://example.org/company?utm_source=repeat", type: "official" }], discoveryPath: ["GitHub"] })] }));
  const snapshot = f.ledger.snapshot();
  assert.equal(snapshot.candidates.length, 1);
  assert.equal(snapshot.candidates[0].discoveredAt, f.now() - 1000);
  assert.equal(snapshot.candidates[0].lastSeenAt, f.now());
  assert.deepEqual(snapshot.candidates[0].discoveryPath, ["Lab", "Alumni page", "Homepage", "GitHub"]);
  assert.equal(snapshot.candidates[0].sources.length, 1);
  assert.equal(snapshot.run.leaseToken, undefined);
});

test("successful empty-candidate scan is idempotent per Shanghai day, not UTC", t => {
  const f = fixture(t); f.setNow("2026-10-21T15:59:00Z");
  const run = f.ledger.begin(); f.ledger.merge(receipt(run)); f.ledger.complete(run);
  assert.equal(f.ledger.begin().reason, "already_updated");
  f.advance(2 * 60000);
  assert.equal(dayKey(f.now()), "2026-10-22");
  assert.equal(f.ledger.begin().reason, "not_due");
  f.setNow("2026-10-22T01:00:00Z");
  assert.equal(f.ledger.begin().started, true);
});

test("active lease rejects concurrent begin even force; stale lease is reclaimed and old writer rejected", t => {
  const f = fixture(t), old = f.ledger.begin();
  assert.equal(f.ledger.begin({ force: true }).reason, "busy");
  f.advance(LEASE_MS + 1);
  const current = f.ledger.begin();
  assert.equal(current.started, true);
  assert.notEqual(current.runId, old.runId);
  assert.throws(() => f.ledger.merge(receipt(old)), { code: "sourcing_run_mismatch" });
  assert.equal(f.ledger.read().history.at(-1).status, "failed");
});

test("failed and partial scans do not advance success watermark; scheduled retries back off and stop", t => {
  const f = fixture(t), initial = f.ledger.begin();
  f.ledger.merge(receipt(initial)); f.ledger.complete(initial);
  const lastSuccessAt = f.ledger.snapshot().run.lastSuccessAt;
  f.advance(86400000);
  let run = f.ledger.begin();
  f.ledger.fail({ ...run, error: "Network unavailable" });
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, lastSuccessAt);
  assert.equal(f.ledger.begin().reason, "backoff");
  f.advance(RETRY_MS);
  run = f.ledger.begin();
  f.ledger.merge(receipt(run, { sources: [
    { name: "Lab", type: "lab", url: "https://example.org/lab", status: "checked" },
    { name: "Other Lab", type: "lab", url: "https://example.org/other-lab", status: "failed" }
  ], coverage: { checked: 1, failed: 1, pending: 0 } }));
  f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "partial");
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, lastSuccessAt);
  f.advance(RETRY_MS);
  run = f.ledger.begin(); f.ledger.fail({ ...run, error: "still unavailable" });
  f.advance(RETRY_MS);
  assert.equal(f.ledger.read().run.attempts, MAX_DAILY_ATTEMPTS);
  assert.equal(f.ledger.begin().reason, "daily_retry_limit");
  assert.equal(f.ledger.begin({ force: true }).started, true);
});

test("completion requires stored merge proof and rejects empty work claims", t => {
  const f = fixture(t), run = f.ledger.begin();
  assert.throws(() => f.ledger.complete({ ...run, completed: true }), { code: "sourcing_receipt_missing" });
  assert.throws(() => f.ledger.merge(receipt(run, { coverage: { checked: 0, failed: 0, pending: 0 } })), /至少一个/);
  assert.throws(() => f.ledger.merge(receipt(run, { sources: [] })), { code: "sourcing_invalid_coverage" });
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, undefined);
  assert.equal(f.ledger.snapshot().run.status, "running");
});

test("unrelated and nonexistent repository links cannot pass as created", t => {
  const f = fixture(t), run = f.ledger.begin();
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ intake: { status: "created", projectId: "invented" } })] })), { code: "sourcing_invalid_link" });
  f.database.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run("unrelated", "Completely Unrelated", f.now());
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ intake: { status: "created", projectId: "unrelated" } })] })), { code: "sourcing_identity_conflict" });
  f.database.prepare("INSERT INTO projects(id,name,created_at,notes) VALUES(?,?,?,?)").run("unverified", "Early Research", f.now(), "https://example.org/company");
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ intake: { status: "created", projectId: "unverified" } })] })), { code: "sourcing_receipt_missing" });
  assert.equal(f.ledger.snapshot().candidates.length, 0);
});

test("corroborated existing entity matches; incremental receipt retains links and final readback catches deletion", t => {
  const f = fixture(t);
  f.database.prepare("INSERT INTO projects(id,name,created_at,notes) VALUES(?,?,?,?)").run("existing", "Early Research", f.now() - 10000, "https://example.org/company");
  const run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate({ intake: { status: "matched", projectId: "existing" } })], completed: false }));
  f.ledger.merge(receipt(run));
  f.database.prepare("DELETE FROM projects WHERE id = ?").run("existing");
  assert.throws(() => f.ledger.complete(run), { code: "sourcing_invalid_link" });
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, undefined);
});

test("name match without canonical URL corroboration is insufficient; alias with matching URL can match", t => {
  const f = fixture(t);
  f.database.prepare("INSERT INTO projects(id,name,created_at,aliases_json) VALUES(?,?,?,?)").run("existing", "Canonical Company", f.now() - 10000, JSON.stringify(["Early Research"]));
  let run = f.ledger.begin();
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ intake: { status: "matched", projectId: "existing" } })] })), { code: "sourcing_identity_conflict" });
  f.ledger.fail({ ...run, error: "identity pending" });
  f.database.prepare("UPDATE projects SET notes=? WHERE id=?").run("https://example.org/company", "existing");
  run = f.ledger.begin({ force: true });
  f.ledger.merge(receipt(run, { candidates: [candidate({ intake: { status: "matched", projectId: "existing" } })] }));
  f.ledger.complete(run);
  const loaded = new SourcingLedger({ libraryDir: f.directory, databasePath: f.databasePath });
  assert.equal(loaded.snapshot().candidates[0].intake.status, "matched");
  assert.equal(loaded.snapshot().sources[0].lastCheckedAt, f.now());
  assert.equal(loaded.snapshot().run.status, "idle");
});

test("CLI respects explicit legacy backend and never creates a parallel ledger", t => {
  const f = fixture(t), configPath = path.join(f.directory, "legacy.json");
  fs.writeFileSync(configPath, JSON.stringify({ storageBackend: "feishu", localRepositoryDir: path.join(f.directory, "other"), localDatabasePath: f.databasePath }));
  const result = spawnSync(process.execPath, [path.join(__dirname, "sourcing-ledger.cjs"), "snapshot"], { encoding: "utf8", env: { ...process.env, DOMI_CONFIG_PATH: configPath } });
  const value = JSON.parse(result.stdout);
  assert.equal(value.ok, false);
  assert.equal(value.snapshot.configured, false);
  assert.equal(value.code, "sourcing_backend_unsupported");
  assert.equal(fs.existsSync(path.join(f.directory, "other")), false);
});

test("CLI persists a full configured-local lifecycle without accessing user state", t => {
  const f = fixture(t), configPath = path.join(f.directory, "local.json"), requestPath = path.join(f.directory, "request.json");
  fs.writeFileSync(configPath, JSON.stringify({ storageBackend: "local", localRepositoryDir: f.directory, localDatabasePath: f.databasePath }));
  function command(name, input) {
    const args = [path.join(__dirname, "sourcing-ledger.cjs"), name];
    if (input) { fs.writeFileSync(requestPath, JSON.stringify(input)); args.push("--json-file", requestPath); }
    const result = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, DOMI_CONFIG_PATH: configPath } });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    return JSON.parse(result.stdout);
  }
  assert.equal(command("snapshot").snapshot.configured, true);
  command("configure", { settings: { enabled: true } });
  const run = command("begin", { force: true });
  command("merge", receipt(run));
  const complete = command("complete", { runId: run.runId, leaseToken: run.leaseToken });
  assert.equal(complete.snapshot.run.status, "idle");
  assert.ok(complete.snapshot.run.lastSuccessAt);
  assert.equal(command("begin", {}).reason, "already_updated");
});

test("expired runs are schedulable and exhausting retries delays to next day", t => {
  const f = fixture(t);
  assert.ok(f.ledger.snapshot().run.nextRunAt <= f.now());
  f.ledger.begin(); f.advance(LEASE_MS + 1);
  assert.equal(f.ledger.snapshot().run.status, "failed");
  assert.ok(f.ledger.snapshot().run.nextRunAt <= f.now());
  let run = f.ledger.begin(); f.ledger.fail({ ...run, error: "offline" }); f.advance(RETRY_MS);
  run = f.ledger.begin(); f.ledger.fail({ ...run, error: "offline" }); f.advance(RETRY_MS);
  assert.ok(f.ledger.snapshot().run.nextRunAt > f.now());
});

test("configure replaces source list, edits URLs clear checks, and runs cannot resurrect removed or paused sources", t => {
  const f = fixture(t);
  f.ledger.configure({ sources: [
    { name: "A", type: "lab", url: "https://example.org/a", enabled: true },
    { name: "B", type: "lab", url: "https://example.org/b", enabled: true }
  ] });
  const run = f.ledger.begin();
  const [a, b] = f.ledger.snapshot().sources;
  f.ledger.merge(receipt(run, { completed: false, sources: [{ ...a, status: "checked" }], coverage: { checked: 1, failed: 0, pending: 1 } }));
  f.ledger.configure({ sources: [{ ...a, url: "https://example.org/a-new" }, { ...b, enabled: false }] });
  const edited = f.ledger.snapshot().sources[0];
  assert.equal(edited.id, a.id); assert.equal(edited.status, "pending"); assert.equal(edited.lastCheckedAt, undefined);
  assert.throws(() => f.ledger.merge(receipt(run, { completed: false, sources: [{ ...a, status: "checked" }, { ...b, enabled: true, status: "checked" }] })), { code: "sourcing_source_out_of_scope" });
  assert.equal(f.ledger.snapshot().sources.some(source => source.url === a.url), false);
  assert.equal(f.ledger.snapshot().sources.find(source => source.id === b.id).enabled, false);
  f.ledger.configure({ sources: [] });
  assert.throws(() => f.ledger.merge(receipt(run, { completed: false, sources: [{ ...b, status: "checked" }] })), { code: "sourcing_source_out_of_scope" });
  assert.equal(f.ledger.snapshot().sources.length, 0);
});

test("all enabled sources at begin are frozen in coverage and omissions stay pending", t => {
  const f = fixture(t);
  f.ledger.configure({ sources: [
    { name: "A", url: "https://example.org/a", type: "lab", enabled: true },
    { name: "B", url: "https://example.org/b", type: "lab", enabled: true },
    { name: "Paused", url: "https://example.org/paused", type: "lab", enabled: false }
  ] });
  const run = f.ledger.begin();
  const sources = [{ name: "A", url: "https://example.org/a", type: "lab", status: "checked" }];
  assert.throws(() => f.ledger.merge(receipt(run, { sources })), { code: "sourcing_invalid_coverage" });
  f.ledger.merge(receipt(run, { sources, coverage: { checked: 1, failed: 0, pending: 1 } }));
  f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "partial");
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, undefined);
});

test("same-name people sharing lab list do not merge without a dedicated identity", t => {
  const f = fixture(t), run = f.ledger.begin();
  const shared = { url: "https://lab.example/team.html", type: "lab", title: "Lab list" };
  const person = profile => ({ name: "Wei Wang", kind: "person", sources: [shared, { url: profile, type: "profile" }] });
  f.ledger.merge(receipt(run, { candidates: [person("https://one.example"), person("https://two.example")] }));
  assert.equal(f.ledger.snapshot().candidates.length, 2);
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [{ ...person("https://one.example"), identityUrl: shared.url }] })), { code: "sourcing_identity_required" });
});


test("auto-intake cannot change during active run, while scheduling may be paused", t => {
  const f = fixture(t), run = f.ledger.begin();
  assert.throws(() => f.ledger.configure({ settings: { autoIntake: false } }), { code: "sourcing_settings_busy" });
  assert.equal(f.ledger.snapshot().settings.autoIntake, true);
  f.ledger.configure({ settings: { enabled: false } });
  assert.equal(f.ledger.snapshot().settings.enabled, false);
  f.ledger.fail({ ...run, error: "stopped" });
  f.ledger.configure({ settings: { autoIntake: false } });
  assert.equal(f.ledger.snapshot().settings.autoIntake, false);
});

test("document-only changes require a fresh archive receipt", t => {
  const f = fixture(t);
  f.database.exec("CREATE TABLE documents(id TEXT PRIMARY KEY,owner_type TEXT,owner_id TEXT,path TEXT,updated_at INTEGER)");
  f.database.prepare("INSERT INTO projects(id,name,created_at,notes) VALUES(?,?,?,?)").run("existing", "Early Research", f.now() - 10000, "https://example.org/company");
  const run = f.ledger.begin();
  const documentPath = path.join(f.directory, "appended-research.md");
  fs.writeFileSync(documentPath, "# Added research\nhttps://example.org/company\n");
  f.database.prepare("INSERT INTO documents VALUES(?,?,?,?,?)").run("research", "project", "existing", documentPath, f.now());
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ intake: { status: "matched", projectId: "existing" } })] })), { code: "sourcing_receipt_missing" });
});

test("auto-intake disabled rejects changes to existing records as well as creations", t => {
  const f = fixture(t);
  f.database.prepare("INSERT INTO projects(id,name,created_at,notes) VALUES(?,?,?,?)").run("existing", "Early Research", f.now() - 10000, "https://example.org/company");
  f.ledger.configure({ settings: { autoIntake: false } });
  const run = f.ledger.begin();
  f.database.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(f.now(), "existing");
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ intake: { status: "matched", projectId: "existing" } })] })), { code: "sourcing_intake_disabled" });
});


test("ledger enforces daily scheduled hour, with explicit manual and due retry exceptions", t => {
  const f = fixture(t); f.setNow("2026-10-21T00:00:00Z");
  assert.equal(f.ledger.begin().reason, "not_due");
  const manual = f.ledger.begin({ force: true }); assert.equal(manual.started, true);
  f.ledger.fail({ ...manual, error: "temporary failure" });
  f.advance(RETRY_MS);
  assert.equal(f.ledger.begin().started, true);
});

test("name-only focuses are independent of web sources; partial config preserves fields and explicit arrays clear", t => {
  const f = fixture(t);
  f.ledger.configure({ sources: [{ name: "Public list", type: "lab", url: "https://example.org/lab" }], focuses: [{ name: "重点实验室", type: "lab" }] });
  let focus = f.ledger.snapshot().focuses[0];
  assert.deepEqual({ ...focus, id: undefined }, { id: undefined, name: "重点实验室", type: "lab", enabled: true, keywords: [], excludedKeywords: [], relations: [], urls: [] });
  const stableId = focus.id;
  f.ledger.configure({ settings: { localHour: 10 } });
  assert.equal(f.ledger.snapshot().focuses[0].id, stableId);
  f.ledger.configure({ focuses: [{ id: stableId, name: "实验室新名字", keywords: [" AI ", "ai"], relations: ["alumni"], urls: ["https://example.org/lab?utm_source=test"] }] });
  focus = f.ledger.snapshot().focuses[0];
  assert.equal(focus.id, stableId); assert.equal(focus.type, "lab");
  assert.deepEqual(focus.keywords, ["ai"]); assert.deepEqual(focus.urls, ["https://example.org/lab"]);
  f.ledger.configure({ focuses: [{ id: stableId, keywords: [], relations: [], urls: [] }] });
  assert.equal(f.ledger.snapshot().focuses[0].name, "实验室新名字");
  assert.deepEqual(f.ledger.snapshot().focuses[0].relations, []);
  f.ledger.configure({ focuses: [] });
  assert.equal(f.ledger.snapshot().focuses.length, 0);
  assert.equal(f.ledger.snapshot().sources.length, 1);
});

test("freeform scope preserves multiline description without classifying or extracting URLs", t => {
  const f = fixture(t);
  const description = `关注ＡＩ科学、重点实验室和相关创业团队。\n  王教授的学生也可以，但不要猜测私人关系。\n指定入口：https://example.org/people\n${"保持用户原文；".repeat(60)}`;
  f.ledger.configure({ focuses: [{ type: "freeform", name: ` \n${description}\n ` }] });
  const focus = f.ledger.snapshot().focuses[0];
  assert.ok(focus.name.length > 300);
  assert.equal(focus.name, description);
  assert.equal(focus.type, "freeform");
  assert.deepEqual(focus.keywords, []);
  assert.deepEqual(focus.relations, []);
  assert.deepEqual(focus.urls, []);
  const run = f.ledger.begin();
  assert.deepEqual(f.ledger.read().run.focusPlan, [focus]);
  assert.deepEqual(f.ledger.read().run.sourceOutcomes, {});
  assert.deepEqual(run.snapshot.run.focusCoverage, { checked: 0, failed: 0, pending: 1 });
  f.ledger.merge(receipt(run, { focusResults: [{ focusId: focus.id, status: "checked", detail: "已逐项检查描述中的实验室、团队及指定公开入口。" }] }));
  f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "idle");
  assert.equal(f.ledger.snapshot().sources[0].focusIds[0], focus.id);
});

test("freeform accepts 4000 characters and rejects over-limit or empty descriptions atomically", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [{ type: "freeform", name: "文".repeat(4000) }] });
  const before = f.ledger.snapshot().focuses;
  assert.equal(before[0].name.length, 4000);
  for (const name of ["文".repeat(4001), " \n\t ", 123]) {
    assert.throws(() => f.ledger.configure({ focuses: [{ type: "freeform", name }] }), { code: "sourcing_invalid_focus" });
    assert.deepEqual(f.ledger.snapshot().focuses, before);
  }
  assert.throws(() => f.ledger.configure({ focuses: [{ type: "lab", name: "文".repeat(301) }] }), { code: "sourcing_invalid_focus" });
});

test("mixed freeform and legacy focuses preserve existing IDs and typed normalization", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [
    { type: "direction", name: " ＡＩ 科学 " }, { type: "lab", name: "重点实验室", relations: ["alumni"] },
    { type: "company", name: "目标公司" }, { type: "person", name: "王教授", urls: ["https://example.org/profile"] }
  ] });
  const legacy = f.ledger.snapshot().focuses;
  assert.equal(legacy[0].name, "AI 科学");
  f.ledger.configure({ focuses: [...legacy, { type: "freeform", name: "ＡＩ方向\n  以及上述实验室的新团队。" }] });
  let mixed = f.ledger.snapshot().focuses;
  assert.deepEqual(mixed.slice(0, 4), legacy);
  const freeform = mixed[4];
  f.ledger.configure({ focuses: [...legacy.map(focus => ({ id: focus.id })), { id: freeform.id, name: "ＡＩ方向\n  只关注公开创业线索。" }] });
  mixed = f.ledger.snapshot().focuses;
  assert.deepEqual(mixed.slice(0, 4), legacy);
  assert.equal(mixed[4].id, freeform.id);
  assert.equal(mixed[4].type, "freeform");
  assert.equal(mixed[4].name, "ＡＩ方向\n  只关注公开创业线索。");
  assert.deepEqual(mixed[4].relations, []);
  assert.throws(() => f.ledger.configure({ focuses: [mixed[4], { ...mixed[4], id: undefined, name: "AI方向 只关注公开创业线索。" }] }), { code: "sourcing_duplicate_focus" });
  assert.deepEqual(f.ledger.snapshot().focuses, mixed);
});

test("focus identity does not collapse same-name people and rejects only duplicate definitions", t => {
  const f = fixture(t);
  const one = { type: "person", name: "Wei Wang", keywords: ["MMLab", "Vision"], urls: ["https://one.example/profile"], relations: ["students", "coauthors"] };
  const two = { ...one, keywords: ["Robotics"], urls: ["https://two.example/profile"] };
  f.ledger.configure({ focuses: [one, two] });
  const original = f.ledger.snapshot().focuses;
  assert.equal(original.length, 2); assert.notEqual(original[0].id, original[1].id);
  f.ledger.configure({ focuses: [two, { ...one, keywords: ["vision", "mmlab"], relations: ["coauthors", "students"] }] });
  assert.equal(f.ledger.snapshot().focuses[0].id, original[1].id);
  assert.equal(f.ledger.snapshot().focuses[1].id, original[0].id);
  assert.throws(() => f.ledger.configure({ focuses: [one, { ...one, name: " WEI WANG ", enabled: false, keywords: ["vision", "mmlab"] }] }), { code: "sourcing_duplicate_focus" });
  assert.equal(f.ledger.snapshot().focuses.length, 2);
});

test("focus settings validate booleans, relation and type enums, arrays and HTTP URLs atomically", t => {
  const f = fixture(t), base = { name: "AI for Science", type: "direction" };
  f.ledger.configure({ focuses: [base] });
  const before = f.ledger.snapshot().focuses;
  for (const invalid of [
    { ...base, enabled: "false" }, { ...base, type: "team" }, { ...base, type: null },
    { ...base, relations: ["private_friends"] }, { ...base, keywords: "chemistry" },
    { ...base, excludedKeywords: [123] }, { ...base, urls: ["file:///etc/passwd"] },
    { ...base, urls: ["https://user:pass@example.org/"] }, { ...base, urls: null }
  ]) {
    assert.throws(() => f.ledger.configure({ focuses: [invalid] }));
    assert.deepEqual(f.ledger.snapshot().focuses, before);
  }
});

test("enabled focus plan is frozen; omitted focus results make source-complete run partial", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [{ name: "重点实验室", type: "lab" }, { name: "暂停方向", type: "direction", enabled: false }] });
  const run = f.ledger.begin();
  assert.deepEqual(run.snapshot.run.focusCoverage, { checked: 0, failed: 0, pending: 1 });
  assert.throws(() => f.ledger.configure({ focuses: [] }), { code: "sourcing_settings_busy" });
  f.ledger.merge(receipt(run)); f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "partial");
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, undefined);
  assert.deepEqual(f.ledger.snapshot().run.focusCoverage, { checked: 0, failed: 0, pending: 1 });
});

test("name-only focus can finish with actual source checks and incrementally saved focus results", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [{ name: "AI for Science", type: "direction" }, { name: "重点公司", type: "company", relations: ["former_employees"] }] });
  const [first, second] = f.ledger.snapshot().focuses;
  const run = f.ledger.begin();
  f.ledger.merge(receipt(run, { completed: false, focusResults: [{ focusId: first.id, status: "checked", detail: "已查公开团队与创业信号" }] }));
  assert.deepEqual(f.ledger.snapshot().run.focusCoverage, { checked: 1, failed: 0, pending: 1 });
  f.ledger.merge(receipt(run, { focusResults: [{ focusId: second.id, status: "checked", detail: "已核验合成测试来源" }] }));
  f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "idle");
  assert.ok(f.ledger.snapshot().run.lastSuccessAt);
  assert.deepEqual(f.ledger.snapshot().run.focusCoverage, { checked: 2, failed: 0, pending: 0 });
  assert.equal(f.ledger.read().run.focusOutcomes[first.id].detail, "已查公开团队与创业信号");
});

test("focus results cannot introduce unknown or paused focuses, duplicate outcomes, or substitute for source proof", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [{ name: "Enabled", type: "person" }, { name: "Paused", type: "person", enabled: false }] });
  const [enabled, paused] = f.ledger.snapshot().focuses, run = f.ledger.begin();
  for (const focusResults of [
    [{ focusId: "invented", status: "checked", detail: "已核验合成测试来源" }], [{ focusId: paused.id, status: "checked", detail: "已核验合成测试来源" }],
    [{ focusId: enabled.id, status: "complete" }], [{ focusId: enabled.id, status: "checked", detail: {} }],
    [{ focusId: enabled.id, status: "checked", detail: "已核验合成测试来源" }, { focusId: enabled.id, status: "failed" }]
  ]) assert.throws(() => f.ledger.merge(receipt(run, { focusResults })), { code: "sourcing_invalid_focus_result" });
  assert.deepEqual(f.ledger.snapshot().run.focusCoverage, { checked: 0, failed: 0, pending: 1 });
  assert.throws(() => f.ledger.merge(receipt(run, { sources: [], coverage: { checked: 0, failed: 0, pending: 0 }, focusResults: [{ focusId: enabled.id, status: "checked", detail: "已核验合成测试来源" }] })), /至少一个/);
  assert.deepEqual(f.ledger.snapshot().run.focusCoverage, { checked: 0, failed: 0, pending: 1 });
});

test("failed focus cannot advance success watermark and deleted focuses never return through run results", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [{ name: "Lab", type: "lab" }] });
  const focus = f.ledger.snapshot().focuses[0], initial = f.ledger.begin();
  f.ledger.merge(receipt(initial, { focusResults: [{ focusId: focus.id, status: "checked", detail: "已核验合成测试来源" }] })); f.ledger.complete(initial);
  const success = f.ledger.snapshot().run.lastSuccessAt;
  f.advance(86400000);
  const next = f.ledger.begin();
  f.ledger.merge(receipt(next, { focusResults: [{ focusId: focus.id, status: "failed", detail: "来源访问失败" }] })); f.ledger.complete(next);
  assert.equal(f.ledger.snapshot().run.status, "partial");
  assert.equal(f.ledger.snapshot().run.lastSuccessAt, success);
  f.ledger.configure({ focuses: [] });
  assert.equal(f.ledger.begin({ force: true }).reason, "focuses_empty");
  f.ledger.configure({ focuses: [{ name: "New scope", type: "direction" }] });
  const current = f.ledger.begin({ force: true });
  assert.throws(() => f.ledger.merge(receipt(current, { sources: [], focusResults: [{ focusId: focus.id, status: "checked", detail: "已核验合成测试来源" }] })), { code: "sourcing_invalid_focus_result" });
  assert.equal(f.ledger.snapshot().focuses.some(item => item.id === focus.id), false);
});

test("all paused focuses prevent scheduled and manual fallback searches without consuming an attempt", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [{ name: "Paused scope", type: "lab", enabled: false }] });
  assert.equal(f.ledger.begin().reason, "focuses_paused");
  assert.equal(f.ledger.begin({ force: true }).reason, "focuses_paused");
  assert.equal(f.ledger.read().run.attempts, undefined);
  assert.equal(f.ledger.snapshot().run.status, "idle");
});

test("legacy ledger and merge without focuses remain compatible", t => {
  const f = fixture(t), old = f.ledger.read();
  delete old.focuses; f.ledger.write(old);
  assert.deepEqual(f.ledger.snapshot().focuses, []);
  const run = f.ledger.begin();
  const persisted = f.ledger.read(); delete persisted.run.focusOutcomes; delete persisted.run.focusPlan; f.ledger.write(persisted);
  f.ledger.merge(receipt(run)); f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "idle");
  assert.ok(f.ledger.snapshot().run.lastSuccessAt);
});

test("enabled focus URLs are mandatory source scope and visible focus outcomes cannot hide omitted URLs", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [
    { name: "Enabled Lab", type: "lab", urls: ["https://example.org/lab", "https://example.org/members"] },
    { name: "Paused Lab", type: "lab", enabled: false, urls: ["https://example.org/paused"] }
  ] });
  const focus = f.ledger.snapshot().focuses[0], run = f.ledger.begin();
  assert.deepEqual(Object.keys(f.ledger.read().run.sourceOutcomes).sort(), ["https://example.org/lab", "https://example.org/members"]);
  assert.throws(() => f.ledger.merge(receipt(run, { focusResults: [{ focusId: focus.id, status: "checked", detail: "已核验合成测试来源" }] })), { code: "sourcing_invalid_coverage" });
  f.ledger.merge(receipt(run, {
    sources: [
      { name: "Lab", type: "lab", url: "https://example.org/lab", status: "checked" },
      { name: "Members", type: "lab", url: "https://example.org/members", status: "checked" }
    ], coverage: { checked: 2, failed: 0, pending: 0 }, focusResults: [{ focusId: focus.id, status: "checked", detail: "指定两个页面已检查" }]
  }));
  f.ledger.complete(run);
  assert.equal(f.ledger.snapshot().run.status, "idle");
  assert.deepEqual(f.ledger.snapshot().run.focusResults, [{ focusId: focus.id, status: "checked", detail: "指定两个页面已检查" }]);
});

test("focus-derived sources keep lineage after scanning and pause without becoming independent sources", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [
    { name: "Lab A", type: "lab", urls: ["https://example.org/a"] },
    { name: "Lab B", type: "lab", urls: ["https://example.org/b"] }
  ], sources: [{ name: "Independent source", type: "event", url: "https://example.org/manual" }] });
  const [a, b] = f.ledger.snapshot().focuses, run = f.ledger.begin();
  const source = (name, url) => ({ name, type: "lab", url, status: "checked" });
  f.ledger.merge(receipt(run, {
    sources: [source("A", a.urls[0]), source("B", b.urls[0]), source("Manual", "https://example.org/manual")],
    coverage: { checked: 3, failed: 0, pending: 0 },
    focusResults: [a, b].map(focus => ({ focusId: focus.id, status: "checked", detail: `已核验 ${focus.urls[0]} 成员和创业信号` }))
  })); f.ledger.complete(run);
  assert.deepEqual(f.ledger.snapshot().sources.find(item => item.url === a.urls[0]).focusIds, [a.id]);
  assert.deepEqual(f.ledger.snapshot().sources.find(item => item.url === b.urls[0]).focusIds, [b.id]);
  assert.equal(f.ledger.snapshot().sources.find(item => item.url.includes("manual")).focusIds, undefined);
  f.ledger.configure({ focuses: [{ ...a, enabled: false }, b] });
  assert.equal(f.ledger.snapshot().sources.find(item => item.url === a.urls[0]).enabled, true);
  assert.equal(f.ledger.snapshot().sources.find(item => item.url === a.urls[0]).inScope, false);
  const next = f.ledger.begin({ force: true });
  assert.deepEqual(Object.keys(f.ledger.read().run.sourceOutcomes).sort(), [b.urls[0], "https://example.org/manual"].sort());
  assert.throws(() => f.ledger.merge(receipt(next, { sources: [source("A", a.urls[0])], completed: false })), { code: "sourcing_source_out_of_scope" });
  assert.throws(() => f.ledger.merge(receipt(next, { sources: [{ ...source("A", a.urls[0]), focusIds: [b.id] }], completed: false })), { code: "sourcing_source_out_of_scope" });
});

test("deleting the last explicitly configured focus preserves history and never restores broad search", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [{ name: "Lab A", type: "lab", urls: ["https://example.org/a"] }] });
  const a = f.ledger.snapshot().focuses[0], run = f.ledger.begin();
  f.ledger.merge(receipt(run, { sources: [{ name: "A", type: "lab", url: a.urls[0], status: "checked" }], focusResults: [{ focusId: a.id, status: "checked", detail: `已核验 ${a.urls[0]}` }] })); f.ledger.complete(run);
  f.ledger.configure({ focuses: [] });
  const snapshot = f.ledger.snapshot(), attempts = f.ledger.read().run.attempts;
  assert.equal(snapshot.focusConfigured, true); assert.deepEqual(snapshot.focuses, []);
  assert.equal(snapshot.sources.length, 1); assert.equal(snapshot.sources[0].inScope, false);
  assert.equal(f.ledger.begin({ force: true }).reason, "focuses_empty");
  assert.equal(f.ledger.begin().reason, "focuses_empty");
  assert.equal(f.ledger.read().run.attempts, attempts);
});

test("name-only focus discoveries require exact active lineage and checked or failed focus outcomes need evidence detail", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [{ name: "Direction A", type: "direction" }, { name: "Direction B", type: "direction" }] });
  const [a, b] = f.ledger.snapshot().focuses, run = f.ledger.begin();
  const source = { name: "Discovered A", type: "person", url: "https://example.org/discovered-a", status: "checked" };
  assert.throws(() => f.ledger.merge(receipt(run, { sources: [source], completed: false })), { code: "sourcing_invalid_source_scope" });
  assert.throws(() => f.ledger.merge(receipt(run, { sources: [{ ...source, focusIds: ["invented"] }], completed: false })), { code: "sourcing_invalid_source_scope" });
  for (const status of ["checked", "failed"]) assert.throws(() => f.ledger.merge(receipt(run, { sources: [{ ...source, focusIds: [a.id] }], focusResults: [{ focusId: a.id, status, detail: "  " }], completed: false })), { code: "sourcing_invalid_focus_result" });
  f.ledger.merge(receipt(run, { sources: [{ ...source, focusIds: [a.id] }], focusResults: [{ focusId: a.id, status: "checked", detail: `查询A方向并核验 ${source.url}` }, { focusId: b.id, status: "pending" }], coverage: { checked: 1, failed: 0, pending: 0 } })); f.ledger.complete(run);
  assert.deepEqual(f.ledger.snapshot().sources[0].focusIds, [a.id]);
  f.ledger.configure({ focuses: [{ ...a, enabled: false }, b] });
  const next = f.ledger.begin({ force: true });
  assert.deepEqual(Object.keys(f.ledger.read().run.sourceOutcomes), []);
  assert.throws(() => f.ledger.merge(receipt(next, { sources: [{ ...source, focusIds: [b.id] }], completed: false })), { code: "sourcing_source_out_of_scope" });
});

test("explicit focus URL cannot be mislabeled as another focus and independent user sources stay independent", t => {
  const f = fixture(t);
  f.ledger.configure({ focuses: [{ name: "A", type: "lab", urls: ["https://example.org/a"] }, { name: "B", type: "lab", urls: ["https://example.org/b"] }],
    sources: [{ name: "Independent A", type: "lab", url: "https://example.org/a" }] });
  const [a, b] = f.ledger.snapshot().focuses, run = f.ledger.begin();
  assert.throws(() => f.ledger.merge(receipt(run, { sources: [{ name: "A", type: "lab", url: a.urls[0], status: "checked", focusIds: [b.id] }], completed: false })), { code: "sourcing_invalid_source_scope" });
  f.ledger.merge(receipt(run, { sources: [{ name: "A", type: "lab", url: a.urls[0], status: "checked" }], completed: false }));
  assert.equal(f.ledger.snapshot().sources[0].focusIds, undefined);
  f.ledger.fail({ ...run, error: "test stopped" });
  f.ledger.configure({ focuses: [{ ...a, enabled: false }, b] });
  assert.equal(f.ledger.snapshot().sources[0].inScope, true);
});

test("old nonempty focus data infers configured mode; old missing focus data remains legacy", t => {
  const f = fixture(t);
  const initial = f.ledger.read(); delete initial.focusConfigured; delete initial.focuses; f.ledger.write(initial);
  assert.equal(f.ledger.snapshot().focusConfigured, false);
  f.ledger.configure({ focuses: [{ name: "Migrated lab", type: "lab", enabled: false }] });
  const populated = f.ledger.read(); delete populated.focusConfigured; f.ledger.write(populated);
  assert.equal(f.ledger.snapshot().focusConfigured, true);
  assert.equal(f.ledger.begin({ force: true }).reason, "focuses_paused");
});

for (const action of ["pause", "delete"]) test(`${action} of a focus URL takes precedence; alternate discovery can finish and explicit restoration re-enables the URL`, t => {
  const f = fixture(t), url = "https://example.org/focus-target";
  f.ledger.configure({ focuses: [{ name: "Target Lab", type: "lab", urls: [url] }] });
  const focus = f.ledger.snapshot().focuses[0], first = f.ledger.begin();
  f.ledger.merge(receipt(first, { sources: [{ name: "Target", type: "lab", url, status: "checked" }], focusResults: [{ focusId: focus.id, status: "checked", detail: `已读取 ${url}` }] })); f.ledger.complete(first);
  const source = f.ledger.snapshot().sources[0];
  f.ledger.configure({ sources: action === "pause" ? [{ ...source, enabled: false }] : [] });
  assert.deepEqual(f.ledger.snapshot().excludedSourceUrls, [url]);
  assert.deepEqual(f.ledger.snapshot().focuses[0].urls, [url]);
  const next = f.ledger.begin({ force: true });
  assert.deepEqual(Object.keys(f.ledger.read().run.sourceOutcomes), []);
  assert.deepEqual(f.ledger.read().run.focusPlan[0].urls, []);
  assert.throws(() => f.ledger.merge(receipt(next, { sources: [{ name: "Target", type: "lab", url, status: "checked", focusIds: [focus.id] }], completed: false })), { code: "sourcing_source_out_of_scope" });
  const alternate = "https://example.org/alternate-profile";
  f.ledger.merge(receipt(next, { sources: [{ name: "Alternate", type: "person", url: alternate, status: "checked", focusIds: [focus.id] }], focusResults: [{ focusId: focus.id, status: "checked", detail: `按实验室名称搜索并核验 ${alternate}；跳过已停用来源` }] })); f.ledger.complete(next);
  assert.equal(f.ledger.snapshot().run.status, "idle");
  const sources = f.ledger.snapshot().sources;
  f.ledger.configure({ sources: action === "pause" ? sources.map(item => item.url === url ? { ...item, enabled: true } : item) : [...sources, { name: "Restored", type: "lab", url, enabled: true }] });
  assert.deepEqual(f.ledger.snapshot().excludedSourceUrls, []);
  const restored = f.ledger.begin({ force: true });
  assert.equal(restored.started, true);
  assert.deepEqual(f.ledger.read().run.focusPlan[0].urls, [url]);
  assert.deepEqual(Object.keys(f.ledger.read().run.sourceOutcomes).sort(), [url, alternate].sort());
});

test("a globally paused shared URL is excluded from every enabled focus plan", t => {
  const f = fixture(t), url = "https://example.org/shared";
  f.ledger.configure({ sources: [{ name: "Shared list", type: "event", url, enabled: false }], focuses: [
    { name: "Lab A", type: "lab", urls: [url] }, { name: "Lab B", type: "lab", urls: [url] }
  ] });
  const run = f.ledger.begin();
  assert.equal(run.started, true);
  assert.deepEqual(f.ledger.read().run.focusPlan.map(focus => focus.urls), [[], []]);
  assert.deepEqual(Object.keys(f.ledger.read().run.sourceOutcomes), []);
  assert.deepEqual(run.snapshot.excludedSourceUrls, [url]);
});

test("read state persists across reopen and daily merges without changing discovery facts", t => {
  const f = fixture(t), run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate()] }));
  const original = f.ledger.snapshot().candidates[0];
  assert.equal(original.userState, undefined);
  f.advance(1000);
  f.ledger.review({ candidateId: original.id, read: true });
  const loaded = new SourcingLedger({ libraryDir: f.directory, databasePath: f.databasePath, now: f.now });
  const read = loaded.snapshot().candidates[0];
  assert.equal(read.userState.readAt, f.now());
  assert.equal(read.userState.updatedAt, f.now());
  assert.equal(read.userState.history, undefined);
  assert.equal(read.lastSeenAt, original.lastSeenAt);
  assert.deepEqual(read.intake, original.intake);
  f.ledger.complete(run);
  f.advance(86400000);
  const next = f.ledger.begin();
  f.ledger.merge(receipt(next, { candidates: [candidate({ id: original.id, userState: { readAt: 1, note: "Forged discovery overwrite" } })] }));
  f.ledger.complete(next);
  assert.deepEqual(f.ledger.snapshot().candidates[0].userState, read.userState);
  f.ledger.review({ candidateId: original.id, read: false });
  assert.equal(f.ledger.snapshot().candidates[0].userState.readAt, undefined);
  assert.equal(f.ledger.snapshot().candidates[0].userState.history, undefined);
});

test("user notes and dispositions retain bounded meaningful history, not view events", t => {
  const f = fixture(t), run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate()] }));
  const id = f.ledger.snapshot().candidates[0].id;
  f.ledger.review({ candidateId: id, read: true, note: "  Ask about retention.  ", disposition: "follow_up" });
  const initial = f.ledger.snapshot().candidates[0].userState;
  assert.equal(initial.note, "Ask about retention.");
  assert.deepEqual(initial.history, [{ at: f.now(), changes: { disposition: "follow_up", note: "Ask about retention." } }]);
  f.ledger.review({ candidateId: id, read: true, note: initial.note, disposition: "follow_up" });
  assert.deepEqual(f.ledger.snapshot().candidates[0].userState.history, initial.history);
  assert.equal(f.ledger.snapshot().candidates[0].userState.updatedAt, initial.updatedAt + 1);
  f.ledger.review({ candidateId: id, read: false });
  assert.equal(f.ledger.snapshot().candidates[0].userState.updatedAt, initial.updatedAt + 2);
  for (let i = 0; i < 23; i++) { f.advance(1); f.ledger.review({ candidateId: id, note: `Synthetic note ${i}` }); }
  const final = f.ledger.snapshot().candidates[0].userState;
  assert.equal(final.history.length, 20);
  assert.equal(final.history[0].changes.note, "Synthetic note 3");
  assert.equal(final.history.at(-1).changes.note, "Synthetic note 22");
  f.ledger.review({ candidateId: id, disposition: "not_interested", note: "" });
  assert.equal(f.ledger.snapshot().candidates[0].userState.disposition, "not_interested");
  assert.equal(f.ledger.snapshot().candidates[0].userState.note, "");
  f.ledger.review({ candidateId: id, disposition: "none" });
  assert.equal(f.ledger.snapshot().candidates[0].userState.disposition, "none");
});

test("manual same-entity confirmation uses canonical current library IDs and never merges records", t => {
  const f = fixture(t);
  f.database.prepare("INSERT INTO projects(id,name,created_at,notes) VALUES(?,?,?,?)").run("canonical", "Canonical Brand", f.now() - 1000, "Unchanged private notes");
  f.database.prepare("INSERT INTO people(id,name,created_at) VALUES(?,?,?)").run("person", "Existing Person", f.now() - 1000);
  const before = f.database.prepare("SELECT * FROM projects ORDER BY id").all();
  const run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate()] }));
  const id = f.ledger.snapshot().candidates[0].id;
  f.ledger.review({ candidateId: id, sameEntity: { type: "project", id: "canonical", name: "Invented name", confirmedAt: 1 }, note: "Same company under its former brand." });
  const state = f.ledger.snapshot().candidates[0].userState;
  assert.deepEqual(state.sameEntity, { type: "project", id: "canonical", name: "Canonical Brand", confirmedAt: f.now() });
  assert.deepEqual(state.history[0].changes.sameEntity, state.sameEntity);
  assert.equal(f.ledger.snapshot().candidates[0].intake.status, "pending");
  assert.deepEqual(f.database.prepare("SELECT * FROM projects ORDER BY id").all(), before);
  const saved = fs.readFileSync(f.ledger.ledgerPath, "utf8");
  for (const sameEntity of [{ type: "project", id: "missing" }, { type: "person", id: "person" }, [], false, {}]) {
    assert.throws(() => f.ledger.review({ candidateId: id, sameEntity, note: "Must not save" }), { code: "sourcing_invalid_review_entity" });
    assert.equal(fs.readFileSync(f.ledger.ledgerPath, "utf8"), saved);
  }
  f.ledger.complete(run);
  f.ledger.review({ candidateId: id, sameEntity: null });
  assert.equal(f.ledger.snapshot().candidates[0].userState.sameEntity, undefined);
  assert.equal(f.ledger.snapshot().candidates[0].userState.history.at(-1).changes.sameEntity, null);
  assert.deepEqual(f.database.prepare("SELECT * FROM projects ORDER BY id").all(), before);
});

test("review during a live run survives stale discovery output and completion", t => {
  const f = fixture(t);
  f.database.prepare("INSERT INTO projects(id,name,created_at,notes) VALUES(?,?,?,?)").run("original", "Early Research", f.now() - 1000, "https://example.org/company");
  f.database.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run("corrected", "Renamed Entity", f.now() - 1000);
  const run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate({ intake: { status: "matched", projectId: "original" } })] }));
  const stale = f.ledger.snapshot().candidates[0];
  f.ledger.review({ candidateId: stale.id, read: true, disposition: "follow_up", note: "The original auto-match is wrong.", sameEntity: { type: "project", id: "corrected" } });
  const review = f.ledger.snapshot().candidates[0].userState;
  f.ledger.complete(run);
  assert.deepEqual(f.ledger.snapshot().candidates[0].userState, review);
  assert.equal(f.ledger.snapshot().candidates[0].intake.projectId, "original");
  f.advance(86400000);
  const next = f.ledger.begin();
  assert.throws(() => f.ledger.merge(receipt(next, { candidates: [{ ...stale, userState: { disposition: "none" } }] })), { code: "sourcing_review_identity_conflict" });
  const { intake, ...withoutIntake } = stale;
  f.ledger.merge(receipt(next, { candidates: [{ ...withoutIntake, userState: { note: "Pretend this was the user's correction" } }] }));
  assert.deepEqual(f.ledger.snapshot().candidates[0].userState, review);
  f.ledger.merge(receipt(next, { candidates: [{ ...stale, intake: { status: "matched", projectId: "corrected" } }] }));
  f.ledger.complete(next);
  assert.equal(f.ledger.snapshot().candidates[0].intake.projectId, "corrected");
  assert.deepEqual(f.ledger.snapshot().candidates[0].userState, review);
});

test("manual identity resolves alias evidence but does not bypass real write receipt verification", t => {
  const f = fixture(t);
  f.database.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)").run("canonical", "Different Canonical Brand", f.now() - 1000, f.now() - 1000);
  const first = f.ledger.begin();
  f.ledger.merge(receipt(first, { candidates: [candidate()] }));
  const id = f.ledger.snapshot().candidates[0].id;
  f.ledger.review({ candidateId: id, sameEntity: { type: "project", id: "canonical" } });
  f.ledger.complete(first);
  f.advance(86400000);
  const run = f.ledger.begin();
  f.database.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(f.now(), "canonical");
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ id, intake: { status: "matched", projectId: "canonical" } })] })), { code: "sourcing_receipt_missing" });
  assert.equal(f.ledger.snapshot().candidates[0].intake.status, "pending");
  assert.equal(f.ledger.snapshot().candidates[0].userState.sameEntity.id, "canonical");
});

test("person identity confirmation rejects projects and conflicting people intake", t => {
  const f = fixture(t);
  for (const id of ["person-a", "person-b"]) f.database.prepare("INSERT INTO people(id,name,created_at) VALUES(?,?,?)").run(id, `Canonical ${id}`, f.now() - 1000);
  const run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate({ kind: "person", name: "Public Alias" })] }));
  const id = f.ledger.snapshot().candidates[0].id;
  assert.throws(() => f.ledger.review({ candidateId: id, sameEntity: { type: "project", id: "person-a" } }), { code: "sourcing_invalid_review_entity" });
  f.ledger.review({ candidateId: id, sameEntity: { type: "person", id: "person-a" } });
  assert.throws(() => f.ledger.merge(receipt(run, { candidates: [candidate({ id, kind: "person", intake: { status: "matched", personIds: ["person-a", "person-b"] } })] })), { code: "sourcing_review_identity_conflict" });
  f.ledger.merge(receipt(run, { candidates: [candidate({ id, kind: "person", intake: { status: "matched", personIds: ["person-a"] } })] }));
  f.ledger.complete(run);
  assert.deepEqual(f.ledger.snapshot().candidates[0].intake.personIds, ["person-a"]);
});

test("automated output cannot invent user state, and invalid reviews are atomic", t => {
  const f = fixture(t), run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate({ userState: { readAt: 1, sameEntity: { type: "project", id: "fake" }, note: "Forged" } })] }));
  const id = f.ledger.snapshot().candidates[0].id;
  assert.equal(f.ledger.snapshot().candidates[0].userState, undefined);
  const before = fs.readFileSync(f.ledger.ledgerPath, "utf8");
  for (const extra of [{}, { read: 1 }, { note: "x".repeat(4001) }, { note: null }, { disposition: "done" }, { read: true, updatedAt: 1 }, { readAt: 1 }]) {
    assert.throws(() => f.ledger.review({ candidateId: id, ...extra }), { code: "sourcing_invalid_review" });
    assert.equal(fs.readFileSync(f.ledger.ledgerPath, "utf8"), before);
  }
  assert.throws(() => f.ledger.review({ candidateId: "missing", read: true }), { code: "sourcing_candidate_missing" });
  assert.equal(fs.readFileSync(f.ledger.ledgerPath, "utf8"), before);
});

test("library search is bounded, canonical and read-only with aliases and organization matching", t => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++) f.database.prepare("INSERT INTO projects(id,name,created_at,legal_name,aliases_json,notes) VALUES(?,?,?,?,?,?)").run(`project-${i}`, `Synthetic Brand ${i}`, f.now() - 1000, `Synthetic Legal ${i}`, JSON.stringify([`Legacy Name ${i}`]), "Unrelated private notes never returned");
  f.database.prepare("INSERT INTO people(id,name,created_at,organization) VALUES(?,?,?,?)").run("person", "Synthetic Person", f.now() - 1000, "Synthetic Public Lab");
  const before = fs.readFileSync(f.ledger.ledgerPath, "utf8");
  const broad = f.ledger.searchLibrary({ type: "project", query: "Synthetic" });
  assert.equal(broad.matches.length, 20);
  assert.ok(broad.snapshot.configured);
  const exact = f.ledger.searchLibrary({ type: "project", query: "Synthetic Brand 1" }).matches;
  assert.equal(exact[0].id, "project-1");
  const alias = f.ledger.searchLibrary({ type: "project", query: "Legacy Name 24" }).matches;
  assert.deepEqual(alias, [{ type: "project", id: "project-24", name: "Synthetic Brand 24", summary: "Synthetic Legal 24" }]);
  assert.equal(f.ledger.searchLibrary({ type: "project", query: "Synthetic Legal 24" }).matches[0].id, "project-24");
  assert.deepEqual(f.ledger.searchLibrary({ type: "person", query: "Public Lab" }).matches, [{ type: "person", id: "person", name: "Synthetic Person", summary: "Synthetic Public Lab" }]);
  assert.deepEqual(f.ledger.searchLibrary({ type: "project", query: "' OR 1=1 --" }).matches, []);
  assert.equal(JSON.stringify(broad).includes("Unrelated private notes"), false);
  for (const input of [{ query: "Synthetic" }, { type: "project", query: "" }, { type: "project", query: "  " }, { type: "person", query: "?" }, { type: "all", query: "Synthetic" }, { type: "project", query: "x".repeat(201) }]) assert.throws(() => f.ledger.searchLibrary(input), { code: "sourcing_invalid_library_query" });
  assert.equal(fs.readFileSync(f.ledger.ledgerPath, "utf8"), before);
});

test("CLI review and library search return persisted synthetic results through supported commands", t => {
  const f = fixture(t), configPath = path.join(f.directory, "review-local.json"), requestPath = path.join(f.directory, "review-request.json");
  fs.writeFileSync(configPath, JSON.stringify({ storageBackend: "local", localRepositoryDir: f.directory, localDatabasePath: f.databasePath }));
  f.database.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run("canonical", "Synthetic Canonical", f.now() - 1000);
  const run = f.ledger.begin();
  f.ledger.merge(receipt(run, { candidates: [candidate()] }));
  const id = f.ledger.snapshot().candidates[0].id;
  function command(name, input) {
    fs.writeFileSync(requestPath, JSON.stringify(input));
    const result = spawnSync(process.execPath, [path.join(__dirname, "sourcing-ledger.cjs"), name, "--json-file", requestPath], { encoding: "utf8", env: { ...process.env, DOMI_CONFIG_PATH: configPath } });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    return JSON.parse(result.stdout);
  }
  assert.equal(command("search-library", { type: "project", query: "Canonical" }).matches[0].id, "canonical");
  const review = command("review", { candidateId: id, read: true, note: "Synthetic CLI note", sameEntity: { type: "project", id: "canonical" } });
  assert.equal(review.snapshot.candidates[0].userState.note, "Synthetic CLI note");
  assert.equal(review.snapshot.candidates[0].userState.sameEntity.name, "Synthetic Canonical");
  assert.ok(review.snapshot.candidates[0].userState.readAt);
  assert.equal(f.ledger.snapshot().candidates[0].userState.note, "Synthetic CLI note");
});
