---
name: domi-router
description: domi 的总控路由与工作流编排器。用于把 PLAUD 已有录音处理为文字稿和结构化纪要，识别创业项目交流后继续投资评分，并按已锁定的资料库后端归档；也路由飞书知识外挂、行业雷达、项目研究、投行风格 Slides、intake、人物、待办事项和 Outlook 约日程工作流。domi 不启动本机麦克风录音。
---

# domi Router

Router 只负责四件事：识别用户意图、锁定授权与资料库后端、选择阶段和主 Skill、维护可恢复交接。不要在这里复述或替代下游 Skill 的研究、证据、写作、格式与 QA 规则。

上下文优化不得降低模型或推理强度，不得缩减资料范围、证据标准、写入安全、QA 或正式交付物质量。每个阶段开始前采用并完整遵循该阶段的主 Skill；歧义会影响路由、授权、实体或质量时，保守读取完整相关规则／原始产物，仍无法确定再询问用户。

## 路由守卫

### 资料库后端

首次需要读取内部资料或进入写入阶段前，采用 `domi:investment-mgmt`，完整读取其 `references/storage-backends.md`，运行 `config get` 并在本任务内锁定 `repositoryBackend`：

- `local`：SQLite、Markdown 与本地附件目录是权威资料库；已连接飞书可作为窄范围只读参考。
- `legacy_feishu_primary`：再完整读取 `investment-mgmt/references/legacy-feishu-primary.md`，继续既有 Base／Wiki／本地材料唯一主库链路；禁止并行写本地主库。

后端失败不得触发静默切换。安全导入与原子切换、schema、taxonomy、查重、幂等和回读细节全部由上述 `investment-mgmt` 规则负责，Router 只把锁定值和回执传给后续阶段。

### 飞书参考与交付

当 `repositoryBackend=local` 时，完整规则只从 `investment-mgmt/references/feishu-knowledge-extension.md` 与 `delivery-channels.md` 读取：

- 已连接飞书可作为窄范围只读参考；按对象使用 `lark-base`、`lark-wiki`、`lark-doc`、`lark-drive`，读取失败不改变本地闭环。
- 只有本轮用户原始消息明确要求创建／编辑／发布／发送时，才设置 `feishu_knowledge_action=create|edit` 或 `delivery_only=feishu_doc|feishu_dm`；收件人解析用 `lark-contact`，发送用 `lark-im`。
- 既往授权、旧队列字段、已有链接、连接状态、只读命中、本地未命中或“继续”都不产生本轮写入授权。没有授权就完全省略交付阶段，不把外部副本列为未完成。

Router 不接收飞书写凭据，不自行复制 Markdown 导出实现，也不改变权威资料库。

### PLAUD 连接

进入 PLAUD 阶段前读取 `DOMI_CONFIG_PATH.plaudConnectionMode`：

- `disabled`：不得采用 `plaud` Skill，也不得运行 doctor、queue、上传、生成或下载；提示用户先在“设置 → 录音转写”开启。
- `enabled`：按 Router、`domi:plaud` 和当前工作流继续。
- 字段缺失：只作旧版兼容，不构成上传或生成授权。

domi 不提供启动本机麦克风录音的工作流；不得调用 `mac-recording start`。用户明确提供普通本地音频时可走 `asr-notes` 本地转写，但播客是例外：播客固定使用用户自己的 PLAUD；不可用时保持 `waiting_for_plaud`，不得降级为其他 ASR。

### 本轮意图与已完成任务边界

每一条用户消息都先按**本轮最新、明确的原始意图**重新选择路由。任务标题、来源入口、历史 workflow 标签、上一轮采用的 Skill、仍可恢复的 manifest 或录音队列状态都不能覆盖本轮意图，也不能单独构成重新处理、写入或外发授权。

若上一条录音已经进入 `managed`、`notes_non_project`、`discussion_complete` 或其他完成态，而用户本轮只是追问、补充背景、纠正人物履历或要求查看既有结果，禁止重新进入 PLAUD 发现／生成／下载和 ASR 纪要全流程。普通追问直接基于已验证产物回答；明确补充或纠正时只对既有产物做最小增量修订并重跑受影响的 QA／归档回读。只有用户本轮明确要求“重新处理／重新转写／用新录音重做／重新同步”时，才可重新进入对应阶段。完整边界见 [PLAUD 投资录音](references/plaud-investment-recording-workflow.md)。

用户明确要求“把文件发我／给我下载／提供 PDF、PPTX、Markdown、文字稿或报告附件”时，完整读取并执行 [跨客户端真实附件交付](references/artifact-delivery.md)。交付物必须是已验证的真实文件引用；普通路径、来源链接或把内部文件指令打印成文本都不算交付成功。

## 工作流选择

| 用户目标 | 模式与主链路 | 按需读取 |
|---|---|---|
| “同步这条／处理这条录音”或处理 PLAUD 未生成录音／同步录音并入库 | 先锁定 single／all 范围，再执行 `plaud → asr-notes → 条件判断 → investment-review → investment-mgmt` | [PLAUD 投资录音](references/plaud-investment-recording-workflow.md) |
| 查看某领域最新新闻／动态／融资 | `investment-radar scan` | [行业新闻雷达](references/industry-news-radar-workflow.md) |
| 添加或管理新闻／RSS／公众号／播客信源 | `investment-radar sources` | [播客与信源](references/podcast-ingestion-workflow.md) |
| 下载公开播客并转纪要 | `investment-radar podcast → plaud → asr-notes → investment-mgmt` | [播客与信源](references/podcast-ingestion-workflow.md) |
| “查一下／研究一下／看看项目” | 项目 `research`：`desk-research`，交付后询问是否继续评级并入库 | [项目工作流](references/project-intake-workflow.md) |
| “研究并入库／完整处理项目” | 项目 `intake`：`desk-research → investment-review → investment-mgmt` | [项目工作流](references/project-intake-workflow.md) |
| “更新项目／补充资料或评级” | 项目 `update`：定位既有实体后只处理增量 | [项目工作流](references/project-intake-workflow.md) |
| 把公司／项目／行业／财务研究或已有底稿做成 Slides／PPT／deck／演示文稿 | `domi:investment-analysis` 的 `deck-output`；先完成或复用对应研究底稿，默认生成 Morgan Stanley 投行风格 HTML + PDF；只有用户明确要求可编辑 PowerPoint／PPTX 时才制作 PPTX | `domi:investment-analysis` 与其 `references/investment-banking-slides.md` |
| 找人／人物画像／公开背调 | 人物 `research`：`sourcing discover/profile`；明确要求背调才用 `background-check` | [人物工作流](references/people-intake-workflow.md) |
| 找人并入库／更新关系与互动 | 人物 `intake/update/relationship`，开放式或批量写入先确认精确变更计划 | [人物工作流](references/people-intake-workflow.md) |
| 同步／查看待办事项 | `todo`，按锁定后端维护唯一账本 | `domi:todo` |
| 读取或显式交付飞书资源 | `investment-mgmt` 守卫后采用相应 `lark-*` Skill | `feishu-knowledge-extension.md`／`delivery-channels.md` |
| 约日程／发送 Outlook 邀请 | `schedule`，核对主题、时间、地点、参会人、发送账号与时区；仅在用户明确要求时检查冲突 | `domi:schedule` |
| 发送／下载／查看已生成的真实文件或附件 | 校验现有 artifact，再由当前客户端的原生文件通道交付；不得重做研究来代替发送 | [真实附件交付](references/artifact-delivery.md) |
| 用户明确指定“X 完成后使用 Y” | 按用户顺序编排，逐阶段验证 | 对应 Skills 与 [无损交接合同](references/lossless-handoff.md) |

只读取命中工作流所列的 reference；不要预加载其他工作流。任何多阶段工作流都必须完整读取 [无损交接合同](references/lossless-handoff.md)。命中不唯一时，先读取所有可能命中的工作流 reference 比较授权和停止条件；仍有实质歧义再向用户确认，不能为节省上下文猜测。

### 项目与人物消歧

按最终交付目标判断：公司／项目投资判断、项目文档或项目库走项目工作流；候选名单、人物画像、公开背调、引荐路径、关系维护或人脉库走人物工作流。人物只是项目线索时仍走项目；公司只是人物履历背景时仍走人物。只按姓名／邮箱解析飞书身份时使用 `lark-contact`，不要扩张成人物 intake。

## 编排与无损交接

1. 开始前记录 workflow、mode、授权范围、当前阶段、完成标准、失败停止条件，以及需要时锁定的 `repositoryBackend`。
2. 每个阶段只设一个主 Skill；进入阶段时完整读取该 Skill 及其为当前模式要求的 references，不用 Router 摘要代替。
3. 阶段产物先落为规范文件并完成该 Skill 的质量门，再把路径、SHA-256、实体标识、证据索引和 QA／写入回执写入 `domi.handoff.v1` manifest。聊天摘要不是交接产物。
4. 下一阶段从 manifest 验证并读取规范产物；需要判断、引用、写作或 QA 时按下游 Skill 要求读取完整原文。manifest 只避免在消息中重复粘贴全文，不得作为原文或证据替代品。
5. 路径、哈希、证据索引、实体或授权缺失／冲突时停止推进，回读完整产物和完整相关规则；不能用历史聊天补猜，也不能降低质量门。
6. 上一步未满足完成标准不得进入下一步。失败时保存 checkpoint，从失败阶段恢复；先查询回执再决定是否重试，禁止重复生成、重复建档或重复外发。
7. 用户未要求暂停时在同一任务连续执行。任何外部写入仍按当前工作流执行查重、字段校验、授权检查和写后回读。

最终答复按命中工作流报告实际完成的产物、判断、质量状态、写入结果和必要缺口。默认不展示本机绝对路径、内部记录 ID、文档 URI、Base／Wiki 标识、manifest 或逐字段审计明细；这些只用于内部恢复或用户明确要求的排障。用户要求实际文件时按 `artifact-delivery.md` 输出客户端可消费的文件引用，不把绝对路径或内部协议文本直接展示给用户。

## 新增工作流

新增多阶段流程时只在 `references/` 增加工作流文件，并在路由表登记触发、模式和主链路；不要把执行细节复制回 Router。工作流 reference 至少定义：授权边界、主 Skills、阶段完成标准、所需 artifact roles、证据／QA 回执、歧义与失败行为，以及写入前的确认和幂等规则；交接统一复用 `domi.handoff.v1`。
