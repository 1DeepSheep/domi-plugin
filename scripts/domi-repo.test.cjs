const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { defaultConfigPath, DomiRepository } = require("./domi-repo.cjs");

test("config path prefers domi and falls back to the legacy application directory", () => {
  const homeDir = "/Users/example";
  const current = path.join(homeDir, "Library", "Application Support", "domi", "domi-plugin-config.json");
  const legacyName = String.fromCodePoint(0x8c46, 0x7c73);
  const legacy = path.join(homeDir, "Library", "Application Support", legacyName, "domi-plugin-config.json");
  assert.equal(defaultConfigPath(homeDir, (candidate) => candidate === current), current);
  assert.equal(defaultConfigPath(homeDir, (candidate) => candidate === legacy), legacy);
  assert.equal(defaultConfigPath(homeDir, () => false), current);
});

function createRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-repository-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new DomiRepository({
    backend: "local",
    databasePath: path.join(root, "Application Support", "domi-repository.sqlite3"),
    libraryDir: path.join(root, "资料库")
  });
}

test("local project upsert creates SQLite record, stable Markdown page and material folders", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());

  const created = repository.upsertProject({
    name: "示例科技",
    domain: "半导体",
    subdomains: ["芯片设计"],
    status: "已交流",
    rating: "A",
    notes: "第一版摘要"
  });
  assert.equal(created.ok, true);
  assert.equal(created.action, "created");
  assert.equal(created.storageReceipt.status, "managed");
  assert.equal(repository.listProjects().length, 1);

  const pagePath = created.project.documentPath;
  fs.appendFileSync(pagePath, "\n## 用户补充\n\n这段内容必须保留。\n");
  const updated = repository.upsertProject({
    name: "示例科技",
    domain: "半导体",
    subdomains: ["芯片设计"],
    status: "深度跟踪",
    rating: "S",
    notes: "第二版摘要"
  });
  assert.equal(updated.action, "updated");
  assert.equal(repository.listProjects().length, 1);
  assert.match(fs.readFileSync(pagePath, "utf8"), /这段内容必须保留/);
  assert.match(fs.readFileSync(pagePath, "utf8"), /第二版摘要/);
  for (const directory of ["纪要", "研究", "原始材料", "导出"]) {
    assert.equal(fs.existsSync(path.join(path.dirname(pagePath), directory)), true);
  }
});

test("local news upsert deduplicates by event ID and writes a readable Markdown mirror", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());

  const first = repository.upsertNews({
    eventId: "evt_demo",
    title: "示例公司发布新产品",
    domains: ["AI"],
    subdomains: ["模型层"],
    publishedAt: "2026-07-24T09:00:00+08:00",
    summary: "产品正式发布。",
    importance: 8,
    confidence: 9
  });
  const second = repository.upsertNews({
    eventId: "evt_demo",
    title: "示例公司发布新产品",
    domains: ["AI"],
    subdomains: ["模型层"],
    publishedAt: "2026-07-24T09:00:00+08:00",
    summary: "补充了客户信息。",
    importance: 8,
    confidence: 9
  });

  assert.equal(first.action, "created");
  assert.equal(second.action, "updated");
  assert.equal(repository.listNews({ to: Date.parse("2026-07-25T00:00:00+08:00") }).length, 1);
  assert.match(fs.readFileSync(second.event.documentPath, "utf8"), /补充了客户信息/);
});
