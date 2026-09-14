const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");
const {
  defaultConfigPath,
  DomiRepository,
  ensureLocalWorkspace,
  LOCAL_TODO_DOCUMENT_NAME,
  readConfig
} = require("./domi-repo.cjs");

test("config path prefers domi and falls back to the legacy application directory", () => {
  const homeDir = "/Users/example";
  const current = path.join(homeDir, "Library", "Application Support", "domi", "domi-plugin-config.json");
  const legacyName = String.fromCodePoint(0x8c46, 0x7c73);
  const legacy = path.join(homeDir, "Library", "Application Support", legacyName, "domi-plugin-config.json");
  assert.equal(defaultConfigPath(homeDir, (candidate) => candidate === current), current);
  assert.equal(defaultConfigPath(homeDir, (candidate) => candidate === legacy), legacy);
  assert.equal(defaultConfigPath(homeDir, () => false), current);
});

test("legacy Feishu backend remains primary until a verified local import", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-authority-"));
  const configPath = path.join(root, "domi-plugin-config.json");
  const repositoryDir = path.join(root, "domi工作区");
  fs.writeFileSync(configPath, JSON.stringify({
    storageBackend: "feishu",
    localRepositoryDir: repositoryDir,
    localLibraryDir: path.join(root, "legacy-materials"),
    projectBaseToken: "placeholder",
    projectTableId: "placeholder",
    peopleBaseToken: "placeholder",
    peopleTableId: "placeholder",
    radarBaseToken: "placeholder",
    radarTableId: "placeholder",
    wikiSpaceId: "placeholder"
  }));
  const previous = process.env.DOMI_CONFIG_PATH;
  process.env.DOMI_CONFIG_PATH = configPath;
  t.after(() => {
    if (previous === undefined) delete process.env.DOMI_CONFIG_PATH;
    else process.env.DOMI_CONFIG_PATH = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const config = readConfig();
  assert.equal(config.backend, "feishu");
  assert.equal(config.libraryDir, config.materialDir);
  assert.notEqual(config.libraryDir, repositoryDir);
  assert.equal(config.legacyFeishuPrimary, true);
  assert.equal(config.legacyFeishuReadCompatible, true);
  assert.equal(config.legacyFeishuConfigured, true);
});

test("verified legacy import disables Feishu read compatibility", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-migrated-"));
  const configPath = path.join(root, "domi-plugin-config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    storageBackend: "feishu",
    localAuthorityMigrationCompleted: true,
    localRepositoryDir: path.join(root, "domi工作区")
  }));
  const previous = process.env.DOMI_CONFIG_PATH;
  process.env.DOMI_CONFIG_PATH = configPath;
  t.after(() => {
    if (previous === undefined) delete process.env.DOMI_CONFIG_PATH;
    else process.env.DOMI_CONFIG_PATH = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const config = readConfig();
  assert.equal(config.backend, "local");
  assert.equal(config.legacyFeishuPrimary, false);
  assert.equal(config.legacyFeishuReadCompatible, false);
});

test("legacy Feishu-primary config rejects accidental local repository writes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-feishu-primary-guard-"));
  const configPath = path.join(root, "domi-plugin-config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    storageBackend: "feishu",
    localLibraryDir: path.join(root, "legacy-materials")
  }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "domi-repo.cjs"), "init"],
    {
      encoding: "utf8",
      env: { ...process.env, DOMI_CONFIG_PATH: configPath }
    }
  );
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.ok, false);
  assert.equal(output.code, "legacy_feishu_primary");
  assert.match(output.error, /禁止|停止|不能调用|本地 domi-repo 命令已停止/);
  assert.equal(fs.existsSync(path.join(root, "domi-repository.sqlite3")), false);
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

test("empty entity search does not claim coverage of names mentioned in notes or documents", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const project = repository.upsertProject({ name: "青松科技", notes: "交流中提及林乙的产品。" }).project;
  const { document } = repository.createDocument({
    ownerType: "project", ownerId: project.id, kind: "研究",
    title: "林乙产品交流", content: "# 交流记录\n\n林乙的产品名为青松助手。\n"
  });
  assert.match(fs.readFileSync(document.path, "utf8"), /林乙/);

  for (const [kind, result] of [
    ["project", repository.queryProjects({ query: "林乙" })],
    ["person", repository.queryPeople({ query: "林乙" })]
  ]) {
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
    assert.equal(result.hasMore, false);
    assert.equal(result.nextCursor, null);
    assert.equal(result.complete, true);
    assert.equal(result.completeScope, "pagination");
    assert.deepEqual(result.searchCoverage, {
      type: "entity_fields", queryApplied: true,
      queryFields: kind === "project" ? ["name", "legalName", "aliases"] : ["name", "organization"],
      documentTitlesSearched: false, documentContentSearched: false
    });
  }
});

test("query projection filters in SQL, preserves actual creation time, and paginates ties completely", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  for (let i = 0; i < 7; i++) repository.upsertProject({ id: `page-${i}`, name: `分页项目${i}`, rating: i < 5 ? "A" : "B" });
  repository.database.exec("UPDATE projects SET updated_at=100, created_at=50");
  const options = { query: "分 页 项目", rating: "A", createdFrom: 40, createdTo: 60, fields: ["name", "createdAt"], limit: 2 };
  const first = repository.queryProjects(options);
  assert.equal(first.total, 5);
  assert.equal(first.hasMore, true);
  assert.equal(first.complete, false);
  assert.equal(first.completeScope, "pagination");
  assert.deepEqual(first.searchCoverage, {
    type: "entity_fields", queryApplied: true, queryFields: ["name", "legalName", "aliases"],
    documentTitlesSearched: false, documentContentSearched: false
  });
  assert.deepEqual(Object.keys(first.items[0]), ["id", "name", "createdAt"]);
  assert.equal(first.items[0].createdAt, 50);
  const ids = first.items.map(item => item.id);
  let page = first;
  while (page.hasMore) {
    page = repository.queryProjects({ ...options, cursor: page.nextCursor });
    assert.equal(page.complete, !page.hasMore);
    assert.equal(page.completeScope, "pagination");
    assert.deepEqual(page.searchCoverage, first.searchCoverage);
    assert.deepEqual(page.scope, first.scope);
    ids.push(...page.items.map(item => item.id));
  }
  assert.equal(page.complete, true);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(ids, ["page-0", "page-1", "page-2", "page-3", "page-4"]);
  assert.throws(() => repository.queryProjects({ ...options, rating: "B", cursor: first.nextCursor }), /different query/);
  repository.database.exec("UPDATE projects SET notes='concurrent edit' WHERE id='page-0'");
  assert.throws(() => repository.queryProjects({ ...options, cursor: first.nextCursor }), error => error.code === "query_snapshot_changed");
});

test("person get/batch report missing IDs and compact projection avoids document queries", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const person = repository.upsertPerson({ name: "张三", organization: "A-B 公司" }).person;
  repository.createDocument({
    ownerType: "person", ownerId: person.id, kind: "研究",
    title: "人物研究", content: "# 张三\n\n任职于 A-B 公司。\n"
  });
  repository.database.prepare("UPDATE people SET created_at=? WHERE id=?").run(123, person.id);
  assert.equal(repository.getPerson(person.id).createdAt, 123);
  const full = repository.queryPeople({ query: "A B公司" });
  assert.equal(full.items[0].documents.length, 1);
  assert.deepEqual(full.searchCoverage, {
    type: "entity_fields", queryApplied: true, queryFields: ["name", "organization"],
    documentTitlesSearched: false, documentContentSearched: false
  });
  const prepare = repository.database.prepare.bind(repository.database);
  repository.database.prepare = (sql) => {
    assert.doesNotMatch(sql, /FROM documents/);
    return prepare(sql);
  };
  const result = repository.queryPeople({ query: "A B公司", ids: [person.id, "missing"], fields: ["name", "createdAt"] });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.missingIds, ["missing"]);
  assert.equal(result.items[0].createdAt, 123);
  assert.deepEqual(result.searchCoverage, full.searchCoverage);
  const batch = repository.queryPeople({ ids: [person.id, "missing"], fields: ["name", "createdAt"] });
  assert.deepEqual(batch.items, result.items);
  assert.deepEqual(batch.missingIds, ["missing"]);
  assert.equal(batch.completeScope, "pagination");
  assert.deepEqual(batch.searchCoverage, { ...full.searchCoverage, queryApplied: false });
  assert.throws(() => repository.queryPeople({ fields: ["id); DROP TABLE people"] }), /Unknown projection/);
  assert.throws(() => repository.queryPeople({ limit: 0 }), /limit/);
});

test("existing repositories migrate project revision without losing records", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-repository-migration-"));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      domain TEXT NOT NULL DEFAULT '',
      subdomains_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT '待交流',
      rating TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      cities_json TEXT NOT NULL DEFAULT '[]',
      investors_json TEXT NOT NULL DEFAULT '[]',
      financing_history TEXT NOT NULL DEFAULT '',
      latest_valuation_usd_100m REAL,
      last_updated_at INTEGER,
      document_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO projects (
      id, name, normalized_name, created_at, updated_at
    ) VALUES ('prj_legacy', '历史项目', '历史项目', 1, 1);
  `);
  legacy.close();
  const repository = new DomiRepository({
    backend: "local",
    databasePath,
    libraryDir: path.join(root, "资料库")
  });
  t.after(() => {
    repository.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const project = repository.getProject("prj_legacy");
  assert.equal(project.recordRevision, 1);
  assert.equal(project.legalName, "");
  assert.deepEqual(project.aliases, []);
  const legacyHash = crypto.createHash("sha256").update(JSON.stringify({
    id: "prj_legacy", name: "历史项目", normalizedName: "历史项目", domain: "", subdomains: [],
    status: "待交流", rating: "", notes: "", cities: [], investors: [], financingHistory: "",
    latestValuationUsd100m: null, lastUpdatedAt: null, documentPath: "", createdAt: 1
  })).digest("hex");
  assert.equal(project.recordHash, legacyHash, "empty metadata preserves pre-upgrade receipts");
  assert.equal(repository.summary().schemaVersion, 7);
});

test("local repository initialization creates and preserves 0.待办事项.md", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const todoDocumentPath = path.join(repository.libraryDir, LOCAL_TODO_DOCUMENT_NAME);

  assert.equal(fs.existsSync(todoDocumentPath), true);
  assert.match(fs.readFileSync(todoDocumentPath, "utf8"), /^# 待办事项/m);
  assert.match(fs.readFileSync(todoDocumentPath, "utf8"), /## 关键节点/);
  assert.match(fs.readFileSync(todoDocumentPath, "utf8"), /## 新入库约见/);
  assert.match(fs.readFileSync(todoDocumentPath, "utf8"), /## 人脉跟进/);
  assert.match(fs.readFileSync(todoDocumentPath, "utf8"), /## 项目跟踪/);

  fs.writeFileSync(todoDocumentPath, "# 用户维护的待办事项\n");
  ensureLocalWorkspace(repository.libraryDir);
  assert.equal(fs.readFileSync(todoDocumentPath, "utf8"), "# 用户维护的待办事项\n");
});

test("local project upsert creates SQLite record and lazily creates document folders", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());

  const created = repository.upsertProject({
    name: "示例科技",
    domain: "半导体",
    subdomains: ["芯片设计"],
    status: "已交流",
    rating: "A",
    notes: "第一版摘要",
    financingHistory: "| 融资时间 | 融资轮次 | 投前估值 | 股东出资情况 | 投后估值 |\n|---|---|---:|---|---:|\n| 2026年3月 | A轮 | 1亿美元 | 红杉投资2,000万美元 | 1.2亿美元 |",
    latestValuationUsd100m: 1.2,
    investors: ["红杉"]
  });
  assert.equal(created.ok, true);
  assert.equal(created.action, "created");
  assert.equal(created.storageReceipt.status, "managed");
  assert.equal(repository.listProjects().length, 1);
  assert.equal(created.project.latestValuationUsd100m, 1.2);
  assert.deepEqual(created.project.investors, ["红杉"]);
  assert.match(created.project.financingHistory, /2026年3月/);

  const pagePath = created.project.documentPath;
  const initialPage = fs.readFileSync(pagePath, "utf8");
  assert.match(initialPage, /\[打开项目目录\]\(domi-folder:current\)/);
  assert.match(initialPage, /## 投资摘要[\s\S]*?## 项目概览[\s\S]*?\| 项目字段 \| 当前信息 \|/);
  assert.match(initialPage, /## 融资与估值[\s\S]*?## 相关材料/);
  assert.doesNotMatch(initialPage, /PLAUD文字稿/);
  fs.appendFileSync(pagePath, "\n## 用户补充\n\n这段内容必须保留。\n");
  const updated = repository.upsertProject({
    name: "示例科技",
    domain: "半导体",
    subdomains: ["芯片设计"],
    status: "深度跟踪",
    rating: "S",
    notes: "第二版摘要",
    financingHistory: created.project.financingHistory,
    latestValuationUsd100m: 1.2,
    investors: ["红杉"]
  });
  assert.equal(updated.action, "updated");
  assert.equal(repository.listProjects().length, 1);
  assert.match(fs.readFileSync(pagePath, "utf8"), /这段内容必须保留/);
  assert.match(fs.readFileSync(pagePath, "utf8"), /第二版摘要/);
  assert.match(fs.readFileSync(pagePath, "utf8"), /1\.2 亿美元/);
  for (const directory of ["纪要", "研究", "原始材料", "导出"]) {
    assert.equal(fs.existsSync(path.join(path.dirname(pagePath), directory)), false);
  }
  const document = repository.createDocument({
    ownerType: "project",
    ownerId: created.project.id,
    kind: "研究",
    title: "桌面研究",
    content: "# 桌面研究\n"
  });
  assert.equal(document.ok, true);
  assert.equal(fs.existsSync(path.join(path.dirname(pagePath), "研究")), true);
  for (const directory of ["纪要", "原始材料", "导出"]) {
    assert.equal(fs.existsSync(path.join(path.dirname(pagePath), directory)), false);
  }
});

test("project upsert enforces optional CAS while preserving idempotence and legacy callers", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const base = {
    name: "并发示例科技",
    domain: "AI",
    subdomains: ["AI Infra"],
    status: "待交流",
    rating: "A",
    notes: "审核通过的完整 payload",
    investors: ["示例基金"]
  };

  const created = repository.upsertProject({
    ...base,
    expectedRevision: 0,
    expectedRecordHash: null
  });
  assert.equal(created.project.recordRevision, 1);
  assert.match(created.project.recordHash, /^[a-f0-9]{64}$/);
  assert.equal(created.storageReceipt.recordRevision, 1);
  assert.equal(created.storageReceipt.recordHash, created.project.recordHash);

  const replay = repository.upsertProject({
    ...base,
    projectId: created.project.id,
    expectedRevision: 0,
    expectedRecordHash: null
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.project.recordRevision, 1);
  assert.equal(replay.project.recordHash, created.project.recordHash);

  const provisional = repository.upsertProject({
    ...base,
    projectId: created.project.id,
    notes: "provisional 完整 payload",
    expectedRevision: created.project.recordRevision,
    expectedRecordHash: created.project.recordHash
  });
  assert.equal(provisional.project.id, created.project.id);
  assert.equal(provisional.project.recordRevision, 2);
  assert.notEqual(provisional.project.recordHash, created.project.recordHash);

  assert.throws(
    () => repository.upsertProject({
      ...base,
      projectId: created.project.id,
      notes: "基于陈旧快照的覆盖",
      expectedRevision: created.project.recordRevision,
      expectedRecordHash: created.project.recordHash
    }),
    (error) => error?.code === "DOMI_PROJECT_CAS_MISMATCH" && /重新读取/.test(error.message)
  );
  assert.equal(repository.getProject(created.project.id).notes, "provisional 完整 payload");

  const final = repository.upsertProject({
    ...base,
    projectId: provisional.project.id,
    notes: "最终审核通过的完整 payload",
    status: "已交流",
    expectedRevision: provisional.project.recordRevision,
    expectedRecordHash: provisional.project.recordHash
  });
  assert.equal(final.project.id, created.project.id);
  assert.equal(final.project.recordRevision, 3);
  assert.equal(final.project.notes, "最终审核通过的完整 payload");

  const legacyCompatible = repository.upsertProject({
    ...base,
    projectId: final.project.id,
    notes: "旧调用仍可更新",
    status: "深度跟踪"
  });
  assert.equal(legacyCompatible.project.id, created.project.id);
  assert.equal(legacyCompatible.project.recordRevision, 4);
  assert.equal(legacyCompatible.project.notes, "旧调用仍可更新");
});

test("project taxonomy updates keep the established root and all user materials", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const created = repository.upsertProject({
    name: "路径稳定科技",
    domain: "AI",
    subdomains: ["AI Infra"],
    notes: "初始摘要"
  });
  const originalPage = created.project.documentPath;
  const originalRoot = path.dirname(originalPage);
  const researchPath = path.join(originalRoot, "研究", "用户研究.md");
  const materialPath = path.join(originalRoot, "原始材料", "BP.pdf");
  fs.mkdirSync(path.dirname(researchPath), { recursive: true });
  fs.mkdirSync(path.dirname(materialPath), { recursive: true });
  fs.writeFileSync(researchPath, "用户研究正文\n");
  fs.writeFileSync(materialPath, "binary-material");
  fs.appendFileSync(originalPage, "\n## 用户编辑\n\n必须保留。\n");

  const updated = repository.upsertProject({
    name: "路径稳定科技",
    projectId: created.project.id,
    domain: "半导体",
    subdomains: ["芯片设计"],
    notes: "分类修正后的摘要",
    expectedRevision: created.project.recordRevision,
    expectedRecordHash: created.project.recordHash
  });

  assert.equal(updated.project.documentPath, originalPage);
  assert.equal(fs.readFileSync(researchPath, "utf8"), "用户研究正文\n");
  assert.equal(fs.readFileSync(materialPath, "utf8"), "binary-material");
  assert.match(fs.readFileSync(originalPage, "utf8"), /必须保留/);
  assert.match(fs.readFileSync(originalPage, "utf8"), /domain: "半导体"/);
  assert.equal(
    fs.existsSync(path.join(repository.libraryDir, "3.项目库", "半导体", "芯片设计", "路径稳定科技")),
    false
  );
});

test("commit failure rolls back without creating an orphan project page", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const expectedPage = repository.projectDocumentPath({
    name: "提交失败科技",
    domain: "AI",
    subdomains: ["AI Infra"]
  });
  const originalExec = repository.database.exec.bind(repository.database);
  repository.database.exec = (sql) => {
    if (sql === "COMMIT") throw new Error("simulated commit failure");
    return originalExec(sql);
  };

  assert.throws(
    () => repository.upsertProject({
      name: "提交失败科技",
      domain: "AI",
      subdomains: ["AI Infra"]
    }),
    /simulated commit failure/
  );
  assert.equal(repository.listProjects("提交失败科技").length, 0);
  assert.equal(fs.existsSync(expectedPage), false);
});

test("post-commit project page failure is recoverable and never claims document verification", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const expectedPage = repository.projectDocumentPath({
    name: "主页失败科技",
    domain: "AI",
    subdomains: ["AI Infra"]
  });
  const originalProjectPage = repository.projectPage.bind(repository);
  repository.projectPage = () => {
    throw new Error("simulated markdown failure");
  };

  let failure;
  try {
    repository.upsertProject({
      name: "主页失败科技",
      domain: "AI",
      subdomains: ["AI Infra"],
      expectedRevision: 0,
      expectedRecordHash: null
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, "DOMI_PROJECT_DOCUMENT_WRITE_FAILED");
  assert.equal(failure?.storageReceipt?.status, "provisional");
  assert.equal(failure?.storageReceipt?.recordVerified, true);
  assert.equal(failure?.storageReceipt?.documentVerified, false);
  assert.equal(failure?.storageReceipt?.recoveryRequired, true);
  assert.equal(fs.existsSync(expectedPage), false);
  const persisted = repository.listProjects("主页失败科技");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].documentPath, expectedPage);

  repository.projectPage = originalProjectPage;
  const recovered = repository.upsertProject({
    name: "主页失败科技",
    domain: "AI",
    subdomains: ["AI Infra"],
    expectedRevision: 0,
    expectedRecordHash: null
  });
  assert.equal(recovered.idempotentReplay, true);
  assert.equal(recovered.storageReceipt.documentVerified, true);
  assert.equal(recovered.project.id, persisted[0].id);
  assert.equal(fs.existsSync(expectedPage), true);
});

test("project upsert rejects archive titles before writing and accepts canonical company names", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());

  assert.throws(
    () => repository.upsertProject({
      name: "20260630-示例主体-技术专题-A",
      domain: "AI",
      subdomains: ["AI4S"]
    }),
    (error) => error?.code === "DOMI_PROJECT_NAME_REVIEW_REQUIRED"
      && /只能是公司或项目主体名/.test(error.message)
  );
  assert.equal(repository.listProjects().length, 0);
  assert.equal(
    fs.existsSync(path.join(
      repository.libraryDir,
      "3.项目库",
      "AI",
      "AI4S",
      "20260630-示例主体-技术专题-A"
    )),
    false
  );

  for (const name of ["360", "3D Systems", "B-ON"]) {
    const result = repository.upsertProject({
      name,
      domain: "_未分类",
      subdomains: []
    });
    assert.equal(result.project.name, name);
  }
  assert.equal(repository.listProjects().length, 3);
});

test("new consumer projects use 消费 while existing 消费科技 projects remain compatible", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());

  const created = repository.upsertProject({
    name: "新消费项目",
    domain: "消费科技",
    subdomains: ["可穿戴"]
  });
  assert.equal(created.project.domain, "消费");

  const legacy = repository.upsertProject({
    name: "历史消费项目",
    domain: "消费",
    subdomains: ["可穿戴"]
  });
  repository.database.prepare("UPDATE projects SET domain = '消费科技' WHERE id = ?")
    .run(legacy.project.id);
  const compatible = repository.upsertProject({
    name: "历史消费项目",
    domain: "消费科技",
    subdomains: ["可穿戴"],
    notes: "只更新摘要"
  });
  assert.equal(compatible.project.domain, "消费科技");
});

test("unclassified projects avoid and migrate the redundant _未分类/_未分类 layer", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const legacyPath = path.join(
    repository.libraryDir,
    "3.项目库",
    "_未分类",
    "_未分类",
    "历史项目"
  );
  fs.mkdirSync(legacyPath, { recursive: true });
  fs.writeFileSync(path.join(legacyPath, "旧材料.txt"), "preserved");

  const result = repository.upsertProject({
    name: "历史项目",
    domain: "",
    subdomains: [],
    status: "待交流"
  });
  const projectDirectory = path.dirname(result.project.documentPath);

  assert.equal(
    projectDirectory,
    path.join(repository.libraryDir, "3.项目库", "_未分类", "历史项目")
  );
  assert.equal(fs.readFileSync(path.join(projectDirectory, "旧材料.txt"), "utf8"), "preserved");
  assert.equal(fs.existsSync(path.join(repository.libraryDir, "3.项目库", "_未分类", "_未分类")), false);
});

test("person records keep one homepage and archive research plus interaction documents", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const created = repository.upsertPerson({
    name: "张三",
    types: ["创业者"],
    organization: "示例科技 · CEO"
  });
  assert.equal(created.ok, true);
  assert.match(created.person.documentPath, /人物主页\.md$/);
  assert.equal(fs.existsSync(path.join(path.dirname(created.person.documentPath), "张三-人物资料.md")), false);

  const document = repository.createDocument({
    ownerType: "person",
    ownerId: created.person.id,
    kind: "交流纪要",
    title: "20260803-电话沟通",
    content: "#### 电话沟通\n- 讨论合作安排。\n"
  });
  assert.match(document.document.path, /纪要\/20260803-电话沟通\.md$/);
  const research = repository.createDocument({
    ownerType: "person",
    ownerId: created.person.id,
    kind: "研究",
    title: "20260803-张三-人物研究",
    content: "# 张三人物研究\n"
  });
  assert.match(research.document.path, /研究\/20260803-张三-人物研究\.md$/);
  const person = repository.listPeople("张三")[0];
  assert.deepEqual(person.interactionDocuments.map((item) => item.title), ["20260803-电话沟通"]);
  assert.equal(fs.existsSync(person.interactionDocuments[0].path), true);
  assert.deepEqual(
    person.documents.map((item) => `${item.kind}:${item.title}`).sort(),
    ["交流纪要:20260803-电话沟通", "研究:20260803-张三-人物研究"].sort()
  );
  assert.equal(fs.existsSync(person.documents[0].path), true);
});

test("formal notes reject bad headings and missing rules before any archive write", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const project = repository.upsertProject({ name: "格式校验示例" }).project;
  const input = { ownerType: "project", ownerId: project.id, kind: "纪要", title: "合成交流纪要" };
  const good = "#### 合成交流纪要\n参会人：张某\n#### 团队背景\n- 两位成员。\n\n---\n\n#### 产品与技术\n- 自研引擎。\n";
  const created = repository.createDocument({ ...input, content: good });
  const before = repository.database.prepare("SELECT * FROM documents WHERE id=?").get(created.document.id);
  for (const content of [good.replace(/####/g, "##"), good.replace("\n\n---\n\n", "\n")]) {
    assert.throws(() => repository.createDocument({ ...input, content }), error => error.code === "DOMI_NOTES_FORMAT_INVALID");
    assert.equal(fs.readFileSync(created.document.path, "utf8"), good);
    assert.deepEqual(repository.database.prepare("SELECT * FROM documents WHERE id=?").get(created.document.id), before);
  }
  for (const content of [
    good.replace("参会人：张某", "参会人：张某\n会议日期：2026年9月10日"),
    good.replace("参会人：张某", "参会人：张某\n主题：产品能力与商业进展"),
    good + "\n本纪要未经独立核验。\n",
    good + "\n口径说明：经营、技术、客户及融资数据均为嘉宾会中陈述，未经合同、财务底稿或独立技术测试验证。\n",
    good + "\n\n---\n\n#### 来源与记录边界\n- 该段仍含须移回正文的合同事实。\n",
    good + "\n\n---\n\n#### 数字审计与冲突清单\n- 其中有须移回正文的预测条件。\n",
    good + "\n\n---\n\n#### 来源与证据边界\n- 该段仍含须移回正文的合同事实。\n",
    good.replace("自研引擎。", "自研引擎（逐字稿00:12）。")
  ]) {
    assert.throws(() => repository.createDocument({ ...input, content }), error =>
      error.code === "DOMI_NOTES_DELIVERY_INVALID" && error.issues.some(issue => issue.line > 1));
    assert.equal(fs.readFileSync(created.document.path, "utf8"), good);
    assert.deepEqual(repository.database.prepare("SELECT * FROM documents WHERE id=?").get(created.document.id), before);
  }
  const raw = repository.createDocument({ ...input, kind: "PLAUD文字稿", title: "原始文字稿", content: "# 原始文字稿\n00:01 Speaker 1\n原话\n" });
  assert.match(fs.readFileSync(raw.document.path, "utf8"), /^# 原始文字稿/);
});

test("person upsert can persist the full research document in the same intake", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const created = repository.upsertPerson({
    name: "叶锐",
    types: ["博士生"],
    organization: "示例大学 · 研究人员",
    researchTitle: "20260803-叶锐-人物研究",
    researchContent: "# 叶锐人物研究\n\n完整研究内容。\n"
  });
  assert.equal(created.ok, true);
  assert.match(created.researchDocument.path, /研究\/20260803-叶锐-人物研究\.md$/);
  assert.deepEqual(created.person.documents.map((item) => item.title), ["20260803-叶锐-人物研究"]);
  assert.equal(fs.existsSync(created.researchDocument.path), true);
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

  const consumer = repository.upsertNews({
    eventId: "evt_consumer",
    title: "示例消费品牌发布新品",
    domains: ["消费科技"],
    subdomains: ["消费品牌"],
    publishedAt: "2026-07-24T10:00:00+08:00"
  });
  assert.deepEqual(consumer.event.domains, ["消费"]);
});


test("new legal-form names require an explicit exception and genuine 科技 brands remain intact", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  for (const name of ["蓝云鲸科技有限公司", "上海星舟有限责任公司", "星舟股份有限公司", "Example Labs, Inc.", "Example LLC"]) {
    assert.throws(() => repository.upsertProject({ name }), error =>
      error.code === "DOMI_PROJECT_NAME_REVIEW_REQUIRED" && /legalName/.test(error.message));
    assert.throws(() => repository.upsertProject({ name, allowLegalName: "true" }), /legalName/);
  }
  assert.equal(repository.listProjects().length, 0);
  for (const name of ["若水科技", "上海电气", "科技之光", "360", "3D Systems", "B-ON", "MemoraX AI"]) {
    assert.equal(repository.upsertProject({ name }).project.name, name);
  }
  const confirmed = repository.upsertProject({ name: "示例实业有限公司", allowLegalName: true }).project;
  const updated = repository.upsertProject({ projectId: confirmed.id, name: confirmed.name, notes: "补充产品进展" }).project;
  assert.equal(updated.name, confirmed.name);
  assert.equal(updated.notes, "补充产品进展");
  assert.throws(() => repository.upsertProject({ projectId: confirmed.id, name: "新示例有限公司" }), /legalName/);
});

test("brand correction preserves identity, materials, business fields and dates, and resolves stale names", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const initial = repository.upsertProject({
    name: "蓝云鲸科技有限公司", allowLegalName: true, domain: "AI", subdomains: ["AI Infra"],
    status: "已交流", rating: "A", notes: "保留完整摘要", cities: ["上海"], investors: ["示例机构"],
    financingHistory: "2026年种子轮", latestValuationUsd100m: 0.1, lastUpdatedAt: 1700000000000,
    aliases: ["CloudWhale AI"]
  }).project;
  const attachment = path.join(path.dirname(initial.documentPath), "原始材料", "BP.pdf");
  fs.mkdirSync(path.dirname(attachment), { recursive: true });
  fs.writeFileSync(attachment, "unchanged binary");
  fs.appendFileSync(initial.documentPath, "\n## 用户章节\n保留用户文字。\n");
  const corrected = repository.upsertProject({
    projectId: initial.id, name: "蓝云鲸", legalName: initial.name, expectedRevision: initial.recordRevision,
    expectedRecordHash: initial.recordHash
  }).project;
  for (const key of ["id", "domain", "subdomains", "status", "rating", "notes", "cities", "investors", "financingHistory", "latestValuationUsd100m", "lastUpdatedAt", "createdAt", "documentPath"]) {
    assert.deepEqual(corrected[key], initial[key], key);
  }
  assert.equal(corrected.legalName, initial.name);
  assert.deepEqual(corrected.aliases, ["CloudWhale AI", initial.name]);
  assert.equal(fs.readFileSync(attachment, "utf8"), "unchanged binary");
  assert.match(fs.readFileSync(initial.documentPath, "utf8"), /company_name: "蓝云鲸"/);
  assert.match(fs.readFileSync(initial.documentPath, "utf8"), /法律主体.*蓝云鲸科技有限公司/);
  assert.match(fs.readFileSync(initial.documentPath, "utf8"), /保留用户文字/);
  for (const name of [initial.name, "cloudwhale ai", "CloudWhale-AI"]) {
    const result = repository.upsertProject({ name });
    assert.equal(result.project.id, initial.id);
    assert.equal(result.project.name, "蓝云鲸");
    assert.equal(result.idempotentReplay, true);
  }
  const staleWithId = repository.upsertProject({ projectId: initial.id, name: initial.name });
  assert.equal(staleWithId.project.name, "蓝云鲸");
  assert.equal(staleWithId.idempotentReplay, true);
  assert.throws(() => repository.upsertProject({ projectId: initial.id, name: initial.name, rename: true }), /legalName/);
  assert.equal(repository.upsertProject({ name: "另一个候选简称", legalName: initial.name }).project.name, "蓝云鲸");
  assert.equal(repository.listProjects().length, 1);
  const reverted = repository.upsertProject({ projectId: initial.id, name: initial.name, rename: true, allowLegalName: true }).project;
  assert.equal(reverted.name, initial.name);
  assert.ok(reverted.aliases.includes("蓝云鲸"));
});

test("identity metadata is searchable and projected without claiming document coverage", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const record = repository.upsertProject({
    name: "星舟科技", legalName: "上海星舟智能科技有限公司", aliases: ["StarBoat AI", "starboat-ai", "星舟科技"]
  }).project;
  assert.deepEqual(record.aliases, ["StarBoat AI"]);
  for (const query of ["星舟", "上海星舟智能", "starboat-ai", "StarBoat AI"]) {
    const response = repository.queryProjects({ query, fields: ["name", "legalName", "aliases"], limit: 1 });
    assert.equal(response.total, 1);
    assert.equal(response.items[0].id, record.id);
    assert.equal(response.items[0].legalName, record.legalName);
    assert.deepEqual(response.items[0].aliases, record.aliases);
    assert.deepEqual(response.searchCoverage.queryFields, ["name", "legalName", "aliases"]);
    assert.equal(response.searchCoverage.documentContentSearched, false);
  }
  const enriched = repository.upsertProject({ projectId: record.id, name: record.name, aliases: ["星舟智能"] }).project;
  assert.deepEqual(enriched.aliases, ["StarBoat AI", "星舟智能"]);
  const changedLegal = repository.upsertProject({ projectId: record.id, name: record.name, legalName: "星舟控股有限公司" }).project;
  assert.ok(changedLegal.aliases.includes(record.legalName));
  assert.equal(repository.queryProjects({ query: record.legalName }).items[0].id, record.id);
});

test("identity collisions and stale CAS cannot merge companies or discard reviewed identity metadata", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const a = repository.upsertProject({ name: "青甲科技", aliases: ["A Labs"] }).project;
  const b = repository.upsertProject({ name: "青乙科技", legalName: "青乙科技有限公司" }).project;
  for (const input of [
    { projectId: a.id, name: b.name },
    { projectId: a.id, name: a.name, aliases: [b.name] },
    { projectId: a.id, name: a.name, legalName: b.legalName },
    { name: a.name, aliases: [b.name] },
    { projectId: "new-id", name: "A Labs" }
  ]) assert.throws(() => repository.upsertProject(input), error => error.code === "DOMI_PROJECT_CAS_MISMATCH");
  assert.equal(repository.listProjects().length, 2);
  assert.deepEqual(repository.getProject(a.id).aliases, ["A Labs"]);
  const enriched = repository.upsertProject({ projectId: a.id, name: a.name, legalName: "青甲智能有限公司" }).project;
  assert.notEqual(enriched.recordHash, a.recordHash);
  assert.throws(() => repository.upsertProject({
    projectId: a.id, name: a.name, notes: "过期覆盖", expectedRevision: a.recordRevision, expectedRecordHash: a.recordHash
  }), error => error.code === "DOMI_PROJECT_CAS_MISMATCH");
  assert.equal(repository.getProject(a.id).notes, "");
  repository.database.prepare("UPDATE projects SET aliases_json = ? WHERE id = ?").run(JSON.stringify(["A Labs"]), b.id);
  assert.throws(() => repository.upsertProject({ name: "A Labs" }), /匹配多个项目/);
  assert.equal(repository.upsertProject({ projectId: a.id, name: a.name, notes: "明确项目的普通更新" }).project.notes, "明确项目的普通更新");
  assert.throws(() => repository.upsertProject({ projectId: a.id, name: "A Labs", rename: true }), /另一个项目/);
});


test("renaming a legal-shaped old display name does not assert an unverified legal entity", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const old = repository.upsertProject({ name: "旧候选名字有限公司", allowLegalName: true }).project;
  const renamed = repository.upsertProject({ projectId: old.id, name: "新品牌" }).project;
  assert.equal(renamed.legalName, "");
  assert.deepEqual(renamed.aliases, [old.name]);
  assert.equal(repository.queryProjects({ query: old.name }).items[0].id, old.id);
  const content = fs.readFileSync(renamed.documentPath, "utf8");
  assert.doesNotMatch(content, /\| 法律主体 \|/);
  assert.match(content, /\| 历史名称／别名 \| 旧候选名字有限公司 \|/);
});

test("project homepage renders legal identity and aliases without breaking Markdown table cells", (t) => {
  const repository = createRepository(t);
  t.after(() => repository.close());
  const project = repository.upsertProject({ name: "表格名称示例", legalName: "Example | Holdings\nLLC", aliases: ["Alias | One", "Alias\nTwo"] }).project;
  const lines = fs.readFileSync(project.documentPath, "utf8").split("\n");
  assert.equal(lines.find(line => line.startsWith("| 法律主体 |")), "| 法律主体 | Example \\| Holdings LLC |");
  assert.equal(lines.find(line => line.startsWith("| 历史名称／别名 |")), "| 历史名称／别名 | Alias \\| One、Alias Two |");
  const separator = lines.indexOf("| --- | --- |");
  assert.equal(lines[separator + 1].startsWith("| 法律主体 |"), true);
  assert.equal(lines[separator + 2].startsWith("| 历史名称／别名 |"), true);
  assert.equal(lines[separator + 3].startsWith("| 领域 |"), true);
});
