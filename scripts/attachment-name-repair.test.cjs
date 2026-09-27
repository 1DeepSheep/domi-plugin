const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { DomiRepository } = require("./domi-repo.cjs");
const { repairAttachmentName, replaceReferencePaths } = require("./attachment-name-repair.cjs");
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-repair-test-"));
  const repository = new DomiRepository({ libraryDir: path.join(root, "library"), databasePath: path.join(root, "repository.sqlite") });
  const saved = repository.upsertProject({ name: "样例材料", domain: "AI", subdomains: ["AI数据"], status: "已交流", rating: "A", lastUpdatedAt: "2026-01-05" });
  const project = repository.getProject(saved.storageReceipt.projectId);
  const originalName = "[BP] 样例材料 100%.pdf", name = `1790000000000-0-${originalName}`;
  const source = path.join(root, name); fs.writeFileSync(source, "sample-pdf-bytes");
  // The explicit originalName reproduces an indexed pre-upgrade bad import.
  const document = repository.createDocument({ ownerType: "project", ownerId: project.id, sourceFile: source, originalName: name, title: name, kind: "BP" }).document;
  const request = { documentId: document.id, expectedPath: document.path, expectedSha256: digest(document.path), originalName };
  t.after(() => { repository.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, repository, project, document, request };
}
function apply(f, request = f.request, hooks) {
  const preview = repairAttachmentName(f.repository, request);
  return repairAttachmentName(f.repository, { ...request, dryRun: false, expectedPlanHash: preview.planHash }, hooks);
}

test("repair previews without mutation, preserves source bytes, dates and user prose, updates ID and exact Markdown paths", t => {
  const f = fixture(t), { repository, project, document, request } = f;
  const relative = path.relative(path.dirname(project.documentPath), document.path);
  const encoded = relative.split(path.sep).map(encodeURIComponent).join("/");
  fs.appendFileSync(project.documentPath, `\n用户备注：${path.basename(document.path)} 是原文件。\n- [本地](${document.path})\n- [相对](${relative})\n- [编码](${encoded})\n- [URI](${pathToFileURL(document.path).href})\n`);
  fs.chmodSync(document.path, 0o640);
  fs.utimesSync(document.path, new Date("2025-01-02T03:04:05.000Z"), new Date("2025-01-02T03:04:05.000Z"));
  fs.chmodSync(project.documentPath, 0o644);
  const sourceStat = fs.statSync(document.path);
  const before = fs.readFileSync(project.documentPath, "utf8"), beforeProject = repository.getProject(project.id);
  const preview = repairAttachmentName(repository, request);
  assert.equal(preview.dryRun, true); assert.equal(preview.references.length, 1);
  assert.equal(fs.existsSync(document.path), true); assert.equal(fs.existsSync(preview.targetPath), false);
  assert.equal(fs.readFileSync(project.documentPath, "utf8"), before);
  const result = repairAttachmentName(repository, { ...request, dryRun: false, expectedPlanHash: preview.planHash });
  assert.equal(fs.existsSync(document.path), false); assert.equal(digest(result.targetPath), request.expectedSha256);
  assert.equal(fs.statSync(result.targetPath).mode & 0o777, sourceStat.mode & 0o777);
  assert.equal(fs.statSync(result.targetPath).mtimeMs, sourceStat.mtimeMs);
  assert.equal(fs.statSync(project.documentPath).mode & 0o777, 0o644);
  const row = repository.database.prepare("SELECT * FROM documents WHERE id=?").get(document.id);
  assert.equal(row.path, result.targetPath); assert.equal(row.title, request.originalName);
  const after = fs.readFileSync(project.documentPath, "utf8");
  assert.ok(after.includes(`用户备注：${path.basename(document.path)} 是原文件。`));
  assert.ok(after.includes(pathToFileURL(result.targetPath).href));
  assert.ok(after.includes(path.relative(path.dirname(project.documentPath), result.targetPath).split(path.sep).map(encodeURIComponent).join("/")));
  assert.ok(!after.includes(document.path));
  assert.deepEqual(repository.getProject(project.id), beforeProject);
  assert.equal(JSON.parse(fs.readFileSync(result.journalPath)).state, "committed");
});

test("same-name different-content target is retained; deterministic content suffix never overwrites", t => {
  const f = fixture(t);
  const clean = path.join(path.dirname(f.document.path), f.request.originalName); fs.writeFileSync(clean, "another-version");
  const result = apply(f);
  assert.notEqual(result.targetPath, clean);
  assert.ok(result.targetPath.includes(f.request.expectedSha256.slice(0, 12)));
  assert.equal(fs.readFileSync(clean, "utf8"), "another-version");
  assert.equal(digest(result.targetPath), f.request.expectedSha256);
});

test("same-content unindexed target deduplicates and separately indexed target is rejected", t => {
  const f = fixture(t), clean = path.join(path.dirname(f.document.path), f.request.originalName);
  fs.copyFileSync(f.document.path, clean);
  f.repository.database.prepare("INSERT INTO documents (id,owner_type,owner_id,kind,title,path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("other-doc", "project", f.project.id, "BP", "other", clean, 1, 1);
  assert.throws(() => repairAttachmentName(f.repository, f.request), /另一份文档索引/);
  f.repository.database.prepare("DELETE FROM documents WHERE id=?").run("other-doc");
  const result = apply(f); assert.equal(result.targetPath, clean); assert.equal(result.targetExists, true);
});

test("stale source, reference, index and plan cannot be applied", t => {
  const f = fixture(t);
  const preview = repairAttachmentName(f.repository, f.request);
  fs.appendFileSync(f.project.documentPath, "\n用户并发修改\n");
  assert.throws(() => repairAttachmentName(f.repository, { ...f.request, dryRun: false, expectedPlanHash: preview.planHash }), /计划已变化/);
  assert.throws(() => repairAttachmentName(f.repository, { ...f.request, expectedSha256: "a".repeat(64) }), /内容已变化/);
  assert.throws(() => repairAttachmentName(f.repository, { ...f.request, expectedPath: path.join(f.root, "other") }), /索引路径已变化/);
  assert.throws(() => repairAttachmentName(f.repository, { ...f.request, originalName: "different.pdf" }), /原名证据/);
  assert.throws(() => repairAttachmentName(f.repository, { ...f.request, references: [{ path: f.project.documentPath, expectedSha256: "a".repeat(64) }] }), /引用文档已变化/);
  assert.equal(fs.existsSync(f.document.path), true);
});

test("failure after filesystem and index writes rolls everything back with private verified backup", t => {
  const f = fixture(t), before = fs.readFileSync(f.project.documentPath), oldRow = f.repository.database.prepare("SELECT * FROM documents WHERE id=?").get(f.document.id);
  let failure;
  try { apply(f, f.request, { beforeCommit() { throw new Error("injected failure"); } }); } catch (error) { failure = error; }
  assert.match(failure.message, /injected/);
  assert.deepEqual(fs.readFileSync(f.project.documentPath), before);
  assert.deepEqual(f.repository.database.prepare("SELECT * FROM documents WHERE id=?").get(f.document.id), oldRow);
  assert.equal(digest(f.document.path), f.request.expectedSha256);
  assert.equal(fs.existsSync(path.join(path.dirname(f.document.path), f.request.originalName)), false);
  const journal = JSON.parse(fs.readFileSync(failure.repairJournalPath));
  assert.equal(journal.state, "rolled-back"); assert.equal(digest(journal.backupPath), f.request.expectedSha256);
});

test("precise replacement leaves similar names, prose and URL query text alone", () => {
  const previous = "/library/项目/原始材料/1790000000000-0-BP.pdf", target = "/library/项目/原始材料/BP.pdf", md = "/library/项目/项目主页.md";
  const source = `用户原文 1790000000000-0-BP.pdf。\n[x](原始材料/1790000000000-0-BP.pdf.bak)\n[x](原始材料/1790000000000-0-BP.pdf)\n${previous}.bak\n/other${previous}\nhttps://example.test/?path=${previous}\n`;
  const updated = replaceReferencePaths(source, md, previous, target);
  assert.ok(updated.includes("用户原文 1790000000000-0-BP.pdf。"));
  assert.ok(updated.includes(".pdf.bak)")); assert.ok(updated.includes("[x](原始材料/BP.pdf)"));
  assert.ok(updated.includes(`${previous}.bak`)); assert.ok(updated.includes(`/other${previous}`));
  assert.ok(updated.includes(`https://example.test/?path=${previous}`));
});
