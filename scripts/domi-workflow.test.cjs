const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DomiRepository } = require("./domi-repo.cjs");
const { prepareNotesCoverage } = require("./notes-coverage.cjs");
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
    claims: [{ claimId: "claim-1", statement: "公司仍在研发，尚无收入", sourceRefs: [{ sourceId: "source-1", lines: [1, 2], quote: "还没有收入" }],
      notesRefs: [{ lines: [3, 3], quote: "公司处于研发阶段，尚无收入" }] }] };
  const coverage = prepareNotesCoverage({ workflowRunId: run, sources: index.sources });
  for (const source of coverage.sources) for (const segment of source.segments) segment.review = { status: "reviewed", reviewer: "model", claimIds: ["claim-1"], exclusions: [] };
  index.coverage = artifact({ path: f.write("coverage.json", coverage) });
  const evidence = artifact({ role: "evidence_index", stage: "notes", path: f.write("evidence.json", index) });
  const checks = Object.fromEntries(["source_manifest", "transcript_traceability", "entity_verification", "number_audit", "completeness", "attribution", "education", "career_model_work", "material_verification", "pending_items", "markdown_rendering", "editorial"].map(key => [key, "passed"]));
  const qa = { schema: "asr.qa-receipt.v1", workflowRunId: run, mode: "B", reviewer: "model", notes, evidenceIndex: evidence,
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

function bindUpdatedIndex(f) {
  f.evidence = artifact({ ...f.evidence, path: f.write("evidence.json", f.index) });
  f.qa.evidenceIndex = f.evidence;
  f.receipt = artifact({ ...f.receipt, path: f.write("qa.json", f.qa) });
  f.manifest.artifacts = [f.transcript, f.notes, f.evidence, f.receipt];
}

test("strict ASR rejects omitted coverage, missing editorial/model QA, borrowed index hashes and research-schema bypass", t => {
  const f = notesFixture(t);
  assert.equal(evidenceCheck(f.index, f.qa, { requireCoverage: true }).coverage.coverageVerified, true);
  const other = structuredClone(f.index); other.claims[0].statement = "不同内存事实";
  assert.throws(() => evidenceCheck(other, f.qa, { requireCoverage: true }), /object differs/);
  assert.throws(() => evidenceCheck({ ...f.index, schema: "domi.research-evidence.v1" }, f.qa, { requireCoverage: true }), /requires asr.evidence/);
  assert.throws(() => evidenceCheck(f.index, { ...f.qa, reviewer: undefined }, { requireCoverage: true }), /model reviewer/);
  assert.throws(() => evidenceCheck(f.index, { ...f.qa, checks: { ...f.qa.checks, editorial: "blocked" } }, { requireCoverage: true }), /editorial/);
  delete f.index.coverage; delete f.qa.checks.editorial; delete f.qa.reviewer; bindUpdatedIndex(f);
  assert.equal(evidenceCheck(f.index, f.qa).qualityStatus, "legacy-unverified");
  assert.throws(() => evidenceCheck(f.index, { ...f.qa, reviewer: "model", checks: { ...f.qa.checks, editorial: "passed" } }, { requireCoverage: true }), /source coverage/);
});

test("new completion cannot substitute generic semantic QA for source-reviewed ASR notes", t => {
  const f = notesFixture(t), manifestPath = path.join(f.root, "manifest.json");
  const initial = saveManifest(manifestPath, { expectedHash: null, manifest: f.manifest });
  const generic = { schema: "domi.semantic-qa.v1", workflowRunId: f.manifest.workflowRunId, stage: "notes", reviewer: "model", overall: "passed",
    checks: Object.fromEntries(["source_reading", "entity", "evidence", "numbers", "completeness", "attribution", "editorial"].map(key => [key, "passed"])),
    artifacts: f.manifest.artifacts.filter(v => v.role !== "qa_receipt"), materialConflicts: [] };
  const next = structuredClone(f.manifest);
  next.artifacts = next.artifacts.filter(v => v.role !== "qa_receipt");
  next.artifacts.push(artifact({ role: "qa_receipt", stage: "notes", path: f.write("generic-qa.json", generic) }));
  next.completedStages = ["notes"];
  assert.throws(() => saveManifest(manifestPath, { expectedHash: initial.manifestSha256, manifest: next }), /generic semantic QA/);
  assert.equal(inspectManifest(manifestPath).manifestSha256, initial.manifestSha256);
});

test("legacy receipt path/hash without evidence bytes remains readable, while new coverage requires bytes", t => {
  const f = notesFixture(t);
  const newQa = { ...f.qa, evidenceIndex: { path: f.evidence.path, sha256: f.evidence.sha256 } };
  assert.throws(() => evidenceCheck(f.index, newQa, { requireCoverage: true }), /expected sha256 and bytes/);
  delete f.index.coverage; delete f.qa.checks.editorial; delete f.qa.reviewer; bindUpdatedIndex(f);
  const oldQa = { ...f.qa, evidenceIndex: { path: f.evidence.path, sha256: f.evidence.sha256 } };
  assert.equal(evidenceCheck(f.index, oldQa).qualityStatus, "legacy-unverified");
  assert.throws(() => evidenceCheck({ ...f.index, mode: "A" }, oldQa), /object differs/);
  assert.throws(() => evidenceCheck(f.index, { ...oldQa, evidenceIndex: { ...oldQa.evidenceIndex, sha256: "0".repeat(64) } }), /hash mismatch/);
});

test("existing completed legacy notes may advance unchanged but new completion and artifact downgrade cannot", t => {
  const f = notesFixture(t), manifestPath = path.join(f.root, "legacy-manifest.json");
  delete f.index.coverage; delete f.qa.checks.editorial; delete f.qa.reviewer; bindUpdatedIndex(f);
  f.manifest.completedStages = ["notes"];
  assert.throws(() => saveManifest(manifestPath, { expectedHash: null, manifest: f.manifest }), /editorial/);
  assert.equal(fs.existsSync(manifestPath), false);
  // An existing pre-upgrade record is read, never rewritten just to label it.
  f.write("legacy-manifest.json", f.manifest);
  const initial = inspectManifest(manifestPath);
  assert.equal(initial.ok, true); assert.equal(initial.qualityStatus, "legacy-unverified");
  assert.deepEqual(initial.legacyUnverifiedStages, ["notes"]);
  const advanced = structuredClone(f.manifest); advanced.currentStage = "archive"; advanced.nextStage = null;
  const saved = saveManifest(manifestPath, { expectedHash: initial.manifestSha256, manifest: advanced });
  assert.equal(saved.ok, true); assert.equal(saved.qualityStatus, "legacy-unverified");
  assert.deepEqual(saved.manifest.artifacts, f.manifest.artifacts);
  const changed = structuredClone(saved.manifest);
  changed.artifacts.push(artifact({ role: "source_material", stage: "notes", path: f.write("extra-source.txt", "新增事实") }));
  assert.throws(() => saveManifest(manifestPath, { expectedHash: saved.manifestSha256, manifest: changed }), /editorial/);
  assert.equal(inspectManifest(manifestPath).manifestSha256, saved.manifestSha256);
});

test("legacy completed podcast can archive unchanged with an explicit unverified quality status", t => {
  const f = notesFixture(t), manifestPath = path.join(f.root, "legacy.json");
  delete f.index.coverage; delete f.qa.checks.editorial; delete f.qa.reviewer; bindUpdatedIndex(f);
  const repository = new DomiRepository({ libraryDir: path.join(f.root, "library"), databasePath: path.join(f.root, "repo.sqlite") });
  t.after(() => repository.close());
  const document = repository.createDocument({ ownerType: "industry", ownerId: "industry-1", canonicalDocumentId: "podcast:public:job-1", domain: "科技", subdomain: "芯片", program: "合成节目", kind: "纪要", title: "历史已完成纪要", contentFile: f.notes.path }).document;
  f.manifest.archiveArtifacts = [artifact({ role: "notes", path: document.path })];
  f.manifest.currentStage = "archive"; f.manifest.nextStage = null; f.manifest.completedStages = ["notes"];
  f.write("legacy.json", f.manifest);
  const result = finalize(manifestPath, path.join(f.root, "storage.json"), repository);
  assert.equal(result.storageReceipt.quality.qualityStatus, "legacy-unverified");
  assert.equal(result.storageReceipt.quality.notes.sha256, f.notes.sha256);
  assert.equal(fs.readFileSync(f.notes.path, "utf8"), "#### 访谈纪要\n\n嘉宾表示，公司处于研发阶段，尚无收入。\n");
});

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
