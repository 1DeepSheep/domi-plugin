const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DomiRepository } = require("./domi-repo.cjs");
const { artifact, contextBundle, evidenceCheck, saveManifest, checkpointManifest, inspectManifest, rebindManifest,
  invalidateManifest, finalize, icStructureCheck } = require("./domi-workflow.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-workflow-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
    return file;
  };
  return { root, write };
}

function notesFixture(t) {
  const f = fixture(t), run = "podcast:job-1";
  const transcript = artifact({ role: "transcript", stage: "notes", path: f.write("transcript.txt", "00:00:01 嘉宾：公司仍处于研发阶段。\n00:00:02 我们还没有收入。\n") });
  const notes = artifact({ role: "notes", stage: "notes", path: f.write("notes.md", "#### 访谈纪要\n\n嘉宾表示，公司处于研发阶段，尚无收入。\n") });
  const index = { schema: "asr.evidence-index.v1", workflowRunId: run, notesScope: "current_session", mode: "B",
    transcript, sources: [{ ...transcript, sourceId: "source-1", role: "current_transcript" }],
    claims: [{ claimId: "claim-1", statement: "公司尚无收入", sourceRefs: [{ sourceId: "source-1", lines: [2, 2], quote: "还没有收入" }] }] };
  const evidence = artifact({ role: "evidence_index", stage: "notes", path: f.write("evidence.json", index) });
  const checks = Object.fromEntries(["source_manifest", "transcript_traceability", "entity_verification", "number_audit", "completeness", "attribution", "education", "career_model_work", "material_verification", "pending_items", "markdown_rendering"].map(key => [key, "passed"]));
  const qa = { schema: "asr.qa-receipt.v1", workflowRunId: run, mode: "B", notes, evidenceIndex: evidence,
    checks, overall: "passed", materialConflicts: [], checkedAt: "2026-09-07T00:00:00.000Z" };
  const receipt = artifact({ role: "qa_receipt", stage: "notes", path: f.write("qa.json", qa) });
  const manifest = { schema: "domi.handoff.v1", workflowRunId: run, executionRunId: "claim-1", workflow: "podcast-ingestion", mode: "intake",
    entity: { type: "industry", fingerprint: "semiconductors", industryId: "industry-1", canonicalDocumentId: "podcast:public:job-1" },
    authorization: { sourceTurnId: "turn-1", internalWrite: true, externalWrite: false, externalTargets: [] },
    repository: { backend: "local", lockedAt: "2026-09-07T00:00:00.000Z" },
    currentStage: "notes", nextStage: "archive", completedStages: [], artifacts: [transcript, notes, evidence, receipt],
    stagePlan: [
      { name: "notes", skill: "asr-notes", requiredRoles: ["transcript", "notes", "evidence_index"], ruleBundleSha256: contextBundle({ skill: "asr-notes", workflow: "podcast-ingestion" }).bundleSha256 },
      { name: "archive", skill: "investment-mgmt", requiredRoles: ["notes"], ruleBundleSha256: contextBundle({ skill: "investment-mgmt", workflow: "podcast-ingestion" }).bundleSha256 }
    ] };
  return { ...f, transcript, notes, index, evidence, qa, receipt, manifest };
}

test("context resolves full transitive rule files once, selects exclusive research mode and detects version changes", t => {
  const f = fixture(t);
  f.write("skills/example/SKILL.md", "Read [rules](references/rules.md) and [same](references/rules.md).\n");
  f.write("skills/example/references/rules.md", "Read [nested](nested.md).\n");
  f.write("skills/example/references/nested.md", "Complete quality instructions.\n");
  const bundle = contextBundle({ skill: "example" }, f.root);
  assert.equal(bundle.files.length, 3);
  f.write("skills/example/references/nested.md", "Changed complete quality instructions.\n");
  assert.notEqual(contextBundle({ skill: "example" }, f.root).bundleSha256, bundle.bundleSha256);
  const company = contextBundle({ skill: "desk-research", mode: "company", workflow: "project-intake" });
  assert.ok(company.files.some(file => file.relativePath.endsWith("company-profile.md")));
  assert.ok(!company.files.some(file => file.relativePath.endsWith("sector-scan.md")));
  assert.ok(company.files.some(file => file.relativePath.endsWith("lossless-handoff.md")));
});

test("evidence mechanically checks hashes and locators while requiring separate semantic review", t => {
  const f = notesFixture(t);
  assert.equal(evidenceCheck(f.index, f.qa).semanticReviewRequired, true);
  const badLocator = structuredClone(f.index); badLocator.claims[0].sourceRefs[0].lines = [200, 201];
  assert.throws(() => evidenceCheck(badLocator), /out of bounds/);
  const auxiliary = structuredClone(f.index);
  auxiliary.sources.push({ ...auxiliary.sources[0], sourceId: "auxiliary", role: "verification_only" });
  auxiliary.claims[0].sourceRefs[0].sourceId = "auxiliary";
  assert.throws(() => evidenceCheck(auxiliary), /cannot introduce/);
  const blocked = structuredClone(f.qa); blocked.checks.completeness = "blocked";
  assert.throws(() => evidenceCheck(f.index, blocked), /missing\/blocked/);
  fs.appendFileSync(f.notes.path, "事实更正\n");
  assert.throws(() => evidenceCheck(f.index, f.qa), /Artifact changed/);
});

test("ASR evidence rejects malformed notes even when a model receipt claims rendering passed", t => {
  const f = notesFixture(t);
  const bad = "# 访谈纪要\n\n## 团队背景\n- 两位成员。\n## 产品与技术\n- 自研引擎。\n";
  const notes = artifact({ role: "notes", path: f.write("bad-notes.md", bad) });
  const qa = { ...f.qa, notes };
  assert.throws(() => evidenceCheck(f.index, qa), /纪要格式未通过/);
  assert.equal(fs.readFileSync(notes.path, "utf8"), bad, "checking must not silently change reviewed bytes");
});

test("handoff rejects incomplete stages and stale writers, preserves artifacts across execution rebind and invalidates dependent stages", t => {
  const f = notesFixture(t), manifestPath = path.join(f.root, "manifest.json");
  const initial = saveManifest(manifestPath, { expectedHash: null, manifest: f.manifest });
  const skipped = structuredClone(f.manifest); skipped.currentStage = "archive"; skipped.nextStage = null;
  assert.throws(() => saveManifest(manifestPath, { expectedHash: initial.manifestSha256, manifest: skipped }), /incomplete/);
  const complete = structuredClone(f.manifest); complete.completedStages = ["notes"];
  const result = saveManifest(manifestPath, { expectedHash: initial.manifestSha256, manifest: complete });
  assert.throws(() => saveManifest(manifestPath, { expectedHash: initial.manifestSha256, manifest: complete }), /changed/);
  const rebound = rebindManifest(manifestPath, "claim-2", result.manifestSha256);
  assert.equal(rebound.manifest.workflowRunId, "podcast:job-1");
  assert.equal(rebound.manifest.executionRunId, "claim-2");
  assert.deepEqual(rebound.manifest.artifacts, complete.artifacts);
  fs.appendFileSync(f.notes.path, "New facts\n");
  assert.equal(inspectManifest(manifestPath).ok, false);
  assert.throws(() => rebindManifest(manifestPath, "claim-3", rebound.manifestSha256), /Artifact changed/);
  const invalidated = invalidateManifest(manifestPath, "notes", "用户更正事实", rebound.manifestSha256);
  assert.equal(invalidated.ok, true);
  assert.deepEqual(invalidated.manifest.completedStages, []);
  assert.equal(invalidated.manifest.artifacts.length, 0);
  assert.equal(invalidated.manifest.failureCheckpoint.invalidatedArtifacts.length, 4);
});

test("checkpoint deterministically completes and advances a validated stage without rewriting identity", t => {
  const f = notesFixture(t), manifestPath = path.join(f.root, "manifest.json");
  const initial = saveManifest(path.relative(process.cwd(), manifestPath), { expectedHash: null, manifest: f.manifest });
  const moved = checkpointManifest(manifestPath, { expectedHash: initial.manifestSha256, completeStage: true, advance: true });
  assert.equal(moved.manifest.currentStage, "archive");
  assert.equal(moved.manifest.nextStage, null);
  assert.deepEqual(moved.manifest.completedStages, ["notes"]);
  assert.throws(() => checkpointManifest(manifestPath, { expectedHash: moved.manifestSha256, entityBinding: { fingerprint: "other" } }), /identity/);
  assert.throws(() => checkpointManifest(manifestPath, { expectedHash: moved.manifestSha256, entityBinding: { industryId: "other" } }), /Canonical entity binding/);
});

test("industry podcast finalization verifies a unique indexed notes file and writes run-bound real receipt", t => {
  const f = notesFixture(t);
  const repository = new DomiRepository({ libraryDir: path.join(f.root, "library"), databasePath: path.join(f.root, "repo.sqlite") });
  t.after(() => repository.close());
  const input = { ownerType: "industry", ownerId: "industry-1", canonicalDocumentId: "podcast:public:job-1", domain: "科技", subdomain: "芯片", program: "合成节目", kind: "播客纪要", title: "合成单集", contentFile: f.notes.path };
  const created = repository.createDocument(input);
  const again = repository.createDocument({ ...input, title: "更改显示标题" });
  assert.equal(again.document.id, created.document.id);
  assert.equal(again.document.path, created.document.path);
  assert.throws(() => repository.createDocument({ ...input, ownerId: "other" }), /different entity/);
  const archived = artifact({ role: "notes", path: created.document.path });
  f.manifest.completedStages = ["notes"];
  f.manifest.currentStage = "archive";
  f.manifest.nextStage = null;
  f.manifest.archiveArtifacts = [archived];
  const manifestPath = path.join(f.root, "manifest.json"), receiptPath = path.join(f.root, "storage.json");
  saveManifest(manifestPath, { expectedHash: null, manifest: f.manifest });
  const result = finalize(manifestPath, receiptPath, repository);
  assert.equal(result.storageReceipt.schema, "domi.storage-receipt.v1");
  assert.equal(result.storageReceipt.executionRunId, "claim-1");
  assert.equal(result.storageReceipt.documentPath, created.document.path);
  assert.equal(result.storageReceipt.canonicalDocumentId, input.canonicalDocumentId);
  assert.equal(result.storageReceipt.recordVerified, true);
  assert.equal(result.storageReceipt.quality.notes.path, f.qa.notes.path);
  assert.equal(result.storageReceipt.quality.notes.sha256, archived.sha256);
  assert.deepEqual(JSON.parse(fs.readFileSync(receiptPath, "utf8")), result.storageReceipt);
  fs.appendFileSync(created.document.path, "并发修改\n");
  assert.throws(() => finalize(manifestPath, receiptPath, repository), /Artifact changed/);
});

for (const entityType of ["project", "person"]) {
  test(`${entityType} podcast receipt separates the canonical notes from the entity homepage and rejects drift`, t => {
    const f = notesFixture(t);
    const repository = new DomiRepository({ libraryDir: path.join(f.root, "library"), databasePath: path.join(f.root, "repo.sqlite") });
    t.after(() => repository.close());
    const record = entityType === "project" ? repository.upsertProject({ name: "合成项目" }).project : repository.upsertPerson({ name: "合成人物" }).person;
    f.manifest.entity = { type: entityType, fingerprint: "synthetic-entity", [entityType === "project" ? "projectId" : "personId"]: record.id,
      canonicalDocumentId: "podcast:public:job-1", ...(entityType === "project" ? { recordRevision: record.recordRevision, recordHash: record.recordHash } : {}) };
    const created = repository.createDocument({ ownerType: entityType, ownerId: record.id, canonicalDocumentId: f.manifest.entity.canonicalDocumentId,
      kind: "纪要", title: "合成节目", contentFile: f.notes.path });
    f.manifest.archiveArtifacts = [artifact({ role: "notes", path: created.document.path })];
    f.manifest.completedStages = ["notes"]; f.manifest.currentStage = "archive"; f.manifest.nextStage = null;
    const manifestPath = path.join(f.root, "manifest.json"), receiptPath = path.join(f.root, "storage.json");
    saveManifest(manifestPath, { expectedHash: null, manifest: f.manifest });
    const result = finalize(manifestPath, receiptPath, repository);
    assert.equal(result.storageReceipt.documentPath, created.document.path);
    assert.equal(result.storageReceipt.primaryEntityDocumentPath, record.documentPath);
    assert.equal(result.storageReceipt.quality.notes.path, f.notes.path);
    assert.notEqual(result.storageReceipt.documentPath, result.storageReceipt.primaryEntityDocumentPath);
    if (entityType === "project") {
      repository.upsertProject({ ...record, notes: "并发资料更新" });
      assert.throws(() => finalize(manifestPath, receiptPath, repository), /revision\/hash changed/);
    }
  });
}

test("IC structural QA checks the five sections but cannot certify their semantic quality", t => {
  const f = fixture(t);
  const titles = ["一、投资概要", "二、关键问题和思考", "三、创始人与公司介绍", "四、商业模式三要素", "五、交易方案"];
  const file = f.write("memo.md", titles.map(title => `## ${title}\n待模型审核的正文\n`).join("\n"));
  assert.equal(icStructureCheck(file).semanticReviewRequired, true);
  f.write("memo.md", titles.slice(0, 4).map(title => `## ${title}\n正文\n`).join("\n"));
  assert.throws(() => icStructureCheck(file), /five canonical/);
});
