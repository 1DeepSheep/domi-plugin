# PLAUD 投资录音处理工作流

## 目标

把 PLAUD 录音处理为文字稿和结构化纪要；若内容属于创业项目或创始人交流，继续完成投资快评，并把纪要、快评、材料和结构化记录写入本轮已经锁定的资料库后端。`repositoryBackend=local` 写本地 SQLite＋Markdown；`repositoryBackend=legacy_feishu_primary` 按 `legacy-feishu-primary.md` 继续写既有 Base／Wiki／本地材料链路。任务中途不得因飞书登录状态或写入失败切换后端。

## 无损交接

本工作流完整遵循 [多阶段无损交接合同](lossless-handoff.md)。PLAUD queue 是可恢复阶段状态，`domi.handoff.v1` 是跨 Skill 产物索引；两者以稳定 `fileId`／`workflowRunId` 绑定，但均不能替代完整文字稿、纪要、证据账本、快评或 QA。

- 下载后登记 `transcript` 的 `transcriptPath`、SHA-256、字节数和 PLAUD `fileId`；`asr-notes` 从该路径读取完整文字稿，不从聊天记录回放全文。
- 用户补充的对话类型、目的、参会人、公司和职位原样保存为上下文 artifact，并保留来源 turn；不得只保留模型摘要。
- 纪要完成后登记 `notes`、`evidence_index` 与 `qa_receipt`；`investment-review` 重新校验哈希并按其完整规则读取纪要和证据。
- 快评完成后登记 `review` 与审核回执；`investment-mgmt` 读取经验证的纪要、快评和实际存在材料，不接收聊天摘要作为归档正文。
- 任一路径缺失、哈希变化、`fileId` 不一致、证据／QA 回执不完整或后端锁冲突时停止推进，从最后可信 queue stage 定点恢复；不得降低证据标准、跳过审计、重复生成文字稿或重跑已经通过的阶段。

## 一、锁定本轮录音范围并恢复

在运行任何恢复或生成动作前先锁定 `targetScope`；`queue` 和 `pending` 都只是只读发现结果，不能把单条请求扩大成批处理授权：

- 用户说“同步这条”“处理这条录音”“继续刚才这条”或从客户端选中一条录音时，`targetScope=single`。优先复用当前 session／manifest 已绑定的 `fileId`；否则用用户选择项与 `pending`／`queue` 的 `fileId + fileName + recordedAt` 唯一匹配。多个候选或没有唯一匹配时先让用户选择，禁止猜测。
- 只有用户明确说“同步 PLAUD 并生成文字稿”“同步全部／所有待生成录音”时，才设置 `targetScope=all_pending_sync`。
- 只有用户明确说“恢复全部未完成录音”时，才设置 `targetScope=all_queue_resume`；全量恢复仍一次只激活一个 `fileId`，该条进入需要用户输入的暂停点或终态后才可选择下一条。`context_pending` 会暂停整个本轮，不能在等待用户回复时抢跑其他录音。

采用 `domi:plaud` 运行 `queue` 后，先把精确 `activeFileId` 写入 `domi.handoff.v1`。`targetScope=single` 时只检查、恢复和更新该条，其他 queue 项即使更早、失败或可恢复也保持不变；不得在单条完成后继续发现或处理新录音。按该条阶段恢复：

   - `transcript_ready`：生成回忆提示并询问上下文；
   - `context_pending`：处理用户补充或跳过，不重新生成文字稿；
   - `context_ready`：进入 ASR Notes；
   - `notes_project`：先 `verify <fileId>`，通过后进入投资快评；
   - `reviewed`：先 `verify <fileId>`，通过后按该队列锁定的资料库后端恢复归档；
   - `documented`：先 `verify <fileId>`，通过后按已保存的 `storageReceipt.backend` 回读结构化记录、主文档和材料目录，再标记完成；没有新式回执的历史队列沿用其原始 Wiki／本地材料链路，不得暗中迁移或新建第二份项目；
   - 失败或超时项先报告原因；`generation_timeout` 先尝试下载，不重复生成。

`all_queue_resume` 也只按上述规则串行恢复明确枚举的 queue 快照；本轮中后来出现的 queue 项不自动加入，除非用户再次授权。恢复 queue 不等于同步 pending，两个范围不得互相扩张。

### 完成态后的普通 follow-up

`managed`、`notes_non_project`、`discussion_complete` 以及已经完成本轮所需交付和回读的等价状态都是终态。终态只说明既有录音工作流可供引用，不授权下一条用户消息重新进入录音流程。每条新消息必须先按本轮最新原始意图重新路由；任务标题、录音入口、历史 workflow 标签、`activeFileId`、旧 manifest 或上一轮主 Skill 都不能覆盖当前意图。

- 用户追问公司、人物、结论、证据或已有纪要内容时，直接从已验证的纪要／快评／研究 artifact 回答；仅为回答问题而读取既有本地 transcript 也不构成 PLAUD 操作。
- 用户补充背景、纠正履历或要求修改既有纪要时，只做最小增量修订，并重跑受影响的证据检查、QA 和归档回读。禁止调用 PLAUD `pending`、`sync-pending`、生成、上传或下载，也禁止重跑 `domi:asr-notes` 的完整纪要生成流程。
- 用户要求查看或发送已有文件时，复用现有 artifact 并执行 [跨客户端真实附件交付](artifact-delivery.md)，不得以“重新处理录音”代替发送。
- 只有用户本轮明确说“重新处理／重新转写／用新录音重做／重新同步”或选择另一条具体录音时，才可重新进入第一、二节；仍须重新锁定范围和授权，不得从旧 `activeFileId` 推断。

若无法唯一找到本轮追问所对应的既有 artifact，应请求用户选择目标或补充最小定位信息；不能通过扫描并处理下一条 PLAUD 录音来猜测。

## 二、发现、生成并下载文字稿

1. 只有 `targetScope=single` 且已锁定 `activeFileId`，或 `targetScope=all_pending_sync` 时才运行 `pending 100`；没有命中时结束，不改动其他项目。
2. `targetScope=single` 只能调用能接收精确 `fileId` 的单条生成／下载能力，并验证返回 `fileId === activeFileId`。当前可用工具若只能调用无目标的 `sync-pending`，则停止为 `waiting_for_targeted_sync` 并报告能力缺口；不得用 `sync-pending 1` 猜测第一条，更不得回退成全量同步。
3. 用户明确触发“同步 PLAUD 并生成文字稿”或“同步全部／所有待生成录音”后，`targetScope=all_pending_sync`，按授权时的 pending 快照数量直接运行一次 `sync-pending`；不因数量增加二次确认。本轮后来新增的 pending 不自动加入。
4. 输出到当前工作区 `work/domi/plaud/<run-id>/`。
5. 每条必须取得与授权范围一致的 `fileId`、`transcriptPath` 且队列为 `transcript_ready`；范围外结果不得进入下游，出现不一致时停止并报告，不能继续处理其他录音。

## 三、回忆提示与上下文确认

对每条文字稿轻量读取标题、日期、时长、开头、结尾和主题段，生成不超过 150 字的回忆提示。疑似公司或姓名只能写“文字稿疑似提到”。先标记：

```text
mark <fileId> context_pending - {"contextPromptedAt":"<ISO-8601>","recallSummary":"<回忆提示>"}
```

再询问对话类型、目的、参会人姓名／公司／职位；用户可回复“直接处理”。本轮在问题后暂停，不得假设用户已经回答。

- 用户提供具体背景：写入必要摘要并标为 `context_ready`、`contextStatus=provided`；
- 用户表示不知道、跳过或直接处理：标为 `context_ready`、`contextStatus=skipped`；
- 尚未回复：保持 `context_pending`，不得后台继续；同一任务中的下一条用户消息默认是对本录音问题的回复，除非用户明确取消或选择其他工作流；
- 部分信息也算 `provided`，不为补齐字段反复追问。
- 收到回复时必须续接原 `fileId`、`transcriptPath` 和此前执行会话；不得把访谈类型、项目名或参会人补充重新解释为“开始录音”，不得创建新录音或调用本机麦克风。
- 用户明确回复`管理层访谈`时，把该对话类型和项目方参会人的姓名／职位原样传给`domi:asr-notes`。纪要文件名与文档标题（`####`）优先按`YYYYMMDD-公司规范名（英文名）-项目方核心受访者短角色 姓名`生成；不得再用模型提炼的技术主题覆盖。联合／共同创始人统一缩写为`联创`，例如`20260115-示例科技（ExampleTech）-联创 张某`。

## 四、生成纪要与审计

1. 将 `transcriptPath` 和上下文传给 `domi:asr-notes`；PLAUD 已提供文字稿，跳过本地 ASR。
2. 初步识别出公司、主体、产品或核心人物后，若飞书已连接，可按 `feishu-knowledge-extension.md` 用规范名和必要别名窄范围只读搜索 Wiki、Docs、Base，把唯一或高置信度命中作为实体消歧、历史背景和既有内部判断的补充参考。会议文字稿仍是本次交流内容的主证据；引用飞书内容时保留文档标题／链接并区分“会中披露”和“飞书材料记载”。无命中、歧义、权限或网络失败时直接继续，不阻塞纪要、快评或本地归档，也不列为未完成。
3. 上述只读检索不得创建、编辑、更新、覆盖、移动或发布任何飞书资源，不得把命中文档当作待更新目标，也不得把全文静默导入本地。
4. 默认每条只生成一个结构化纪要 Markdown；用户明确要求时才额外生成精修逐字稿。
5. 项目访谈交付前完成学历原子证据表、履历／职级时间线和模型工作表。提出、主导、带队、参与、共同作者、团队完成必须分开。
6. 对最终文件完成实体、数字、学历分层、履历、归因、句内冲突和完整性审计；确定语气但无证据的事实删除或标待确认。
7. `project` 项运行：

```text
mark <fileId> notes_project <notesPath> {"notesAudit":{"status":"passed","evidenceLedgerComplete":true,"degreeIsolation":true,"claimConsistency":true,"careerLedgerComplete":true,"modelWorkLedgerComplete":true,"attributionConsistency":true,"educationClaimCount":<非负整数>,"careerClaimCount":<非负整数>,"modelWorkClaimCount":<非负整数>,"unresolvedDefinitiveEducationClaims":0,"unresolvedDefinitiveCareerClaims":0,"unresolvedDefinitiveModelWorkClaims":0}}
```

非项目标记 `notes_non_project`。未通过审计不得进入评分或归档。

## 五、判断项目类型

参会方含创始人／核心管理者，且内容围绕具体公司并覆盖团队、产品、商业、客户、竞争、融资等多个维度时通常为 `project`。行业专家访谈、内部会议、播客、培训、纯技术讨论、LP／基金交流通常为 `non_project`。证据冲突且会影响是否写入本地项目库时先确认；`non_project` 只保留纪要，不评分、不建项目。

## 六、投资快评

1. 对 `project` 纪要采用 `domi:investment-review`。
2. 完整遵循 3–5 个关键问题、对应判断、1–10 分且禁用 5、B/A/S 评级。
3. 快评不得新增或跨层级传播纪要中的学历、职级、组织责任和模型归因；需要更正时先回到纪要并重做审计。
4. 保存为 `[纪要标题]-review.md`，一致性通过后运行：

```text
mark <fileId> reviewed <reviewPath> {"score":X,"rating":"A","reviewAudit":{"status":"passed","educationConsistency":true,"careerModelConsistency":true}}
```

## 七、按锁定后端归档与项目记录

本阶段是 `project` 录音的强制阶段。先按 `investment-mgmt/references/storage-backends.md` 读取并锁定 `repositoryBackend`，再采用 `domi:investment-mgmt`：

1. 从纪要和快评提取规范公司名、会议日期、领域、子领域和评级；分类来自 taxonomy。
   - 公司名只保留主体规范名；会议日期、产品／技术主题和评级用于文档标题或结构化字段，不得拼进 `project upsert.name`。日期型旧目录只能作为候选线索，必须经独立证据或用户确认后再写入。
2. `local` 分支用 `project search` 检查中英文名、产品名和主体名，用 `project upsert` 创建／更新 SQLite 记录和稳定项目目录，再用 `document create` 把纪要、快评与实际存在材料归入同一项目。
3. `legacy_feishu_primary` 分支完整执行 `legacy-feishu-primary.md`：在既有 Watching List／Wiki 查重，复用或创建唯一 Wiki 项目文档，将源材料保留在原有本地材料目录，最后 upsert 既有项目 Base；禁止调用本地网关或生成第二个本地项目记录。
4. 两个分支都保持“交流纪要在前、桌面研究独立 Part 在后”的阅读顺序；相同内容跳过，不同版本并存，不静默覆盖。
5. 两个分支都回读结构化记录、主文档和材料目录。只创建文档未写记录，或只写记录未归档材料，都不算完成。

结构化字段包括：公司名称、领域／子领域、真实进展状态、项目评级、Notes、历史融资、最新估值、八家关注投资机构、系统生成的入库时间和有信息增量时的最后更新时间。评分和完整决策链留在文档，Notes 只放高密度摘要。

本地主库完成后运行：

```text
mark <fileId> documented - {"storageReceipt":{"backend":"local","projectId":"prj_xxx","documentUri":"file:///.../项目主页.md","libraryPath":"/absolute/project/path","recordVerified":true,"documentVerified":true,"filesVerified":true,"status":"managed"}}
mark <fileId> managed - {"action":"created|updated","storageReceipt":{"backend":"local","projectId":"prj_xxx","documentUri":"file:///.../项目主页.md","libraryPath":"/absolute/project/path","recordVerified":true,"documentVerified":true,"filesVerified":true,"status":"managed"}}
```

旧飞书主库兼容分支完成后运行：

```text
mark <fileId> documented - {"storageReceipt":{"backend":"legacy_feishu_primary","recordId":"rec_xxx","documentUri":"https://.../wiki/...","libraryPath":"/absolute/project/path","recordVerified":true,"documentVerified":true,"filesVerified":true,"status":"managed"}}
mark <fileId> managed - {"action":"created|updated","storageReceipt":{"backend":"legacy_feishu_primary","recordId":"rec_xxx","documentUri":"https://.../wiki/...","libraryPath":"/absolute/project/path","recordVerified":true,"documentVerified":true,"filesVerified":true,"status":"managed"}}
```

任一可恢复归档步骤失败时保持 `reviewed`，保存 `archiveError` 后从同一快评恢复；不得伪造 `documented`／`managed`。历史队列没有 `storageReceipt` 时，旧字段只用于恢复其原有后端；是否迁移必须由用户显式发起并完整执行安全导入，不能由录音任务顺带完成。

## 八、仅在本轮明确写入指令下执行的飞书交付

本地主库用户只有本轮原始消息明确说“把这篇纪要／项目文档创建到飞书”或“编辑／更新这篇飞书文档”时才进入本节。既往消息、旧队列字段、已有 Wiki 链接、飞书已连接、第四节只读检索命中、本地未命中或用户只说“继续”都不是写入授权。

- 有本轮写入授权时，先完成第七节本地归档，再按 `investment-mgmt/references/feishu-knowledge-extension.md` 通过 App 受控 Markdown 导出服务交付；服务不可用时才返回 `FEISHU_EXPORT_HANDOFF_REQUIRED`，状态为未导出。
- 没有本轮写入授权时，完全省略本节：不运行 `feishu-markdown-export.cjs` 的预检／handoff，不创建或更新 Wiki／Doc，不生成外部交付任务，不把“飞书副本未创建／未更新”列为未完成。第七节本地回读通过后即可标记 `managed`。
- 旧飞书主库用户的唯一 Wiki 项目文档属于管理闭环，不应再创建同内容副本；其兼容写入只由已锁定的 `legacy_feishu_primary` 后端触发，不能由只读外挂触发。

禁止退化成简单 `docs +create` 而丢本地图片，也不得顺带创建另一套 Base／Wiki 管理结构。

## 九、最终报告

按录音报告文字稿、纪要、类型、评分／评级、本地归档是否完成和必要下一步；实际采用飞书只读参考时列出必要来源。只有本轮用户明确要求写飞书时，才报告外部交付成功或失败。未获写入授权时不得出现飞书副本待处理／未完成。另列失败、待确认说话人、分类低置信度项和实际写入的最后更新时间。默认不展示本机绝对路径、文档 URI、项目／记录 ID、Base／Wiki 标识或 PLAUD 鉴权信息；只有冲突排障或用户明确要求时才展示必要定位信息。
