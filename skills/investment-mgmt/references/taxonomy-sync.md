# 本地项目与行业分类同步

用于让本地 SQLite 的项目与行业事件共享 `taxonomy.md` 的 canonical 领域／子领域。该流程只维护本地分类 schema 与记录分类，不创建或修改飞书 Base、Wiki 或 Doc。

## 分类状态机

1. exact 或 alias 命中 canonical：`reused`。
2. 可由多个现有子领域表达：使用多选组合，`reused`；不得创建交叉词。
3. 本地 SQLite 缺少插件已有 canonical 项：通过受控本地 migration 补齐，`local_schema_repaired`。
4. 旧飞书或历史目录出现本地不存在的 option：标为 `legacy_orphan`，只在导入回执保留；不得反向提升为 canonical。
5. 真新子领域且通过全部门槛：生成变更计划并进入分类审核台，用户确认后更新 `taxonomy.md` 与本地 schema，`created`。
6. 不通过或归属不唯一：`deferred`；使用最接近既有分类，或只写一级领域。

## 真新子领域门槛

必须全部满足：

- 唯一归属于一个现有一级领域；一级领域永不由自动扫描创建。
- 与 canonical 名称、标准化键和别名均不重复。
- 不能由现有一个或多个子领域充分表达，也不是单一功能或过细技术特征。
- 是稳定、供应商中立、可用于项目分类的价值链或市场段，不是公司、产品、模型版本、事件动作或短期热点。
- 至少覆盖两个独立商业主体并有两个可靠来源，或有监管／标准组织定义。
- 粒度与同级相当，全局唯一；路径分隔符统一用全角 `／`。

新闻扫描只可提出候选，不能自动创建一级领域。用户可在分类审核台自行输入新子领域名称；系统先做重复、别名、父级和粒度检查，再显示将受影响的项目、行业事件与目录预览，用户确认后一次事务提交。

## 本地逻辑事务

1. 计算 `change_id = tax_v1_<SHA-256(parent|canonical) 前20位>`，读取 `taxonomy.md`、本地 schema 版本和当前引用计数。
2. 生成 `create/reuse/defer` 计划与受影响记录，不提前改文件或数据库。
3. 用户确认 `created` 后，先用 `apply_patch` 更新 canonical plugin source，再运行插件校验；随后通过版本化本地 migration 增加选项。
4. 回读 `taxonomy.md` 与 SQLite，确认旧 canonical 未丢失、父级唯一、新名称只出现一次。
5. 最后定向更新本轮已确认的记录；不自动批量回填全部历史数据。
6. 任一步失败则按 `change_id` 回滚尚未被记录引用的变更；已经被引用时返回 `partial` 和精确人工修复项，不删除用户数据。

不得编辑安装缓存，不得要求 Base Token、Table ID 或 Wiki Space ID。旧飞书选项迁移必须保持源端只读，逐条导入并回读本地；全部通过前维持 `legacyFeishuReadCompatible=true`。

## 回执

```yaml
taxonomy_sync:
  reused: 0
  local_schema_repaired: 0
  created: 0
  deferred: 0
  legacy_orphan: 0
  failed: 0
  partial: 0
  changes:
    - change_id: tax_v1_xxx
      raw: 用户或新闻原词
      canonical: 规范名称
      parent: 一级领域
      status: reused|local_schema_repaired|created|deferred|legacy_orphan|failed|partial
      reason: 判断依据或失败说明
      affected_local_ids: []
      manual_repair: ""
```
