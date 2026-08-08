const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

const router = read("skills", "domi-router", "SKILL.md");
const investmentMgmt = read("skills", "investment-mgmt", "SKILL.md");
const storage = read("skills", "investment-mgmt", "references", "storage-backends.md");
const legacy = read("skills", "investment-mgmt", "references", "legacy-feishu-primary.md");
const extension = read("skills", "investment-mgmt", "references", "feishu-knowledge-extension.md");
const delivery = read("skills", "investment-mgmt", "references", "delivery-channels.md");
const exporter = read("scripts", "feishu-markdown-export.cjs");
const todo = read("skills", "todo", "SKILL.md");
const radar = read("skills", "investment-radar", "SKILL.md");
const radarSchema = read("skills", "investment-radar", "references", "base-schema.md");
const projectWorkflow = read("skills", "domi-router", "references", "project-intake-workflow.md");
const peopleWorkflow = read("skills", "domi-router", "references", "people-intake-workflow.md");
const radarWorkflow = read("skills", "domi-router", "references", "industry-news-radar-workflow.md");
const sourcing = read("skills", "sourcing", "SKILL.md");

test("local SQLite and Markdown remain authoritative for new and migrated users", () => {
  for (const contract of [investmentMgmt, storage, delivery]) {
    assert.match(contract, /权威资料库.*本地|本地.*权威/);
  }
  assert.match(investmentMgmt, /新用户与完成安全导入的用户以 SQLite、Markdown 和本地附件目录为权威来源/);
  assert.match(storage, /`backend=local`/);
  assert.match(storage, /禁止\*\*自动\*\*创建、迁移或维护项目／人脉／行业 Base 作为 domi 管理后端/);
  assert.match(storage, /明确要求搜索／读取既有 Base.*使用 `lark-base`/);
  assert.match(investmentMgmt, /`legacy_feishu_primary`/);
  assert.doesNotMatch(storage, /本地 → 飞书/);
});

test("legacy Feishu management remains the single primary backend until verified cutover", () => {
  for (const contract of [router, investmentMgmt, storage]) {
    assert.match(contract, /legacy_feishu_primary/);
  }
  assert.match(storage, /legacyFeishuPrimary=true/);
  assert.match(storage, /旧 Base／Wiki 继续读写/);
  assert.match(storage, /localAuthorityMigrationCompleted=true/);
  assert.match(storage, /不得先切换再补数据/);
  assert.match(legacy, /旧版飞书主库兼容契约/);
  assert.match(legacy, /Watching List 与 Wiki/);
  assert.match(legacy, /人脉 Base/);
  assert.match(legacy, /行业动态 Base/);
  assert.match(legacy, /`1\.待办事项`/);
  assert.match(legacy, /禁止执行/);
  assert.match(legacy, /原子切换/);
  assert.match(legacy, /不删除、移动或覆盖原飞书内容/);
});

test("every management entry point explicitly routes legacy Feishu-primary users", () => {
  for (const contract of [todo, radar, radarSchema, projectWorkflow, peopleWorkflow, radarWorkflow, sourcing]) {
    assert.match(contract, /legacy_feishu_primary/);
    assert.match(contract, /legacy-feishu-primary\.md/);
  }
  assert.match(todo, /不得初始化或写 `0\.待办事项\.md`/);
  assert.match(radar, /禁止调用本地 `news get\/list\/upsert`/);
  assert.match(projectWorkflow, /不得创建仅本地可见的第二个项目/);
  assert.match(peopleWorkflow, /不得调用 `person upsert` 或创建本地第二主档/);
  assert.match(sourcing, /Do not call `domi-repo\.cjs` or create a parallel local person record/);
});

test("Feishu keeps the complete capability scope without becoming the authority", () => {
  for (const capability of ["Base", "Wiki", "Docs", "Drive", "IM", "Contact"]) {
    assert.match(extension, new RegExp(capability));
  }
  for (const skill of ["lark-base", "lark-wiki", "lark-doc", "lark-drive", "lark-im", "lark-contact"]) {
    assert.match(extension, new RegExp(skill));
    assert.match(router, new RegExp(skill));
  }
  assert.match(extension, /授权能力范围与原完整飞书连接保持一致/);
  assert.match(extension, /连接权限与本轮操作授权是两层概念/);
  assert.match(storage, /不缩减飞书连接权限/);
  assert.match(extension, /仅作外部参考或用户指定的协作产物/);
  assert.match(extension, /不能接管 domi 的项目、人脉、行业事件或待办事项管理/);
});

test("Feishu search, read, create and edit require explicit intent and no fixed Base mapping", () => {
  assert.match(extension, /feishu_knowledge_action=search\|read/);
  assert.match(extension, /feishu_knowledge_action=create\|edit/);
  assert.match(extension, /只有本轮用户明确要求搜索、读取、创建、编辑、上传、发送或解析收件人/);
  assert.match(extension, /不要求用户手工填写 Base Token、Table ID、Wiki Space ID/);
  assert.match(extension, /用户明确说“在这个 Base 新增／更新记录”/);
  assert.match(delivery, /delivery_only=feishu_doc\|feishu_dm/);
  assert.match(delivery, /仅说“研究”“整理”“入库”“归档”不能推断/);
  assert.match(router, /delivery_only=feishu_doc\|feishu_dm/);
});

test("single Markdown export has an executable preflight and explicit App-host handoff", () => {
  assert.match(extension, /feishu-markdown-export\.cjs prepare/);
  assert.match(extension, /feishu-markdown-export\.cjs export/);
  assert.match(extension, /feishu-markdown-export\.cjs verify/);
  assert.match(extension, /FEISHU_EXPORT_HANDOFF_REQUIRED/);
  assert.match(extension, /预检清单本身不是写入授权/);
  assert.match(extension, /绝不能退化为简单 `docs \+create`/);
  assert.match(extension, /content_verified=true/);
  assert.match(extension, /images_verified=true/);
  assert.match(exporter, /domi\.feishuMarkdownExporter\.v1/);
  assert.match(exporter, /MISSING_LOCAL_IMAGE/);
  assert.match(exporter, /FEISHU_EXPORT_HANDOFF_REQUIRED/);
  assert.doesNotMatch(exporter, /lark-cli|docs \+create|DOMI_FEISHU_EXPORT_SOCKET|DOMI_FEISHU_EXPORT_TOKEN|node:net/);
});

test("delivery preserves privacy and idempotency without becoming a backend", () => {
  assert.match(delivery, /workflowRunId \+ channel \+ target \+ contentHash/);
  assert.match(delivery, /状态不确定时先查询/);
  assert.match(delivery, /不写回 `storageBackend`/);
  assert.match(delivery, /不建立隐式双向同步/);
  assert.match(extension, /本机路径、文档 token、用户标识和空间标识不得出现/);
});
