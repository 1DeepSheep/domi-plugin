# PLAUD 投资录音处理工作流

## 目标

把 PLAUD 录音处理为文字稿和结构化纪要；若内容属于创业项目或创始人交流，继续完成投资快评，并把纪要、快评、材料和结构化记录写入本地 SQLite＋Markdown 权威资料库。连接飞书不改变归档路径；只有用户明确要求创建／编辑飞书文档交付副本时，才在本地闭环成功后按 `feishu-knowledge-extension.md` 另行交付。

## 一、恢复未完成任务

1. 采用 `domi:plaud` 运行 `queue`。
2. 按阶段恢复：
   - `transcript_ready`：生成回忆提示并询问上下文；
   - `context_pending`：处理用户补充或跳过，不重新生成文字稿；
   - `context_ready`：进入 ASR Notes；
   - `notes_project`：先 `verify <fileId>`，通过后进入投资快评；
   - `reviewed`：先 `verify <fileId>`，通过后恢复本地归档；
   - `documented`：先 `verify <fileId>`，通过后核验本地结构化记录并标记完成；旧队列若只有 Wiki token，必须显式导入本地并回读验证，禁止继续把飞书当管理后端；
   - 失败或超时项先报告原因；`generation_timeout` 先尝试下载，不重复生成。
3. 恢复项处理后再发现新录音。

## 二、发现、生成并下载文字稿

1. 运行 `pending 100`。没有 pending 时处理完恢复项后结束。
2. 数量 1–10 时运行 `sync-pending`；超过 10 条先报告数量并确认本批范围。
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
2. 默认每条只生成一个结构化纪要 Markdown；用户明确要求时才额外生成精修逐字稿。
3. 项目访谈交付前完成学历原子证据表、履历／职级时间线和模型工作表。提出、主导、带队、参与、共同作者、团队完成必须分开。
4. 对最终文件完成实体、数字、学历分层、履历、归因、句内冲突和完整性审计；确定语气但无证据的事实删除或标待确认。
5. `project` 项运行：

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

## 七、本地归档与项目记录

本阶段是 `project` 录音的强制阶段。采用 `domi:investment-mgmt`，固定使用本地网关：

1. 从纪要和快评提取规范公司名、会议日期、领域、子领域和评级；分类来自 taxonomy。
2. 用 `project search` 同时检查中英文名、产品名和主体名；多个相似命中时先确认。
3. 用 `project upsert` 创建／更新 SQLite 记录、稳定项目目录与 `项目主页.md`。
4. 用 `document create` 把纪要和快评分别写入 `纪要/` 与 `研究/`；PLAUD 原始文字稿、BP／slides 和其他实际存在材料按类型归档。相同内容跳过，不同版本保留，不静默覆盖。
5. 真实交流纪要产生后，项目阅读顺序为“交流纪要在前、桌面研究独立 Part 在后”；不得简单追加到研究末尾或交叉改写。
6. 用 `project get`、`project search` 与 `workspace verify` 回读结构化字段、Markdown、目录、关键文件大小／哈希。只创建文件而未写 SQLite，或只写 SQLite 而未归档文件，都不算完成。

结构化字段包括：公司名称、领域／子领域、真实进展状态、项目评级、Notes、历史融资、最新估值、八家关注投资机构、本地文档 URI、系统生成的入库时间和有信息增量时的最后更新时间。业务字段与最后更新时间同次 upsert；评分和完整决策链留在文档，Notes 只放高密度摘要。

完成后运行：

```text
mark <fileId> documented - {"projectId":"prj_xxx","storageReceipt":{"backend":"local","projectId":"prj_xxx","documentUri":"file:///.../项目主页.md","libraryPath":"/absolute/project/path","recordVerified":true,"documentVerified":true,"filesVerified":true,"status":"managed"}}
mark <fileId> managed - {"action":"created|updated","projectId":"prj_xxx","storageReceipt":{"backend":"local","projectId":"prj_xxx","documentUri":"file:///.../项目主页.md","libraryPath":"/absolute/project/path","recordVerified":true,"documentVerified":true,"filesVerified":true,"status":"managed"}}
```

任一可恢复归档步骤失败时保持 `reviewed`，保存 `archiveError` 后从同一快评恢复；不得伪造 `documented`／`managed`。旧队列中的 `wikiUrl`、`wikiNodeToken`、`docToken`、`recordId` 仅用于定位历史资料并执行一次显式本地导入；导入与回读未完成前保持兼容读取提示，不得把旧 token 作为新写入目标。

## 八、可选飞书交付

仅当用户明确说“把这篇纪要／项目文档创建到飞书”或“编辑这篇飞书文档”时执行。必须先完成第七节本地归档，再按 `investment-mgmt/references/feishu-knowledge-extension.md` 通过 App 受控 Markdown 导出服务交付；服务不可用时返回 `FEISHU_EXPORT_HANDOFF_REQUIRED`，状态为未导出。禁止退化成简单 `docs +create` 而丢本地图片，也不得顺带创建 Base、Wiki 管理结构或回填成权威记录。

## 九、最终报告

按录音报告文字稿、纪要、类型、评分／评级、本地文档 URI、资料目录与本地项目记录。另列失败、待确认说话人、分类低置信度项和实际写入的最后更新时间。`project` 若缺本地文档 URI、结构化记录或项目路径，应报告未完成。只有实际完成受控飞书导出时才另列远端副本；不要输出任何 PLAUD 鉴权信息或私人配置。
