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
const handoff = read("skills", "domi-router", "references", "lossless-handoff.md");
const plaud = read("skills", "plaud", "SKILL.md");
const plaudCommands = read("skills", "plaud", "references", "commands.md");
const asrNotes = read("skills", "asr-notes", "SKILL.md");
const macRecording = read("skills", "mac-recording", "SKILL.md");
const pluginManifest = JSON.parse(read(".codex-plugin", "plugin.json"));

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

test("PLAUD explicit sync processes the full pending set without a quantity confirmation threshold", () => {
  assert.match(plaud, /点击“同步 PLAUD 并生成文字稿”即明确授权处理当前读取到的全部待生成录音/);
  assert.match(plaudWorkflow, /targetScope=all_pending_sync/);
  assert.match(plaudWorkflow, /不因数量增加二次确认/);
  assert.doesNotMatch(plaud, /待生成数量超过 10/);
  assert.doesNotMatch(plaudWorkflow, /超过 10 条先报告数量并确认/);
});

test("PLAUD single-record requests never expand into queue recovery or full pending sync", () => {
  assert.match(router, /同步这条／处理这条录音.*先锁定 single／all 范围/);
  assert.match(plaudWorkflow, /“同步这条”“处理这条录音”“继续刚才这条”/);
  assert.match(plaudWorkflow, /targetScope=single/);
  assert.match(plaudWorkflow, /fileId \+ fileName \+ recordedAt/);
  assert.match(plaudWorkflow, /其他 queue 项.*保持不变/s);
  assert.match(plaudWorkflow, /不得在单条完成后继续发现或处理新录音/);
  assert.match(plaudWorkflow, /不得用 `sync-pending 1` 猜测第一条/);
  assert.match(plaudWorkflow, /waiting_for_targeted_sync/);
  assert.match(plaudWorkflow, /context_pending.*暂停整个本轮/s);
  assert.match(plaudWorkflow, /恢复 queue 不等于同步 pending/);
});

test("domi no longer starts local microphone recordings while legacy sessions remain recoverable", () => {
  assert.match(router, /domi 不提供启动本机麦克风录音的工作流/);
  assert.match(router, /不得调用 `mac-recording start`/);
  assert.match(macRecording, /只负责收尾旧版 domi 已经启动的 Mac 麦克风录音/);
  assert.match(macRecording, /绝不得调用 `start`、`doctor` 或 `--dry-run`/);
  assert.match(macRecording, /`status`/);
  assert.match(macRecording, /`stop`/);
  assert.match(macRecording, /`last`/);
  assert.ok(!pluginManifest.keywords.includes("mac-recording"));
  assert.ok(!pluginManifest.keywords.includes("quick-discussion"));
  assert.equal(
    fs.existsSync(path.join(root, "skills", "domi-router", "references", "quick-discussion-workflow.md")),
    false
  );
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

test("multi-stage routing uses lossless artifact handoffs without weakening quality", () => {
  assert.match(router, /Router 只负责四件事/);
  assert.match(router, /不得降低模型或推理强度/);
  assert.match(router, /只读取命中工作流所列的 reference/);
  assert.match(router, /命中不唯一时.*读取所有可能命中的工作流 reference/s);
  assert.match(router, /domi\.handoff\.v1/);
  assert.match(router, /聊天摘要不是交接产物/);
  assert.match(handoff, /路径、哈希、类型、实体 ID 和证据索引/);
  assert.match(handoff, /manifest 摘要不能作为证据/);
  assert.match(handoff, /保守读取所有可能适用的完整规则/);
  assert.match(handoff, /不能由旧消息、旧 manifest、只读命中或既有回执推导新的写入／外发权限/);
  assert.match(handoff, /SHA-256/);
  assert.match(projectWorkflow, /research_report/);
  assert.match(projectWorkflow, /evidence_index/);
  assert.match(projectWorkflow, /不得用历史聊天中的研究全文或摘要替代规范产物/);
  assert.match(plaudWorkflow, /PLAUD queue 是可恢复阶段状态/);
  assert.match(plaudWorkflow, /不得降低证据标准、跳过审计、重复生成文字稿或重跑已经通过的阶段/);
});

test("local project intake treats the first SQLite upsert as provisional until the full closure verifies", () => {
  assert.match(projectWorkflow, /provisional upsert/);
  assert.match(projectWorkflow, /命令会立即写 SQLite/);
  assert.match(projectWorkflow, /即使命令返回 `storageReceipt\.status=managed`.*不得对外报告“已入库／managed”/s);
  assert.match(projectWorkflow, /同一个 `project_id`.*幂等最终 upsert/s);
  assert.match(projectWorkflow, /禁止稀疏 payload 把既有字段清空/);
  assert.match(projectWorkflow, /写前快照.*`recordRevision`.*`recordHash`.*完整 payload hash/s);
  assert.match(projectWorkflow, /`recordRevision`.*`recordHash`.*`expectedRevision`.*`expectedRecordHash`/s);
  assert.match(projectWorkflow, /同一个 SQLite 写事务内 fail-closed 比对/);
  assert.match(projectWorkflow, /同值重放可成功.*CAS 不匹配.*重新读取、合并并复核/s);
  assert.match(projectWorkflow, /只用于内部并发控制.*不得出现在面向用户/s);
  assert.match(projectWorkflow, /已有项目的目录是稳定实体身份/);
  assert.match(projectWorkflow, /分类变化未生成第二目录/);
  assert.match(projectWorkflow, /DOMI_PROJECT_DOCUMENT_WRITE_FAILED/);
  assert.match(projectWorkflow, /status=provisional.*不得报告 `managed` 或 `documentVerified`/s);
  assert.match(projectWorkflow, /recordVerified=true.*documentVerified=true.*filesVerified=true/s);
  assert.match(projectWorkflow, /storagePhase=provisional/);
  assert.match(projectWorkflow, /确认无并发漂移后复用目录补齐缺项/);
  assert.match(projectWorkflow, /不得覆盖他人更新、删除记录或自动重建/);
  assert.doesNotMatch(projectWorkflow, /两者都只在文档与材料成功归档后一次性写入/);
});
