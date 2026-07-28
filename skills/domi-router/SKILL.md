---
name: domi-router
description: domi 的总控路由与工作流编排器。用于把 PLAUD 录音处理为文字稿和结构化纪要；把无修饰的“开始录音”默认串联为 Mac 录音、PLAUD 文字稿、ASR Notes 纪要、核心要点与跟进事项；仅在用户明确要求本地录音且不上传时执行单阶段录音；识别创业项目交流后继续投资评分，并按用户选择的飞书资料库或本地 SQLite/Markdown 资料库完成归档；路由行业雷达、项目研究、intake、人物、待办事项和 Outlook 约日程工作流。
---

# domi Router

协调 domi 内多个 Skill。Skill 不是函数调用；每个阶段开始前都要采用并完整遵循对应 Skill 的规则，并把上一步的完整产物作为下一步输入。

## 资料库路由守卫

任何涉及项目、人脉、行业事件、文档或资料文件的工作流，在读取内部数据或进入写入阶段前，必须先采用 `domi:investment-mgmt` 并读取 `references/storage-backends.md`，运行 `domi-repo.cjs config get` 取得显式 `backend`：

- `feishu`：执行当前飞书 Base / Wiki / 本地材料链路。
- `local`：执行 SQLite / Markdown / 本地材料链路，不采用 `lark-doc`、`lark-wiki` 或 `lark-base`。

后端在一次任务内锁定。飞书鉴权失败不得切到本地，本地文件错误也不得切到飞书。后端切换不授权迁移或删除另一侧数据。

## PLAUD 可选连接守卫

进入任何 PLAUD 阶段前，读取 `DOMI_CONFIG_PATH` 中的 `plaudConnectionMode`：

- `disabled`：不得采用 `plaud` Skill，不得运行 `doctor`、`queue`、上传、生成或下载。用户明确要求 PLAUD 处理时，请其先在 domi“设置 → 录音转写”中开启。
- `enabled`：按本 Router 与 `plaud` Skill 的授权规则继续。
- 字段缺失：按旧版本兼容处理，但不构成上传或生成授权。

当 PLAUD 已关闭而用户只说无修饰的“开始录音”时，降级为 `mac-recording` 本地单阶段录音，并明确说明停止后只保存音频、不上传、不转写；不得静默切换到其他云端转写。用户另行明确提供本地音频并要求整理文字稿／纪要时，可以采用 `asr-notes` 的本地转写路径，该请求不等于重新开启 PLAUD。

## 当前工作流

| 工作流 | 触发 | 顺序 |
|---|---|---|
| PLAUD 投资录音处理 | “运行 domi”“处理 PLAUD 未生成录音”“同步录音并入库” | `plaud` → 文字稿回忆提示与对话上下文确认 → `asr-notes` → 条件判断 → `investment-review` → `investment-mgmt` 按后端归档 |
| Mac 本机录音即时控制 | “开始本地录音”“仅本地录音”“只录音，不上传／不整理”“停止后只保存文件”“录音状态” | `mac-recording` 单阶段即时控制；不进入 PLAUD 工作流 |
| 快速讨论 | 无修饰的“开始录音”“现在开始录音”“启动 Mac 录音”，以及“开始快速讨论”“录下这段讨论”“停止快速讨论并整理” | `mac-recording` → `plaud` 本地音频上传与文字稿 → 上下文确认 → `asr-notes` → 完整纪要 → 核心要点与跟进事项 |
| 行业新闻雷达 | “看一下／搜一下／更新一下 XX 领域最新的新闻／动态／融资信息” | `investment-radar` 联网检索、分类归一、原文核验、事件去重与评分 → 必要时 taxonomy-sync → 按后端写入行业事件库 → 只返回值得关注项 |
| 投资项目只读研究 | “查一下这个项目”“研究一下这个项目”“看看这个项目” | `desk-research` → 交付研究 → 主动询问是否继续评级分析并入库；用户确认后复用研究产物进入 `investment-review` → `investment-mgmt` 按后端归档 |
| 投资项目研究入库 | “研究并入库”“查完加入 Watching List”“完整处理这个项目”“跑项目 intake” | `desk-research` → `investment-review` → `investment-mgmt` 按后端完成文档、材料与结构化记录 |
| 人物只读研究 | “找一下 XX 方向的人”“研究一下这个人”“看看这位创始人”“调查一下某人” | `sourcing` 的 `discover/profile`，仅在用户明确要求背调时使用 `background-check` → 交付候选或人物画像 → 主动询问是否写入／更新《1.1 People人际关系管理》 |
| 人物研究入库 | “找人并入库”“查完加入人脉表”“把这个人加入 1.1 People”“完整处理这个人”“跑 people intake” | `sourcing` → 按后端读取 schema 与查重 → 单人唯一匹配直接 upsert；开放式或批量候选确认变更计划后写入 → 回读验证 |
| 人脉记录更新 | “更新人脉表里的 XX”“把这次互动／跟进补到人脉表”“更新这个人的 People 记录” | `sourcing relationship/base-maintenance` → 按后端定位唯一既有记录 → 增量 patch → 回读验证；找不到时询问是否切换 `intake`，不得暗中新建 |
| 待办事项 | “同步待办事项”“我最近该做什么”“刷新 1.待办事项／0.待办事项.md”“看待办事项看板” | `todo` → 读取当前后端的项目、人脉、行业动态和旧账本 → 去重与排序 → 精确更新待办事项文档 → 回读验证 |
| Outlook 约日程 | “约日程”“把这个会面放进 Outlook”“发日程”“在手机日历显示” | `schedule` → 核对账号与时区 → 检查冲突 → 写入 Outlook 默认个人日历 → 按 event ID 验证 |
| 单次自定义串联 | 用户明确指定“X 完成后使用 Y” | 按用户顺序执行，并定义完成标准与交接产物 |

执行 PLAUD 投资录音处理时，必须先完整读取 [references/plaud-investment-recording-workflow.md](references/plaud-investment-recording-workflow.md)。
执行快速讨论时，必须先完整读取 [references/quick-discussion-workflow.md](references/quick-discussion-workflow.md)。
执行行业新闻雷达时，必须先完整读取 [references/industry-news-radar-workflow.md](references/industry-news-radar-workflow.md)，再采用插件内 `investment-radar` Skill；Router 只负责触发、交接和回传，不复制其检索、评分或写入逻辑。
执行投资项目只读研究或研究入库时，必须先完整读取 [references/project-intake-workflow.md](references/project-intake-workflow.md)，再按该文件的模式与阶段契约逐一采用对应 Skill；仅说“查一下”时不得推断入库授权，研究交付后的主动询问也不等于用户已授权写入。
执行人物只读研究、人物研究入库或人脉记录更新时，必须先完整读取 [references/people-intake-workflow.md](references/people-intake-workflow.md)，再采用插件内 `sourcing` Skill；飞书模式采用 `lark-base` 并读取实时 schema，本地模式采用 `domi-repo.cjs`。仅说“找一下／研究一下某人”时不得推断写入授权；开放式发现或批量写入即使已有入库授权，也必须先确认精确变更计划。
执行待办事项时直接采用插件内 `todo` Skill；飞书模式维护 `1.待办事项`，本地模式维护工作区根目录的 `0.待办事项.md`，并尊重旧账本中的忽略、进行中和完成状态。
执行约日程时直接采用插件内 `schedule` Skill；日历写入走 Outlook Calendar 连接器，不读取或持久化 OAuth 凭据。

### 人物与项目消歧

优先根据用户的交付目标路由：目标是公司／项目投资判断、Watching List、Wiki 或本地资料库时走项目工作流；目标是候选名单、人物画像、公开背调、引荐路径、关系维护或《1.1 People人际关系管理》时走人物工作流。人物只是识别某个项目的零散线索时仍走项目工作流；公司只是解释人物履历的背景时仍走人物工作流。若用户只要按姓名／邮箱解析飞书身份，不做人物研究或关系管理，则使用 `lark-contact`，不要扩张成人物 intake。

### Mac 录音快速路由

用户当前消息明确要求立即用 Mac 默认麦克风开始录音时，固定采用当前已解析的插件内 `mac-recording` Skill，并以该 `SKILL.md` 所在目录的 `scripts/mac-recording.js` 为唯一入口。支持串行工具编排时，把读取该 Skill 与随后执行 `start` 放在同一次工具往返中；直接执行且只执行一次 `node <resolved-script-path> start ...`。不得预先运行 `doctor`、`status`、`last` 或 `start --dry-run`，不得搜索、枚举或比较其他插件目录及缓存版本。入口缺失时立即报告，不转而查找其他副本。

无修饰的“开始录音”“现在开始录音”“启动 Mac 录音”“录下这段讨论”，以及明确的“开始快速讨论”，都默认匹配快速讨论完整工作流。本次唯一的 `start` 必须带 `--workflow-kind quick-discussion`；主题可同时传入 `--name`。启动后立即回复，不提前打开 PLAUD。带该标签的录音停止后按快速讨论 reference 继续；用户在停止时明确说“只停止，不上传／不整理”时，到音频就绪后暂停。

只有用户在启动消息中明确限定“开始本地录音”“仅本地录音”“只录音，不上传 PLAUD／不生成纪要”“停止后只保存文件”时，才省略工作流标签并停留在 `mac-recording` 单阶段。不要把“开始录音”本身解释为本地限定，也不要为了确认默认分流而延迟启动。

只根据本次 `start` 返回的 JSON 判断结果；出现 `recording: true` 后立即报告输出路径、开始时间、自动停止时长和 `timings.totalMs`，不做启动后复查，不在回复前执行测试或插件维护。若返回已有活动录音，直接报告本次响应中的路径和时长，不启动第二个。

停止、状态查询及错误恢复仍完整遵循 `mac-recording` Skill；“一次调用”只约束正常启动热路径，不削弱 `stop` 的终止回执、文件校验及 `status`/`last` 恢复检查。停止时根据活动录音保存的 `workflowKind/workflowId` 判断是否继续 PLAUD，不能只凭停止消息措辞重新分流。系统音频或屏幕录制不路由到 `mac-recording`。

## 通用编排规则

1. 开始前确定完整工作流、每一步的完成标准、交接产物和失败处理。
2. 进入某阶段前采用对应 Skill 并完整遵循：domi 自有阶段使用插件内同名 Skill，飞书阶段使用对应的 `lark-*` Skill；不要只凭 Router 对该 Skill 的摘要执行。
3. 上一步未满足完成标准时，不得进入下一步。
4. 默认传递完整产物文件，而不是只传聊天摘要。
5. 用户没有要求阶段性暂停时，在同一任务中连续执行。
6. 外部写入前执行去重和字段校验；遇到多个可能匹配项时先让用户确认。
7. 某一步失败时保留已完成产物和阶段标识，从失败点恢复；PLAUD 不重复触发生成，项目 intake 不重复创建文档或记录，people intake 不重发已成功的人物写入。
8. 对 `project` 类型的新项目，当前后端的结构化记录、文档和材料目录都是强制阶段；任一层失败时不得跳过并直接标为 `managed`。
9. 最终报告所选工作流实际产生的关键产物：快速讨论直接展示核心要点与跟进事项，并提供音频、PLAUD 文字稿、完整纪要和讨论摘要；PLAUD 投资工作流报告文字稿、纪要、项目判断、评分／评级、飞书 Wiki 链接、本地资料库项目路径和 Watching List 结果；行业新闻雷达报告扫描范围、值得关注项、taxonomy 复用／镜像修复／新增／延期／孤立／同步失败／回滚／部分完成／分类修正状态（部分完成须列已改变侧和人工修复项）、覆盖缺口，以及 Base 的新增／更新／分类修正／无变化／跳过／失败数量与链接，默认不展示未达到关注阈值的事件；项目 `research` mode 先完整交付只读研究，并以“是否继续进行投资评级分析，并将项目归档、加入 Watching List？”收尾；用户明确确认前不得评级、建文档或写入。确认后复用既有研究产物切换到 `intake`，不得重复研究；项目 `intake/update` mode 报告研究结论、评分／评级、文档归档、项目库归档和 Watching List 结果；人物 `research` mode 报告候选／人物画像、证据、置信度、覆盖缺口和下一步，并询问是否写入／更新人脉表，确认前零写入；人物 `intake/update` mode 报告新增、更新、无变化、跳过、歧义和失败数量，每人的 `record_id`、字段变化与后续动作。

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
