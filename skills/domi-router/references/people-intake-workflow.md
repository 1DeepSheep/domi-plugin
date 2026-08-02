# 人物研究与人脉入库工作流

## 目标

把赛道／人才池条件、人物姓名、截图、链接、公开履历、关系线索或互动记录处理成可追溯的人物研究结果，并在获得明确授权后去重写入当前人脉库。Router 直接编排各阶段；进入人物研究前必须采用并完整读取 `domi:sourcing`，写入前先按 `investment-mgmt/references/storage-backends.md` 解析后端。飞书模式采用 `lark-base`，本地模式采用 `domi-repo.cjs person search/upsert`。

本工作流只负责人选发现、人物画像、公开背景核验、关系路径和 People Base。不得自动调用 `investment-review` 给人物做 B/A/S 评级，也不自动创建项目 Wiki、本地资料库目录或 Watching List 记录；用户另行要求研究人物关联公司时，才把已核实的人物资料交给项目工作流。

## 一、模式与授权边界

| Mode | 触发 | 允许动作 |
|---|---|---|
| `research` | “找一下 XX 方向的人／研究一下这个人／看看这位创始人／调查一下某人” | 只读发现或人物画像；交付后主动询问是否写入／更新 People Base，确认前不得创建或修改记录 |
| `intake` | “找人并入库／查完加入人脉表／把这个人加入 1.1 People／完整处理这个人／跑 people intake” | 完成人物研究、读取 Base schema、查重、生成精确变更计划并 upsert；开放式或批量名单必须再次确认后才写 |
| `update` | “更新人脉表里的 XX／把这次互动或跟进补到人脉表／更新这个人的 People 记录” | 只查找并增量更新唯一既有记录；找不到记录时询问是否切换 `intake`，不得自动新建 |

不要因用户提到 domi、发送人物截图或只说“找一下／研究一下”就推断写入授权。`research` 完成后必须询问：“是否将以上 Included／指定人物写入或更新到《1.1 People人际关系管理》？”只有用户明确确认后才切换到 `intake`；未回复、拒绝或表达不确定时保持零写入。

确认升级后复用已完成的检索范围、候选集、人物指纹、画像、信源和事实状态，从 Base schema 与查重阶段继续；除非时效事实已过期或用户改变筛选条件，不得重新做一遍 sourcing。

`intake` 的写入授权不等于候选选择授权。满足以下任一条件时，必须先展示 `create/update/skip/ambiguous` 变更计划并等待一次明确确认：

- 候选由系统开放式发现，而不是用户逐一明确点名；
- 一次计划写入多于一人；
- 现有记录有多个可能匹配、字段覆盖存在冲突或需要合并；
- 需要新增字段、选项、修改 schema、删除或合并记录。

用户点名的单人且身份唯一、现有记录匹配唯一、字段映射无冲突时，可在既有 `intake/update` 授权内直接 upsert。背景调查只在用户明确要求“背调／背景调查／核验风险”时启用 `sourcing background-check`；普通找人不得默认扩张为深度风险调查。

## 二、阶段交接契约

| 阶段 | 使用的 Skill | 输入 | 必须产出 | 完成标准 |
|---|---|---|---|---|
| 范围锁定 | Router + `domi:sourcing` | 赛道、角色、姓名、截图、链接或关系线索 | `search_brief`、purpose、纳入／排除条件 | 对象、用途、范围和写入模式可执行；关键范围仍歧义时先确认 |
| 人选发现 | `domi:sourcing discover` | `search_brief` | `candidate_set`、Included／Watchlist／Excluded、`coverage_note` | 完成 source graph、alias graph 和 anti-omission 检查；每位候选有证据与状态 |
| 人物画像 | `domi:sourcing profile`；按需 `background-check` | 候选、用户材料 | `person_fingerprint`、结构化画像、`source_ledger`、置信度、缺口 | 身份唯一；关键履历、builder 信号、当前状态和来源均有结论或明确缺口 |
| 人脉库查重（仅 `intake/update`） | 飞书：`lark-base`；本地：`domi-repo` | 人物指纹与画像 | `schema_snapshot`、`dedupe_result`、`record_id/person_id?` | 按当前后端完成多键查重；中低置信匹配不得自动合并 |
| 变更计划 | `domi:sourcing base-maintenance` + 当前后端 | 画像、schema、查重结果 | 每人 `create/update/skip/ambiguous`、字段 diff | 批量／开放式／冲突计划已经用户确认；敏感或不确定字段已排除 |
| 人脉库写入 | 当前后端 | 已授权的精确计划 | `record_id/person_id`、逐记录写入状态 | 只写 Included／用户点名人物；每条写后按 ID 回读验证 |
| 终检 | 上述对应 Skills | 所有阶段标识 | 一致性快照与恢复清单 | 无重复人物；字段类型、单值类型、接触事实、来源和隐私均正确 |

`research` mode 只执行范围锁定、人选发现和人物画像，跳过 Base schema、查重与写入。只有用户明确询问“人脉表里有没有／我们是否认识／有什么引荐路径”时，才可在 `research` 内只读查询 People Base；查询不会升级写入权限。

若用户已经给出一个明确人物，跳过广泛 `discover`，直接执行身份核验与 `profile`。若用户要求人才池、若干候选或某赛道潜在创始人，必须先 `discover` 再为 Included 候选补齐最小可入库画像。

## 三、锁定范围与人物身份

1. 明确用途：创业者 sourcing、会议准备、公开背调、引荐规划、投后支持或关系维护。
2. 对开放式找人明确赛道／thesis、阶段、地域、角色、资历、时间窗、人数目标和排除条件；信息不足但可合理默认时说明假设后继续，候选范围会实质改变时再询问。
3. 为每人建立人物指纹：`规范化姓名与中英／拼写别名 + canonical professional URL／主页／GitHub／Hugging Face／Scholar 等稳定标识 + 当前或历史组织、角色和时间线`。不得只用“姓名 + 当前公司”，避免同名或换工作后重复创建。
4. 以官网团队页、个人主页、项目／论文页、GitHub／Hugging Face、公司公告等一手来源交叉绑定姓名、组织和代表成果。实体仍无法唯一确认时停止该候选后续写入，列出候选身份与所需确认信息。
5. 事实状态统一标为 `verified`、`user-provided`、`inferred` 或 `unverified`，并为时效信息记录来源日期。

若人物只是识别某家公司或项目的线索，且用户要的是项目投资结论，转交项目工作流；若公司仅用于解释人物履历，继续人物工作流，不自动创建项目记录。

## 四、发现候选与形成人物画像

完整遵循 `domi:sourcing` 的 source graph、project／paper graph、alias graph、snowball graph 和 Google／Google-style anti-omission pass。搜索摘要只用于发现线索，重要事实回到一手页面核验。

对每个候选给出：

- `Included`、`Watchlist` 或 `Excluded`；
- 当前组织／角色与规范化别名；
- 与 thesis 的匹配及可观察 founder／builder 信号；
- 代表产品、项目、代码、模型、论文、客户或经营证据；
- 关系路径、公开职业联系渠道和建议下一步；
- 事实状态、来源链接、日期、置信度与待验证问题。

进入写入阶段前，Included 人物至少满足：身份唯一；当前组织／角色或最近状态已核验；为什么相关有具体证据；存在至少一个 canonical source URL；关键判断有置信度；没有把学校／大厂光环替代 builder 证据。证据不足但可能相关者留在 Watchlist，不自动入库；Excluded 默认不写。

普通人物画像只检查与履历一致性直接相关的公开风险信号。用户明确要求背景调查时，再执行 `background-check`，输出 proceed／proceed with questions／pause、核验时间线、reference map、风险与缺口；未经核实的负面传闻不得写成风险事实。

## 五、读取 schema 并查重

仅在 `intake/update` 或用户明确要求只读关系查询时进入当前人脉库。

飞书模式依次采用并完整遵循 `lark-base`，执行下列规则。
本地模式使用 `person search --query` 查重、`person upsert` 写入；SQLite schema 已由网关管理，不得自行改表。人物唯一结构化主档保存在 `4.人脉库/<姓名>/人物主页.md`，完整人物画像／背景研究必须通过同一次 upsert 的 `researchContentFile` 或 `researchContent` 写入 `4.人脉库/<姓名>/研究/`，不得只停留在对话回答中，也不再创建根目录下的“<姓名>-人物资料.md”。真实发生的交流、访谈或会议单独写入 `4.人脉库/<姓名>/纪要/`，并同步维护人脉库的“交流文档”链接；写后再次 search 并验证人物主页、`documents` 中的研究文档以及交流文档 URI。

1. 定位《1.1 People人际关系管理》，读取实时 table、字段 ID、字段名、类型、必填项、select 选项、linked-record 字段和相关视图；不得假设历史字段名仍存在。
2. 飞书模式先运行 `node <plugin-root>/skills/investment-mgmt/scripts/ensure-intake-time-fields.js ensure`，确认 `入库时间` 为系统 `created_at`，并确认人脉表存在文本型“交流文档”字段；`入库时间` 只读，不得放入 create/update payload，交流纪要生成或归档后应把对应链接增量写入“交流文档”。
3. 优先用稳定标识查重：`open_id`、用户授权的职业邮箱、canonical professional URL、个人主页、GitHub／Hugging Face／Scholar 等；再用规范化姓名与别名 + 当前／历史组织 + 角色／时间线复核。
4. 将结果分为：`create`、`update(record_id, high-confidence)`、`skip(no delta)`、`ambiguous`。多条命中、身份中低置信或疑似重复时不得自动 merge、覆盖或删除。
5. `update` mode 只能定位唯一既有 `record_id`；无记录时暂停并询问是否切换 `intake`，不得把“更新”解释成“找不到就新建”。
6. 永远按实时 schema 映射字段。字段缺失时，只在内容适合且安全时写入现有 Notes／Summary／`情报`；否则询问是否调整 schema。除统一维护系统型 `入库时间` 外，不得擅自新增字段、select 选项或改变字段类型。

本地 `intake` 的写入顺序是强制的：先生成完整人物研究 Markdown 临时文件，再将其作为 `researchContentFile` 与结构化字段一起传给 `person upsert`；随后按姓名回读并确认 `人物主页.md`、`研究/<标题>.md` 与 SQLite 人物记录都存在。任一项缺失时状态为部分完成，不得声称已入库。`update` 有实质研究增量时同样写入新的可辨识研究文档，避免只覆盖结构化摘要而丢失完整成果。

《1.1 People人际关系管理》的 `类型` 只能保留一个最利于检索的主标签；即使 API 需要数组也只传一个选项。学校、雇主、历史公司、身份和 why-now 放入 `所属组织&身份`、`情报` 或其他实时存在的适配字段，不得堆成多个 `类型`。

## 六、隐私、关系事实与字段写入

只使用公开、用户提供或获授权的内部资料。不得收集或写入健康、宗教、民族、政治观点、家庭状况、住址、证件、私人电话或私人邮箱等敏感／私人信息。公开职业主页可以保存；联系方式只有在用户明确提供或属于公开职业联系渠道且确有投资关系管理用途时才可写入。

优先写入 `verified` 和 `user-provided` 事实。`inferred/unverified` 如确需保留，必须在 `情报`／Notes 中显式带状态与来源，不得覆盖更强证据。未经核实的负面信息不得进入 risk flag。

关系状态、关系强度、owner、mutual contact、intro path、touchpoint、last interaction 和 next follow-up 必须来自真实互动、用户提供记录或已授权的内部证据：

- 公开研究本身不等于“已联系／已见面”，不得升级关系状态；
- 共同学校、共同公司或社交关注不自动等于 warm intro；
- 用户没有给出互动日期时不得把研究日期写成 last interaction；
- 用户没有指定 owner、deadline 或具体 ask 时不得编造跟进责任人和日期；
- `update` 只 patch 有信息增量的字段，不用公开推断覆盖用户已有的内部关系笔记。

每次写入前展示或记录完整字段 diff；系统型 `入库时间` 不计入可写 diff。每条写后按 `record_id` 回读，验证姓名、主类型、组织身份、来源、关系状态、下一步以及系统生成的入库时间。涉及 linked-record 时还要验证链接对象唯一正确。

## 七、批量确认、幂等与恢复

批量／开放式候选确认表至少包含：人物、指纹摘要、Included 理由、计划动作、目标 `record_id?`、关键字段 diff、跳过或歧义原因。只有用户确认的 create／update 项可以写；Watchlist、Excluded、ambiguous 和未确认项保持零写入。

恢复时保留：`workflow_id`、`mode`、`brief_hash`、`candidate_id`、`person_fingerprint`、`source_ledger`、`schema_snapshot`（时间、字段 ID／类型／选项）、`dedupe_result`、`planned_action`、`confirmation_status`、`record_id`、逐记录 `write_status` 与 `verified_fields`。

| 失败位置 | 恢复动作 |
|---|---|
| 人物身份不唯一 | 暂停该人物，保留候选身份与排除证据 |
| 关键来源不可访问 | 标记缺口，换独立来源；不编造，不阻塞其他独立候选 |
| 当前人脉库／schema 不可读 | 交付研究产物并暂停写入；不得按旧 schema 猜写 |
| 确认前中断 | 保留计划，恢复后继续等待；不得视沉默为确认 |
| schema 在确认后变化 | 刷新映射；若字段语义或计划有实质变化，重新确认 |
| create／update 响应丢失 | 先按人物指纹和目标 `record_id` 搜索、回读，再决定是否重试 |
| 批量部分失败 | 保留成功项 `record_id`，只重试 pending／failed 项，禁止整批重发 |
| 写后字段不一致 | 按 `record_id` 定向 patch 差异，不整表覆盖 |
| update 找不到记录 | 询问是否切换 `intake`；未确认前不得新建 |
| 存在重复记录 | 报告重复与建议合并方案；未经确认不删除或自动 merge |

## 八、最终交付

`research` mode 向用户报告：

- 搜索范围和覆盖过的 source families；
- Included／Watchlist／Excluded 候选及原因；
- 每位重点人物的核心证据、置信度、关系路径、待验证问题和建议下一步；
- 可能遗漏与不可访问来源；
- 明确说明本次零 Base 写入，并询问是否将 Included／指定人物写入或更新到《1.1 People人际关系管理》。

`intake/update` mode 向用户报告：

- `created / updated / unchanged / skipped / ambiguous / failed` 数量；
- 每位已处理人物的动作、`record_id` 和关键字段变化；
- 因隐私、低置信、重复或 schema 不匹配而未写的内容；
- 尚待确认、需要人工合并或可从当前阶段恢复的项目；
- 最有价值的后续引荐、联系或验证动作。

最终答复必须自包含，不得声称未回读验证的记录已经入库，也不得把人物优先级／置信度写成 Investment Review 的项目评分或评级。
