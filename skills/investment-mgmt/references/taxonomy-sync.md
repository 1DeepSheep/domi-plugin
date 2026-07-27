# 新闻与项目分类同步

用于把《1.2 行业信息追踪》的「领域／子领域」与 `1.0 项目Watching List` 及 `investment-mgmt` 分类体系保持一致。该流程只维护分类 schema，不创建或修改项目记录。

## 目录

- [用户配置目标](#用户配置目标)
- [分类状态机](#分类状态机)
- [真新子领域门槛](#真新子领域门槛)
- [逻辑事务](#逻辑事务)
- [既有记录修正](#既有记录修正)
- [回执](#回执)

## 用户配置目标

Base、Table 和字段 ID 都属于用户运行配置，不得写入插件。运行前从 `$DOMI_CONFIG_PATH` 读取 `projectBaseToken / projectTableId / radarBaseToken / radarTableId`，再通过 `field-list` 按字段名动态解析「领域」和「子领域」字段 ID。配置缺失时停止并提示用户到 domi“设置 → 资料连接”补充。

项目表的选项名是运行时 canonical 词表；[taxonomy.md](taxonomy.md) 维护父子关系和别名；新闻表以项目表为镜像。跨 Base 的 option ID 不相同，只比较规范化名称和显示颜色。历史记录仍引用的 orphan 是临时安全例外：保留到迁移完成，但禁止新记录继续使用。

持久化映射必须写入 domi 插件的 canonical local source。先用 `codex plugin list --json` 定位 `domi@personal` 的 `.source.path`，不要假设任何固定用户名或绝对路径。严禁直接编辑 `~/.codex/plugins/cache/...` 的安装缓存。

## 分类状态机

1. exact 或 alias 命中 canonical：返回 `reused`。
2. 可由多个现有子领域表达：使用 MultiSelect 组合，返回 `reused`；不得创建交叉词。
3. 项目表已有、新闻表缺失：只修复新闻镜像，返回 `mirror_repaired`。
4. 新闻表存在、项目表不存在：标为 `orphan`；停止使用并检查引用，不得反向提升为 canonical。零引用时可把新闻字段恢复为项目表镜像并返回 `mirror_repaired`；仍有引用时保留现场并返回 `orphan`，列出人工迁移项。
5. 真新子领域且通过全部门槛：执行下述逻辑事务，返回 `created`。
6. 不通过或归属不唯一：返回 `deferred`；使用最接近的既有分类，或只写一级领域。

每个请求必须携带 `target_field: domain|subdomain` 和对应新闻字段 ID。`new_subdomain` 只允许 `target_field=subdomain`；`target_field=domain` 只允许 `mirror_missing` 或 `orphan`，一级领域永不自动创建。

## 真新子领域门槛

必须全部满足：

- 唯一归属于一个现有一级领域；一级领域永不自动创建。
- 与 canonical 名称、标准化键和别名均不重复。
- 不能由现有一个或多个子领域充分表达，也不是现有子领域的单一功能或过细技术特征。
- 是稳定、可用于项目分类的价值链或市场段，不是公司、产品、模型版本、融资轮次、事件动作或短期热点。
- 至少覆盖两个相互独立的商业主体，且有两个独立可靠来源采用该类目；或者有监管／标准组织正式定义。
- 名称供应商中立、粒度与同级相当、全局唯一；含斜杠时使用全角 `／`。
- 单次 Radar 扫描最多自动创建两个子领域；超过的候选全部 `deferred`。

比较名称时统一 Unicode、大小写、首尾空格、连续空格、`&／和` 与 `/／`；显示名优先使用行业通用中文，成熟缩写可保留。

## 逻辑事务

### 1. Prepare

1. 生成 `change_id = tax_v1_<SHA-256(target_field|parent_or_empty|canonical) 前20位>`。
2. 使用 user 身份完整读取两张表的「领域／子领域」字段和所有 options；`field-list` 有 `remaining_options_count` 时，继续用 `field-search-options --limit 200` 获取完整选项。
3. 按 `target_field` 保存对应两侧字段的完整定义和 options 指纹，并按 `kind` 验证预期：`new_subdomain` 必须在两侧及别名中均不存在；`mirror_missing` 必须只存在于项目表；`orphan` 必须只存在于新闻表。项目领域字段保持 SingleSelect，新闻领域字段保持 MultiSelect；镜像只同步 option 名称和颜色，不改变各自字段类型。
4. 在任何新闻字段 PUT 前，针对该 `target_field` 枚举全部 `news options - project options`，逐项查询同一新闻字段的记录引用，生成带 `target_field / field_id / option / referenced_record_ids` 的 `retained_orphans` 与 `removable_orphans`。引用查询不完整或结果不确定时禁止执行该字段 PUT，并返回 `sync_failed`；不得假定“未查到”等于零引用。
5. 从 `codex plugin list --json` 解析 `domi@personal` 的 local source；`new_subdomain` 还要保存将修改的 source 文件与 `.codex-plugin/plugin.json` 快照，无法解析可写 local source 时须在任何 schema 写入前返回 `sync_failed`。纯 `mirror_missing`／`orphan` 修复不改 source，可继续执行。
6. 验证 source 中 `taxonomy.md` 的父子关系与项目表一致。发现漂移先修复，不叠加新分类。
7. 字段更新是全量 PUT；新闻字段 payload 必须是“同一 `target_field` 的项目表完整 canonical options + 该字段 `retained_orphans` 原定义”，只排除该字段 `removable_orphans`，并保留新闻字段自身的 multiple/type。任何时候都不得只提交新选项片段。

### 2. Apply

严格按 `kind` 分支并串行执行：

1. 共用写前闸门：紧邻每次新闻字段 PUT 前，再查询该 `target_field` 全部 `removable_orphans` 的引用并重读两侧 options 指纹；出现新引用或漂移立即中止并从 Prepare 重算。任何分支都不得跳过此闸门。
2. `new_subdomain`：在项目表「子领域」完整 options 末尾增加 canonical 名称，保留全部旧选项及颜色并回读；随后执行共用写前闸门，再用“更新后的项目完整 options + retained_orphans”更新新闻表并回读。
3. `mirror_missing`：项目表保持不变；执行共用写前闸门后，仅用“项目完整 options + retained_orphans”更新新闻表并回读，不重复追加项目选项。
4. `orphan`：执行共用写前闸门；零引用项从新闻 payload 排除，有引用项以原 name／颜色保留、返回 `orphan` 并列明待迁移记录。不得为了修复另一个选项而顺带删除被引用 orphan。
5. 只有 `new_subdomain` 才使用 `apply_patch` 更新 canonical plugin source 内的 `taxonomy.md`；有明确 Wiki 文件夹或高置信关键词时再更新 `folder_map.md`、`keyword_rules.md`。不得修改安装缓存。
6. source 有变化时，更新 `.codex-plugin/plugin.json` 版本构建号，运行 skill validator 与 JSON 校验，再执行 `codex plugin add domi@personal --json` 刷新安装；用 `codex plugin list --json` 和文件对比确认新缓存来自该 source 且映射已生效。纯镜像修复不得无意义改版本。
7. 刷新对应两张表字段并确认：旧 canonical 选项未丢失、目标名称数量符合分支预期、子领域父级唯一、两侧 canonical 名称和颜色一致；`retained_orphans` 仍存在且定义未变，并作为已知例外列入回执。全部通过后，Radar 才能写使用该分类的新闻记录。

新闻发现的新子领域只要求完成词表和映射同步；首次有项目使用该子领域时，再由 `investment-mgmt` 创建或复用 Wiki 与本地资料库对应目录，避免制造无人使用的空目录。

### 3. 并发与失败

- 每次字段 PUT 前重新读取并比较 options 指纹；有漂移则中止、重算，不覆盖他人修改。
- 超时或结果未知时先回读，不盲目重放。
- 项目表更新失败：零变更，返回 `sync_failed`。
- 新闻表、canonical source、校验或插件刷新失败：仅当当前指纹仍等于本事务预期、候选没有记录引用时，才按相反顺序恢复 source 文件与完整字段快照，并按恢复后的版本重新刷新插件。
- 安全回滚成功：`rolled_back`；无法安全回滚：`partial`，列出已改变侧和人工修复项，并停止后续 taxonomy schema 写入。
- 回滚前必须确认本次新增选项无人引用；禁止为回滚删除已经被使用的分类。

## 既有记录修正

- 同一事件只修正分类时保留 `事件ID`，仅更新「领域／子领域」，状态为 `classification_updated`。
- 分类修正不改变新闻事实、评分或来源，也不创建新行。
- 不自动批量回填历史项目或新闻；只修正本次命中的记录。全量历史迁移必须作为独立维护任务执行。
- schema 同步不刷新任何 Watching List 记录的「最后更新时间」。

## 回执

除 Radar 的 `created / updated / unchanged / skipped / failed` 外，返回：

```yaml
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
