# 行业新闻雷达工作流

## 触发与优先级

用户要求查看某个行业、赛道、主题或技术方向的“最新新闻／近期动态／融资消息／公司或机构动作”时，优先进入本流程。即使句子包含“查一下／研究一下”，只要核心对象是一个领域且明确强调最新消息，也优先于项目桌面研究。

以下情况不进入本流程：

- 核心对象是单一公司或项目，且用户要求完整画像、竞争格局或投资判断：走 `desk-research`。
- 用户明确要求把某个项目加入项目库：走项目 intake。
- 用户只要求解释已经收录的一条事件：采用 `investment-radar` 的 `explain` 模式，不重新扫描。

## 默认输入

从用户消息提取：

```yaml
topic_raw: 用户原始领域表达
time_window: 用户指定；默认最近 7 天，优先最近 72 小时
region: 用户指定；默认全球
languages: 用户指定；默认中文和英文
event_types: 用户指定；默认项目融资、行业趋势、公司动态、投资机构动态
```

如领域表达足以执行，直接采用默认值，不为时间窗、地域或语言单独打断用户。领域完全无法识别时才请求澄清。

## 阶段

### 1. 采用 Radar

完整读取并采用插件内 `investment-radar` Skill，以及该 Skill 为当前模式要求读取的 references。把上述结构化范围交给其 `scan` 模式。

本机存在用户信源注册表时，同时读取 `investment-radar/references/source-registry.md`，让已启用的新闻／RSS／重点公众号／播客源与通用检索并行发现候选。信源读取失败与其他检索隔离；公众号和播客元数据不替代原文核验。播客 quick scan 默认只发现元数据，下载、PLAUD 转写和纪要进入独立后台队列，不占用本轮 Radar 完成时间。

Radar 先以项目表 canonical taxonomy 为准完成分类归一。若发现真正的新行业分类、项目表已有但新闻表缺失的镜像项、或新闻表孤立项，返回带 `target_field: domain|subdomain` 的 `taxonomy_requests`；受影响事件暂记为 `pending_taxonomy`，不写未知或漂移选项。`new_subdomain` 固定指向 subdomain；domain 只允许镜像修复或 orphan 处理，不得自动新建。

完成标准：无待处理 taxonomy request 时，Radar 返回符合其输出契约的完整结果包，且每个 accepted event 都有明确的 `write_status`；有 request 时，先完成下一阶段。

### 2. 分类同步（按需）

只要 `taxonomy_requests` 中存在 `pending` 项就进入；不得只以“是否发现新子领域”为条件，从而漏掉纯镜像漂移：

1. Router 采用插件内 `investment-mgmt` 的 `taxonomy-sync` 模式，并完整读取其 `taxonomy.md` 与 `taxonomy-sync.md`。
2. `investment-mgmt` 先做别名、组合表达、父领域和稳定性校验；只自动新增通过全部门槛的子领域，一级领域不得自动新增。
3. 按 `target_field` 独立计算差集和引用，再按 `kind` 分支：`new_subdomain` 才新增项目子领域、更新 canonical source 并刷新插件；`mirror_missing` 只补同一新闻字段镜像；`orphan` 只清同字段零引用项，有引用则保留并报告迁移项。任何新闻字段 PUT 都必须保留同字段其他被引用 orphan，并在 PUT 紧前重查引用。完成回读后，把含字段定位及 `changes / errors / changed_side / manual_repair / retained_orphans` 的 `taxonomy_sync` 回执交还 Radar。
4. Radar 刷新字段并恢复事件写入。同步失败时使用较宽的既有分类或只写一级领域，并明确报告；不得写 raw 未知选项。最终包必须消解所有 `pending` 和 `pending_taxonomy`；没有安全降级分类的事件记为 `failed`。

Router 不自行修改本地 SQLite schema，只负责交接和恢复。

### 3. 归档

Radar 把全部通过采纳门槛的事件写入本地行业事件库，而不是只写最终推荐项。Router 不直接操作 SQLite，也不在 Radar 之外再次创建记录。

如果检索完成但本地事件库不可访问、schema 不一致或写后无法验证，保留研究结果并标为“搜索完成、归档未完成”；不得声称已经写入，也不得改写飞书作为替代。

### 4. 回传

Router 只把 `noteworthy_events` 作为主结果返回，默认最多 8 条，并按重要性、可信度和发布时间排序。每条必须包括：

- 事件级标题与发布时间。
- 核心事实和投资含义。
- 重要性／可信度与简短评分理由。
- 建议动作和原文链接。

重要性很高但可信度不足的事件继续归档供后续核验，默认不回传；不得混入已确认的值得关注项。

最后报告扫描范围、taxonomy 的 `reused / created / deferred / partial / classification_updated`、覆盖缺口及本地 `created / updated / classification_updated / unchanged / skipped / failed` 数量。`partial` 必须列明原因和人工修复项。没有达到阈值时直说，不为凑数返回低价值信息；已采纳的低分事件仍按 Radar 契约归档。

用户信源参与时追加聚合覆盖回执；播客只有在需要用户授权、PLAUD 恢复、主归档歧义或失败时才显示单集任务。正常后台处理不展开临时下载路径、PLAUD `fileId`、真实信源清单或内部关键词。

## 失败与恢复

- 搜索源受限：继续使用可访问的一手与可靠来源，在最终结果列出会影响判断的覆盖缺口。
- 单条事件核验失败：跳过写入并保留在 `skipped`，不要把搜索摘要当原文。
- 写入超时：由 Radar 先按事件 ID 回查再决定是否重试；Router 不重放写请求。
- 事件 ID 命中多条：停止该事件写入并报告数据重复，其他事件可继续。
- Taxonomy 同步失败：保留可安全使用的既有分类；出现 `partial` 时停止后续 schema 写入并报告两表差异，不得盲目重试全量字段 PUT。
- 同一请求重试：复用原扫描批次和事件 ID，不生成重复记录。

## 后续交接

- “研究第 N 条／深入研究这家公司”：把对应事件、实体指纹、Claim、来源链、冲突和待验证项交给 `desk-research`，保持只读。
- “研究并入库／加入项目库”：在研究完成后进入项目 intake，并按其去重、文档归档和明确写入授权执行。
- “继续关注”：保留在 Radar 事件库，不自动创建或修改项目。
