# 行业事件资料库契约

执行前先读取 `../../investment-mgmt/references/storage-backends.md` 并解析 `backend`。

- `feishu`：本文件后续 Base 字段与 `lark-cli` 契约全部生效。
- `local`：同一业务字段写入本地 SQLite `news_events`，同时生成 `2.行业动态/<YYYY>/<MM>/<事件ID>.md`；使用插件根目录 `scripts/domi-repo.cjs news list/upsert`，不得要求 Base Token 或飞书授权。

本地模式用 `eventId` 去重：写前 `news get --id <事件ID>`；0 条创建，1 条仅在有实质增量时 upsert。写后再次 get，并验证回执中的 `recordVerified` 与 `documentVerified`。字段映射遵循本文件“字段”表的语义，命令 payload 见 `investment-mgmt/references/storage-backends.md`。taxonomy 以插件 `taxonomy.md` 为 canonical；本地模式不执行 Base option 镜像，只校验父子关系并把新子领域请求交给用户确认。

## 用户配置目标

真实飞书标识禁止写入插件。运行时从 `$DOMI_CONFIG_PATH` 读取：

```json
{
  "projectBaseToken": "员工项目库 Base Token",
  "projectTableId": "员工项目表 Table ID",
  "radarBaseToken": "员工行业动态 Base Token",
  "radarTableId": "员工新闻表 Table ID",
  "wikiSpaceId": "员工 Wiki Space ID"
}
```

豆米首次安装会在本机生成该配置。直接使用插件时默认路径为 `~/Library/Application Support/豆米/domi-plugin-config.json`。飞书模式正常 `scan` 必须复用用户配置目标；目标不可访问或结构不一致时停止写入，不得另建同名 Base，也不得改写项目 Watching List。

`references/priority-watchlist.md` 是 `priority_watch` 的默认项目来源，《1.1 People人际关系管理》是人脉侧只读来源。普通扫描不得为了建立项目名单重新读取 Watching List 项目记录，也不得因新闻命中而修改两表的评级、跟踪状态、最后更新时间、Notes、互动记录或其他字段。

## 字段

| 字段 | 类型 | 写入要求 |
|---|---|---|
| 新闻标题 | text | 必填；使用事件级标题，包含核心主体和动作 |
| 领域 | multi-select | 必填；名称必须来自项目表 canonical 领域词表；新闻可跨多个领域 |
| 子领域 | multi-select | 可选；必须符合 `investment-mgmt` 父子映射；未知项先走 taxonomy-sync |
| 信息类型 | multi-select | 必填 |
| 信息发布时间 | datetime | 必填；原始来源时间，格式 `YYYY-MM-DD HH:mm:ss` |
| 新闻核心内容 | text | 必填；1–3 句事实摘要，保留主体、动作、数字和限定 |
| 投资含义 | text | 值得关注事件必填；与事实分开 |
| 原文链接 | URL text | 必填；优先最上游或官方来源 |
| 来源名称 | text | 必填 |
| 涉及公司 | text | 使用归一化名称，多个用 `；` 分隔 |
| 涉及机构 | text | 使用归一化名称，多个用 `；` 分隔 |
| 重要性评分 | rating 1–10 | 必填 |
| 重要性等级 | select | 必填：`P0-立即关注` / `P1-重点关注` / `P2-日常跟踪` / `P3-仅归档` |
| 可信度 | rating 1–10 | 必填 |
| 证据状态 | select | 必填：`独立核实` / `公司／机构口径` / `可观察动作` / `二手报道` / `传闻／待核验` |
| 是否值得关注 | checkbox | 必填 |
| 建议动作 | select | 必填：`立即关注` / `继续跟踪` / `进入深研` / `加入候选池` / `仅归档` |
| 事件ID | text | 必填；跨批次业务键 |
| 扫描批次 | text | 必填；创建时记录首个批次，更新时可追加最近批次 |
| 收录时间 | created_at | 只读，不写 |
| 最后更新时间 | updated_at | 只读，不写 |

## 写入前检查

先从 `$DOMI_CONFIG_PATH` 读取项目库 Base/Table，再按字段名动态解析「领域」和「子领域」字段 ID，读取项目 Watching List 的 canonical 分类。真实 Base、Table 和字段 ID 均不得写回插件或任务产物。

用 `field-search-options --limit 200` 获取完整选项，并分别比较「领域」与「子领域」；每个请求必须带 `target_field: domain|subdomain`。新闻表允许「领域」为多选，但 canonical 选项名称与颜色必须和项目表一致；历史记录仍引用的 orphan 可作为临时例外保留，但禁止新记录使用。项目表已有而新闻表缺失时输出 `taxonomy_request(kind=mirror_missing)`；新闻表孤立选项输出 `taxonomy_request(kind=orphan)`。真正的新子领域输出 `taxonomy_request(kind=new_subdomain,target_field=subdomain)`；一级领域永不自动创建。所有受影响事件先标 `pending_taxonomy`，由 Router 交给 `investment-mgmt taxonomy-sync`；Radar 不得依靠写入未知 select 值让平台隐式创建选项。

始终显式使用 user 身份：

```bash
lark-cli base +field-list \
  --base-token "$RADAR_BASE_TOKEN" \
  --table-id "$RADAR_TABLE_ID" --as user
```

按事件 ID 精确查询：

```bash
lark-cli base +record-list \
  --base-token "$RADAR_BASE_TOKEN" \
  --table-id "$RADAR_TABLE_ID" \
  --filter-json '{"logic":"and","conditions":[["事件ID","==","evt_v1_xxx"]]}' \
  --field-id 事件ID --field-id 新闻标题 --field-id 信息发布时间 \
  --field-id 原文链接 --field-id 重要性评分 --limit 10 \
  --format json --as user
```

`base +record-upsert` 不会按业务键自动去重：不传 `--record-id` 一定创建，传入真实 `record_id` 才更新。

## 事件 ID

使用：

```text
evt_v1_<SHA-256 前 20 位>
```

哈希输入为规范化后的：

```text
核心实体集合｜信息类型｜不可变事件键
```

`不可变事件键` 表示事件本身的身份，不是新闻披露状态。创建后永不重算 `事件ID`；传闻转官宣、金额修正、投资方补充、来源增加和发布日期变化都更新原事件并保留旧 ID。公告日期、首次发现日期等可变时间不得进入哈希；财报期间、基金 vintage、产品版本等事件固有期间可以进入事件键。

事件键示例：

- 融资：公司｜规范化轮次或交易标识。金额、投资方和公告日期仅作辅助碰撞判断。
- 产品／技术：公司｜产品、技术或版本｜发布动作。
- 人事：公司／机构｜人员｜岗位｜加入／离职动作。
- 政策：发布机构｜文件编号或规范化政策主题｜动作。
- 合作／并购：排序后的核心各方｜交易或合作对象｜动作。
- 财务／趋势：核心主体或领域｜指标｜固有统计期间。
- 深度访谈／公开观点：人物或机构｜规范化核心论点簇｜公开观点披露。媒体名称、标题措辞和发布日期不得进入事件键；重复论点先做语义去重。

媒体名称、标题、URL、公告日期、领域标签、评分和扫描批次不得进入哈希输入。若稳定键仍可能对应多个事件，先按核心实体、信息类型、时间窗口和关键事实检索候选并做语义比对；无法唯一判断时跳过自动写入，不得靠加入发布日期临时生成新 ID。

## 创建与更新

创建：

```bash
lark-cli base +record-upsert \
  --base-token "$RADAR_BASE_TOKEN" \
  --table-id "$RADAR_TABLE_ID" \
  --json '<字段映射 JSON>' --as user
```

更新：

```bash
lark-cli base +record-upsert \
  --base-token "$RADAR_BASE_TOKEN" \
  --table-id "$RADAR_TABLE_ID" \
  --record-id <真实 record_id> \
  --json '<仅含发生变化的可写字段>' --as user
```

连续写入必须串行。出现超时或未知结果时，先重新查询事件 ID；不要直接重放创建请求。写后再次按事件 ID 回读并核验关键字段。
