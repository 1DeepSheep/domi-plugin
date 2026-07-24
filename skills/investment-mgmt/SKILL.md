---
name: investment-mgmt
description: |
  管理 Domi 投资资料库。资料库可由用户明确选择为飞书模式（Watching List + Wiki + 本地材料）或完全本地模式（SQLite + Markdown + 本地材料）；负责项目、人脉、行业事件、文档与资料文件的一致性。也涵盖分类统计、领域/子领域维护、新闻与项目分类词表同步、受控新增子领域、进展状态、项目评级、投资机构、最后更新时间和数据质量。
  当用户提到以下内容时触发：Watching List、项目分类、领域/子领域、补填子领域、分类概览、项目统计、投资项目管理、行业分类、项目领域、新闻分类对齐、taxonomy 同步、新子领域、进展状态、项目评级、投资机构、最后更新时间、更新时间、交流文档链接、本地资料库、项目文件整理、三系统一致性、deal flow、投资管道、新增项目、补录项目、Wiki查漏、文档库项目检查。
---

# 投资管理

管理 Domi 投资资料库及其分类体系。每次运行先完整读取并执行 [references/storage-backends.md](references/storage-backends.md)，根据用户明确选择的后端工作：

- 飞书模式：Watching List + Wiki + 本地材料目录；飞书操作必须使用 `lark-cli`，禁止使用 MCP 工具操作飞书。
- 本地模式：SQLite + Markdown + 本地材料目录；禁止要求飞书授权或调用飞书写入。

## 本机配置（必读）

真实 Base、Wiki 标识和本地资料库路径属于用户运行数据，禁止写入 Skill、Git、日志或任务产物。豆米首次安装时把员工自己的配置写入 `$DOMI_CONFIG_PATH`；直接在 Codex 中使用插件时，默认读取 `~/Library/Application Support/豆米/domi-plugin-config.json`。

执行飞书或本地资料库操作前先加载配置：

```bash
export DOMI_CONFIG_PATH="${DOMI_CONFIG_PATH:-$HOME/Library/Application Support/豆米/domi-plugin-config.json}"
STORAGE_BACKEND="$(node -e 'const c=require(process.env.DOMI_CONFIG_PATH); process.stdout.write(c.storageBackend==="local"?"local":"feishu")')"
PROJECT_BASE_TOKEN="$(node -e 'const c=require(process.env.DOMI_CONFIG_PATH); process.stdout.write(c.projectBaseToken||"")')"
PROJECT_TABLE_ID="$(node -e 'const c=require(process.env.DOMI_CONFIG_PATH); process.stdout.write(c.projectTableId||"")')"
RADAR_BASE_TOKEN="$(node -e 'const c=require(process.env.DOMI_CONFIG_PATH); process.stdout.write(c.radarBaseToken||"")')"
RADAR_TABLE_ID="$(node -e 'const c=require(process.env.DOMI_CONFIG_PATH); process.stdout.write(c.radarTableId||"")')"
WIKI_SPACE_ID="$(node -e 'const c=require(process.env.DOMI_CONFIG_PATH); process.stdout.write(c.wikiSpaceId||"")')"
LOCAL_LIBRARY_DIR="$(node -e 'const c=require(process.env.DOMI_CONFIG_PATH); process.stdout.write(c.localLibraryDir||c.oneDriveProjectDir||"")')"
LOCAL_REPOSITORY_DIR="$(node -e 'const c=require(process.env.DOMI_CONFIG_PATH); process.stdout.write(c.localRepositoryDir||"")')"
LOCAL_DATABASE_PATH="$(node -e 'const path=require("node:path"); const c=require(process.env.DOMI_CONFIG_PATH); process.stdout.write(c.localDatabasePath||path.join(path.dirname(process.env.DOMI_CONFIG_PATH),"domi-repository.sqlite3"))')"
```

`STORAGE_BACKEND=feishu` 时 Base、Wiki 与 `LOCAL_LIBRARY_DIR` 本地材料目录为必需值；`STORAGE_BACKEND=local` 时只要求 `LOCAL_REPOSITORY_DIR` 资料库根目录和数据库路径。两个目录是独立配置，禁止把飞书模式已经指向 `3.项目库` 的材料目录直接当作本地模式根目录。任一当前后端的必需值为空时停止，并提示用户到豆米“设置 → 资料连接”补充；不得从 Skill 内容、历史对话或他人配置中猜测。

## ⚠️ 关键字段名映射（必读）

Bitable 中项目名称的字段名是 **`公司名称`**（不是"项目"）。搜索/过滤项目时必须使用此字段名，否则 API 静默返回空结果。

| 字段 | 类型 | 搜索用字段名 |
|------|------|------------|
| 公司名称 | Text (1) | `公司名称` |
| Notes | Text (1) | `Notes` |
| 领域 | SingleSelect (3) | `领域` |
| 子领域 | MultiSelect (4) | `子领域` |
| 进展状态 | SingleSelect (3) | `进展状态` |
| 项目评级 | SingleSelect (3) | `项目评级` |
| 城市 | MultiSelect (4) | `城市` |
| 最后更新时间 | DateTime (5) | `最后更新时间` |
| 链接 | Text (1) | `链接` |
| 是否完成后续融资 | SingleSelect (3) | `是否完成后续融资` |
| 投资机构 | MultiSelect (4) | `投资机构` |

需要 field ID 时用字段列表端点按字段名动态解析，不得把真实 field ID 固化到插件。

**进展状态选项**：待交流 → 已交流（一次性会面无后续）→ 深度跟踪（持续关注、反复跟进或寻找投资机会）→ 已投 / Miss / 放弃

**禁用历史值**：`找投资窗口` 已于 2026-07-12 合并入 `深度跟踪`。后续任何新增、更新、导入、清洗或字段 schema 操作均不得写入、恢复或重新创建 `找投资窗口`；遇到外部数据含该值时，直接归一化为 `深度跟踪`。
**最后更新时间**：记录项目在 Watching List 中最近一次重要内容变更的操作日期，统一使用 Asia/Shanghai 当天日期。旧字段名 `最近跟进时间` 已于 2026-07-12 原地重命名，后续不得再使用旧字段名。

## 领域 → 子领域 映射

详见 [references/taxonomy.md](references/taxonomy.md)。

- `1.0 项目Watching List` 的「领域／子领域」选项名是运行时 canonical 词表。
- `taxonomy.md` 维护 canonical 名称的父子关系和别名；两者必须一致。
- 《1.2 行业信息追踪》只镜像项目表的 canonical 选项名。两张 Base 的 option ID 不要求相同。
- 新闻可跨多个领域，因此新闻表「领域」保持 MultiSelect；项目表「领域」保持 SingleSelect。
- 新子领域或两表词表漂移时，完整读取并执行 [references/taxonomy-sync.md](references/taxonomy-sync.md)。

## 功能

### 1. 分类概览

获取全部记录，统计领域/子领域分布和缺失率：

```bash
lark-cli api POST "/open-apis/bitable/v1/apps/${PROJECT_BASE_TOKEN}/tables/${PROJECT_TABLE_ID}/records/search" \
  --data '{"field_names":["公司名称","领域","子领域"]}' \
  --page-all --page-size 500
```

注意：`--page-all` 输出会在 JSON 前插入 `[page N] fetching...` 行，需用 `grep -v '^\[page'` 过滤后再解析。

输出：总数 / 有子领域数 / 缺失数 / 按领域分组覆盖率 / 子领域 TOP 20。

### 2. 搜索项目

**⚠️ 搜索字段名必须用 `公司名称`（不是"项目"）**，否则 API 返回空但不报错。

```bash
# 按公司名搜索项目
lark-cli api POST "/open-apis/bitable/v1/apps/${PROJECT_BASE_TOKEN}/tables/${PROJECT_TABLE_ID}/records/search" \
  --data '{"filter":{"conjunction":"and","conditions":[{"field_name":"公司名称","operator":"contains","value":["关键词"]}]},"page_size":20}'
```

公司名称字段返回格式为 `[{"text":"xxx","type":"text"}]`（富文本），提取文本时需遍历数组拼接 `.text`。

### 3. 修改项目分类

先搜索定位 record_id，再批量更新：

```bash
# 批量更新（最多500条/批）
TODAY_MS="$(($(date +%s) * 1000))"
lark-cli api POST "/open-apis/bitable/v1/apps/${PROJECT_BASE_TOKEN}/tables/${PROJECT_TABLE_ID}/records/batch_update" \
  --data "{\"records\":[{\"record_id\":\"recXXX\",\"fields\":{\"子领域\":[\"选项名\"],\"最后更新时间\":${TODAY_MS}}}]}" \
  --as user
```

子领域值必须是 [references/taxonomy.md](references/taxonomy.md) 中的合法选项名。

### 4. 补填子领域

对缺失子领域的项目，按优先级尝试三种匹配：

**Step 1 — Wiki 搜索匹配**（最可靠，Wiki 文件夹位置是权威来源）

```bash
lark-cli api POST "/open-apis/wiki/v1/nodes/search" \
  --data "{\"query\":\"公司名\",\"space_id\":\"${WIKI_SPACE_ID}\"}" \
  --params '{"page_size":5}' --as user

lark-cli api GET "/open-apis/wiki/v2/spaces/get_node" \
  --params '{"token":"NODE_TOKEN"}' --as user
```

向上遍历 parent_node_token（最多5层），用 folder→子领域 映射表（见 [references/folder_map.md](references/folder_map.md)）确定子领域。

**Step 2 — 关键词规则匹配**

根据领域 + Notes + 公司名称中的关键词推断。规则见 [references/keyword_rules.md](references/keyword_rules.md)。

**Step 3 — 人工确认**

无法自动分类的项目列表呈现给用户（表格形式，含公司名、Notes摘要），由用户指定子领域后批量更新。

### 5. 三系统一致性管理

飞书模式的三个系统分类必须保持一致：
- **Watching List**（飞书 Bitable）：领域 + 子领域字段
- **Wiki 知识库**（飞书 Wiki）：文档所在的行业文件夹层级
- **本地资料库**：`3.项目库/领域/子领域/项目文件` 三层目录结构

**权威性排序**：Wiki > Watching List > 本地资料库（Wiki 分类为主）

本地模式不使用上述权威性排序，改为：SQLite 结构化记录 > Markdown frontmatter > 文件夹路径。写入统一走 `domi-repo.cjs`，由网关同步维护三层；禁止绕过 SQLite 仅创建文件夹或仅写 Markdown。

**本地资料库路径**：使用 `$LOCAL_LIBRARY_DIR`，目录可以位于本机磁盘、iCloud Drive、OneDrive、Dropbox 或已挂载团队盘；不得在 Skill 中固定用户名、同步服务商或目录结构。

**本地资料库项目匹配规则**（严禁仅凭名称猜测分类）：

1. **优先匹配 WL 记录**：提取文件/文件夹中的公司名，搜索 WL（用 `公司名称` 字段），以 WL 的领域/子领域为准
2. **次选 Wiki 搜索**：WL 无匹配时搜索 Wiki 知识库，根据文档所在文件夹确定分类
3. **关键词规则**：仅在 WL 和 Wiki 都无匹配时使用，且仅对高置信度关键词（如"碳化硅"→半导体材料）
4. **兜底放入 `_未分类`**：无法确定的项目放入 `领域/_未分类/`，**绝不凭文件名猜测**

**公司名提取模式**：
- `NDA（...）- COMPANY revised.doc` → 提取 `COMPANY`
- `COMPANY BP.pdf` / `COMPANY 商业计划书.pdf` → 提取 `COMPANY`
- `20260422-COMPANY交流.pdf` → 提取 `COMPANY`
- `COMPANY路演slides.pdf` → 提取 `COMPANY`

#### 新项目闭环（强制）

当调用来自 domi 的 PLAUD `project` 工作流或项目 `intake`，且查重后确认是新项目时，先按后端执行对应闭环，不得把资料库归档降级成“后续项”。

**飞书模式**按以下顺序执行：

1. **先确定分类**：使用 taxonomy 选择领域和子领域；用 `folder_map.md` 确定 Wiki 与本地资料库的主子领域目录。多子领域只选一个主目录，Watching List 可保留多个子领域。
2. **Wiki 查重**：按中文名、英文名、产品名和主体名搜索。唯一项目文档则复用并更新；无匹配才创建；多匹配先让用户确认。
3. **创建或更新文档**：采用 `lark-doc` 与 `lark-wiki`，将结构化纪要／研究底稿和投资快评写入目标行业文件夹。更新既有文档时保留用户已有的独立章节、图片、附件与产品更新。
4. **归档本地资料库**：在 `<项目库>/<领域>/<主子领域>/<YYYYMMDD-公司名-主题-评级>/` 保存源材料、文字稿、纪要、快评和本次处理形成的其他项目文件；相同文件跳过，不同版本并存且名称可辨识。
5. **写后验证**：fetch 文档核心章节和评分；读取 Wiki 节点父链；列出项目目录文件并核验关键二进制文件大小或校验和。
6. **最后写 Watching List**：同一次 upsert 写入业务字段、Wiki URL 和最后更新时间；写后按公司名反查验证。

新项目缺少 Wiki URL 或本地资料库项目路径时，流程仍是未完成状态，不得写成 `managed`。已有项目的增量更新也应复用现有文档和目录，禁止重复创建近似名称的节点或文件夹。

**本地模式**按以下顺序执行：

1. 用 taxonomy 确定领域、多个子领域与唯一主子领域。
2. `project search` 按中英文名、产品名和主体名查重；多匹配时先让用户确认。
3. 把纪要、研究或快评整理为 Markdown 临时文件。
4. 用 `project upsert` 同一次写入 SQLite 并创建／更新 `项目主页.md` 与稳定项目目录。
5. 用 `document create` 把纪要／研究文档写入项目目录；原始二进制材料归档到 `原始材料/`，同文件跳过、不同版本并存。
6. 用 `project get` 与 `workspace verify` 回读，核验 SQLite、Markdown 与目录；三项均通过才返回 `managed`。

### 6. 创建或补填 Wiki 文档链接

WL 的「链接」字段应关联项目在 Wiki 知识库中的项目文档页面 URL。新增项目必须先按上节创建或更新 Wiki 文档并填入链接；批量检查历史记录时，对已有 Wiki 文档补链接，对确实缺文档的非“待交流”项目创建文档或报告为未完成，不能只把缺失留作后续项。

**查找未链接项目**：

```bash
# 1. 获取所有 WL 记录的 公司名称 和 链接
lark-cli api POST ".../records/search" \
  --data '{"field_names":["公司名称","链接"],"page_size":500}' \
  --page-all --as user | grep -v '^\[page'

# 2. 对链接为空的项目，逐个搜索 Wiki
lark-cli api POST "/open-apis/wiki/v1/nodes/search" \
  --data "{\"query\":\"公司名\",\"space_id\":\"${WIKI_SPACE_ID}\"}" \
  --params '{"page_size":5}' --as user
```

**选取正确文档**：若搜索返回多个文档，选取**顶层文档**（即父节点为行业文件夹的那个），其余文档通常是其子页面。通过 `get_node` 检查 `parent_node_token` 判断层级。

**⚠️ Wiki 搜索关键词处理（避免漏匹配与误匹配）**：

- **截断会漏匹配**：公司名含全角括号 `（）`、斜杠 `/`、空格时，直接拿前 N 字搜索会把噪声带进查询词，导致 Wiki 搜索返回无关结果。例：`心言集团（测测）` 取前6字得 `心言集团（测`，括号污染查询，漏掉文档。**正确做法**：在 `（()/\s&，,` 处切分，用干净的基础名（如 `心言集团`）搜索。
- **放宽匹配会误命中**：对短名/英文/人名项目过度放宽会大量误匹配。常见陷阱：
  - 命中通用词：`项目`、`Studio`、`AI`、`数据`、`Link`、`Mate`、`One` 等短 token
  - 命中**聚合型综述文档**：一篇文档提到几十个公司（如 `行业项目日志`、`AI产品系列分享`、`XX OnePager`、`投资团队科技内部版`），不是单一项目的交流纪要
  - 同名巧合：人名项目（如 `李超 项目`）命中另一个同名人的无关文档
- **匹配判定规则**：要求公司的**独特 token**（≥2字、非通用词）完整出现在文档标题中；排除聚合型综述文档；人名项目需结合领域上下文验证（如 AI 项目不应匹配「炒菜机器人」文档）。
- **批量补链接前必须人工复核**：模糊匹配结果先列给用户确认，不可盲目批量写入。

**写入链接**：链接字段写入 Wiki 页面 URL（纯文本字符串），不支持富文本 link 对象格式：

```bash
TODAY_MS="$(($(date +%s) * 1000))"
lark-cli api POST ".../records/batch_update" \
  --data "{\"records\":[{\"record_id\":\"recXXX\",\"fields\":{\"链接\":\"WIKI_NODE_URL\",\"最后更新时间\":${TODAY_MS}}}]}" \
  --as user
```

**注意**：链接字段是 Text 类型，直接传 URL 字符串即可。传富文本数组 `[{"type":"text","text":"...","link":"..."}]` 会导致 lark-cli 静默失败。

### 7. 业务管理逻辑（核心规则）

WL 是 deal flow 管道工具，各字段有明确语义和填写规则：

**进展状态管道层次**（反映与项目的接触深度）：

| 状态 | 含义 | 是否应有评级 | 是否应有交流文档链接 |
|------|------|------------|-------------------|
| 待交流 | 初步发现，尚未首次交流 | 否（没聊过无法判断） | 否（没建文档正常） |
| 已交流 | 一次性会面后无后续 | 是 | 应有 |
| 深度跟踪 | 持续关注、反复跟进，含明确想投并寻找入场机会 | 是 | 应有 |
| 已投 / Miss / 放弃 | 终态 | 是 | 应有 |

**派生规则（数据质量检查用）**：
- **进展状态为空 → 默认「待交流」**（一般是新录入未跟进）
- **外部或历史数据为「找投资窗口」→ 一律写成「深度跟踪」**，不得恢复旧选项
- **「待交流」项目无评级、无链接是正常的**（没聊过自然无法判断、无文档）
- **异常①：非「待交流」却无评级** → 需列出请用户确认（交流过应能打分）
- **异常②：非「待交流」却无链接** → 去 Wiki 查交流文档补链接（见功能6）；由 domi 新项目／项目交流工作流产生的记录必须创建文档并回填，其他历史记录可列出供用户决定补档或降级为「待交流」
- **评级口径**：S/A 为重点，B 为一般跟踪，C 偏负面。`跟踪观察`（旧值）按评级拆分：A→深度跟踪，B→已交流

**最后更新时间（重要）**：记录“该项目资料在系统中何时发生实质更新”，不是最近一次与项目方交流的日期。每次执行下列事件时，将字段覆盖为操作当天的 Asia/Shanghai 日期，并与业务字段放在同一个 create/update 请求中：

- 首次把项目新增或补录到 Watching List；
- 新增或实质补充公司、创始人、团队、产品、技术、客户、融资、收入、盈利、估值、竞争格局等核心信息；
- 创建项目飞书纪要、桌面研究、OnePager 等文档，或对项目文档作实质性更新，并新增/更新「链接」；
- 更新项目评级、进展状态、投资机构、领域/子领域等会改变投资判断或管道管理的字段；
- 新增交流纪要、BP、财务数据、客户验证或其他重要材料。

以下情况不刷新：纯排版、美化、错别字修正、链接格式修复、重复数据清理、无信息增量的机械迁移。若同一任务包含多次重要写入，只需写当天日期一次。历史补录也使用实际补录当天，不再从文档标题日期推导；文档标题日期只作为历史事件信息保留在文档或 Notes 中。

**投资机构标注**（红杉/高瓴/IDG 等）：必须读交流文档**正文内容**判断该机构是否**真实投资了本项目**，严禁"提及即标注"。常见误判：
- 文档里机构是**竞品/对标公司**的投资方（"a16z 和红杉投资了 Howie"）
- 机构是创始人/团队成员的**履历背景**（"曾任 IDG 资本合伙人"、"红杉招的第一个应届生"）
- 机构只是**在谈/看过/被 drop**（"高瓴聊过"、"被红杉 drop 了"、"不是红杉高瓴"）
- 投资方是 LP 语境（"有 LP 投给红杉"）

判定为投资的依据：融资/股东/轮次上下文中明确列为出资方（"天使轮：红杉…"、"IDG 独家投了 X 万"、"老股东红杉、IDG、高瓴 pro rata"、"高瓴 IC 过了"）。**批量写入前列证据给用户复核**。

### 8. 字段 schema 操作

PUT 更新字段可用于**重命名字段**、**增删选项**（已验证可用）：

```bash
# 重命名字段（如 时间→最后更新时间）：先按字段名解析 FIELD_ID，再保留 type 和 property
lark-cli api PUT ".../fields/${FIELD_ID}" \
  --data '{"field_name":"最后更新时间","type":5,"property":{"date_formatter":"yyyy/MM/dd","auto_fill":false}}' --as user

# 增删/重命名 SingleSelect/MultiSelect 选项：PUT 传完整 options 列表（保留所有要留的选项的 id+name+color）
lark-cli api PUT ".../fields/${FIELD_ID}" \
  --data '{"field_name":"领域","type":3,"property":{"options":[{"name":"AI","id":"optMDWs3MO","color":0}, ...]}}' --as user
# 删选项=从列表中移除该项；加选项=列表中加 {"name":"新选项","color":N}（不带id）
# 重命名选项=保留该选项的 id，只改 name（如 NAS→NAS／私有云）——引用该选项的所有记录会自动跟随更新，无需逐条改
```

**注意事项**：
- **取选项必须用 fields 列表端点**：`GET .../fields`（遍历找目标字段），单字段端点 `GET .../fields/{id}` 会返回 404
- PUT body **必须含 `type`**，否则静默失败
- **重命名选项首选"保留 id 改 name"**：引用自动跟随，最安全。仅当要彻底移除某选项时才删（删前确认无记录引用，查引用用 search filter `领域 is 选项名`）
- **删/改一个选项必须传全量 options**：漏掉的选项会被删除，已有记录引用会丢失
- 重命名跨三系统的行业（一级 领域 或 二级 子领域）流程：① WL 选项原地改 name（引用自动跟随）；② Wiki 对应节点标题 `wiki/v2/spaces/{space}/nodes/{node}/update_title`；③ 本地资料库两处文件夹 `3.项目库/`（项目库）和 `1.行业研究/`（研究库）；④ 更新 skill 的 taxonomy/folder_map/keyword_rules
- **本地资料库文件夹名含斜杠用全角「／」(U+FF0F)**：半角 `/` 是路径分隔符无法做文件夹名。三系统字符串须完全一致（skill 匹配需要），故 WL 选项名 / Wiki 节点 / 文件夹统一用全角「／」
- 连续 PUT 间 `sleep 3-5` 避免限流
- 修改前备份：`lark-cli api GET .../records --page-all > /tmp/backup.json`
- lark-cli `--page-all` 输出混有 `[page N]` 前缀行，管道处理先 `grep -v '^\[page'`
- 批量更新最多 500 条/批

#### 8.1 新闻与项目分类同步

当 `investment-radar` 返回任一 `taxonomy_request`（新子领域、镜像缺失或孤立选项），或直接发现项目表与新闻表选项不一致时，采用 `taxonomy-sync` 模式，完整遵循 [references/taxonomy-sync.md](references/taxonomy-sync.md)：

1. 只允许自动新增二级「子领域」；一级「领域」缺失时停止并请求用户确认。
2. 先做别名归一和组合表达判断；能由现有子领域或多个 MultiSelect 表达时不得新建。
3. 真新子领域先写项目表，再镜像新闻表；两侧回读一致后，Radar 才能写使用该分类的新闻。
4. 字段更新必须保留全部既有选项；每次 PUT 前重读并比较选项指纹，防止覆盖并发修改。
5. 只修正新闻分类时保留原 `事件ID`，仅更新「领域／子领域」，状态记为 `classification_updated`。
6. schema 同步不得创建、更新或评级 Watching List 项目记录，也不得刷新任何项目的「最后更新时间」。

### 9. 新增项目记录

**⚠️ lark-cli 的 `api POST .../records` 和 `.../records/batch_create` 创建记录会静默失败（rc=1，无输出）**。必须用专用命令 `base +record-upsert`：

```bash
TODAY_MS="$(($(date +%s) * 1000))"
lark-cli base +record-upsert \
  --base-token "$PROJECT_BASE_TOKEN" --table-id "$PROJECT_TABLE_ID" \
  --json "{\"公司名称\":\"公司名\",\"领域\":\"AI\",\"子领域\":[\"AI数据\"],\"进展状态\":\"已交流\",\"链接\":\"https://...\",\"最后更新时间\":${TODAY_MS},\"项目评级\":\"B\"}" \
  --as user
```

- **文本字段（公司名称/链接）用纯字符串**，不是富文本数组 `[{"type":"text",...}]`（upsert 会报 "Cell value does not match any supported shape"）
- SingleSelect 用字符串，MultiSelect 用字符串数组，DateTime 用毫秒时间戳
- 来自 domi `project`／`intake` 的新项目，`链接`为必填且必须经过 Wiki 父节点验证；同时必须已有写后验证的本地资料库项目目录。缺任一项时停止创建记录并恢复归档阶段。
- 无 `--record-id` = 创建；带 `--record-id` = 更新
- 返回 `{"ok":true,"data":{"created":true}}` 表示成功
- 删记录：`base +record-delete --record-id recXXX`

### 10. 反向一致性检查（Wiki → WL 查漏）

找出"Wiki 有交流文档、但 WL 中没有"的项目（防止交流过的项目漏入管道）：

**Step 1 — 遍历 Wiki 行业文件夹树**

```bash
# 列子节点（分页，递归遍历各行业顶层节点的子树，最多5层）
lark-cli api GET "/open-apis/wiki/v2/spaces/${WIKI_SPACE_ID}/nodes" \
  --params '{"parent_node_token":"NODE","page_size":50}' --as user
```

逐个行业顶层节点（AI行业/半导体行业/EV行业…）递归收集所有节点标题。

**Step 2 — 识别项目交流文档并提取公司名**

- 项目文档特征：标题以日期前缀 `YYYYMMDD-公司名-赛道-阶段` 开头，或带 `【S/A/B/C】` 前缀
- 排除**子行业文件夹**（名含"行业/主题/基础层/应用层/项目集"等）和**非项目文档**（访谈/专家/想法/精修稿/Cheat Sheet/OnePager/日报/综述）
- 公司名 = 去掉日期前缀后、第一个 `-` 之前的段

**Step 3 — 与 WL 比对 + 必须 API 复核**

- 提取的公司名去 WL 比对（归一化：去空格/括号内容/标点后做包含匹配）
- **找到的"缺失"项必须逐个用 `公司名称 contains` 直接搜 WL 复核**，排除因名称变体导致的假缺失（如 `千帜科技/UNICUS` 实为 WL 的 `千帜科技/方仔`）
- 早年（2021-2023）系统扫行业留下的研究文档大量不在 WL 属正常，按行业/年份分层呈现，**聚焦近 1-2 年**

**Step 4 — 批量补录**（见功能9）：领域/子领域（按文档赛道，见 folder_map）、进展状态=已交流、链接=Wiki URL、最后更新时间=实际补录当天、项目评级=标题后缀。标题日期只作为历史交流日期保留，不写入「最后更新时间」。**补录清单先列给用户逐项确认**。
