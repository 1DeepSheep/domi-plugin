const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");

const router = read("skills", "domi-router", "SKILL.md");
const investmentMgmt = read("skills", "investment-mgmt", "SKILL.md");
const storage = read("skills", "investment-mgmt", "references", "storage-backends.md");
const extension = read("skills", "investment-mgmt", "references", "feishu-knowledge-extension.md");
const delivery = read("skills", "investment-mgmt", "references", "delivery-channels.md");
const exporter = read("scripts", "feishu-markdown-export.cjs");

test("local SQLite and Markdown remain authoritative while Feishu is optional", () => {
  for (const contract of [investmentMgmt, storage, delivery]) {
    assert.match(contract, /权威资料库.*本地|本地.*权威/);
  }
  assert.match(investmentMgmt, /固定为本地 SQLite \+ Markdown/);
  assert.match(storage, /backend` 必须为 `local`/);
  assert.match(storage, /禁止\*\*自动\*\*创建、迁移或维护项目／人脉／行业 Base 作为 domi 管理后端/);
  assert.match(storage, /明确要求搜索／读取既有 Base.*使用 `lark-base`/);
  assert.doesNotMatch(investmentMgmt, /飞书模式：Watching List/);
  assert.doesNotMatch(storage, /本地 → 飞书/);
});

test("legacy Feishu management data remains read-compatible until verified import", () => {
  assert.match(storage, /legacyFeishuReadCompatible=true/);
  assert.match(storage, /只读历史来源/);
  assert.match(storage, /localAuthorityMigrationCompleted=true/);
  assert.match(storage, /全部对象验证成功后/);
  assert.match(storage, /迁移期间新任务.*只写本地/);
  assert.match(storage, /不删除、移动或覆盖原飞书内容/);
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
