# 投资项目研究入库工作流

## 目标

把项目名称、截图、链接、BP、访谈、纪要或零散人物线索处理成可追溯、可评价、可继续跟进的投资记录。Router 直接编排各阶段；进入每个阶段前，必须采用并完整读取对应 Skill，不能用本文件摘要替代下游规则。本工作流同时完整遵循 [多阶段无损交接合同](lossless-handoff.md)：长篇材料、研究底稿、快评和 QA 结果先保存为规范文件，阶段间只传经哈希验证的 artifact 引用；下游 Skill 仍按自己的质量规则读取完整原文。

## 资料库分支守卫

进入内部查重或任何归档／写入前先执行 `investment-mgmt/references/storage-backends.md`：

- `repositoryBackend=local`：执行本文件的 SQLite／Markdown 项目链路；飞书已连接时可围绕已锁定项目实体窄范围只读搜索 Wiki、Docs、Base 作为补充参考，失败不阻塞；
- `repositoryBackend=legacy_feishu_primary`：同时完整读取
  `investment-mgmt/references/legacy-feishu-primary.md`，内部查重改查既有
  Watching List 与 Wiki，文档／材料／结构化写入严格执行该 reference 的“项目库
  与项目文档”顺序。本文件中所有 `domi-repo project/document` 命令均跳过，
  不得创建仅本地可见的第二个项目；
- `research` mode 仍保持零内部写入，后端分支不会扩大授权。

## 一、模式与授权边界

| Mode | 触发 | 允许动作 |
|---|---|---|
| `research` | “查一下／研究一下／看看这个项目” | 只读研究；交付后必须主动询问是否继续评级分析并入库，确认前不评级、不新建文档、不写资料库 |
| `intake` | “研究并入库／加入项目库／完整处理” | 完整研究、评级，并归档到当前已锁定资料库的结构化记录、项目文档与材料目录 |
| `update` | “更新这个项目／补充资料／更新评级或纪要” | 查找已有记录、文档和项目目录，只更新有信息增量的内容 |

不要因用户提到 domi 或发送项目截图就推断写入授权。`research` mode 完成后必须主动询问：“是否继续进行投资评级分析，并将项目文档归档、加入当前资料库？”只有用户明确确认后，才切换到 `intake`；未回复、拒绝或表达不确定时均保持只读状态。

确认升级后复用已完成的实体核验、研究底稿、信源和事实状态，直接从 `investment-review` 开始，随后按 `storage-backends.md` 写入当前权威资料库；不得重新做一遍桌面研究。复用以 `domi.handoff.v1` 中已验证的 `research_report`、`evidence_index`、`source_material` 路径与 SHA-256 为准，不把聊天摘要重新扩写成研究事实。用户若只要求评级、不要求入库，则只执行 `investment-review`，继续禁止资料库写入。

## 二、阶段交接契约

| 阶段 | 使用的 Skill | 输入 | 必须产出 | 完成标准 |
|---|---|---|---|---|
| 标的锁定 | Router 只读核验 | `source_material` artifact 引用 | `entity_fingerprint`、别名、同名排除 | 官网、主体、创始人至少两项能互相绑定；实体仍无法唯一确认时停止 |
| 内部查重（仅 `intake/update`） | `domi:investment-mgmt` | manifest 中的实体指纹与别名 | `project_id?`、`document_uri?` | 本地主库查 SQLite／项目目录；旧飞书主库查 Watching List／Wiki |
| 桌面研究 | `domi:desk-research` | 实体指纹、经哈希验证的用户材料 | `research_report`、`evidence_index`、信源和事实状态 | A类事实无遗漏；中国或华人创始项目完成双语访谈检索；产物非空且哈希已写入 manifest |
| 投资快评 | `domi:investment-review` | 完整 `research_report` 与 `evidence_index` | `review`、关键问题、判断、评分、评级 | 按 Investment Review 完整读取研究产物，格式、证据与评分纪律全部通过 |
| 本地主库 provisional upsert（仅 `local intake/update`） | `domi:investment-mgmt` | 唯一实体、完整合并后的最终字段 payload | 稳定 `project_id`、项目目录、`provisional` 回执 | SQLite 与项目主页已创建／更新，但尚未视为完整入库或 `managed` |
| 文档与项目库归档 | `domi:investment-mgmt` | 经验证的底稿、快评、分类、用户材料 artifact | 当前后端 `document_uri`、`library_path`、归档清单 | 按后端回读 Wiki／Markdown 与材料目录 |
| 最终结构化提交 | `domi:investment-mgmt` | 已验证文档／材料、完整字段、写入授权 | `project_id/record_id`、完整字段、最终 `storageReceipt` | local 复用 provisional ID 幂等 upsert；legacy 在文档后首次 upsert；业务字段与最后更新时间同次写入并回读 |
| 终检 | 上述对应 Skills | manifest 中所有 artifacts、阶段标识和回执 | `qa_receipt`、一致性快照 | 规范原文、记录、文档、目录、链接和哈希互相一致 |

`research` mode 只执行公开来源、用户材料和可选飞书只读参考的标的锁定与桌面研究，然后交付成果并询问是否继续评级分析并入库。飞书只读参考必须按实体指纹窄范围检索，不能创建、编辑或把命中文档当作待更新目标；未连接、无命中或读取失败直接继续。确认前跳过投资快评、内部资料库查重、文档归档和结构化写入。

## 三、锁定标的并查重

1. 从图片、链接、文章、BP 或文字中提取项目名、创始人、产品、官网、账号和地域线索。
2. 生成标的指纹：`官网域名 + 一句话业务 + 法律／运营主体 + 创始人`。
3. 并查别名、中英文名、产品名和主体名，显式列出需要排除的同名项目。
4. 把公司主体名与材料／纪要标题分开：结构化 `name` 只保留规范主体名；日期、产品／技术主题、评级只进入文档标题和对应字段。遇到日期型旧目录时必须用用户确认、已有主页／Base 记录或独立材料核验，不能直接把目录名当公司名。
5. 仅在 `intake/update` mode 进入内部查重：本地主库用 `domi-repo.cjs project search` 查 SQLite 与已有项目主页；旧飞书主库按 legacy reference 查 Watching List 与 Wiki。查重阶段始终只读，`research` mode 跳过本项。
6. 名称模糊或多条命中时，先完成实体核验；仍无法唯一判断时再向用户确认，不得创建重复记录。

实体无法唯一确认时停止后续研究，列出候选与所需确认信息；只有实体本身已经唯一、但部分履历或业务事实仍不确定时，才可继续研究并把这些事实标为缺口。

## 四、桌面研究

采用并完整遵循 `domi:desk-research` 的 `primary/company/standard` 流程。技术型项目必须盘点官网、GitHub、Hugging Face、论文和产品发布。

中国或华人创始项目必须执行创始人双语检索矩阵：中英文名／账号 × 访谈、专访、播客、演讲、融资、创业；定向覆盖甲子光年、36Kr、晚点、Founder Park、暗涌和公众号转载。用户点名文章时先用精确标题检索并完整抽取，不得只检索英文官方源。

长访谈按九类抽取：

1. 完整履历；
2. 主体关系；
3. 产品技术；
4. 量化进展；
5. 客户定价；
6. 收入融资；
7. 成本结构；
8. 战略变化；
9. 可核验线索。

所有关键事实区分为：已独立核实、公司／创始人口径、分析推断、尚缺失。

### 重要性审计

不要只检查“是否提到”。将事实按决策重要性分级：

- A：改变投资判断，必须进入摘要和当前后端项目 Notes；
- B：支撑核心逻辑，必须进入正文；
- C：背景信息。

客户、定价、收入、盈利、融资、产量、关键 Pipeline、核心 benchmark 和完整创始人履历通常属于 A/B 类。保留数字限定：新增／累计、开源／内部、报价／成交、单月／持续、环境／任务／轨迹。

桌面研究的完成标准是：标的指纹、团队、产品技术、商业模式、融资经营、竞争风险和核心待验证项均有结论或明确缺口。

## 五、初步投资快评

采用并完整遵循 `domi:investment-review`：

1. 根据项目阶段提出 3–5 个项目独有的关键问题；
2. 给出对应判断、1–10 分评分（禁用 5 分）及 B/A/S 评级；
3. 早期项目重点判断人—事匹配、时点和方向，不用 A 轮数据标准惩罚天使项目；
4. 产品与行业问题至少 2 个且占关键问题的一半以上，必须回答事情是否成立、产品化／规模化路径以及什么公司会赢；
5. 创始人口径经公开信息交叉验证后再进入判断，无法核实时显式保留口径标签；
6. 全职、履历、IP、合同、cap table、term sheet 与交割凭证默认属于后置尽调，不得替代核心投资问题；只有已发现具体 deal breaker 时才升级。

当前后端结构化记录只写评级字母；评分和完整决策链写入项目文档。评级不得改变接触深度：仅公开研究的项目仍保持 `待交流`。

## 六、生成并归档项目文档

仅在 `intake` 或 `update` mode 执行。先读取 `storage-backends.md`：

- 本地主库在查重、taxonomy、评级和完整字段 payload 全部通过后，先回读目标记录，并把写前快照（新项目为 `null`）、`recordRevision`（新项目为 `0`）、`recordHash`（新项目为 `null`）和完整 payload hash 保存进 manifest。provisional `project upsert` 必须把这两个回读值原样作为 `expectedRevision` 与 `expectedRecordHash` 传入；底层会在同一个 SQLite 写事务内 fail-closed 比对。该命令会立即写 SQLite，并创建稳定 `project_id`、项目目录和 `项目主页.md`，因此本工作流把 `storagePhase` 记为 `provisional`，且只把命令回执视作 **provisional upsert**；即使命令返回 `storageReceipt.status=managed`，在文档、原始材料和最终闭环尚未验证前也不得对外报告“已入库／managed”。`update` 必须把旧记录与增量合并成完整 payload 后再 upsert，禁止稀疏 payload 把既有字段清空。
- provisional 成功后，把回执返回的新 `recordRevision` 与 `recordHash` 原子写入 manifest，作为后续文档归档和 final upsert 的 CAS 基线。这两个值只用于内部并发控制，不得出现在面向用户的研究报告、项目文档或最终回复中。
- 取得稳定 `project_id` 后，用 `document create` 保存研究、纪要和快评，原始材料进入同一项目的 `原始材料/`。只有用户明确要求创建／编辑飞书文档交付副本时，才另行采用 `feishu-knowledge-extension.md`，且本地归档必须先成功。
- 旧飞书主库严格执行 `legacy-feishu-primary.md` 的项目顺序：Watching List／Wiki 查重 → 唯一 Wiki 文档 → 原有本地材料目录 → 回读 → 最后 Base upsert。不得调用本地 `project upsert`／`document create`。

统一遵守：

1. 新项目以核心产品／主要收入来源确定一个主子领域目录；其他子领域保留在当前项目记录的多值分类字段中。已有项目的目录是稳定实体身份：后续领域／子领域修正只更新分类字段与原主页，不得另建新目录或拆散纪要、研究、原始材料和用户编辑；需要搬迁时必须另走显式、可审计、全目录原子迁移流程。
2. 公开桌面研究标题使用 `YYYYMMDD-公司名-子领域-桌面研究`；真实交流纪要按现有交流文档命名规则。
3. 桌面研究正文严格采用 `domi:desk-research` 的标题层级：主要板块使用 `####`，板块内分组使用 `#####`，不使用 `#` / `##` / `###`。
4. **先研究、后交流的整合顺序（强制）**：若已有桌面研究，后来产生真实项目交流纪要，更新项目文档时不得把新纪要简单追加在研究之后。最终阅读顺序固定为“交流纪要在前、桌面研究作为独立 Part 在后”；两块内容不得交叉改写。需要显式 Part 标签时使用顶格加粗行 `**Part 1｜交流纪要**` 与 `**Part 2｜桌面研究**`，不要用新的 Markdown 标题包裹，以保留纪要和研究各自的 `####` / `#####` 层级。其他既有独立章节、图片和附件继续保留。
5. 文档至少包含：摘要、主体关系、创始人、产品技术、商业模式、关键数据、融资经营、竞争与风险、投资快评、访谈问题、信源。
6. 在正文显式标注创始人口径与独立核实状态。
7. 写入后按当前后端回读 Wiki／Markdown、材料目录、正文与关键数字，并核对交流纪要确实位于桌面研究之前；同时验证文档非空、核心信息未被压缩遗漏。
8. 按 `investment-mgmt` 的新项目闭环规则归档用户提供的 BP／slides、研究底稿、交流文字稿、项目文档源稿和投资快评；已有目录则复用并去重，不覆盖不同版本。项目根目录保持稳定，不加入日期、评级或进展。
9. 列出材料目录并核验关键二进制文件大小或校验和。当前后端文档 URI、结构化记录与项目路径均取得并验证后，文档归档阶段才算完成；本地主库此时仍处于 provisional，必须继续执行第七节最终提交。

### 文档质量门槛

必须保留：

- 创始人的学校、专业、学位、导师／实验室、关键任职和代表性成果；
- 公司、产品、开源社区、母子公司和运营主体关系；
- 技术项目的输入、Pipeline、输出、规模、基准、用途和成本／价格因素；
- 客户、定价、收入、盈利、融资、估值的具体时点与口径；
- 3–5 个决定投资成败的项目独有问题；
- 事实、公司口径、推断和缺失四种状态。

禁止把完整履历压缩成“技术背景扎实”，把“累计 1,400 条环境、其中新增 1,000 条”压缩成“有大量数据”，把报价／预算写成成交价，把单月盈利写成持续盈利，或把 GitHub stars 写成客户或收入。

## 七、新增或更新项目结构化记录

仅在 `intake` 或 `update` mode 执行。采用并完整遵循 `domi:investment-mgmt` 的最新字段 schema、taxonomy 与状态规则：

- `local`：第六节 provisional upsert 已实际写入 SQLite。文档与材料成功归档后，用同一个 `project_id` 和同一份已验证的完整 payload 再做幂等最终 upsert，并把 provisional 回执的 `recordRevision`、`recordHash` 分别作为 `expectedRevision`、`expectedRecordHash` 传入，提交最后更新时间。确认返回的新 revision/hash 已更新 manifest，且 `documentUri` 指向已回读的同一项目主页；随后重新 search/get 和回读文档、材料。不得生成第二个 ID，也不得把 provisional 命令回执直接当最终 `storageReceipt`。
- `legacy_feishu_primary`：继续“文档／材料成功 → 最后一次 Base upsert”的顺序，不存在本地 provisional 写入。

最终提交字段包括：

- 公司名称；
- 领域／子领域；
- 进展状态；
- 项目评级；
- Notes；
- 历史融资；
- 最新估值（亿美元数值）；
- 仅含关注机构的投资机构；
- 当前后端项目文档 URI；
- 入库时间（SQLite／Base 系统 `created_at`，由系统生成，不放入写入 payload）；
- 最后更新时间（Asia/Shanghai 操作当天）。

Notes 保留 300–600 字的决策密度：项目定位、创始人匹配、关键量化事实、商业进展、主要不确定性和下一步。不要把整篇报告塞进 Notes。

进展状态按接触事实填写：仅公开线索=`待交流`；发生一次真实交流=`已交流`；持续跟进或明确寻找机会=`深度跟踪`。不得使用历史值“找投资窗口”。评级变化不得自动升级状态。

### 写入前检查

- [ ] 使用 `公司名称` 查重，并覆盖中英文名、产品名和主体名；
- [ ] 领域与子领域来自 `investment-mgmt` taxonomy；
- [ ] 状态反映真实接触深度，不因评级自动升级；
- [ ] 评级来自 `investment-review`；
- [ ] Notes 是高密度摘要并标注关键公司口径；
- [ ] 历史融资按 `investment-mgmt/references/financing-fields.md` 从晚到早排列，最新估值与最新投后估值一致；
- [ ] 人民币估值换算写明 USD/CNY 汇率、日期和来源；
- [ ] 投资机构只保留八家关注机构，且每家都有融资轮次／股东证据；
- [ ] 文档 URI 指向当前后端经回读验证的 Markdown 或唯一 Wiki 项目文档；
- [ ] 新项目文档和材料目录位于正确领域／主子领域；已有项目复用原稳定根目录，且源材料、用户编辑和产物已写后验证；
- [ ] 第一次入库或有重要内容更新时，最后更新时间为 Asia/Shanghai 操作当天；
- [ ] 业务字段和最后更新时间在同一次写入中提交；
- [ ] local 最终 upsert 复用 provisional `project_id`，payload hash 与审核通过版本一致，并传入 provisional 回执的 `expectedRevision` 与 `expectedRecordHash`；
- [ ] 写后重新 search 验证。

## 八、闭环验证

只有最终提交后重新读取并全部确认，工作流才能标为 `managed`：

1. 当前结构化项目库只有一个正确实体记录；
2. 评级、分类、状态、Notes、历史融资、最新估值、投资机构、链接和最后更新时间正确，入库时间由系统生成且新增后非空；
3. 新项目文档位于当前后端的正确分类目录；已有项目的文档 URI 与稳定根目录保持一致，分类变化未生成第二目录；
4. 文档 URI 指向真实本地 Markdown 或唯一 Wiki 项目文档，而不是搜索结果或临时 URL；
5. 项目目录唯一且与结构化记录和文档分类一致；
6. 没有把公司口径写成独立事实；
7. `research` mode 没有产生任何外部写入。

任何单个 `project upsert` 回执、项目主页存在、文档创建成功或材料目录存在都只是局部成功，不能单独满足闭环。最终 `storageReceipt.status=managed` 只在同一实体的 `recordVerified=true`、`documentVerified=true`、`filesVerified=true`，且 manifest 中最终 payload、研究／快评／证据 artifact 哈希全部一致后写入。

## 九、恢复与幂等

每个阶段都原子更新 `domi.handoff.v1`，保留 `entity_fingerprint`、任务开始时锁定的 `repositoryBackend`、内部 `project_id/record_id`、`document_uri`、`library_path`，以及研究、证据、快评、QA 规范文件的路径与 SHA-256。失败后先验证 artifact 和回执，再从当前阶段恢复；不得用历史聊天中的研究全文或摘要替代规范产物。恢复状态只用于内部续跑，不进入默认用户报告：

| 失败位置 | 恢复动作 |
|---|---|
| 实体不唯一 | 暂停写入，保留候选与排除证据 |
| 关键来源不可访问 | 标记缺口，用独立转载或镜像；不编造 |
| Markdown／Wiki 创建成功、正文写入失败 | 复用同一当前后端文档修复，禁止再建同名副本 |
| local provisional upsert 后文档／材料失败 | manifest 保持 `storagePhase=provisional`，保存 `project_id`、完整 payload hash、回执 `recordRevision/recordHash`、写前记录快照与已有 artifact；不得报告 `managed`。恢复时先按同一 ID 回读并比对 revision/hash，确认无并发漂移后复用目录补齐缺项，不得新建第二项目 |
| SQLite 已提交、项目主页原子写入失败 | 接受 `DOMI_PROJECT_DOCUMENT_WRITE_FAILED` 的 `status=provisional` 恢复回执；保存同一 `project_id`、revision/hash 和目标 `documentUri`，不得报告 `managed` 或 `documentVerified`。重新回读记录并以同值幂等 upsert 修复主页，禁止新建记录或目录 |
| 文档成功、材料归档失败 | 复用已有项目目录，补齐材料并回读；不得重复创建项目或把 provisional 回执升级为最终回执 |
| 文档与目录成功、最终结构化提交失败 | local 复用 provisional `project_id`、已验证完整 payload 及 manifest 中的 expected revision/hash 幂等重试；同值重放可成功，若 CAS 不匹配则必须重新读取、合并并复核，禁止盲重试；legacy 复用当前 URI、项目路径和研究结果重试 Base upsert |
| SQLite／Base 已有同名 | 核验实体后更新原 `project_id/record_id` |
| 回填后字段不一致 | 按 `project_id/record_id` 定向修复当前后端记录；不要整库覆盖 |

若 provisional 后发现实体不一致、payload hash 变化或记录存在非本工作流并发更新，立即停止自动恢复；保留写前快照和当前记录供定向修复，不得覆盖他人更新、删除记录或自动重建。只有完成第八节全部闭环后才把 `storagePhase` 从 `provisional` 更新为 `managed`。

## 十、最终交付

向用户报告：

- 一句话投资判断、评分和评级；
- 3–5 个关键结论；
- 可在客户端预览的文档入口与归档成功／部分完成／失败状态；默认不展示本机绝对路径或内部文档 URI；
- 项目结构化记录新增／更新结果、状态和最后更新时间；默认不展示 `project_id/record_id`，仅在冲突排查或用户明确要求时提供必要标识；
- 最重要的 3–5 个待验证问题。

`research` mode 只报告实际完成的只读研究，不虚构评级、文档或入库结果，并在末尾明确询问是否继续进行投资评级分析并归档到当前资料库。若用户此前已明确要求只做研究且不要追问，则尊重该指令，不再询问。最终答复必须自包含，不依赖用户回看过程消息。
