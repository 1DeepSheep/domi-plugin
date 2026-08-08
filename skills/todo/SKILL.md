---
name: todo
description: 生成并维护 domi 的投资待办事项。扫描当前项目库、人脉库、行业动态和关键日期，将建议归入关键节点、新入库约见、人脉跟进、项目跟踪四类；本地主库维护 0.待办事项.md，尚未安全导入的旧飞书主库继续维护既有 1.待办事项。兼容用户沿用“任务建议”“1.Task”或“1.待办事项”的旧说法。
---

# Todo

把当前项目、人脉与行业信号转成少量、可解释、可执行的待办事项。先读取 `investment-mgmt/references/storage-backends.md`：

- `repositoryBackend=local`：`<localRepositoryDir>/0.待办事项.md` 是客户端看板与本技能共享的唯一可写账本；普通飞书连接不会改变该位置。
- `repositoryBackend=legacy_feishu_primary`：完整读取 `investment-mgmt/references/legacy-feishu-primary.md`，当前 Wiki 空间的既有 `1.待办事项` 是唯一可写账本；不得初始化或写 `0.待办事项.md`。

## 必须遵守

1. 先读取 `DOMI_CONFIG_PATH` 指向的本机 JSON 配置和资料库后端，只解析当前分支必需字段。不得在回答、产物、日志或仓库中复述本机绝对路径、邮箱、访问令牌、Base／Table／Wiki 标识。
2. 所有新写入固定进入当前已锁定主库：本地主库写 SQLite／Markdown；旧飞书主库写既有 Base／Wiki。一次同步不得跨后端双写。
3. 本地主库的项目、人脉和行业事件只通过插件根目录 `scripts/domi-repo.cjs` 读取；旧飞书主库按 legacy reference 读取三个既有 Base。不得因为候选不足而自动扩张到无关飞书知识资源。
4. 写入前读取并合并当前账本，绝不覆盖待办事项文档中的用户内容。已有 `ignored`、`done`、`in_progress` 状态必须保留；状态只用于生命周期管理，不作为看板分类。
5. 只生成有证据、可说明原因、能给出下一动作的待办事项。不得把缺字段或模糊猜测包装成提醒。

## 客户端快速同步路径

调用上下文包含 `DOMI_TODO_CLIENT_SNAPSHOT_V1` 时，客户端已按当前主库完成项目表和人脉表刷新，并按本技能规则传入近 28 天新入库候选与 A/S 长期跟进候选：

1. 完整读取本文件、`references/suggestion-rules.md` 与 `references/todo-ledger-schema.md`；不要加载与本轮无关的通用技能。
2. 配置和账本各读取一次；客户端候选是 `new-entry`、`relationship-follow-up`、`project-follow-up` 的本轮权威候选集，不得再次全量读取项目表或人脉表。
3. 只有关键节点日期、已核验关联动态、字段歧义或账本消歧可以补充读取；能按 `recordId` 点读时不得退化为全表扫描。
4. 合并后单次写入、单次回读验证。不得重复刷新相同表或逐项回读所有源记录。

## 工作流

### 1. 初始化并读取当前账本

1. 把本文件所在插件目录解析为 `<plugin-root>`，把本技能目录解析为 `<todo-skill-dir>`。
2. 本地主库运行 `node <plugin-root>/scripts/domi-repo.cjs init`，幂等确保本地数据库、资料目录和 `0.待办事项.md` 已初始化；旧飞书主库禁止执行该命令，按 legacy reference 唯一定位或按明确同步请求创建 `1.待办事项`。
3. 本地主库从配置拼接精确路径 `<localRepositoryDir>/0.待办事项.md`，运行：

```bash
node <todo-skill-dir>/scripts/todo-ledger.js local-read "<document-path>"
```

4. 本地文件不存在、不是普通文件或缺少 `domi-task-board-v1` 数据块时停止并报告本地初始化失败；不得另建同名飞书文档或用全文覆盖修复。
5. 旧飞书主库按 legacy reference 读取 docx 中 caption 为 `domi-task-board-v1` 的唯一 ledger，保留 `open`、`in_progress`、`done`、`ignored` 及时间戳；多个非空候选或 marker 无法核验时停止，不得猜测或改写本地账本。

### 2. 读取实时数据

本地主库普通调用只使用本地网关：

```bash
node <plugin-root>/scripts/domi-repo.cjs project list
node <plugin-root>/scripts/domi-repo.cjs person list
node <plugin-root>/scripts/domi-repo.cjs news list --from <ISO时间> --to <ISO时间>
```

旧飞书主库改为一次读取既有项目／人脉／行业 Base 的实时 schema 与候选集合，执行系统 `入库时间` 幂等检查，并按 stable ID 建立内存索引；不得调用本地网关。两个分支都不得直接修改底层数据库或通过文件夹名猜测结构化状态。

- 项目库：近 28 天入库、评级、阶段／状态、最后跟进、最后更新时间、关键节点或下次动作日期。
- 人脉库：近 28 天入库、评级、关系进展、所属组织与身份、最后联系、关键事件或下次联系日期。
- 行业动态：只读取与 S/A 重点项目或重点人物直接相关的近期已核验事件。

创建时间优先使用当前后端系统型 `intake_time`／`created_at`；不得用最后更新时间、研究日期或本轮扫描日期伪装为“新入库”。

客户端同步可能附带一份最近 4 周新入库候选索引，并以 `DOMI_TODO_CLIENT_SNAPSHOT_V1` 标记。该索引来自本轮已完成的项目／人脉刷新，是三类候选的权威集合；不要为了发现同一批新入库对象再次全量读取项目表或人脉表，也不要为长期跟进候选重复扫描全表。只在字段歧义、价值证据不足或账本消歧时按 `recordId` 点读。索引中存在符合规则且没有冷却约束的候选时，本轮不得把 `new-entry` 留空；若全部排除，说明因低质量、已约见、冷却期或重复而排除的数量。

### 3. 生成建议

完整采用 [references/suggestion-rules.md](references/suggestion-rules.md)。默认最多保留 12 个开放事项，P1 不超过 4 个。选择时先为每个有合格候选的分类保留最多 2 个席位，再按优先级、时效和证据强度填充剩余席位；其他分类仍有合格候选时，任何单一分类不得超过 5 个。

每项必须包含简明标题、事实理由、`category`、`priority`、`source`、可核验的 `dueAt`，以及一个可直接执行的 `suggestedAction`。`category` 只能是：

- `key-milestone`：临近关键日期、已过期节点或有明确时效的承诺；
- `new-entry`：近 28 天新入库、值得优先约见的项目或人物；
- `relationship-follow-up`：重要人物新动态、很久未联系或需要维护关系；
- `project-follow-up`：重点项目新动态、很久未跟进或需要补充判断。

会面或联系安排使用 `suggestedAction.kind="schedule"`，prompt 要求采用 `$domi:schedule`，但不得预填未核实的时间或私人邮箱。

### 4. 合并与去重

按 [references/todo-ledger-schema.md](references/todo-ledger-schema.md) 生成 ledger。稳定键为 `category + source.kind + source.recordId + signalKey`：

- 同一信号已有开放事项时更新，不新建重复事项。
- 同一对象的多个信号最终要求同一种联系动作（`schedule`／`contact`）时，只保留一个开放事项并合并理由。
- 同一对象动作目的明显不同可以跨分类并存；14 天内有真实截止日时优先 `key-milestone`，否则近 28 天新入库对象优先 `new-entry`。
- `in_progress` 不自动退回 `open`；`done` 只在出现可证明的新事件时重开；`ignored` 在 30 天内不重开。
- 本轮未命中的开放事项只在证据明确失效时设为 `done`，否则保留并更新理由或优先级。

所有时间使用 ISO-8601；ID 使用不含私人信息的随机值。

### 5. 写入与验证

本地主库将完整 ledger JSON 写入权限为 `0600` 的临时文件后运行：

```bash
node <todo-skill-dir>/scripts/todo-ledger.js local-write "<localRepositoryDir>/0.待办事项.md" < <ledger-json-file>
```

该命令只替换 `domi-task-board-v1` 数据块，并保留标题、分类标题与用户补充内容。成功后运行 `local-read`，逐项核对 schema、事项、状态与时间戳，随后删除临时文件。禁止用整文件重写、正则脚本或 shell 拼接绕过该命令。

旧飞书主库将完整 ledger 传给：

```bash
node <todo-skill-dir>/scripts/todo-ledger.js render < <ledger-json-file>
```

输出是 caption 为 `domi-task-board-v1` 的 XML 代码块。通过 `lark-doc` 对已唯一
定位的 `1.待办事项` 执行 block replace；只有第一次初始化才 append。写后重新
fetch 对应 block，把结果传给 `todo-ledger.js parse`，逐项核对 schema、事项、
状态与时间戳，并确认其他文档 block 仍存在。不得全文覆盖、重复创建文档或写入
`0.待办事项.md`。

## 客户端动作

- `同步待办事项`：扫描、合并、写入并验证。
- `taskId=... 执行下一动作`：按 prompt 执行对应技能；客户端负责 `in_progress`／`done` 状态切换，技能不重复写状态。
- `taskId=... 忽略`：客户端写为 `ignored`，后续扫描尊重冷却期。

涉及 Outlook 写入时采用 `$domi:schedule`。缺少日期、时间、时区或标题时先询问，不得自行排入日历。

## 输出

只返回扫描范围、生成／更新／保留／忽略数量、四类开放事项摘要、当前后端写入与回读结果，以及被跳过规则及原因。不要返回配置值、文档链接、本机路径、私人邮箱、飞书标识或完整原始记录。
