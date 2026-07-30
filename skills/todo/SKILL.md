---
name: todo
description: 生成并维护 domi 的投资待办事项。用户要求查看、更新或同步待办事项，询问该约谁、跟进什么，或客户端要求同步待办事项看板时使用。扫描项目库、人脉库、行业动态和关键日期，将事项归入关键节点、新入库约见、人脉跟进、项目跟踪四类；飞书模式写入 1.待办事项，本地模式写入工作区根目录的 0.待办事项.md，并维护忽略与完成状态。兼容用户沿用“任务建议”“1.Task”或“1.待办事项”的旧说法。
---

# Todo

把项目、人脉与行业信号转成少量、可解释、可执行的待办事项，并让当前资料库的待办事项文档与 domi 客户端看板共享同一份数据。飞书模式使用 `1.待办事项`，本地模式使用 `<localRepositoryDir>/0.待办事项.md`。客户端按事项类型分栏，只展示仍需行动的事项。

## 必须遵守

1. 先读取 `DOMI_CONFIG_PATH` 指向的本机 JSON 配置。不得在回答、产物、日志或仓库中复述 Wiki Space ID、旧版 `taskDocumentUrl`、Base token、Table ID、邮箱或本机绝对路径。
2. 严格按 `storageBackend` 选择单一事实源：
   - `feishu`：固定使用当前飞书文档库中的 `1.待办事项` docx；兼容旧标题 `1.Task` / `1. Task`，找到后改名为 `1.待办事项`。不要求用户粘贴链接，旧版 `taskDocumentUrl` 只作无感兼容。
   - `local`：固定使用 `<localRepositoryDir>/0.待办事项.md`。必须从配置解析根目录，不得猜测、搜索其他目录或改用飞书；文件缺失时先运行插件根目录的 `scripts/domi-repo.cjs init`，仍缺失则停止。
3. 普通飞书调用采用 `lark-drive`、`lark-wiki`、`lark-base`、`lark-doc`，进入执行前完整读取实际使用的技能及其必读引用；若调用上下文包含 `DOMI_TODO_CLIENT_SNAPSHOT_V1`，改用下述“客户端快速同步路径”，不得再加载这四个通用技能全文。本地模式不得调用飞书，项目、人脉和行业事件只通过插件根目录的 `scripts/domi-repo.cjs` 读取。
4. 写入前先读取当前待办事项账本并合并，绝不覆盖待办事项文档中的其他内容。已有 `ignored`、`done`、`in_progress` 状态必须保留，但这些状态只用于生命周期管理，不作为看板分类。
5. 只生成有证据、可说明原因、能给出下一动作的待办事项。不得把缺字段或模糊猜测包装成提醒。

## 客户端快速同步路径

调用上下文包含 `DOMI_TODO_CLIENT_SNAPSHOT_V1` 时，客户端已经完成项目表和人脉表刷新，并按本 Skill 的完整规则传入近 28 天新入库候选与 A/S 长期跟进候选。此模式保持同样的证据门槛、四分类、冷却规则和 12 项配额，只减少重复读取：

1. 完整读取本 `SKILL.md`、`references/suggestion-rules.md` 和 `references/todo-ledger-schema.md`；不读取 domi Router，也不加载与当前后端无关的通用技能。
2. 配置只读取一次，当前待办事项账本只读取一次；客户端候选作为 `new-entry`、`relationship-follow-up` 和 `project-follow-up` 的本轮权威候选集，不得再次全量读取项目表或人脉表。
3. 只有关键节点日期、已核验关联动态、字段歧义或账本消歧可以做补充读取；能按 `recordId` 点读时不得退化为全表扫描。上下文明确说明候选被截断时，才读取未传入部分。
4. 完成合并后单次写入，再单次回读验证。不得在写入前后重复搜索待办文档、重复刷新相同表或逐项回读所有源记录。
5. 飞书模式可直接执行本 Skill 已给出的精确 `lark-cli` 命令；本快速路径不因跳过四个通用技能全文而省略身份、标题消歧、schema、写后回读或隐私校验。

## 工作流

### 1. 读取配置与旧账本

从 `DOMI_CONFIG_PATH` 读取当前后端以及项目、人脉、行业动态和 Wiki 配置。配置值只用于本轮工具参数，不写入中间文件。先把本 `SKILL.md` 所在目录解析为 `<todo-skill-dir>`，把插件根目录解析为 `<plugin-root>`。

若 `storageBackend=local`：

1. 运行 `node <plugin-root>/scripts/domi-repo.cjs init`，幂等确保本地数据库、四个资料目录和 `0.待办事项.md` 已初始化；
2. 从配置读取 `localRepositoryDir`，拼接精确路径 `<localRepositoryDir>/0.待办事项.md`；
3. 运行 `node <todo-skill-dir>/scripts/todo-ledger.js local-read "<document-path>"` 读取规范化 ledger；路径只作命令参数，禁止在回复中展示；
4. 文件不存在、不是普通文件或缺少 `domi-task-board-v1` 数据块时停止，不得覆盖全文或另建同名文件。

若 `storageBackend=feishu`，且本机仍有旧版 `taskDocumentUrl`，可直接用作本轮文档定位，但不得展示或要求用户维护。否则：

1. 优先使用 `drive +search --query "intitle:1.待办事项" --only-title --space-ids <wikiSpaceId> --as user`，没有结果时再搜索旧标题 `1.Task`，随后通过 `wiki +node-get` 解析；搜索能力不可用时才以 `wiki +node-list` 递归遍历作为兜底；
2. 只接受标题经 NFKC 规范化并移除全部空白后等于 `1.待办事项` 或旧标题 `1.Task`、且 `obj_type=docx` 的节点；
3. 找到多个新旧候选文档时，逐个只读解析 `domi-task-board-v1` 账本：若唯一一个账本含待办事项，选它；若只有一个规范标题 `1.待办事项` 且其余旧版账本均为空，选规范标题文档；若多个账本都有待办事项或无法完整核验，停止写入并提示用户处理，绝不按搜索顺序或时间自行猜测；
4. 自动消歧不得删除、覆盖或清空其他候选文档。只找到旧标题时，使用 `drive files patch --file-token <wiki_node_token> --type wiki --data '{"new_title":"1.待办事项"}' --as user` 改名并通过 `wiki +node-get` 回读验证；若已存在规范标题但唯一非空账本仍在旧标题文档中，本轮继续使用该非空账本且不改名，避免标题冲突；
5. 没找到且用户明确要求生成／更新待办事项时，使用 `wiki +node-create` 在该资料库根目录创建 `1.待办事项`，随后追加空账本并回读验证；
6. 没有 `wikiSpaceId` 时，提示先完成 domi 项目库、人脉库与 Wiki 的资料连接，不得改为索要待办事项文档链接。

飞书模式用局部 fetch 优先定位 caption 为 `domi-task-board-v1` 的代码块；该 marker 为兼容已有数据而保留。找不到时才读取足够范围确认确实尚未初始化。将 fetch 结果通过：

```bash
node <todo-skill-dir>/scripts/todo-ledger.js parse
```

标准输入传入 fetch 的 JSON 输出。命令返回 `found`、`blockId` 与规范化 ledger。不要自行修改 schema。

若数据块不存在，允许在用户明确要求“生成／更新待办事项”时用 `docs +update --command append` 初始化一个数据块；不得覆盖全文。新创建的 `1.待办事项` 也必须完成这一步并回读到 block ID，才算初始化成功。

### 2. 读取实时数据

飞书模式下，普通调用先运行以下幂等迁移，确保项目表和人脉表都有系统型 `入库时间`（`created_at`）：

```bash
node <plugin-root>/skills/investment-mgmt/scripts/ensure-intake-time-fields.js ensure
```

迁移成功后，每张 Base 都先取字段 schema，再选择真实存在的字段。不要假设其他中文字段名一定存在。`入库时间` 只读，任何记录写入都不得包含它。

客户端快速同步路径已经由客户端刷新并规范化 `入库时间`、评级、阶段、最后跟进和最后联系；不得重复运行迁移或为了这三类候选再次读取 schema。只有关键节点日期需要源表中客户端未提供的日期字段时，才读取一次对应表 schema，并只选择真实存在的日期字段。

本地模式只使用 `domi-repo.cjs`：

```bash
node <plugin-root>/scripts/domi-repo.cjs project list
node <plugin-root>/scripts/domi-repo.cjs person list
node <plugin-root>/scripts/domi-repo.cjs news list --from <ISO时间> --to <ISO时间>
```

不得直接修改 SQLite，不得通过文件夹名称猜测结构化状态。项目和人脉创建时间、最后更新时间、评级、阶段及文档路径以网关返回值为准；文档路径只用于必要的本机核验，不得写进待办事项 ledger 或回复。

- 项目库：近 28 天入库、评级、阶段／状态、最后跟进、最后更新时间、关键节点或下次动作日期。
- 人脉库：近 28 天入库、评级、关系进展、所属组织与身份、最后联系、关键事件或下次联系日期。
- 行业动态：只读取与 S/A 重点项目或重点人物直接相关的近期已核验事件。

创建时间优先读取系统字段 `入库时间`；兼容读取 Base 记录元数据 `created_time`，但不得用最后更新时间、研究日期或本轮扫描日期伪装成“新入库”。

客户端同步可能附带一份最近 4 周新入库候选索引，并以 `DOMI_TODO_CLIENT_SNAPSHOT_V1` 标记。该索引来自本轮已完成的项目／人脉刷新，是 `new-entry`、`relationship-follow-up` 和 `project-follow-up` 的权威候选集；不要为了发现同一批新入库对象再次全量读取项目表或人脉表，也不要为长期跟进候选重复扫描全表。只在字段歧义、价值证据不足或账本消歧时按 `recordId` 点读单条记录。索引中存在符合规则、且没有 `done`／`ignored` 冷却约束时，本轮不得把 `new-entry` 留空。若全部排除，输出中必须给出因低质量、已约见、冷却期或重复而排除的数量。

### 3. 生成建议

完整采用 [references/suggestion-rules.md](references/suggestion-rules.md)。默认最多保留 12 个开放待办事项，P1 不超过 4 个。选择事项时先为每个有合格候选的分类保留最多 2 个席位，再按优先级、时效和证据强度填充剩余席位；其他分类仍有合格候选时，任何单一分类不得超过 5 个。每项必须包含：

- 简明标题与一段事实理由；
- `category`、`priority`、`source`；
- 可核验的 `dueAt`（没有就为 `null`）；
- 一个明确的 `suggestedAction`，含按钮文案和可直接交给 domi 执行的 prompt。

`category` 只能使用以下四个值：

- `key-milestone`：临近关键日期、已过期但未完成的节点或有明确时效的承诺；
- `new-entry`：近 28 天新入库、值得优先约见的项目或人物；
- `relationship-follow-up`：重要人物新动态、很久未联系或需要维护关系；
- `project-follow-up`：重点项目新动态、很久未跟进或需要补充判断。

涉及会面或联系安排时，使用 `suggestedAction.kind="schedule"`，prompt 必须要求采用 `$domi:schedule`，但不得预填未核实的时间、私人邮箱或参与人邮箱。

### 4. 合并与去重

按 [references/todo-ledger-schema.md](references/todo-ledger-schema.md) 生成 ledger。稳定键为 `category + source.kind + source.recordId + signalKey`：

- 同一信号已有开放待办事项时更新理由、分类、优先级和动作，不新建重复事项。
- 同一对象出现不同、且实质动作不同的信号时可以跨分类并存；例如“临近签约节点”和“安排创始人交流”可分别保留。
- 同一对象的多个信号最终都要求同一种联系动作（`schedule` / `contact`）时，只保留一个开放事项，把其他信号合并进 `reason`，不得生成两张含义相同的约见卡片。近 28 天新入库对象以 `new-entry` 为主分类；有 14 天内真实截止日时以 `key-milestone` 为主分类。
- 已有等价开放事项时更新该事项，不新建跨分类重复项；不要删除或伪造完成状态来清理历史任务。
- `in_progress` 不得自动退回 `open`。
- `done` 不自动重开；只有出现可证明的新事件或新的关键日期才创建新待办事项。
- `ignored` 在 30 天内不重开；关键日期改变或出现新的已核验事件才视为新信号。
- 本轮不再命中的开放待办事项，只有证据明确失效时才设为 `done`；否则保留并降低优先级或更新理由。

所有时间写 ISO-8601，`updatedAt` 使用本轮实际时间。待办事项 ID 使用不含私人信息的随机 ID。

### 5. 写入与验证

将完整 ledger 传给对应后端。

本地模式把 ledger JSON 写入权限为 `0600` 的临时文件，然后运行：

```bash
node <todo-skill-dir>/scripts/todo-ledger.js local-write "<localRepositoryDir>/0.待办事项.md" < <ledger-json-file>
```

该命令只精确替换 `domi-task-board-v1` 数据块，并保留标题、分类标题和用户补充内容。命令成功后再次运行 `local-read`，逐项核对 schema、事项、状态与时间戳；最后删除临时 ledger 文件。禁止用整文件重写、正则脚本或 shell 拼接绕过该命令。

飞书模式将完整 ledger 传给：

```bash
node <todo-skill-dir>/scripts/todo-ledger.js render
```

输出是一个 XML 代码块。已有数据块时使用 `block_replace` 精确替换它；初始化时使用 `append`。不要把文档链接写进内容。

写后重新 fetch，运行 `parse` 并逐项核对：

- `schemaVersion=1`；
- 所有本轮新增／更新待办事项存在；
- 状态与时间戳未丢失；
- 文档中的其他块仍存在。

若验证失败，报告失败并停止；不要循环覆盖。

## 客户端动作

客户端可能用以下意图调用本技能：

- `同步待办事项`：执行完整扫描、合并、写入和验证。
- `taskId=... 执行下一动作`：依据待办事项 prompt 执行对应技能。客户端会在开始时设为 `in_progress`，并在动作成功后确定性更新为 `done`；技能不要重复写状态。失败或取消时客户端恢复为 `open`。
- `taskId=... 忽略`：客户端会直接把该待办事项设为 `ignored`；后续扫描必须尊重冷却期。

涉及 Outlook 写入时采用 `$domi:schedule`。缺少日期、时间、时区或日程标题时先询问，不得自行排入日历。

## 输出

只返回：

- 扫描的数据范围与生成／更新／保留／忽略数量；
- 按关键节点、新入库约见、人脉跟进、项目跟踪分组，并在组内按 P1、P2、P3 排列的开放事项摘要；
- 当前后端的写入和回读是否成功；
- 被跳过的规则及原因。

不要返回配置值、待办事项文档链接或本机路径、私人邮箱、Base 标识或完整原始记录。
