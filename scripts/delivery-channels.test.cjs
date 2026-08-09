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
const deskResearch = read("skills", "desk-research", "SKILL.md");
const deskSources = read("skills", "desk-research", "references", "sources-and-output.md");
const sectorScan = read("skills", "desk-research", "references", "sector-scan.md");
const projectAgent = read("skills", "domi-router", "agents", "openai.yaml");
const sourcingAgent = read("skills", "sourcing", "agents", "openai.yaml");
const plaudWorkflow = read("skills", "domi-router", "references", "plaud-investment-recording-workflow.md");
const plaud = read("skills", "plaud", "SKILL.md");
const plaudCommands = read("skills", "plaud", "references", "commands.md");
const asrNotes = read("skills", "asr-notes", "SKILL.md");

test("local SQLite and Markdown remain authoritative for new and migrated users", () => {
  for (const contract of [investmentMgmt, storage, delivery]) {
    assert.match(contract, /权威资料库.*本地|本地.*权威/);
  }
  assert.match(investmentMgmt, /新用户与完成安全导入的用户以 SQLite、Markdown 和本地附件目录为权威来源/);
  assert.match(storage, /`backend=local`/);
  assert.match(storage, /禁止\*\*自动\*\*创建、迁移或维护项目／人脉／行业 Base 作为 domi 管理后端/);
  assert.match(storage, /当前实体窄范围搜索／读取 Wiki、Docs、Base 作为参考/);
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
  assert.match(extension, /只读连接与写入授权是两层概念/);
  assert.match(storage, /不缩减飞书连接权限/);
  assert.match(extension, /仅作外部参考或用户指定的协作产物/);
  assert.match(extension, /不能接管 domi 的项目、人脉、行业事件或待办事项管理/);
});

test("connected Feishu may provide narrow read-only references but every write requires current-turn intent", () => {
  assert.match(extension, /feishu_knowledge_action=search\|read/);
  assert.match(extension, /feishu_knowledge_action=create\|edit/);
  assert.match(extension, /项目、人物、PLAUD 录音和研究工作流可以围绕当前已识别实体/);
  assert.match(extension, /公司名、主体名、产品名、人名或必要别名/);
  assert.match(extension, /窄范围只读检索/);
  assert.match(extension, /只有本轮用户原始消息明确要求对应写动作/);
  assert.match(extension, /既往消息、旧队列字段、已有 Wiki／Doc 链接、飞书连接、只读搜索命中、本地未命中或“继续处理”都不是写入授权/);
  assert.match(extension, /不要求用户手工填写 Base Token、Table ID、Wiki Space ID/);
  assert.match(extension, /用户明确说“在这个 Base 新增／更新记录”/);
  assert.match(delivery, /delivery_only=feishu_doc\|feishu_dm/);
  assert.match(delivery, /只有本轮用户原始消息明确说/);
  assert.match(delivery, /仅说“研究”“整理”“入库”“归档”“继续”/);
  assert.match(delivery, /不得调用导出交接，也不得把外部副本列为未完成/);
  assert.match(router, /delivery_only=feishu_doc\|feishu_dm/);
  assert.match(router, /已连接飞书可作为窄范围只读参考/);
  assert.match(investmentMgmt, /围绕当前实体窄范围只读搜索 Wiki、Docs、Base 作为参考/);
  assert.match(storage, /当前实体窄范围搜索／读取 Wiki、Docs、Base 作为参考/);
  assert.match(projectWorkflow, /已锁定项目实体窄范围只读搜索 Wiki、Docs、Base/);
  assert.match(peopleWorkflow, /已识别人物、组织及必要别名窄范围只读搜索 Wiki、Docs、Base/);
  assert.match(deskResearch, /飞书已连接时可围绕当前实体做窄范围只读参考/);
  assert.match(deskResearch, /只有用户本轮明确要求时才创建／编辑飞书文档或发送私聊/);
  assert.match(deskSources, /无命中、歧义、权限或网络失败直接继续/);
  assert.match(sectorScan, /赛道边界、公司或人物实体明确时.*窄范围只读参考/);
});

test("PLAUD local completion never depends on an unrequested Feishu copy", () => {
  assert.match(plaudWorkflow, /没有本轮写入授权时，完全省略本节/);
  assert.match(plaudWorkflow, /不运行 `feishu-markdown-export\.cjs` 的预检／handoff/);
  assert.match(plaudWorkflow, /不得出现飞书副本待处理／未完成/);
  assert.match(plaudWorkflow, /无命中、歧义、权限或网络失败时直接继续/);
  assert.match(plaud, /没有本轮飞书写指令时不得调用导出交接/);
  assert.match(plaud, /不得把副本缺失列为待处理或未完成/);
  assert.match(asrNotes, /只生成纪要，不自动触发投资评级、归档或项目库写入/);
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

test("agent prompts and completion reports follow the selected backend without leaking internal IDs", () => {
  assert.doesNotMatch(projectAgent, /1\.1 People/);
  assert.doesNotMatch(sourcingAgent, /1\.1 People|relationship base/);
  assert.match(projectAgent, /当前资料库后端/);
  assert.match(sourcingAgent, /currently configured domi people repository/);
  assert.match(projectWorkflow, /锁定的 `repositoryBackend`/);
  assert.match(projectWorkflow, /默认不展示 `project_id\/record_id`/);
  assert.match(peopleWorkflow, /默认不展示内部 `person_id\/record_id`/);
});

test("PLAUD project archival preserves the backend locked for the queue item", () => {
  for (const contract of [plaudWorkflow, plaudCommands]) {
    assert.match(contract, /backend.*local/);
    assert.match(contract, /legacy_feishu_primary/);
    assert.match(contract, /storageReceipt/);
  }
  assert.match(plaudWorkflow, /任务中途不得.*切换后端/);
  assert.match(plaudWorkflow, /不得暗中迁移或新建第二份项目/);
  assert.match(plaudWorkflow, /默认不展示本机绝对路径、文档 URI、项目／记录 ID/);
});
