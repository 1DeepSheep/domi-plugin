# 程序化交接与质量工具

`<plugin-root>/scripts/domi-workflow.cjs` 承担机械步骤。它不选择投资结论、不缩写材料、不自动批准语义 QA，也不产生用户授权。所有命令仅处理明确传入的工作流私有文件；不在正文展示内部路径、ID 或回执。

## 1. 阶段规则与规范产物

```bash
node <plugin-root>/scripts/domi-workflow.cjs context --skill <当前主Skill名称> --workflow <工作流> --mode <模式>
node <plugin-root>/scripts/domi-workflow.cjs artifact --role <角色> --path <绝对文件路径>
```

`context` 返回完整的规则依赖路径、字节数、逐文件 SHA-256 与 bundleSha256；路径去重，company/sector 按明确模式互斥选择。必须完整读取返回的规则，不以本文件替代。未知条件保守保留分支；外部非插件 Skill 仍由模型按规则选择并完整读取。`workflow` 内置 project-intake、people-intake、plaud-investment-recording、podcast-ingestion、industry-news-radar；普通单阶段可省略。自定义工作流通过模块 `contextBundle({skill,additionalRules:[插件内相对.md路径]})` 扩展，不能猜测跳过依赖。

`artifact` 实际读普通文件并返回 path/sha256/bytes。把输出原样登记到 manifest，附上 `stage`、role 和必要 mediaType；不要自己编哈希。一个版本对应一个路径，改稿用新版本文件，不覆盖审计链中的旧产物。

多个产物一次调用 `artifact --input <JSON数组文件>`，数组元素为 `{role,path}`，返回全部实际哈希，避免逐项调用。

## 2. Manifest 状态与恢复

首次建立 `domi.handoff.v1` JSON；沿用 lossless-handoff.md 的字段，另外注册：

```json
{
  "stagePlan": [
    {"name":"research","skill":"desk-research","mode":"company","requiredRoles":["research_report","evidence_index"],"ruleBundleSha256":"context返回值"},
    {"name":"review","skill":"investment-review","requiredRoles":["review"],"ruleBundleSha256":"context返回值"},
    {"name":"archive","skill":"investment-mgmt","requiredRoles":["research_report","review"],"ruleBundleSha256":"context返回值"}
  ]
}
```

阶段内容必须与已锁定工作流的完整规则一致；此示例不是所有任务的固定链。PLAUD／播客纪要阶段用 `skill:asr-notes`，requiredRoles 至少 transcript、notes、evidence_index。每个已完成阶段都检查必需 artifact 和该 Skill 规则 bundle；语义阶段额外要求对应 stage 的 qa_receipt。不能删改阶段来绕过原合同。

`currentStage` 是当前阶段，`nextStage` 为 stagePlan 中紧随其后的阶段或 null；`completedStages` 是已完成阶段的有序前缀。完成当前阶段先保存完成标识，再推进下一阶段。实体 fingerprint、后端、授权范围和 stagePlan 在同一运行中固定。

```bash
node <plugin-root>/scripts/domi-workflow.cjs save --manifest <manifest.json> --input <save-input.json>
node <plugin-root>/scripts/domi-workflow.cjs inspect --manifest <manifest.json>
```

save-input 是 `{ "expectedHash": null, "manifest": <完整manifest对象> }`；已有文件必须把 expectedHash 设为刚刚 inspect/save 返回的 manifestSha256。程序校验 schema、规则版本、产物哈希、阶段次序和语义审核回执，并以私有临时文件原子替换。并发变化会拒绝写入，不能盲重试。

首次 save 后，阶段执行统一用 `checkpoint --manifest <manifest.json> --input <阶段输入.json>`，输入仅为 `{expectedHash,artifacts:[本阶段实际产物],completeStage:true,advance:true}`。程序登记 stage、执行质量门、保存完成点并按锁定 stagePlan 推进，模型无需重写完整 manifest 或手算前缀。需要时带 entityBinding（仅真实ID、recordRevision、recordHash）和 archiveArtifacts；最后归档阶段不 advance，由 finalize 完成。任何中间失败保留最近可信 checkpoint。

`inspect` 返回 ok/failures、可复用规范产物和 resumeStage；不重做检索或产物。产物失效后，明确失效起点并执行：

```bash
node <plugin-root>/scripts/domi-workflow.cjs invalidate --manifest <manifest.json> --stage <失效阶段> --reason <实际原因> --expected-hash <回读值>
```

该操作保留 history 与失败点，撤销对应阶段及后续产物／回执；先前可信阶段继续复用。修正文件与受影响语义 QA 通过后重新登记，不把“撤销成功”当业务完成。

播客 workflowRunId 固定 `podcast:<jobId>`；executionRunId 使用本次客户端 claim ID。重试先 inspect 验证，再更新执行 ID：

```bash
node <plugin-root>/scripts/domi-workflow.cjs rebind --manifest <manifest.json> --execution-run-id <当前claim ID> --expected-hash <回读值>
```

rebind 只更新 executionRunId 并清除旧执行成功回执；不会扩大授权、丢弃已核验正文或重做研究。旧 artifact/QA 继续绑定稳定 workflowRunId。

## 3. 机械与语义 QA 分工

ASR最终纪要先按[格式检查流程](../../asr-notes/references/format-validation.md)执行 `notes-format.cjs format` 和 `check`，再生成证据索引、QA与artifact哈希。检查 H4/H5 与主板块分隔线；不套用到原始转写、研究、快评或IC。格式程序不能补造事实或代替全文语义审核。

ASR 必须使用 `asr.evidence-index.v1` 和 `asr.qa-receipt.v1` 的完整合同，通过 `evidence-check --index <json> --qa <json>` 校验文件、来源定位和已执行审核项。不能把程序的 mechanicalChecksPassed 写成模型已经审核。

其他语义阶段完成后，模型实际执行完整 Skill QA，并保存：

```json
{
  "schema":"domi.semantic-qa.v1",
  "workflowRunId":"本任务稳定ID",
  "stage":"research",
  "reviewer":"model",
  "artifacts":[{"path":"完整规范产物绝对路径","sha256":"artifact返回值"}],
  "checks":{"source_reading":"passed","entity":"passed","evidence":"passed","numbers":"passed","completeness":"passed","attribution":"passed","editorial":"passed"},
  "overall":"passed",
  "materialConflicts":[],
  "checkedAt":"实际ISO时间"
}
```

artifacts 必须覆盖该阶段全部 requiredRoles 的当前版本（不含 QA 自身）。未执行、冲突或质量不足必须 blocked；只有模型完成全文、证据和编辑审核才能给 passed。工具只核对声明完整并绑定哈希，不根据关键词“自动审核”投资质量。研究证据 `domi.research-evidence.v1` 的 source/claim 机械核验沿用 evidence-check，返回 currentFactsVerified:false；时效与口径仍须核验。

## 4. 真正完成归档

复用 domi-repo 的 CAS upsert、已有文档与材料目录；研究／纪要／快评正文先按既有合同归档。manifest.entity 增加真实 projectId/personId/industryId；项目还要登记最新回读的 recordRevision/recordHash。`archiveArtifacts` 是归档文件的 path/role/sha256/bytes，每项必须与规范 artifact 的 role/hash 相同，不能用“目录存在”代替材料校验。

播客主文档必须使用 `domi-repo.cjs document create` 的 `canonicalDocumentId:"podcast:<sourceFormat或public>:<jobId>"`。ownerType 可为 project/person/industry；同 ID 幂等复用同一路径，不能换实体。行业主归档还给 domain、subdomain、program，程序只在配置资料库的 `1.行业研究/<领域>/<子领域>/播客/<节目>` 下写唯一正文；ownerId 为已锁定行业实体 key。项目／人脉仍复用原实体目录。模型保留主题归属、同名消歧与选择，不能为省 token 猜分类。

```bash
node <plugin-root>/scripts/domi-workflow.cjs finalize --manifest <manifest.json> --receipt <storage-receipt.json>
```

finalize 实际核对配置后端、记录、CAS、文档索引、规范文档、归档材料及绑定当前正文的语义 QA，再保存 `domi.storage-receipt.v1` JSON。回执含 workflowRunId/executionRunId、实体ID、canonicalDocumentId（播客）、主 documentPath/documentUri、libraryPath、artifacts、verifiedAt、recordVerified/documentVerified/filesVerified、status。节目纪要为主 documentPath；项目／人脉主页单独记 primaryEntityDocumentPath。行业记录以唯一 documents 索引核验。旧版单次 upsert 的 managed 值仍只是局部兼容回执，不等于该完成合同。

播客回执额外带 `quality.schema=domi.podcast-quality.v1` 及 qaReceipt、evidenceIndex、原审核稿 notes、完整 transcript 四项真实 artifact。归档主文档与原审核稿可在不同路径，但内容哈希必须相同。客户端会回读完整质量链；这些私有持久文件不能在任务完成前删除或移位。

客户端播客原样输出 `DOMI_PODCAST_PROGRESS_V1 {"stage":"notes_ready","notesPath":"...","qaReceiptPath":"..."}`，只有完整 ASR QA 通过才可输出；归档后原样给程序返回的 receiptPath：`DOMI_PODCAST_PROGRESS_V1 {"stage":"archived","receiptPath":"..."}`。客户端会再次回读与校验，不接受模型自填 true。

本地工具不能认证 Feishu；旧飞书分支继续既有实际外部回读与授权合同，不能调用本地 finalize 伪造跨后端成功。
