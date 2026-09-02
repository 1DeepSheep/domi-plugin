---
name: investment-radar
description: 按需追踪并整理最新行业新闻、项目融资、行业趋势、公司与投资机构动态；维护新闻／RSS／重点公众号／播客信源，完成联网核验、实体归一、事件级去重、重要性与可信度评分，并写入当前行业事件库。
---

# Investment Radar

把公开信息整理为可追溯、可证伪的事件／产业论点，非转载或整期节目；每轮先匹配重点项目／人物，再返回一般新闻。

要附件时读[合同](../domi-router/references/artifact-delivery.md)。

## 后端与模式

客户端 `quick_scan` 的运行上下文会直接给出已校验的 `后端：local` 或 `后端：legacy_feishu_primary`；存在该事实时直接锁定，不再读取 `storage-backends.md`。其他调用先读取 `../investment-mgmt/references/storage-backends.md` 并锁定：

- `repositoryBackend=local`：写本地 SQLite + Markdown；飞书仅在用户明确列为本轮信源时窄范围只读。
- `repositoryBackend=legacy_feishu_primary`：完整读取 `../investment-mgmt/references/legacy-feishu-primary.md`；既有行业动态 Base 是唯一写入端，禁止调用本地 `news get/list/upsert`。

后端不可用只阻塞归档；不得静默切换、双写、创建第二事件库或修改项目／人脉库。

- `quick_scan`：客户端增量刷新。每次调度严格执行调用方 `followed_domains` 快照中的领域；不得自行增删领域，也不得因上一轮零新增而跳过到点轮次、降频或改变客户端周期。完整读取 [references/quick-scan.md](references/quick-scan.md)，不再加载其他 Radar reference、taxonomy-sync、sourcing、全量项目或人脉库。
- `scan`：标准 7 天扫描；完整读取 [references/base-schema.md](references/base-schema.md)、[references/priority-watchlist.md](references/priority-watchlist.md)、[references/research-and-scoring.md](references/research-and-scoring.md)、[references/output-contract.md](references/output-contract.md)、`../sourcing/SKILL.md`、taxonomy 与 taxonomy-sync。
- `brief/explain`：只读既有事件生成摘要或解释评分／去重，明确是否重新联网。
- `sources`：完整读取 [references/source-registry.md](references/source-registry.md) 后管理本机私有信源。
- `podcast`：完整读取 [references/source-registry.md](references/source-registry.md) 与 [references/podcast-ingestion.md](references/podcast-ingestion.md)；没有单次授权或 `autoProcess=true` 时只能保留公开元数据。
- `setup`：仅在用户明确要求初始化／修复时使用；本地主库不得创建飞书 Base，旧飞书只能修复已配置目标。

只加载当前模式列出的引用。完整规则在引用中，下面是所有模式共同的不可省略守卫。

## 标准扫描

### 1. 范围与监控集

默认全球、中英文、最近 7 天且优先 72 小时；无合格事件才可扩到 30 天并说明。覆盖融资、技术、商业、政策、并购、财务、人事、机构动态及启用信源。

项目侧读取 `priority-watchlist.md` 中 A/S 且“深度跟踪”快照；仅在明确同步、缺失或损坏时回源一次，过期只记缺口。人物侧一次读取 A 及以上对象；关系进展仅作消歧，明确排除才剔除。缺字段记缺口，不得把全库当重点。

指定领域处理范围内对象，全局扫描覆盖全部；列出批次未覆盖项。公司、品牌、产品、法人及人物须实体消歧；竞品／泛行业关联不是直接命中。

### 2. 联网发现与证据

最新信息必须联网；宽搜、重点对象定向搜、启用信源并行。优先监管、官方、论文、原始产品页，再用独立媒体验证。必须打开原文；搜索／RSS／公众号摘要、数据库、播客标题只能发现候选。

每个候选记录实体、Claim、数字、上游及独立来源、冲突、证据状态、投资含义和待验证项。事实与判断分开并明确归因。转载、泛泛观点、无增量或无法核验者不写。

访谈／公开观点仅在身份、原文、语境可核验且含具体可证伪产业判断时采纳；节目发布本身不是事件。

### 3. 归一、去重、评分与写入

分类先按 taxonomy exact／alias，再组合现有子领域。一级领域不得自动创建；新子领域输出 `taxonomy_request(kind=new_subdomain)` 交 Router，分类完成前不写。Radar 不改 schema。

按“核心实体 + 类型 + 不可变语义”生成稳定 `evt_v1_` ID；媒体、URL、标题、日期、金额、投资方、评分、批次不得入键。转载合并，实质增量更新原事件；歧义时跳过。

重要性、可信度分开评分；冲突未解时可信度最高 5。合格事件均归档；默认回传阈值 `重要性>=7 且可信度>=6`，低可信标“传闻／待核验”。

写前一次加载窗口索引；同一 ID：0 条创建、1 条有增量才更新、多条停止。未知结果先回查，不重放；写后批量验证。不可写时报告“搜索完成、归档未完成”。

## 重点提醒与结果

项目／人物 `direct` 命中且为实质事件、可信度 >= 6 时进入重点提醒，不受一般重要性阈值和最多 8 条限制；同一事件命中两类关系时合并。重点提醒列出对象、来源、评级／状态、事实、影响、建议动作、可信度、时间和原文。无命中时明确说明，并报告项目／人物加载数与覆盖缺口。

一般值得关注项最多 8 条，按重要性、可信度、发布时间排序，不与重点提醒重复。最后汇总范围、用户信源覆盖、分类、`created/updated/unchanged/skipped/failed` 和实质缺口；无合格事件也是正常完成，不创建“暂无新闻”。完整结构遵循 output-contract。

关键依赖局部失败时局部降级：单领域／单源／单条写入失败不阻塞其他项；记录未覆盖与拒绝原因。不得为补偿失败扩大到无界扫描、切换后端或声称“全网无遗漏”。

## 数据、授权与隐私边界

- 不新增、评级或修改项目／人物，不更新其状态、Notes、最后时间或关系进展；雷达新公司仅是候选，用户明确要求后才交给研究／intake。
- 新闻提到机构不等于真实投资；不得据此修改项目投资机构字段。
- 用户信源配置只在本机 Application Support，权限 `0600`；真实清单、关键词、水位、响应正文、Cookie、token、路径和内部 ID 不得写入插件、Git、事件正文或公开诊断。不得读取日常浏览器 Profile、绕过登录／付费墙或 robots。
- 播客只处理免费公开直链；禁止私有 API、Cookie、HLS／DASH 抓流、DRM 绕过。未经授权不得下载或上传；获准音频必须经用户自己的 PLAUD，PLAUD 不可用时暂停，禁止回退本地 ASR 或其他云转写。
- 不长期保存或大段复制受版权保护正文；只存结构化事实、短摘要和原始链接。音频、完整文字稿与纪要只进用户私有队列／资料库。
- 不提供个性化买卖建议，只整理事实、机制、风险和待验证项。

完成条件：范围明确；监控集已加载或缺口已记录；原文已核验；实体、分类、事件 ID、去重、评分完成；每个候选有写入或拒绝状态；成功项已回读；先重点提醒再一般信息和归档结果。失败或部分完成必须如实标记。
