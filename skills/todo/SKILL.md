---
name: todo
description: 维护 domi 投资待办。扫描项目、人脉、行业动态和关键日期，按四类写本地 0.待办事项.md；旧飞书主库继续写既有 1.待办事项。兼容“任务建议”“1.Task”“1.待办事项”。
---

# Todo

把资料库信号变成少量可执行事项。客户端上下文同时含 `DOMI_TODO_CLIENT_SNAPSHOT_V1` 和已校验的 `后端：local`／`后端：legacy_feishu_primary` 时直接锁定，不再读取 `storage-backends.md`；普通调用先读 `../investment-mgmt/references/storage-backends.md`：

要附件时读[合同](../domi-router/references/artifact-delivery.md)。

- `repositoryBackend=local`：`<localRepositoryDir>/0.待办事项.md` 是唯一账本；资料只经 `scripts/domi-repo.cjs` 读取。
- `repositoryBackend=legacy_feishu_primary`：完整读取 `../investment-mgmt/references/legacy-feishu-primary.md`；既有 Base／Wiki 与 `1.待办事项` 是唯一主库。禁止调用本地网关、不得初始化或写 `0.待办事项.md`。

失败即停；不得切换、双写或新建第二账本。

## 客户端紧凑同步

上下文含 `DOMI_TODO_CLIENT_SNAPSHOT_V1` 时，客户端已刷新主库并传入最近 4 周新入库候选索引与 A/S 长期候选。它是三类跟进候选的本轮权威集合：

1. 本轮只读取本文件、配置必需字段和当前账本各一次；无需再读两个 reference 或其他通用 Skill。
2. 不要为了发现同一批新入库对象再次全量读取项目表或人脉表。仅为关键节点、已核验动态、字段／账本歧义按 `recordId` 点读。
3. 索引中有符合规则且不受冷却约束的候选时，`new-entry` 不得留空；全部排除时汇总低质量、已约见、冷却期和重复的数量。
4. 内存合并后只写、回读各一次；不得重复 init、刷新、搜索账本或逐项回读源记录。

普通调用读 `references/suggestion-rules.md` 与 `references/todo-ledger-schema.md`。

## 执行契约

### 1. 读取账本与候选

从 `DOMI_CONFIG_PATH` 只解析必需字段。本地主库幂等运行：

```bash
node <plugin-root>/scripts/domi-repo.cjs init
node <todo-skill-dir>/scripts/todo-ledger.js local-read "<localRepositoryDir>/0.待办事项.md"
```

文件须为普通文件且含唯一 `domi-task-board-v1` 块；否则停止。旧飞书按 legacy reference 唯一定位；多个非空候选或 marker 无法核验时停止。

普通本地调用一次读取：

```bash
node <plugin-root>/scripts/domi-repo.cjs project list
node <plugin-root>/scripts/domi-repo.cjs person list
node <plugin-root>/scripts/domi-repo.cjs news list --from <ISO时间> --to <ISO时间>
```

只用系统 `intake_time/created_at` 判断近 28 天入库；更新时间、研究日和扫描时间不能冒充创建时间。行业事件须有原始来源、已核验且直接关联 A/S 对象。

### 2. 生成与配额

事项须回答“为什么现在、做什么、来源能否唯一定位、是否重复”；否则跳过或作 P3 补全。四类为：

- `key-milestone`：真实关键日期、过期未完成节点或有明确时效的承诺；
- `new-entry`：近 28 天入库且值得约见的对象；
- `relationship-follow-up`：A/S 人物已核验新动态或超过 60 天未联系；
- `project-follow-up`：A/S 项目已核验新动态或超过 45 天未跟进。

最多 12 个开放事项、P1 最多 4 个；每个有合格候选的分类保留最多 2 个席位，再按优先级、日期、证据填充；其他类仍有候选时单类最多 5 个。

`dueAt` 只用来源可核验的真实截止／节点日：无日期必须为 `null`；禁止用当前／扫描时间、模型推算或建议时间填充、覆盖已有真实日期。未来 7 天内且证据明确为 P1；8–14 天默认 P2，另有已核验重大事件／承诺才升级；无日期不能只因评级高给 P1。

每项须符合 ledger schema。会面用 `suggestedAction.kind="schedule"` 并调用 `$domi:schedule`；不得预填未核实时间或私人邮箱。

### 3. 合并与生命周期

稳定键：`category + source.kind + source.recordId + signalKey`。

- 同一信号更新原事项；同一对象多个信号最终要求同一种联系动作（`schedule/contact`）时合并，只留一项。
- 动作目的确实不同可跨分类并存；14 天内真实截止日优先 `key-milestone`，否则近 28 天对象优先 `new-entry`。
- 保留 `in_progress`；`done` 仅在出现可证明的新事件时重开；`ignored` 30 天内不重开。
- `open` 仅在证据明确失效时设 `done`。配额不足、未入选或本轮未扫描到，不得改成 `done/ignored`。
- 合并输入为 `dueAt=null` 时保留已有可核验日期；只有来源证明日期改变或节点取消时才能更新／清空。

时间用 ISO-8601；ID 不含私人信息。不得直接改 SQLite 或以目录名猜状态。

### 4. 单次写入、单次验证

本地主库把 ledger 写入 `0600` 临时 JSON，然后：

```bash
node <todo-skill-dir>/scripts/todo-ledger.js local-write "<localRepositoryDir>/0.待办事项.md" < <ledger-json-file>
node <todo-skill-dir>/scripts/todo-ledger.js local-read "<localRepositoryDir>/0.待办事项.md"
```

核对 schema、事项、状态、`dueAt`、时间戳后删临时文件。只替换 marker；禁止整文件重写或脚本绕过。

旧飞书用 `render` 生成同一 marker，只 replace 唯一 block，首次才 append；写后 fetch + `parse` 核对并确认其他 block 仍在。禁止全文覆盖或重复建文档。

## 客户端动作与输出

- `同步待办事项`：执行上述扫描、合并、写入和验证。
- `taskId=... 执行下一动作`：按 prompt 执行；客户端管理 `in_progress/done`，本 Skill 不重复写状态。
- `taskId=... 忽略`：客户端写 `ignored`，后续扫描遵守冷却期。

只返回范围、各状态数量、四类摘要、写入／回读结果和跳过原因。不得返回配置、链接、路径、私人邮箱、内部标识或完整原始记录。
