const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DomiRepository } = require("./domi-repo.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-attachment-test-"));
  const repository = new DomiRepository({ libraryDir: path.join(root, "library"), databasePath: path.join(root, "repo.sqlite") });
  const project = repository.upsertProject({ name: "样例数据", domain: "AI", subdomains: ["AI数据"], status: "已交流", rating: "A", lastUpdatedAt: "2026-01-05" });
  const id = project.storageReceipt.projectId;
  const source = path.join(root, "Deck 样例.pdf");
  fs.writeFileSync(source, Buffer.from([0, 1, 2, 255]));
  t.after(() => { repository.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, repository, id, source };
}

test("original attachment preserves bytes, indexes once and keeps different versions", t => {
  const { repository, id, source } = fixture(t);
  const before = repository.getProject(id);
  const input = { ownerType: "project", ownerId: id, sourceFile: source, kind: "BP", title: "样例 BP" };
  const first = repository.createDocument(input);
  assert.equal(first.action, "imported");
  assert.deepEqual(fs.readFileSync(first.document.path), fs.readFileSync(source));
  const second = repository.createDocument(input);
  assert.equal(second.document.id, first.document.id);
  assert.equal(second.action, "unchanged");
  assert.match(fs.readFileSync(before.documentPath, "utf8"), /样例 BP/);
  fs.writeFileSync(source, Buffer.from([3, 4, 5]));
  const next = repository.createDocument(input);
  assert.notEqual(next.document.path, first.document.path);
  assert.deepEqual(fs.readFileSync(first.document.path), Buffer.from([0, 1, 2, 255]));
  assert.equal(repository.database.prepare("SELECT count(*) n FROM documents WHERE owner_id=?").get(id).n, 2);
  const after = repository.getProject(id);
  for (const key of ["rating", "status", "lastUpdatedAt", "createdAt"]) assert.equal(after[key], before[key]);
});

test("attachment rejects path escape, unsupported owner and mixed source types", t => {
  const { repository, id, source } = fixture(t);
  const input = { ownerType: "project", ownerId: id, sourceFile: source };
  assert.throws(() => repository.createDocument({ ...input, originalName: "../outside.pdf" }), /文件名/);
  assert.throws(() => repository.createDocument({ ...input, ownerType: "industry" }), /仅支持/);
  assert.throws(() => repository.createDocument({ ...input, content: "# other" }), /不能同时/);
  const target = path.join(path.dirname(repository.getProject(id).documentPath), "原始材料");
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(source, path.join(target, path.basename(source)));
  assert.throws(() => repository.createDocument(input), /普通文件/);
  assert.equal(repository.database.prepare("SELECT count(*) n FROM documents WHERE owner_id=?").get(id).n, 0);
});

test("authoritative staging metadata imports original physical names and dates; unknown numeric names stay intact", t => {
  const { repository, id, root } = fixture(t);
  const staging = path.join(repository.libraryDir, "attachments");
  fs.mkdirSync(staging);
  const upload = path.join(staging, "1790000000000-0-[BP] 样例项目.pdf");
  fs.writeFileSync(upload, "sample-original");
  const input = { ownerType: "project", ownerId: id, sourceFile: upload, originalName: "[BP] 样例项目.pdf", title: path.basename(upload), kind: "BP" };
  const imported = repository.createDocument(input);
  assert.equal(path.basename(imported.document.path), "[BP] 样例项目.pdf");
  assert.equal(imported.document.title, "[BP] 样例项目.pdf");
  assert.equal(fs.readFileSync(upload, "utf8"), "sample-original");
  for (const name of ["20260922-样例项目-文字稿.md", "2026-09-22-报告.pdf", "1234567890123-4-设备.pdf"]) {
    const source = path.join(root, name); fs.writeFileSync(source, name);
    const result = repository.createDocument({ ...input, sourceFile: source, originalName: undefined, title: name });
    assert.equal(path.basename(result.document.path), name);
  }
});

test("authoritative original names override storage guesses and normalized imports remain idempotent with collision versions", t => {
  const { repository, id, root } = fixture(t);
  const source = path.join(root, "1790000000000-0-upload.pdf"); fs.writeFileSync(source, "version-one");
  const input = { ownerType: "project", ownerId: id, sourceFile: source, originalName: "[BP] 样例项目.pdf" };
  const first = repository.createDocument(input), repeated = repository.createDocument(input);
  assert.equal(first.document.id, repeated.document.id);
  assert.equal(path.basename(first.document.path), input.originalName);
  fs.writeFileSync(source, "version-two");
  const second = repository.createDocument(input);
  assert.match(path.basename(second.document.path), /^\[BP\] 样例项目-[a-f0-9]{12}\.pdf$/);
  assert.equal(fs.readFileSync(first.document.path, "utf8"), "version-one");
  assert.equal(fs.readFileSync(second.document.path, "utf8"), "version-two");
  const numeric = "1790000000000-9-真实产品编号.pdf";
  const result = repository.createDocument({ ...input, originalName: numeric });
  assert.equal(path.basename(result.document.path), numeric);
  assert.equal(repository.createDocument({ ...input, originalName: numeric }).action, "unchanged");
});

test("attachment directories, symlinks and archived paths do not justify stripping numeric original names", t => {
  const { repository, id, root } = fixture(t);
  const outside = path.join(root, "1790000000000-0-用户原名.pdf"); fs.writeFileSync(outside, "numeric-original");
  const staging = path.join(repository.libraryDir, "attachments"); fs.mkdirSync(staging);
  const realStaged = path.join(staging, "1790000000000-1-真实产品编号.pdf"); fs.writeFileSync(realStaged, "real-numeric-original");
  const staged = repository.createDocument({ ownerType: "project", ownerId: id, sourceFile: realStaged });
  assert.equal(path.basename(staged.document.path), path.basename(realStaged));
  const link = path.join(staging, path.basename(outside)); fs.symlinkSync(outside, link);
  const result = repository.createDocument({ ownerType: "project", ownerId: id, sourceFile: link });
  assert.equal(path.basename(result.document.path), path.basename(outside));
  assert.equal(repository.createDocument({ ownerType: "project", ownerId: id, sourceFile: result.document.path }).document.id, result.document.id);
});
