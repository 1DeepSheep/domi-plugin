"use strict";
// Isolated synthetic review only. No user repository or configuration is read.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const test = require("node:test");
const plugin = path.resolve(__dirname, "..");
const { DomiRepository } = require(path.join(plugin, "scripts/domi-repo.cjs"));
const { SourcingLedger } = require(path.join(plugin, "scripts/sourcing-ledger.cjs"));
const { artifact, contextBundle, saveManifest, checkpointManifest, finalize } = require(path.join(plugin, "scripts/domi-workflow.cjs"));
const results = [];
function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sourcing-review-"));
  const libraryDir = path.join(root, "library"), databasePath = path.join(root, "repo.sqlite");
  const repository = new DomiRepository({ libraryDir, databasePath });
  let now = Date.now() - 5;
  const ledger = new SourcingLedger({ libraryDir, databasePath, now: () => now });
  ledger.configure({ settings: { localHour: 0 } });
  const write = (name, value) => { const file = path.join(root, name); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value)); return file; };
  try { callback({ root, repository, ledger, write, advance: ms => { now += ms; } }); }
  finally { repository.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
const source = suffix => ({ name: suffix, type: "lab", url: `https://example.org/${suffix}`, enabled: true, status: "checked" });
const result = (run, extras = {}) => ({ runId: run.runId, leaseToken: run.leaseToken, completed: true, candidates: [], sources: [source("lab")], coverage: { checked: 1, failed: 0, pending: 0 }, ...extras });
function makeArchivedEntity(f, run, type) {
  const name = type === "project" ? "Synthetic Review Project" : "Synthetic Review Person";
  const identityUrl = `https://example.org/${type}`;
  const row = type === "project" ? f.repository.upsertProject({ name, domain: "AI", notes: `Synthetic fixture. ${identityUrl}` }).project : f.repository.upsertPerson({ name, organization: `Synthetic Lab ${identityUrl}` }).person;
  const workflowRunId = `${run.runId}:${type}`;
  const note = artifact({ role: "discovery_note", stage: "sourcing", path: f.write(`${type}-note.md`, `# ${name}\n\nSynthetic identity/source verification fixture. ${identityUrl}\n`) });
  const sources = artifact({ role: "source_ledger", stage: "sourcing", path: f.write(`${type}-sources.json`, { sources: [{ url: identityUrl, status: "checked" }], synthetic: true }) });
  const qa = artifact({ role: "qa_receipt", stage: "sourcing", path: f.write(`${type}-qa.json`, { schema: "domi.semantic-qa.v1", workflowRunId, stage: "sourcing", reviewer: "model", artifacts: [note, sources], checks: Object.fromEntries(["source_reading", "entity", "evidence", "numbers", "completeness", "attribution", "editorial"].map(key => [key, "passed"])), overall: "passed", materialConflicts: [], checkedAt: new Date().toISOString(), syntheticTestFixture: true }) });
  const manifest = { schema: "domi.handoff.v1", workflowRunId, executionRunId: run.runId, workflow: "underwater-discovery", mode: "underwater_discover", entity: { type, fingerprint: `synthetic-${type}`, [type === "project" ? "projectId" : "personId"]: row.id, ...(type === "project" ? { recordRevision: row.recordRevision, recordHash: row.recordHash } : {}) }, authorization: { sourceTurnId: "synthetic-test-only", internalWrite: true, externalWrite: false, externalTargets: [] }, repository: { backend: "local", lockedAt: new Date().toISOString() }, currentStage: "sourcing", nextStage: "archive", completedStages: [], artifacts: [note, sources, qa], stagePlan: [{ name: "sourcing", skill: "sourcing", mode: "underwater_discover", requiredRoles: ["discovery_note", "source_ledger"], ruleBundleSha256: contextBundle({ skill: "sourcing", mode: "underwater_discover" }).bundleSha256 }, { name: "archive", skill: "investment-mgmt", requiredRoles: ["discovery_note"], ruleBundleSha256: contextBundle({ skill: "investment-mgmt" }).bundleSha256 }] };
  const manifestPath = path.join(f.root, `${type}-manifest.json`), receiptPath = path.join(f.root, `${type}-receipt.json`);
  let saved = saveManifest(manifestPath, { expectedHash: null, manifest });
  saved = checkpointManifest(manifestPath, { expectedHash: saved.manifestSha256, completeStage: true, advance: true });
  const doc = f.repository.createDocument({ ownerType: type, ownerId: row.id, kind: "研究", title: "Synthetic Discovery", contentFile: note.path }).document;
  const current = type === "project" ? f.repository.getProject(row.id) : f.repository.getPerson(row.id);
  saved = checkpointManifest(manifestPath, { expectedHash: saved.manifestSha256, entityBinding: { [type === "project" ? "projectId" : "personId"]: row.id, ...(type === "project" ? { recordRevision: current.recordRevision, recordHash: current.recordHash } : {}) }, archiveArtifacts: [artifact({ role: "discovery_note", path: doc.path })] });
  finalize(manifestPath, receiptPath, f.repository);
  return { name, kind: type === "project" ? "company" : "person", identityUrl, sources: [{ url: identityUrl }], intake: { status: "created", ...(type === "project" ? { projectId: row.id } : { personIds: [row.id] }), receipts: [{ entityType: type, entityId: row.id, manifestPath, receiptPath }] } };
}
for (const type of ["project", "person"]) test(`${type}: actual archive and unchanged next-day scan`, () => fixture(f => {
  f.ledger.configure({ settings: { enabled: true }, sources: [source("lab")] });
  const run = f.ledger.begin();
  const candidate = makeArchivedEntity(f, run, type);
  f.ledger.merge(result(run, { candidates: [candidate] })); f.ledger.complete(run);
  assert.ok(f.ledger.snapshot().run.lastSuccessAt);
  results.push(`${type}: actual finalize → ledger merge → complete PASS`);
  f.advance(86400000);
  const next = f.ledger.begin();
  const old = f.ledger.snapshot().candidates[0];
  f.ledger.merge(result(next, { candidates: [{ ...old, intake: { ...old.intake, status: "matched" } }] }));
  f.ledger.complete(next);
}));
test("borrowed, missing and tampered storage receipts are rejected", () => fixture(f => {
  f.ledger.configure({ settings: { enabled: true }, sources: [source("lab")] });
  const run = f.ledger.begin(), candidate = makeArchivedEntity(f, run, "project");
  const noReceipt = structuredClone(candidate); delete noReceipt.intake.receipts;
  assert.throws(() => f.ledger.merge(result(run, { candidates: [noReceipt] })), { code: "sourcing_receipt_missing" });
  assert.throws(() => f.ledger.merge(result(run, { candidates: [{ ...candidate, name: "Completely Unrelated Company" }] })), { code: "sourcing_identity_conflict" });
  assert.throws(() => f.ledger.merge(result(run, { candidates: [{ ...candidate, identityUrl: "https://other.example/", sources: [{ url: "https://other.example/" }] }] })), { code: "sourcing_identity_conflict" });
  const receiptPath = candidate.intake.receipts[0].receiptPath;
  const originalReceipt = fs.readFileSync(receiptPath, "utf8"), invalidReceipt = JSON.parse(originalReceipt);
  invalidReceipt.executionRunId = "another-run"; fs.writeFileSync(receiptPath, JSON.stringify(invalidReceipt));
  assert.throws(() => f.ledger.merge(result(run, { candidates: [candidate] })), { code: "sourcing_invalid_receipt" });
  fs.writeFileSync(receiptPath, originalReceipt);
  const receipt = JSON.parse(originalReceipt), archivedNote = receipt.artifacts.find(file => file.role === "discovery_note");
  const originalNote = fs.readFileSync(archivedNote.path, "utf8"); fs.appendFileSync(archivedNote.path, "\nUnreviewed drift.\n");
  assert.throws(() => f.ledger.merge(result(run, { candidates: [candidate] })), { code: "sourcing_invalid_receipt" });
  fs.writeFileSync(archivedNote.path, originalNote);
  f.ledger.merge(result(run, { candidates: [candidate] })); f.ledger.complete(run);
}));
test("disabled auto-intake rejects new entity success", () => fixture(f => {
  f.ledger.configure({ settings: { enabled: true, autoIntake: false }, sources: [source("lab")] });
  const run = f.ledger.begin(), candidate = makeArchivedEntity(f, run, "project");
  assert.throws(() => f.ledger.merge(result(run, { candidates: [candidate] })), { code: "sourcing_intake_disabled" });
}));
test("omitted sources cannot produce a full success", () => fixture(f => {
  f.ledger.configure({ settings: { enabled: true }, sources: [source("lab"), source("other")] });
  const run = f.ledger.begin();
  assert.throws(() => f.ledger.merge(result(run)), { code: "sourcing_invalid_coverage" });
  results.push("Omitted enabled source rejected PASS");
  f.ledger.merge(result(run, { sources: [source("lab"), { ...source("other"), status: "pending" }], coverage: { checked: 1, failed: 0, pending: 1 } }));
  f.ledger.complete(run); assert.equal(f.ledger.snapshot().run.status, "partial");
}));
test("dedicated personal URLs prevent same-name collapse and allow lab profile details", () => fixture(f => {
  f.ledger.configure({ settings: { enabled: true }, sources: [source("lab")] });
  const run = f.ledger.begin();
  const candidate = (signal, identityUrl) => ({ name: "Wei Wang", kind: "person", signal, identityUrl, sources: [{ url: "https://example.edu/lab/people" }, { url: identityUrl }] });
  f.ledger.merge(result(run, { candidates: [candidate("Alpha", "https://alpha.example/about"), candidate("Beta", "https://beta.example/about")] }));
  assert.equal(f.ledger.snapshot().candidates.length, 2); results.push("Same-name people sharing list page remain distinct PASS");
  f.ledger.merge(result(run, { candidates: [candidate("Lab profile", "https://example.edu/people/wei-wang")] }));
  assert.equal(f.ledger.snapshot().candidates.length, 3);
}));

for (const type of ["project", "person"]) test(`${type}: existing record update with a fresh archive receipt`, () => fixture(f => {
  const name = type === "project" ? "Synthetic Review Project" : "Synthetic Review Person";
  const identityUrl = `https://example.org/${type}`;
  if (type === "project") f.repository.upsertProject({ name, notes: `Earlier source ${identityUrl}` });
  else f.repository.upsertPerson({ name, organization: `Earlier source ${identityUrl}` });
  f.ledger.configure({ settings: { enabled: true }, sources: [source("lab")] });
  const run = f.ledger.begin(), candidate = makeArchivedEntity(f, run, type);
  candidate.intake.status = "matched";
  f.ledger.merge(result(run, { candidates: [candidate] })); f.ledger.complete(run);
  assert.ok(f.ledger.snapshot().run.lastSuccessAt);
}));

for (const autoIntake of [true, false]) test(`document-only update must honor receipt and auto-intake=${autoIntake}`, () => fixture(f => {
  const identityUrl = "https://example.org/existing-project";
  const project = f.repository.upsertProject({ name: "Existing Source Project", notes: `Identity ${identityUrl}` }).project;
  f.ledger.configure({ settings: { enabled: true, autoIntake }, sources: [source("lab")] });
  const run = f.ledger.begin();
  f.repository.createDocument({ ownerType: "project", ownerId: project.id, kind: "研究", title: "New Synthetic Research", contentFile: f.write("new-research.md", `# Synthetic update\n${identityUrl}\n`) });
  const candidate = { name: project.name, kind: "company", identityUrl, sources: [{ url: identityUrl }], intake: { status: "matched", projectId: project.id } };
  assert.throws(() => f.ledger.merge(result(run, { candidates: [candidate] })), { code: autoIntake ? "sourcing_receipt_missing" : "sourcing_intake_disabled" });
}));
