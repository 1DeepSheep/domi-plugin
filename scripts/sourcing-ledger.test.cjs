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
  return { name: "Early Research", kind: "company", identityUrl: "https://example.org/company", founders: ["Person A"], sources: [{ url: "https://example.org/company", title: "Official", type: "official" }], summary: "Early project", discoveryPath: ["Lab", "Alumni page", "Homepage"], ...extra };
}
function receipt(run, extra = {}) {
  return { runId: run.runId, leaseToken: run.leaseToken, candidates: [], sources: [{ name: "Lab", type: "lab", url: "https://example.org/lab", status: "checked" }], completed: true, coverage: { checked: 1, failed: 0, pending: 0 }, ...extra };
}

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
  f.ledger.merge(receipt(run, { completed: false, sources: [{ ...a, status: "checked" }, { ...b, enabled: true, status: "checked" }] }));
  assert.equal(f.ledger.snapshot().sources.some(source => source.url === a.url), false);
  assert.equal(f.ledger.snapshot().sources.find(source => source.id === b.id).enabled, false);
  f.ledger.configure({ sources: [] });
  f.ledger.merge(receipt(run, { completed: false, sources: [{ ...b, status: "checked" }] }));
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
