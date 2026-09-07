#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { stableJson } = require("../skills/todo/scripts/todo-ledger.js");
const { acquireProcessLock } = require("./process-lock.cjs");
const { checkNotesFormat } = require("./notes-format.cjs");

const ROOT = path.resolve(__dirname, "..");
const HASH = /^[a-f0-9]{64}$/;
const SEMANTIC_SKILLS = new Set(["asr-notes", "desk-research", "investment-review", "investment-analysis", "ic-memo", "sourcing"]);
const WORKFLOWS = {
  "project-intake": "project-intake-workflow.md",
  "people-intake": "people-intake-workflow.md",
  "plaud-investment-recording": "plaud-investment-recording-workflow.md",
  "podcast-ingestion": "podcast-ingestion-workflow.md",
  "industry-news-radar": "industry-news-radar-workflow.md"
};
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
function assert(condition, message) { if (!condition) throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function nonempty(value) { return typeof value === "string" && Boolean(value.trim()); }
function notesFormatCheck(file, mode = "auto") {
  const report = checkNotesFormat(fs.readFileSync(file, "utf8"), { profile: "structured-notes", mode });
  assert(report.ok, `纪要格式未通过：文档/主板块须为四级标题，子标题为五级，主板块之间须有独立分隔线。先运行 notes-format.cjs format，再更新证据索引与QA。${report.error || JSON.stringify(report.issues || [])}`);
  return { ...report, path: file, mechanicalChecksPassed: true, semanticReviewRequired: true };
}
function artifact(value) {
  assert(value && path.isAbsolute(value.path || ""), "Artifact path must be absolute");
  const stat = fs.lstatSync(value.path);
  assert(stat.isFile() && stat.size > 0, "Artifact must be a nonempty regular file");
  const bytes = fs.readFileSync(value.path);
  return { ...value, path: path.resolve(value.path), sha256: sha256(bytes), bytes: bytes.length };
}
function verifyArtifact(value) {
  assert(HASH.test(value?.sha256 || "") && Number.isSafeInteger(value?.bytes) && value.bytes > 0, "Artifact requires expected sha256 and bytes");
  const actual = artifact(value);
  assert(actual.sha256 === value.sha256 && actual.bytes === value.bytes, `Artifact changed: ${value.path}`);
  return actual;
}
function atomicJson(file, value) {
  assert(path.isAbsolute(file), "Output path must be absolute");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${crypto.randomUUID()}`;
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function contextBundle(input, root = ROOT) {
  const skill = String(input.skill || "");
  assert(/^[a-z][a-z0-9-]+$/.test(skill), "Specify the current primary skill");
  const primary = path.join(root, "skills", skill, "SKILL.md");
  const queue = [primary], seen = new Set(), files = [], unresolved = [];
  if (input.workflow) {
    assert(WORKFLOWS[input.workflow], "Unknown workflow; use the explicit additionalRules interface for custom workflows");
    queue.push(path.join(root, "skills/domi-router/references", WORKFLOWS[input.workflow]));
    queue.push(path.join(root, "skills/domi-router/references/lossless-handoff.md"));
  }
  for (const item of input.additionalRules || []) {
    assert(typeof item === "string" && item.endsWith(".md"), "additionalRules must contain Markdown paths");
    queue.push(path.resolve(root, item));
  }
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    assert(file.startsWith(`${path.resolve(root)}${path.sep}`), "Rule path escapes plugin root");
    if (!fs.existsSync(file)) { unresolved.push(path.relative(root, file)); continue; }
    const text = fs.readFileSync(file, "utf8");
    files.push({ ...artifact({ role: "rule", path: file }), relativePath: path.relative(root, file) });
    // Stage entry follows only this Skill's rules. Workflow references describe
    // later stages; their links must not recursively preload every later Skill.
    if (file.includes(`${path.sep}domi-router${path.sep}references${path.sep}`)) continue;
    const links = [...text.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)].map(match => match[1]);
    const inline = [...text.matchAll(/`((?:\.\.\/|references\/)[^`\s]+\.md)`/g)].map(match => match[1]);
    for (const relative of [...links, ...inline]) {
      if (/^[a-z]+:/i.test(relative)) continue;
      const target = path.resolve(path.dirname(file), relative);
      // Explicit mode pruning only where the Skill declares exclusive branches.
      if (file === primary && skill === "desk-research" && input.mode === "company" && relative.endsWith("sector-scan.md")) continue;
      if (file === primary && skill === "desk-research" && input.mode === "sector" && relative.endsWith("company-profile.md")) continue;
      if (file === primary && skill === "domi-router" && target.includes("-workflow.md") && path.basename(target) !== WORKFLOWS[input.workflow]) continue;
      queue.push(target);
    }
  }
  assert(unresolved.length === 0, `Unresolved required rules: ${unresolved.join(", ")}`);
  return { schema: "domi.context.v1", skill, mode: input.mode || null, workflow: input.workflow || null,
    files, bundleSha256: sha256(stableJson(files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })))),
    bytes: files.reduce((sum, file) => sum + file.bytes, 0), completeTextRequired: true,
    semanticRoutingRequired: true, externalSkillsRequireModelResolution: true };
}

function validateManifest(manifest, { verify = true } = {}) {
  assert(manifest?.schema === "domi.handoff.v1", "Expected domi.handoff.v1");
  for (const key of ["workflowRunId", "workflow", "mode", "currentStage"]) assert(nonempty(manifest[key]), `Missing ${key}`);
  assert(nonempty(manifest.entity?.type) && nonempty(manifest.entity?.fingerprint), "Entity type and fingerprint required");
  assert([null, "local", "legacy_feishu_primary"].includes(manifest.repository?.backend), "Invalid backend lock");
  assert(nonempty(manifest.authorization?.sourceTurnId), "Current authorization sourceTurnId required");
  assert(typeof manifest.authorization.internalWrite === "boolean" && typeof manifest.authorization.externalWrite === "boolean"
    && Array.isArray(manifest.authorization.externalTargets), "Explicit authorization scope required");
  assert(Array.isArray(manifest.stagePlan) && manifest.stagePlan.length > 0, "stagePlan required");
  assert(new Set(manifest.stagePlan.map(stage => stage.name)).size === manifest.stagePlan.length, "Duplicate stage names");
  for (const stage of manifest.stagePlan) {
    assert(nonempty(stage.name) && nonempty(stage.skill) && Array.isArray(stage.requiredRoles), "Invalid stagePlan entry");
  }
  const index = manifest.stagePlan.findIndex(stage => stage.name === manifest.currentStage);
  assert(index >= 0, "Unknown currentStage");
  assert(manifest.nextStage === (manifest.stagePlan[index + 1]?.name || null), "nextStage must follow stagePlan");
  assert(Array.isArray(manifest.completedStages) && manifest.completedStages.every((stage, i) => stage === manifest.stagePlan[i]?.name), "completedStages must be an ordered prefix");
  assert(manifest.completedStages.length <= index + 1, "Cannot complete future stages");
  assert(Array.isArray(manifest.artifacts), "artifacts required");
  const seen = new Set();
  for (const file of manifest.artifacts) {
    assert(nonempty(file.role) && !seen.has(file.path), "Artifact role required and paths unique"); seen.add(file.path);
    if (verify) verifyArtifact(file);
  }
  return manifest;
}

function validateSemanticQa(qa, manifest, stage) {
  assert(qa.schema === "domi.semantic-qa.v1", "Semantic QA must use domi.semantic-qa.v1");
  assert(qa.workflowRunId === manifest.workflowRunId && qa.stage === stage.name && qa.reviewer === "model", "Semantic QA run/stage/reviewer mismatch");
  const required = ["source_reading", "entity", "evidence", "numbers", "completeness", "attribution", "editorial"];
  assert(qa.overall === "passed" && required.every(check => qa.checks?.[check] === "passed"), "Model semantic QA has unresolved or missing checks");
  assert(Array.isArray(qa.artifacts) && qa.artifacts.length > 0, "Semantic QA must bind artifact hashes");
  for (const target of manifest.artifacts.filter(item => stage.requiredRoles.includes(item.role) && item.role !== "qa_receipt")) {
    assert(qa.artifacts.some(item => item.path === target.path && item.sha256 === target.sha256), "Semantic QA is stale or omits a required artifact");
  }
  assert(!qa.materialConflicts?.length, "Material conflicts block advancement");
}

function completedStageChecks(manifest) {
  for (const name of manifest.completedStages) {
    const stage = manifest.stagePlan.find(item => item.name === name);
    const expectedRules = contextBundle({ skill: stage.skill, mode: stage.mode, workflow: WORKFLOWS[manifest.workflow] ? manifest.workflow : undefined });
    assert(stage.ruleBundleSha256 === expectedRules.bundleSha256, `Stage rules changed or were not fully resolved: ${name}`);
    for (const role of stage.requiredRoles) assert(manifest.artifacts.some(file => file.role === role), `Missing ${name} artifact role: ${role}`);
    if (SEMANTIC_SKILLS.has(stage.skill)) {
      if (stage.skill === "asr-notes") {
        for (const file of manifest.artifacts.filter(item => item.role === "notes" && (!item.stage || item.stage === name))) notesFormatCheck(file.path);
      }
      const receipt = manifest.artifacts.find(file => file.role === "qa_receipt" && file.stage === name);
      assert(receipt, `Completed semantic stage ${name} requires a model QA receipt`);
      const qa = readJson(receipt.path);
      if (qa.schema === "asr.qa-receipt.v1" && stage.skill === "asr-notes") {
        assert(qa.workflowRunId === manifest.workflowRunId, "ASR QA workflow mismatch");
        assert(manifest.artifacts.some(file => file.role === "notes" && file.path === qa.notes?.path && file.sha256 === qa.notes?.sha256), "ASR receipt does not cover the current notes artifact");
        assert(manifest.artifacts.some(file => file.role === "evidence_index" && file.path === qa.evidenceIndex?.path && file.sha256 === qa.evidenceIndex?.sha256), "ASR receipt does not cover the current evidence index");
        evidenceCheck(readJson(qa.evidenceIndex.path), qa);
      } else validateSemanticQa(qa, manifest, stage);
    }
  }
}

function inspectManifest(file) {
  const manifest = readJson(file);
  const failures = [];
  try { validateManifest(manifest); completedStageChecks(manifest); } catch (error) { failures.push(error.message); }
  return { ok: failures.length === 0, manifestSha256: sha256(fs.readFileSync(file)), manifest,
    failures, resumeStage: failures.length ? manifest.failureCheckpoint?.stage || manifest.currentStage : manifest.currentStage,
    reusableArtifacts: manifest.artifacts?.filter(item => { try { verifyArtifact(item); return true; } catch { return false; } }) || [] };
}

function saveManifest(file, input) {
  assert(nonempty(file), "Manifest path required");
  file = path.resolve(file);
  const next = structuredClone(input.manifest);
  validateManifest(next); completedStageChecks(next);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lockPath = `${file}.lock`;
  const release = acquireProcessLock(lockPath);
  try {
    let previous = null;
    if (fs.existsSync(file)) {
      assert(input.expectedHash === sha256(fs.readFileSync(file)), "Manifest changed; inspect before retrying");
      previous = readJson(file);
      for (const key of ["workflowRunId", "workflow", "mode", "authorization", "repository", "stagePlan"]) {
        assert(stableJson(previous[key]) === stableJson(next[key]), `Immutable workflow field changed: ${key}`);
      }
      for (const key of ["type", "fingerprint"]) assert(previous.entity[key] === next.entity[key], "Entity changed during workflow");
      for (const key of ["projectId", "personId", "industryId", "canonicalDocumentId"]) {
        if (previous.entity[key]) assert(previous.entity[key] === next.entity[key], `Canonical entity binding changed: ${key}`);
      }
      assert(next.currentStage === previous.currentStage || (previous.completedStages.includes(previous.currentStage) && next.currentStage === previous.nextStage), "Cannot skip incomplete stages");
      assert(previous.completedStages.every((name, i) => next.completedStages[i] === name), "Use invalidate to revoke completed stages");
      for (const old of previous.artifacts) {
        const replacement = next.artifacts.find(item => item.path === old.path);
        assert(!replacement || replacement.sha256 === old.sha256, "Use a new artifact path for a new version");
      }
      next.history = [...(previous.history || []), { currentStage: previous.currentStage, manifestSha256: input.expectedHash,
        artifacts: previous.artifacts, receipts: previous.receipts || {}, executionRunId: previous.executionRunId || null,
        completedStages: previous.completedStages, updatedAt: previous.updatedAt }];
    } else assert(input.expectedHash === null, "New manifest requires expectedHash:null");
    next.updatedAt = new Date().toISOString();
    atomicJson(file, next);
    return inspectManifest(file);
  } finally { release(); }
}

function checkpointManifest(file, input) {
  const inspected = inspectManifest(file);
  assert(inspected.ok, inspected.failures.join("; "));
  assert(inspected.manifestSha256 === input.expectedHash, "Manifest changed before checkpoint");
  const manifest = inspected.manifest;
  const allowedBindings = ["projectId", "personId", "industryId", "canonicalDocumentId", "recordRevision", "recordHash"];
  for (const [key, value] of Object.entries(input.entityBinding || {})) {
    assert(allowedBindings.includes(key), "Checkpoint cannot change entity identity or authorization"); manifest.entity[key] = value;
  }
  for (const value of input.artifacts || []) {
    const checked = verifyArtifact({ ...value, stage: manifest.currentStage });
    const old = manifest.artifacts.find(item => item.path === checked.path);
    if (old) assert(old.sha256 === checked.sha256 && old.stage === checked.stage, "Do not overwrite previous-stage or changed artifacts");
    else manifest.artifacts.push(checked);
  }
  if (input.archiveArtifacts) manifest.archiveArtifacts = input.archiveArtifacts.map(verifyArtifact);
  if (input.completeStage === true && !manifest.completedStages.includes(manifest.currentStage)) manifest.completedStages.push(manifest.currentStage);
  let saved = saveManifest(file, { expectedHash: input.expectedHash, manifest });
  if (input.advance === true) {
    assert(saved.manifest.completedStages.includes(saved.manifest.currentStage) && saved.manifest.nextStage, "Only a completed nonfinal stage may advance");
    const next = saved.manifest;
    next.currentStage = next.nextStage;
    const index = next.stagePlan.findIndex(stage => stage.name === next.currentStage);
    next.nextStage = next.stagePlan[index + 1]?.name || null;
    saved = saveManifest(file, { expectedHash: saved.manifestSha256, manifest: next });
  }
  return saved;
}

function rebindManifest(file, executionRunId, expectedHash) {
  assert(nonempty(executionRunId), "executionRunId required");
  const inspected = inspectManifest(file);
  assert(inspected.ok, inspected.failures.join("; "));
  assert(inspected.manifestSha256 === expectedHash, "Manifest changed before execution rebind");
  inspected.manifest.executionRunId = executionRunId;
  // Receipts from an older execution stay in history, never attest this attempt.
  inspected.manifest.receipts = {};
  if (inspected.manifest.storagePhase === "managed") inspected.manifest.storagePhase = "provisional";
  return saveManifest(file, { expectedHash, manifest: inspected.manifest });
}

function invalidateManifest(file, stageName, reason, expectedHash) {
  assert(nonempty(file), "Manifest path required");
  file = path.resolve(file);
  assert(nonempty(reason), "Invalidation reason required");
  const manifest = readJson(file);
  validateManifest(manifest, { verify: false });
  const index = manifest.stagePlan.findIndex(stage => stage.name === stageName);
  assert(index >= 0, "Unknown invalidation stage");
  assert(sha256(fs.readFileSync(file)) === expectedHash, "Manifest changed before invalidation");
  const affected = new Set(manifest.stagePlan.slice(index).map(stage => stage.name));
  const invalidated = manifest.artifacts.filter(file => affected.has(file.stage));
  assert(manifest.artifacts.every(file => nonempty(file.stage)), "Recovery requires artifact stage ownership");
  manifest.history = [...(manifest.history || []), { manifestSha256: expectedHash, artifacts: manifest.artifacts, currentStage: manifest.currentStage }];
  manifest.artifacts = manifest.artifacts.filter(file => !affected.has(file.stage));
  manifest.archiveArtifacts = [];
  manifest.receipts = {};
  manifest.completedStages = manifest.completedStages.slice(0, index);
  manifest.currentStage = stageName;
  manifest.nextStage = manifest.stagePlan[index + 1]?.name || null;
  manifest.failureCheckpoint = { stage: stageName, reason, invalidatedArtifacts: invalidated };
  validateManifest(manifest); completedStageChecks(manifest);
  const lockPath = `${file}.lock`, release = acquireProcessLock(lockPath);
  try {
    assert(sha256(fs.readFileSync(file)) === expectedHash, "Manifest changed before invalidation save");
    manifest.updatedAt = new Date().toISOString(); atomicJson(file, manifest);
    return inspectManifest(file);
  } finally { release(); }
}

function sourceLocator(source, ref) {
  const text = fs.readFileSync(source.path, "utf8");
  const lines = ref.lines || String(ref.locator || "").match(/^L?(\d+)(?:-L?(\d+))?$/)?.slice(1).map(value => value === undefined ? undefined : Number(value));
  if (lines) {
    const [from, to = from] = lines;
    assert(Number.isInteger(from) && Number.isInteger(to) && from > 0 && to >= from && to <= text.split(/\r?\n/).length, "Source line locator out of bounds");
    if (ref.quote) assert(text.split(/\r?\n/).slice(from - 1, to).join("\n").includes(ref.quote), "Source quote differs from indexed lines");
  } else {
    assert(nonempty(ref.locator) && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(ref.locator) && text.includes(ref.locator), "Use existing timestamp or explicit source line range");
  }
}

function evidenceCheck(index, qa = null) {
  assert(["asr.evidence-index.v1", "domi.research-evidence.v1"].includes(index.schema), "Unknown evidence index schema");
  assert(nonempty(index.workflowRunId) && Array.isArray(index.sources) && index.sources.length, "Evidence sources and run required");
  if (index.schema === "asr.evidence-index.v1") {
    assert(["A", "B"].includes(index.mode) && ["current_session", "longitudinal"].includes(index.notesScope), "ASR mode and notesScope required");
    verifyArtifact(index.transcript);
    assert(index.sources.some(source => source.role === "current_transcript" && source.path === index.transcript.path && source.sha256 === index.transcript.sha256), "Evidence sources must include the complete canonical transcript");
  }
  const sources = new Map();
  for (const source of index.sources) {
    assert(nonempty(source.sourceId) && !sources.has(source.sourceId), "Duplicate or missing sourceId");
    assert(["current_transcript", "historical_record", "verification_only", "public_source", "user_correction", "source_material"].includes(source.role), "Unknown source role");
    verifyArtifact(source); sources.set(source.sourceId, source);
    if (source.role === "historical_record") assert(index.notesScope === "longitudinal" && source.entityFingerprint === index.entityFingerprint && nonempty(index.entityFingerprint), "Historical material requires a confirmed matching entity and longitudinal scope");
  }
  assert(Array.isArray(index.claims) && index.claims.length > 0, "Evidence claims required; mechanical checks cannot infer completeness");
  const claimIds = new Set();
  for (const claim of index.claims) {
    assert(nonempty(claim.claimId) && !claimIds.has(claim.claimId) && nonempty(claim.statement), "Claim ID/statement invalid"); claimIds.add(claim.claimId);
    assert(Array.isArray(claim.sourceRefs) && claim.sourceRefs.length, "Claim sourceRefs required");
    for (const ref of claim.sourceRefs) {
      const source = sources.get(ref.sourceId); assert(source, "Unknown claim sourceId"); sourceLocator(source, ref);
      if (source.role === "verification_only") assert(nonempty(claim.existingClaimId), "Verification-only source cannot introduce a new claim");
    }
  }
  if (qa) {
    assert(qa.schema === "asr.qa-receipt.v1" && qa.workflowRunId === index.workflowRunId, "ASR receipt schema/run mismatch");
    verifyArtifact(qa.notes);
    notesFormatCheck(qa.notes.path);
    assert(HASH.test(qa.evidenceIndex?.sha256 || "") && sha256(fs.readFileSync(qa.evidenceIndex.path)) === qa.evidenceIndex.sha256, "Evidence index receipt hash mismatch");
    const required = ["transcript_traceability", "entity_verification", "number_audit", "completeness", "attribution", "markdown_rendering"];
    assert(qa.overall === "passed" && required.every(key => qa.checks?.[key] === "passed"), "ASR semantic QA missing/blocked");
    const optional = ["source_manifest", "education", "career_model_work", "material_verification", "pending_items"];
    assert(optional.every(key => ["passed", "not_applicable"].includes(qa.checks?.[key])), "ASR applicable checks must be recorded");
    if (index.claims.some(claim => claim.category === "education")) assert(qa.checks.education === "passed", "Education claims require education QA");
    if (index.claims.some(claim => ["career", "model_work"].includes(claim.category))) assert(qa.checks.career_model_work === "passed", "Career/model claims require corresponding QA");
    if (index.sources.some(source => source.role === "verification_only")) assert(qa.checks.material_verification === "passed", "Auxiliary sources require material QA");
    assert(!(index.unresolved || []).some(item => item.materialToDecision === true), "Unresolved material claims block automatic advancement");
    assert(!qa.materialConflicts?.length, "Material conflicts block handoff");
  }
  return { ok: true, schema: index.schema, workflowRunId: index.workflowRunId, sourceCount: sources.size, claimCount: claimIds.size,
    mechanicalChecksPassed: true, semanticReviewRequired: true, currentFactsVerified: false };
}

function icStructureCheck(file) {
  let fence = null;
  const text = fs.readFileSync(file, "utf8").split(/\r?\n/).map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker && !fence) { fence = marker[1]; return ""; }
    if (marker && fence && marker[1][0] === fence[0] && marker[1].length >= fence.length) { fence = null; return ""; }
    return fence ? "" : line;
  }).join("\n");
  const headings = [...text.matchAll(/^#{1,3}\s+([一二三四五])、\s*(.+)$/gm)].map(match => `${match[1]}、${match[2].trim()}`);
  const expected = ["一、投资概要", "二、关键问题和思考", "三、创始人与公司介绍", "四、商业模式三要素", "五、交易方案"];
  assert(headings.length === 5 && expected.every((heading, i) => headings[i] === heading), "IC memo requires the five canonical sections in order");
  return { ok: true, artifact: artifact({ role: "ic_memo", path: file }), headings, mechanicalChecksPassed: true, semanticReviewRequired: true };
}

function finalize(manifestPath, receiptPath, repository) {
  assert(nonempty(manifestPath) && nonempty(receiptPath), "Manifest and receipt paths required");
  manifestPath = path.resolve(manifestPath); receiptPath = path.resolve(receiptPath);
  const inspected = inspectManifest(manifestPath);
  assert(inspected.ok, inspected.failures.join("; "));
  const manifest = inspected.manifest;
  assert(manifest.repository.backend === "local" && manifest.authorization.internalWrite === true, "Finalization requires the locked local backend and current internal-write authorization");
  assert(manifest.stagePlan.filter(stage => SEMANTIC_SKILLS.has(stage.skill)).every(stage => manifest.completedStages.includes(stage.name)), "Semantic stages must pass before archival completion");
  assert(manifest.stagePlan.at(-1).name === manifest.currentStage && manifest.stagePlan.at(-1).skill === "investment-mgmt", "Advance to the final archive stage before finalization");
  const entity = manifest.entity;
  if (manifest.workflow === "podcast-ingestion") {
    assert(nonempty(manifest.executionRunId), "Podcast finalization requires the current executionRunId");
    assert(manifest.stagePlan.some(stage => stage.skill === "asr-notes" && manifest.completedStages.includes(stage.name)), "Podcast notes require passed ASR semantic QA");
    assert(nonempty(entity.canonicalDocumentId), "Podcast finalization requires canonicalDocumentId");
  }
  assert(["project", "person", "industry"].includes(entity.type), "Unsupported finalization entity type");
  const ownerId = entity.projectId || entity.personId || entity.industryId;
  let canonicalDocument = null;
  if (entity.canonicalDocumentId) {
    canonicalDocument = repository.database.prepare("SELECT * FROM documents WHERE id=? AND owner_type=? AND owner_id=?")
      .get(entity.canonicalDocumentId, entity.type, ownerId);
    assert(canonicalDocument, "Canonical document ID does not match the entity document index");
  }
  const record = entity.type === "project" ? repository.getProject(entity.projectId)
    : entity.type === "person" ? repository.getPerson(entity.personId)
      : canonicalDocument ? { id: ownerId, documentPath: canonicalDocument.path } : null;
  assert(record, "Finalization requires an existing canonical entity/document record");
  if (entity.type === "project") assert(record.recordRevision === entity.recordRevision && record.recordHash === entity.recordHash, "Final record revision/hash changed");
  const root = fs.realpathSync(path.dirname(record.documentPath));
  assert(root === fs.realpathSync(repository.libraryDir) || root.startsWith(`${fs.realpathSync(repository.libraryDir)}${path.sep}`), "Entity directory escapes configured repository");
  const homepage = artifact({ role: entity.type === "industry" ? "notes" : "entity_homepage", path: record.documentPath });
  assert(Array.isArray(manifest.archiveArtifacts) && manifest.archiveArtifacts.length > 0, "No explicit archived material manifest");
  const archived = manifest.archiveArtifacts.map(file => {
    const checked = verifyArtifact(file);
    assert(fs.realpathSync(file.path).startsWith(`${root}${path.sep}`), "Archived material is outside the canonical entity directory");
    assert(manifest.artifacts.some(source => source.role === file.role && source.sha256 === file.sha256), "Archived material has no matching canonical artifact");
    return checked;
  });
  if (canonicalDocument) assert(archived.some(file => path.resolve(file.path) === path.resolve(canonicalDocument.path)), "Canonical document is missing from verified archived artifacts");
  const documentPath = canonicalDocument?.path || record.documentPath;
  let quality;
  if (manifest.workflow === "podcast-ingestion") {
    const notesStage = manifest.stagePlan.find(stage => stage.skill === "asr-notes" && manifest.completedStages.includes(stage.name));
    const qaArtifact = manifest.artifacts.find(file => file.role === "qa_receipt" && file.stage === notesStage.name);
    const qa = readJson(qaArtifact.path);
    assert(qa.schema === "asr.qa-receipt.v1", "Podcast requires the full ASR QA schema");
    const evidenceIndex = verifyArtifact(manifest.artifacts.find(file => file.role === "evidence_index" && file.path === qa.evidenceIndex.path));
    const index = readJson(evidenceIndex.path);
    evidenceCheck(index, qa);
    const canonicalNotes = archived.find(file => file.role === "notes" && path.resolve(file.path) === path.resolve(documentPath));
    assert(canonicalNotes && canonicalNotes.sha256 === qa.notes.sha256, "Canonical podcast notes differ from model-reviewed notes");
    quality = { schema: "domi.podcast-quality.v1", qaReceipt: verifyArtifact(qaArtifact), evidenceIndex,
      notes: verifyArtifact(qa.notes), transcript: verifyArtifact(index.transcript) };
  }
  const receipt = { schema: "domi.storage-receipt.v1", workflowRunId: manifest.workflowRunId,
    ...(manifest.executionRunId ? { executionRunId: manifest.executionRunId } : {}), backend: "local", entityType: entity.type,
    [{ project: "projectId", person: "personId", industry: "industryId" }[entity.type]]: record.id,
    ...(entity.canonicalDocumentId ? { canonicalDocumentId: entity.canonicalDocumentId } : {}),
    ...(entity.type === "project" ? { recordRevision: record.recordRevision, recordHash: record.recordHash } : {}),
    documentPath, documentUri: pathToFileURL(documentPath).href, libraryPath: root,
    ...(entity.type !== "industry" ? { primaryEntityDocumentPath: record.documentPath } : {}),
    artifacts: [homepage, ...archived].filter((file, i, all) => all.findIndex(other => other.path === file.path) === i),
    ...(quality ? { quality } : {}),
    recordVerified: true, documentVerified: true, filesVerified: true, verifiedAt: new Date().toISOString(), status: "managed" };
  atomicJson(receiptPath, receipt);
  manifest.receipts = { ...manifest.receipts, storage: receipt };
  manifest.storagePhase = "managed";
  manifest.failureCheckpoint = null;
  manifest.completedStages = manifest.stagePlan.map(stage => stage.name);
  saveManifest(manifestPath, { expectedHash: inspected.manifestSha256, manifest });
  return { ok: true, receiptPath, storageReceipt: receipt };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) { assert(args[i].startsWith("--") && args[i + 1], "Expected --flag value"); flags[args[i].slice(2)] = args[i + 1]; }
  let result;
  if (command === "context") result = contextBundle({ skill: flags.skill, workflow: flags.workflow, mode: flags.mode });
  else if (command === "artifact") result = flags.input ? { artifacts: readJson(flags.input).map(artifact) } : artifact({ role: flags.role, path: flags.path });
  else if (command === "inspect") result = inspectManifest(flags.manifest);
  else if (command === "save") result = saveManifest(flags.manifest, readJson(flags.input));
  else if (command === "checkpoint") result = checkpointManifest(flags.manifest, readJson(flags.input));
  else if (command === "rebind") result = rebindManifest(flags.manifest, flags["execution-run-id"], flags["expected-hash"]);
  else if (command === "invalidate") result = invalidateManifest(flags.manifest, flags.stage, flags.reason, flags["expected-hash"]);
  else if (command === "evidence-check") result = evidenceCheck(readJson(flags.index), flags.qa ? readJson(flags.qa) : null);
  else if (command === "notes-check") result = notesFormatCheck(flags.path, flags.mode || "auto");
  else if (command === "ic-check") result = icStructureCheck(flags.path);
  else if (command === "finalize") {
    const { DomiRepository, readConfig } = require("./domi-repo.cjs");
    const config = readConfig(); assert(!config.legacyFeishuPrimary, "Use verified legacy backend receipts; local finalize cannot certify Feishu");
    assert(fs.existsSync(config.databasePath), "Finalization cannot initialize a missing repository");
    const repository = new DomiRepository(config);
    try { result = finalize(flags.manifest, flags.receipt, repository); } finally { repository.close(); }
  } else throw new Error("Usage: domi-workflow.cjs context|artifact|inspect|save|evidence-check|notes-check|ic-check|finalize --flag value");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.ok === false) process.exitCode = 1;
}

if (require.main === module) { try { main(); } catch (error) { process.stdout.write(`${JSON.stringify({ ok: false, error: error.message })}\n`); process.exitCode = 1; } }
module.exports = { artifact, verifyArtifact, atomicJson, contextBundle, validateManifest, inspectManifest, saveManifest, checkpointManifest, rebindManifest, invalidateManifest, evidenceCheck, notesFormatCheck, icStructureCheck, finalize };
