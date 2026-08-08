---
name: investment-mgmt
description: |
  管理 domi 的本地投资资料库。SQLite、Markdown 和本地附件目录永远是项目、人脉、行业事件、待办事项与研究文档的权威来源；负责分类、项目状态、评级、历史融资、最新估值、投资机构、入库时间、最后更新时间、文档索引、播客归档和数据质量。飞书作为可选知识外挂与发布平台，完整保留 Base、Wiki、Docs、Drive、IM、Contact 能力；按用户明确指令搜索／读取外部资料，或创建／编辑／发布飞书内容，但不作为 domi 管理基础。
  当用户提到项目库、人脉库、行业信息库、投资资料库、领域/子领域、分类、项目评级、进展状态、融资、估值、投资机构、入库时间、交流文档、项目文件整理、播客归档、本地资料库、飞书知识库或多维表格搜索、读取飞书资源、创建、编辑或发送飞书内容时触发。
---

# 投资管理

每次运行先完整读取并执行 [references/storage-backends.md](references/storage-backends.md)。权威资料库固定为本地 SQLite + Markdown + 工作区附件目录：

- 所有“研究并入库”“更新项目／人脉／行业动态”“同步待办事项”都写本地资料库。
- 连接飞书不切换资料库、不自动迁移结构化表，也不要求用户手工填写 Base Token、Table ID 或固定 Wiki Space ID；但连接授权仍完整保留 Base、Wiki、Docs、Drive、IM、Contact 能力。
- 用户明确要求飞书搜索、读取、创建或编辑时，再完整读取并执行 [references/feishu-knowledge-extension.md](references/feishu-knowledge-extension.md)。
- 已有 `delivery_only=feishu_doc|feishu_dm` 继续兼容，完整读取 [references/delivery-channels.md](references/delivery-channels.md)；外部副本不改变本地权威源。

## 本机配置

真实路径、飞书账号与文档标识属于用户运行数据，禁止写入 Skill、Git、研究正文、公开日志或诊断包。默认配置路径：

```bash
export DOMI_CONFIG_PATH="${DOMI_CONFIG_PATH:-$HOME/Library/Application Support/domi/domi-plugin-config.json}"
DOMI_REPO="<plugin-root>/scripts/domi-repo.cjs"
node "$DOMI_REPO" config get
```

只要求 `localRepositoryDir` 和 `localDatabasePath`。缺失时提示用户在 domi“设置 → 资料连接”选择本地工作区上级目录；不得改为索要飞书资料库标识。

## 领域与子领域

完整遵循 [references/taxonomy.md](references/taxonomy.md)：

- SQLite 中的 canonical 领域／子领域是客户端筛选、目录与行业动态共用词表。
- 项目 `domain` 为唯一主领域，`subdomains` 可多个；目录只使用第一个主子领域。
- 用户可明确命名新子领域。先做别名归一，确认不能由现有单个或多个子领域表达，再展示“新增子领域 + 所属领域 + 受影响记录”让用户确认。
- 一级领域新增或移动子领域必须确认，不能由模型静默创建。
- 无法分类的项目进入 `3.项目库/_未分类/<项目名称>/`，不得凭文件名猜测。

分类优先级：

1. 项目已有结构化字段与用户明确判断；
2. 项目主页、研究与纪要中的主营产品／技术路线证据；
3. 高置信度关键词；
4. `_未分类` 并进入分类审核，不创建近似标签。

## 项目业务字段

| 字段 | 语义 |
|---|---|
| name | 公司／项目 canonical 名称 |
| notes | 结构化摘要，不放过程性回执 |
| domain / subdomains | 主领域与多个子领域 |
| status | 待交流、已交流、深度跟踪、已投、Miss、放弃 |
| rating | S / A / B / C；待交流项目可为空 |
| cities | 可多选城市 |
| financingHistory | 历史及进行中融资表格 |
| latestValuationUsd100m | 最新已完成轮次投后估值，单位亿美元 |
| investors | 仅记录有融资／股东证据的关注机构 |
| intakeTime | SQLite 首次创建时间，系统只读 |
| lastUpdatedAt | 最近一次实质业务内容更新的 Asia/Shanghai 日期 |

`找投资窗口` 是禁用历史值，导入时归一为 `深度跟踪`，不得恢复。评级不使用 5 分的投资快评纪律由 `investment-review` 维护；本 Skill 只保存其最终评级。

### 融资字段

读取或写入融资字段前，完整读取 [references/financing-fields.md](references/financing-fields.md)。优先用：

```bash
node <plugin-root>/skills/investment-mgmt/scripts/financing-fields.js --json-file /tmp/project-financing.json
```

- `financingHistory` 同时记录已完成和进行中融资，包含时间、轮次、投前估值、股东出资、投后估值／状态。
- `latestValuationUsd100m` 只取最新已完成轮次；进行中融资不冒充已完成估值。
- 人民币换算必须有汇率日期与来源；冲突或无法计算时保留缺口，不猜测。
- `investors` 只关注红杉、高瓴、IDG、锦秋、Monolith／励思资本、五源、蓝驰、经纬；机构仅被提及、属于创始人履历、竞品股东、在谈或 drop 均不算本项目投资。

## 进展状态与数据质量

| 状态 | 是否通常有评级 | 是否通常有交流文档 |
|---|---:|---:|
| 待交流 | 否 | 否 |
| 已交流 | 是 | 是 |
| 深度跟踪 | 是 | 是 |
| 已投 / Miss / 放弃 | 是 | 是 |

- 状态为空的新项目默认 `待交流`。
- 非待交流但无评级／无纪要，列入数据质量提示，不自动捏造。
- `lastUpdatedAt` 只在公司、团队、产品、技术、客户、融资、收入、评级、状态、分类或重要材料发生实质变化时刷新；排版、错别字和机械迁移不刷新。
- `intakeTime` 由 SQLite 首次创建自动生成，不允许外部 payload 覆盖。

## 搜索与写入

查询、去重和统计只走本地网关，不递归扫描全工作区：

```bash
node "$DOMI_REPO" project search --query "公司名"
node "$DOMI_REPO" person search --query "姓名"
node "$DOMI_REPO" news list --from <ISO时间> --to <ISO时间>
```

创建或更新时，先按中英文名、主体名、产品名查重；多匹配先让用户确认。把 JSON 写到权限受控的临时文件，再调用：

```bash
node "$DOMI_REPO" project upsert --json-file /tmp/project.json
node "$DOMI_REPO" person upsert --json-file /tmp/person.json
node "$DOMI_REPO" news upsert --json-file /tmp/event.json
node "$DOMI_REPO" document create --json-file /tmp/document.json
```

### 新项目闭环

1. 用 taxonomy 确定领域、多个子领域和唯一主子领域；不确定则进入 `_未分类`。
2. `project search` 按名称变体查重；多匹配先确认。
3. 把纪要、研究或快评整理为 Markdown 临时文件。
4. `project upsert` 同一次写入 SQLite 并创建／更新稳定的 `项目主页.md` 与项目目录。
5. `document create` 把纪要／研究写入项目目录；BP、录音和附件进入 `原始材料/`，同文件跳过、不同版本并存。
6. `project get` 与 `workspace verify` 回读；SQLite、Markdown 与目录都通过才返回 `managed`。

已有项目必须复用同一稳定目录和文档索引，禁止每个任务创建新的工作区域或 `outputs/` 作为最终项目归档。

### 人物闭环

唯一结构化主档为 `4.人脉库/<姓名>/人物主页.md`；完整人物研究进入 `研究/`，真实交流进入 `纪要/`。可在同一次 `person upsert` 中提交 `researchTitle` 和 `researchContentFile`。写后再次 `person search`，确认人物主页和文档索引均存在，否则不能报告“已入库”。

### 播客唯一主归档

先完整遵循 `../investment-radar/references/podcast-ingestion.md`。播客音频只交给 PLAUD 转写，不调用本地 ASR。

- `project_dominant`：主纪要进入唯一项目的 `纪要/`。
- `industry_dominant`：进入 `1.行业研究/<领域>/<主子领域>/播客/<节目名称>/`。
- `ambiguous`：让用户在行业、候选项目或暂不归档中选择。
- 一个单集只有一个 `canonicalDocumentId` 和一份可编辑主纪要；其他入口只保存引用。
- 播客归档不得暗中新建项目，也不自动新增评级或改变投资状态。

## 飞书知识外挂

飞书动作必须是显式的：

- “去飞书知识库／多维表格／云盘搜，或读取这个飞书链接” → `feishu_knowledge_action=search|read`；使用 `lark-base`／`lark-wiki`／`lark-doc`／`lark-drive` 只读，不改本地。
- “把这份飞书文档保存到项目” → 读取后通过本地 `document create` 导入；没有隐式双向同步。
- “把本地 Markdown 搬到飞书” → `feishu_knowledge_action=create|edit` 或兼容 `delivery_only=feishu_doc`；执行完整 Markdown／图片保真校验。
- “在这个 Base／Wiki／云盘目标中创建或编辑” → 使用对应 `lark-base`／`lark-wiki`／`lark-drive`，只处理用户唯一指定的外部目标，不把它登记为管理后端。
- “发到飞书私聊／发给某人” → 先用 `lark-contact` 唯一解析收件人，再用 `lark-im` 发送用户指定内容。
- “入库／归档”本身只写本地，不创建飞书文档。

任何飞书读写前完整采用 `lark-shared` 和实际使用的 `lark-base`、`lark-wiki`、`lark-doc`、`lark-drive`、`lark-im`、`lark-contact` Skill。连接权限完整不代表自动调用；飞书失败不影响已完成的本地归档，也不触发资料库切换。

## 回执

工作流完成时后台生成并验证 `storage_receipt`，其 `backend` 固定为 `local`。默认完成报告只展示成功／部分完成／失败、更新内容和必要下一步，不展示项目内部 ID、文档 URI、本机路径或逐字段审计明细。出现冲突、部分完成或用户明确要求时才展开必要回执。
