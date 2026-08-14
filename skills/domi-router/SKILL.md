---
name: domi-router
description: domi 的总控路由与工作流编排器。用于把 PLAUD 已有录音处理为文字稿和结构化纪要，识别创业项目交流后继续投资评分，并按已锁定的资料库后端归档；也路由飞书知识外挂、行业雷达、项目研究、intake、人物、待办事项和 Outlook 约日程工作流。domi 不启动本机麦克风录音。
---

# domi Router

协调 domi 内多个 Skill。Skill 不是函数调用；每个阶段开始前都要采用并完整遵循对应 Skill 的规则，并把上一步的完整产物作为下一步输入。

## 资料库与交付路由守卫

任何涉及项目、人脉、行业事件、待办事项、文档或资料文件的工作流，在读取内部数据或进入写入阶段前，必须先采用 `domi:investment-mgmt` 并读取 `references/storage-backends.md`，再按 `config get` 锁定一次任务内的 `repositoryBackend`：

- `local`：结构化记录写 SQLite，文档写 Markdown，附件写本地实体目录；已连接飞书可作为窄范围只读参考，任何飞书创建／编辑／发布仍只按本轮明确指令执行。
- `legacy_feishu_primary`：完整读取 `investment-mgmt/references/legacy-feishu-primary.md`，既有 Base／Wiki／本地材料继续作为唯一主库链路；禁止调用本地网关写入。

- 连接飞书不创建第二套管理库，不自动迁移到 Base／Wiki，也不要求用户手工填写 Base Token、Table ID 或固定 Wiki Space ID；连接本身仍保留 Base、Wiki、Docs、Drive、IM、Contact 的完整授权能力。
- 旧版飞书管理库尚未完成回读验证的本地导入时设置 `legacyFeishuPrimary=true`，继续原飞书主库读写，不能把新写入分流到空本地库；导入与原子切换完成后才改走本地。
- 本地主库的飞书鉴权失败只影响外挂／交付阶段；旧飞书主库的鉴权失败会阻塞该主库阶段，但仍不得静默切换本地。本地错误也不得通过写飞书来绕过。

当 `repositoryBackend=local` 时，飞书是只读知识外挂与显式发布通道，读取和写入必须分开路由。飞书已连接时，项目、人物、PLAUD 录音和研究工作流可以围绕当前已识别实体窄范围搜索／读取 Wiki、Docs、Base 作为参考，设置 `feishu_knowledge_action=search|read`；该阶段非必需，失败不得阻塞本地工作流。只有本轮用户明确要求创建／编辑／更新／覆盖／移动／发布飞书资源或发送私聊时，才设置 `feishu_knowledge_action=create|edit` 或兼容值 `delivery_only=feishu_doc|feishu_dm`：

- 本地权威源保持不变；只读 Base 参考采用 `lark-base`，知识空间采用 `lark-wiki`，文档采用 `lark-doc`，文件采用 `lark-drive`；写操作仍须本轮明确授权，收件人解析采用 `lark-contact`，私聊采用 `lark-im`。
- 外挂和交付不要求任何项目／人脉／行业 Base 或 Wiki 固定映射，也不得据此自动创建管理 Base；用户明确指定的外部 Base／Wiki／Docs／Drive 搜索、读取、创建或编辑仍可正常执行。
- 本地 Markdown 搬到飞书必须调用 `feishu-markdown-export.cjs` 预检／handoff 合同，再由 App host 根据用户原始明确指令和当前打开文档直接执行；Codex 不接收写凭证，只接收回执。Host 能力缺失时停止，不能退化为纯文本创建。
- 缺少飞书登录或对应权限时，请用户连接飞书账号并从当前飞书阶段恢复；不得切换资料库后端。
- 既往消息、旧队列字段、已有 Wiki 链接、飞书已连接、只读命中或本地未命中都不构成本轮写入授权。没有本轮明确交付指令时，不得主动外发，不得调用飞书 Markdown 导出交接，也不得把“飞书副本未创建／未更新”列为未完成项。

## PLAUD 可选连接守卫

进入任何 PLAUD 阶段前，读取 `DOMI_CONFIG_PATH` 中的 `plaudConnectionMode`：

- `disabled`：不得采用 `plaud` Skill，不得运行 `doctor`、`queue`、上传、生成或下载。用户明确要求 PLAUD 处理时，请其先在 domi“设置 → 录音转写”中开启。
- `enabled`：按本 Router 与 `plaud` Skill 的授权规则继续。
- 字段缺失：按旧版本兼容处理，但不构成上传或生成授权。

domi 不提供启动本机麦克风录音的工作流。用户另行明确提供本地音频并要求整理文字稿／纪要时，可以采用 `asr-notes` 的本地转写路径；该请求不等于重新开启 PLAUD，也不得调用 `mac-recording start`。

播客是例外：播客处理明确固定使用用户自己的 PLAUD。PLAUD 已关闭、登录失效或不可用时，把单集暂停为 `waiting_for_plaud`，不得降级为 `asr-notes` 本地音频转写，也不得改用其他云端 ASR。

## 当前工作流

| 工作流 | 触发 | 顺序 |
|---|---|---|
| PLAUD 投资录音处理 | “运行 domi”“处理 PLAUD 未生成录音”“同步录音并入库” | `plaud` → 文字稿回忆提示与对话上下文确认 → `asr-notes` → 条件判断 → `investment-review` → `investment-mgmt` 按已锁定后端归档 |
| 行业新闻雷达 | “看一下／搜一下／更新一下 XX 领域最新的新闻／动态／融资信息” | `investment-radar` 联网检索、分类归一、原文核验、事件去重与评分 → 必要时 taxonomy 更新 → 写入当前后端行业事件库 → 只返回值得关注项 |
| 行业信源管理 | “添加新闻源／RSS／重点公众号／播客”“管理行业动态信源” | `investment-radar sources` → 只读测试公开 URL → 保存本机私有信源配置；没有自动处理授权时到此结束 |
| 播客纪要 | “下载这期播客并转纪要”“处理小宇宙单集”，或已授权播客自动命中 | `investment-radar podcast` 公开发现与授权 → 临时下载 → `plaud transcribe-local` → `asr-notes` 读取 PLAUD 文字稿 → `investment-mgmt` 唯一主归档与多处关联 → Radar 写入有增量的行业事件 |
| 投资项目只读研究 | “查一下这个项目”“研究一下这个项目”“看看这个项目” | `desk-research` → 交付研究 → 主动询问是否继续评级分析并入库；用户确认后复用研究产物进入 `investment-review` → `investment-mgmt` 按当前后端归档；本地主库下用户明确要求飞书文档／私聊时再追加外部动作 |
| 投资项目研究入库 | “研究并入库”“查完加入项目库”“完整处理这个项目”“跑项目 intake” | `desk-research` → `investment-review` → `investment-mgmt` 按当前后端完成文档、材料与结构化记录 |
| 人物只读研究 | “找一下 XX 方向的人”“研究一下这个人”“看看这位创始人”“调查一下某人” | `sourcing` 的 `discover/profile`，仅在用户明确要求背调时使用 `background-check` → 交付候选或人物画像 → 主动询问是否写入／更新本地人脉库 |
| 人物研究入库 | “找人并入库”“查完加入人脉库”“完整处理这个人”“跑 people intake” | `sourcing` → 当前后端查重 → 单人唯一匹配直接 upsert；开放式或批量候选确认变更计划后写入 → 回读验证 |
| 人脉记录更新 | “更新人脉库里的 XX”“把这次互动／跟进补到人脉库” | `sourcing relationship` → 定位当前后端唯一既有记录 → 增量 patch → 回读验证；找不到时询问是否切换 `intake`，不得暗中新建 |
| 待办事项 | “同步待办事项”“我最近该做什么”“刷新待办事项”“看待办事项看板” | `todo` → 读取当前后端项目、人脉、行业动态和账本 → 去重与排序 → 精确更新 `0.待办事项.md` 或旧主库 `1.待办事项` → 回读验证 |
| 飞书知识外挂 | 已连接飞书时的项目／人物／PLAUD／研究参考检索，或用户明确要求读取／创建／编辑／发送飞书资源 | `investment-mgmt` 飞书知识外挂守卫 → 围绕当前实体用 `lark-base`／`lark-wiki`／`lark-doc`／`lark-drive` 做可选只读参考；只有本轮明确写指令才采用写入／发送动作，不改变本地权威源 |
| Outlook 约日程 | “约日程”“把这个会面放进 Outlook”“发日程”“在手机日历显示” | `schedule` → 整理主题、时间、地点和用户指定的参会人 → 核对实际发送账号与时区 → 写入 Outlook 默认个人日历 → 验证结果；仅在用户明确要求时检查冲突 |
| 单次自定义串联 | 用户明确指定“X 完成后使用 Y” | 按用户顺序执行，并定义完成标准与交接产物 |

执行 PLAUD 投资录音处理时，必须先完整读取 [references/plaud-investment-recording-workflow.md](references/plaud-investment-recording-workflow.md)。
执行行业新闻雷达时，必须先完整读取 [references/industry-news-radar-workflow.md](references/industry-news-radar-workflow.md)，再采用插件内 `investment-radar` Skill；Router 只负责触发、交接和回传，不复制其检索、评分或写入逻辑。
执行行业信源管理或播客纪要时，必须先完整读取 [references/podcast-ingestion-workflow.md](references/podcast-ingestion-workflow.md)；信源配置遵循 `investment-radar/references/source-registry.md`，播客下载、PLAUD 转写和归档遵循 `investment-radar/references/podcast-ingestion.md`。
执行投资项目只读研究或研究入库时，必须先完整读取 [references/project-intake-workflow.md](references/project-intake-workflow.md)，再按该文件的模式与阶段契约逐一采用对应 Skill；仅说“查一下”时不得推断入库授权，研究交付后的主动询问也不等于用户已授权写入。
执行人物只读研究、人物研究入库或人脉记录更新时，必须先完整读取 [references/people-intake-workflow.md](references/people-intake-workflow.md)，再采用插件内 `sourcing` Skill；本地主库写入采用 `domi-repo.cjs`，旧飞书主库写入采用既有人脉 Base。仅说“找一下／研究一下某人”时不得推断写入授权；开放式发现或批量写入即使已有入库授权，也必须先确认精确变更计划。
执行待办事项时直接采用插件内 `todo` Skill；本地主库维护 `0.待办事项.md`，旧飞书主库维护既有 `1.待办事项`，并尊重旧账本中的忽略与完成状态。
执行约日程时直接采用插件内 `schedule` Skill；日历写入走 Outlook Calendar 连接器，不读取或持久化 OAuth 凭据。

### 人物与项目消歧

优先根据用户的交付目标路由：目标是公司／项目投资判断、项目文档或本地项目库时走项目工作流；目标是候选名单、人物画像、公开背调、引荐路径、关系维护或本地人脉库时走人物工作流。人物只是识别某个项目的零散线索时仍走项目工作流；公司只是解释人物履历的背景时仍走人物工作流。若用户只要按姓名／邮箱解析飞书身份，不做人物研究或关系管理，则使用 `lark-contact`，不要扩张成人物 intake。

## 通用编排规则

1. 开始前确定完整工作流、每一步的完成标准、交接产物和失败处理。
2. 进入某阶段前采用对应 Skill 并完整遵循：domi 归档使用插件内同名 Skill；飞书只读参考或本轮显式交付阶段使用对应 `lark-*` Skill。不要只凭 Router 摘要执行。
3. 上一步未满足完成标准时，不得进入下一步。
4. 默认传递完整产物文件，而不是只传聊天摘要。
5. 用户没有要求阶段性暂停时，在同一任务中连续执行。
6. 外部写入前执行去重和字段校验；遇到多个可能匹配项时先让用户确认。
7. 某一步失败时保留已完成产物和阶段标识，从失败点恢复；PLAUD 不重复触发生成，项目 intake 不重复创建文档或记录，people intake 不重发已成功的人物写入。
8. 对 `project` 类型的新项目，当前锁定后端的结构化记录、主文档和材料目录都是强制阶段；任一层失败时不得跳过并直接标为 `managed`。本地主库是 SQLite／Markdown／本地材料，旧飞书主库是既有 Base／Wiki／本地材料。
9. 最终报告所选工作流实际产生的关键产物：PLAUD 投资工作流报告文字稿、纪要、项目判断、评分／评级和当前后端归档结果；行业新闻雷达报告扫描范围、值得关注项、taxonomy 复用／新增／延期／部分完成／分类修正状态、覆盖缺口，以及当前后端事件库新增／更新／无变化／跳过／失败数量；播客工作流报告节目与单集、PLAUD 文字稿状态、唯一主纪要、主归档类型和关联项目／行业；项目 `research` mode 先完整交付只读研究，并以“是否继续投资评级分析并归档到项目库？”收尾，确认前不得评级或写入；确认后复用研究产物进入 `intake`，不得重复研究；项目与人物 intake 报告当前后端新增、更新、无变化、跳过、歧义和失败。实际采用飞书只读参考时列出必要标题／链接；只有本轮用户明确要求飞书写入时才报告交付链接或交付失败。未获写入授权时省略外部副本阶段，不把它写成入库结果或未完成项。默认不展示本机绝对路径、内部记录 ID、Base／Wiki 标识或逐字段审计明细。

## 新增多阶段工作流的写法

后续增加“X 完成后使用 Y”等多阶段串联时，在 `references/` 新建或更新一个工作流文件，并在上方路由表增加入口。单阶段即时控制可直接写在路由层。每个多阶段流程至少写明：

- 触发条件。
- 使用的 Skill。
- 输入产物。
- 完成标准。
- 输出与下一阶段交接字段。
- 信息不足、失败或歧义时的行为。
- 是否包含外部写入，以及写入前的去重/确认规则。

不要把详细流程全部堆进本文件；保持路由层简洁，把流程细节放在一层 `references/` 文件中。
