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
