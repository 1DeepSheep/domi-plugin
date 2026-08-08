# Radar 输出与交接契约

每次扫描向 Router 返回一个完整结果包：

```yaml
scan_id: radar_YYYYMMDDTHHMMSS+0800_topic
scope:
  topic_raw: 用户原词
  topic_canonical: 标准领域或子领域
  time_window: 起止时间
  discovery_from: quick_scan 重叠发现窗口起点
  checked_after: 上次成功检查水位；无则为空
  checked_through: 本轮检查截止
  region: 全球或用户指定
  languages: [中文, 英文]
coverage:
  queries: 已执行的查询类别
  sources_opened: 已打开原文数量
  source_failures: 受限或失败来源
source_coverage:
  enabled: 用户启用的新闻／RSS／公众号／播客信源数
  checked: 本轮实际检查数
  succeeded: 成功数
  failed: 失败数
  items_discovered: 发现条目数
  items_deduplicated: URL／GUID 去重数
  candidates_forwarded: 进入 Radar 候选数
  failures: 只列错误码和需要用户处理的信源，不包含 Cookie、响应正文或私有配置
candidate_diagnostics:
  candidates: 0
  rejected:
    duplicate: 0
    not_event: 0
    unverified: 0
    unavailable: 0
    out_of_scope: 0
  rejection_details: []
priority_watch:
  project_source: local_snapshot|live_refresh
  project_snapshot_generated_at: ISO 8601 时间
  project_snapshot_stale: false
  project_filter: 项目评级 in [A,S] AND 进展状态 = 深度跟踪
  people_filter: 运行时人脉 schema 中评级 A 及以上；关系进展只作消歧，不作为准入条件
  projects_loaded: 0
  people_loaded: 0
  projects_in_scope: 0
  people_in_scope: 0
  coverage_gaps: []
taxonomy_requests:
  - raw: 新闻或用户原词
    canonical: 建议 canonical 名称
    target_field: domain|subdomain
    target_field_id: 对应新闻字段 ID
    parent: 子领域的唯一一级领域；target_field=domain 时为 null
    kind: new_subdomain|mirror_missing|orphan
    event_ids: 受该分类请求阻塞的事件 ID 列表；无则为空
    evidence: 新子领域时为主体与来源；镜像漂移时为两侧字段差异与引用检查
    status: pending|reused|mirror_repaired|created|deferred|orphan|sync_failed|rolled_back|partial
    reason: 判断依据或失败说明
events:
  - event_id: evt_v1_xxx
    title: 事件级标题
    fields: 完整 Base 字段映射
    source_chain: 最上游来源与独立佐证
    score_reason: 重要性与可信度理由
    priority_matches:
      - entity_type: project|person
        entity_name: 规范名称
        source: priority-watchlist.md|local-people-index
        rating: A|S|人脉表中明确高于A的选项
        tracking_status: 项目为深度跟踪；人物保留关系进展原值
        match_type: direct|related
        matched_alias: 实际命中的名称或别名
        reason: 身份消歧与关联依据
        alert_level: 立即提醒|重点更新|仅归档
    write_status: pending_taxonomy|created|updated|classification_updated|unchanged|skipped|failed
    record_id: 成功写入时返回
podcast_jobs:
  - source_id: 本机信源 ID；没有播客候选时为空
    episode_id: provider GUID／公开单集 ID
    episode_url: 公开单集 URL
    status: metadata_only|waiting_for_authorization|downloading|waiting_for_plaud|transcribing|notes_ready|archived|failed
    transcript_provider: plaud
    canonical_document_id: 纪要生成后填写
    primary_archive: project_dominant|industry_dominant|ambiguous
    linked_project_ids: 仅保存规范项目关系；不复制主文档
    failure_code: 无则为空
priority_alerts:
  - event_id: evt_v1_xxx
    matched_entities: [规范项目或人物名]
    alert_level: 立即提醒|重点更新
    reason: 为什么影响当前投资判断或跟进动作
noteworthy_events: 满足关注阈值的事件 ID 列表
storage:
  target: configured_radar_base
  created: 0
  updated: 0
  classification_updated: 0
  unchanged: 0
  skipped: 0
  failed: 0
  verified: true|false
taxonomy_sync:
  reused: 0
  mirror_repaired: 0
  created: 0
  deferred: 0
  orphan: 0
  sync_failed: 0
  rolled_back: 0
  partial: 0
  classification_updated: 0
  retained_orphans:
    - target_field: domain|subdomain
      field_id: 新闻字段 ID
      option: 原始 option 完整定义
      referenced_record_ids: 仍引用该 option 的记录 ID
  changes:
    - change_id: tax_v1_xxx
      kind: new_subdomain|mirror_missing|orphan|classification_correction
      target_field: domain|subdomain
      target_field_id: 对应新闻字段 ID
      raw: 用户或新闻原词
      canonical: 规范名称
      parent: 子领域的一级领域；target_field=domain 时为 null
      event_ids: 受影响事件 ID 列表
      status: reused|mirror_repaired|created|deferred|orphan|sync_failed|rolled_back|partial|classification_updated
      reason: 判断依据或失败说明
      changed_side: none|project|news|local_source|multiple
      manual_repair: 无则为空；有则列出精确修复动作
  errors: []
```

`pending` 与 `pending_taxonomy` 只用于 Radar 首次交给 Router 的中间包。Router 完成同步或失败处理后，Radar 必须把请求改成最终状态并把事件改成实际写入状态；最终用户回执不得残留 pending。若没有可安全使用的降级分类，事件写入状态为 `failed`。

## 用户回传顺序

1. 扫描范围和时间窗，并说明重点项目快照／人脉实际加载数量。
2. “重点跟踪对象动态”：先返回全部 `priority_alerts`，不受一般最多 8 条限制；同一事件只展示一次，并列出命中的项目／人物关系。没有命中时明确说明。
3. “值得关注”：最多 8 条，按重要性、可信度和发布时间降序；已在重点对象动态展示的事件不重复。
4. 每条展示核心事实、投资含义、重要性／可信度、建议动作、发布时间和原文链接；重点对象动态额外展示对象评级、跟踪状态、匹配依据与提醒级别。
5. 分类结果：默认只展示复用、新增、延期、失败和部分完成数量；仅在失败、部分完成或用户明确要求时列出详细分类回执与人工修复项。
6. 归档结果：展示新增、更新、分类修正、无变化、跳过和失败数量；默认不展示 Base 链接、记录 ID 或逐条写入回执。
7. 覆盖缺口：项目快照过期、人脉未覆盖、字段缺失、受限来源或批次限制等会实质影响结论的缺口。

用户信源参与扫描时，在扫描范围后用聚合数字报告检查、成功、失败、发现与去重数量。真实信源清单、内部关键词和播客自动处理规则默认不展开。播客任务只在需要授权、PLAUD 恢复、归档歧义或失败时向用户展示；正常后台处理中不把下载路径、PLAUD `fileId` 或本机队列明细写进报告。

没有达到关注阈值的信息时，不强行推荐；说明通过采纳门槛的事件已经归档。没有合格事件时报告新增 0、更新 0，不创建“暂无新闻”记录。

## 下游边界

- 用户说“研究第 N 条”时，把该事件的实体指纹、Claim、来源链、冲突和待验证项交给 `desk-research`，仍保持只读。
- 用户说“研究并入库／加入项目库”时，交给现有项目 intake 工作流；不得由 Radar 直接 upsert 项目记录。
- 用户只说“继续关注”时，只保留在 Radar 事件库，不等于项目入库。
