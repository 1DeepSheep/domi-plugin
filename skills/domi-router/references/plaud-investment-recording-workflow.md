# PLAUD 投资录音处理工作流

## 目标

把 PLAUD 录音处理为文字稿和结构化纪要；若内容属于创业项目或创始人交流，继续完成投资快评，并把纪要、快评、材料和结构化记录写入本轮已经锁定的资料库后端。`repositoryBackend=local` 写本地 SQLite＋Markdown；`repositoryBackend=legacy_feishu_primary` 按 `legacy-feishu-primary.md` 继续写既有 Base／Wiki／本地材料链路。任务中途不得因飞书登录状态或写入失败切换后端。

## 一、恢复未完成任务

1. 采用 `domi:plaud` 运行 `queue`。
2. 按阶段恢复：
   - `transcript_ready`：生成回忆提示并询问上下文；
   - `context_pending`：处理用户补充或跳过，不重新生成文字稿；
   - `context_ready`：进入 ASR Notes；
   - `notes_project`：先 `verify <fileId>`，通过后进入投资快评；
   - `reviewed`：先 `verify <fileId>`，通过后按该队列锁定的资料库后端恢复归档；
   - `documented`：先 `verify <fileId>`，通过后按已保存的 `storageReceipt.backend` 回读结构化记录、主文档和材料目录，再标记完成；没有新式回执的历史队列沿用其原始 Wiki／本地材料链路，不得暗中迁移或新建第二份项目；
   - 失败或超时项先报告原因；`generation_timeout` 先尝试下载，不重复生成。
3. 恢复项处理后再发现新录音。

## 二、发现、生成并下载文字稿

1. 运行 `pending 100`。没有 pending 时处理完恢复项后结束。
2. 用户明确触发“同步 PLAUD 并生成文字稿”后，按当前待生成数量直接运行一次 `sync-pending`；不因数量增加二次确认。
3. 输出到当前工作区 `work/domi/plaud/<run-id>/`。
4. 每条必须取得 `transcriptPath` 且队列为 `transcript_ready`；失败项不得进入下一步。

## 三、回忆提示与上下文确认

对每条文字稿轻量读取标题、日期、时长、开头、结尾和主题段，生成不超过 150 字的回忆提示。疑似公司或姓名只能写“文字稿疑似提到”。先标记：

```text
mark <fileId> context_pending - {"contextPromptedAt":"<ISO-8601>","recallSummary":"<回忆提示>"}
```

再询问对话类型、目的、参会人姓名／公司／职位；用户可回复“直接处理”。本轮在问题后暂停，不得假设用户已经回答。

- 用户提供具体背景：写入必要摘要并标为 `context_ready`、`contextStatus=provided`；
- 用户表示不知道、跳过或直接处理：标为 `context_ready`、`contextStatus=skipped`；
- 尚未回复：保持 `context_pending`，不得后台继续；
- 部分信息也算 `provided`，不为补齐字段反复追问。

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
