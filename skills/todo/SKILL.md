---
name: todo
description: 维护 domi 投资待办四类事项，本地账本为 0.待办事项.md；旧飞书主库用既有 1.待办事项。兼容任务建议、1.Task。
---

# Todo

上下文同时含 `DOMI_TODO_CLIENT_SNAPSHOT_V1` 和已校验后端时直接锁定，不再读取 `storage-backends.md`；普通调用先读 `../investment-mgmt/references/storage-backends.md`。

- `local`：唯一账本 `<localRepositoryDir>/0.待办事项.md`；资料经 `scripts/domi-repo.cjs` 读取。
- `legacy_feishu_primary`：完整读 `../investment-mgmt/references/legacy-feishu-primary.md`；只维护既有 Base／Wiki 与 `1.待办事项`；不得初始化或写 `0.待办事项.md`，禁止本地网关。

失败即停；不得切换、双写或新建第二账本。要附件时读[合同](../domi-router/references/artifact-delivery.md)。

## 客户端紧凑同步

`DOMI_TODO_CLIENT_SNAPSHOT_V1` 含最近 4 周新入库候选索引与 A/S 长期候选，是本轮权威集合。只读本文件、必需配置和账本各一次，无需再读两个 reference。不要为了发现同一批新入库对象再次全量读取项目表或人脉表；仅为关键节点、动态或歧义点读。

有合格且不受冷却约束候选时 `new-entry` 不得留空；全排除时汇总低质量、已约见、冷却期、重复数量。调用程序合并，只写、回读各一次；不得重复 init、搜索账本或逐条回读。普通调用读 `references/suggestion-rules.md` 和 `references/todo-ledger-schema.md`。

## 读取

只解析 `DOMI_CONFIG_PATH` 必需字段。普通本地幂等调用 `domi-repo.cjs init`（客户端就绪工作区跳过），用 `todo-ledger.js local-read <账本绝对路径>` 读取。

账本须是普通文件且含唯一 `domi-task-board-v1`；否则停。普通本地候选经 `project/person list --fields id,name,rating,status,createdAt --limit 200`、`news list --from <ISO> --to <ISO>` 获取。hasMore=true 沿 nextCursor 读完；query_snapshot_changed 重查去重。投影仅筛选，事实判断用 `project get/person get --id` 读完整记录和必需原文。

仅系统 `intake_time/created_at`（网关 createdAt）判断近 28 天入库，更新时间、研究日不能冒充。行业事件须有原始来源、已核验且直接关联 A/S 对象。

## 生成与语义审核

每项回答“为什么现在、做什么、来源能否唯一定位、是否重复”；不明确则跳过或作 P3 补全。四类：

- `key-milestone`：真实关键日期、过期未完成节点或明确承诺；
- `new-entry`：近 28 天入库且值得约见；
- `relationship-follow-up`：A/S 人物已核验新动态或超过 60 天未联系；
- `project-follow-up`：A/S 项目已核验新动态或超过 45 天未跟进。

最多 12 个开放事项、P1 最多 4 个；每个有合格候选的分类保留最多 2 个席位，再按优先级、日期、证据填充；其他类仍有候选时单类最多 5 个。

`dueAt` 仅用真实截止／节点日：无日期必须为 `null`；禁止用当前／扫描时间、模型推算或建议时间填充、覆盖已有真实日期。未来 7 天内且证据明确为 P1；8–14 天默认 P2，另有已核验重大事件／承诺才升级；无日期不能只因评级高给 P1。会面用 `suggestedAction.kind="schedule"` 调用 `$domi:schedule`，不预填未核实时间或私人邮箱。

## 生命周期与程序合并

稳定键 `category + source.kind + source.recordId + signalKey`。同信号更新原项；同对象多个信号最终要求同一种联系动作（schedule/contact）时合并。目的确实不同可设 purposeKey 区分；14 天内真实截止优先 key-milestone，否则近 28 天优先 new-entry。

保留 `in_progress`；`done` 仅凭可证明的新事件重开；`ignored` 30 天不重开。open 仅证据明确失效才 done。配额不足、未入选或本轮未扫描到，不得改成 `done/ignored`。合并 dueAt=null 保留已有真实日期；仅来源证明改期／取消才能更新／清空。时间 ISO-8601，ID 不含私人信息。

必须用 `todo-ledger.js merge/local-merge` 执行这些机械规则。每个 candidates 元素为 `{task,review}`：task 遵循账本 schema；review 至少 `{status:"passed",sourceRefs:["来源ID:定位"]}`，只能在模型实际完成价值、归因与证据审核后给 passed。真实日期另给 dateVerified；改期／取消给 dateChanged/dateCancelled；新入库给真实 sourceCreatedAt 与 valueVerified；重大事件、承诺、新事件、信号失效给 majorEvent/commitment/newEvent/signalInvalidated。不得编造这些审核值以通过工具。

本地 stdin JSON：`{runId,now,expectedLedgerHash,candidates}`。runId 原样取 `DOMI_TODO_RUN_V1`（独立调用生成 UUID），now 为真实本轮 ISO 时间，expectedLedgerHash 原样取 local-read.ledgerSha256：

```bash
node <todo-skill-dir>/scripts/todo-ledger.js local-merge "<localRepositoryDir>/0.待办事项.md" < <私有输入JSON>
```

程序校验并发、合并、仅替换 marker、写后回读，返回 diagnostics 和真实 receipt。旧有效事项超配额如实保留，不伪装完成。客户端最终 `DOMI_TODO_RESULT_V1` 后原样输出 receipt JSON（runId、documentSha256、ledgerSha256、taskIds、verified），禁止自行拼成功。丢失输出时只读 `local-read <path> --run-id <原runId>`；回执与实际内容匹配才 verified，不重复研究或写入。

旧飞书用 `merge`（stdin `{ledger,candidates,now}`）后 `render`，仅 replace 唯一 block、首次才 append；写后 fetch + `parse` 核对其他 block 仍在。`local-write` 仅兼容明确完整账本维护，不用于新同步。临时 JSON 用 0600，完成后删除；不得整文档覆盖、重复建档或直接改 SQLite。

## 输出与动作

动作状态由客户端管理，本 Skill 不重复修改。只返回范围、数量、四类摘要、验证与跳过原因；除客户端私有回执外不暴露路径、邮箱、配置、内部标识或原始记录。
