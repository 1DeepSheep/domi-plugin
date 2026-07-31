# domi 资料库后端契约

所有会读取或写入项目、人脉、行业事件、项目文档或资料文件的 domi 工作流，必须先解析资料库后端。后端是显式配置，不得根据飞书令牌、授权状态或网络错误猜测。

## 1. 解析当前后端

从 `investment-mgmt/SKILL.md` 所在插件根目录解析：

```bash
DOMI_REPO="<plugin-root>/scripts/domi-repo.cjs"
node "$DOMI_REPO" config get
```

返回：

```json
{
  "ok": true,
  "backend": "feishu | local",
  "localRepositoryDir": "/absolute/path",
  "localDatabasePath": "/absolute/path"
}
```

- `backend=feishu`：继续执行当前 Skill 中的 `lark-cli`、Wiki 与本地材料目录规则。
- `backend=local`：禁止要求飞书授权，禁止调用 Wiki/Base 写入；结构化数据和文档都通过 `domi-repo.cjs` 写入。
- 配置缺失时停止并提示用户到 domi“设置 → 资料连接”选择模式。
- 飞书授权过期只报告飞书错误，不得静默切换本地。
- 切换后端不代表迁移数据；没有显式迁移命令时禁止复制、删除或覆盖另一后端的数据。

### 本地 → 飞书的显式迁移

domi 客户端从本地模式切换到飞书模式时，可由用户明确开启“先迁移本地资料，再切换到飞书”。只有这条受控路径获得了跨后端写入授权：

1. 切换前验证飞书用户身份、项目 Base、People Base、行业动态 Base、Wiki Space、本地资料库和所有必需连接；任何一项缺失都不开始迁移。
2. 预检本地 SQLite 中的项目、人脉与行业事件；先幂等确保项目表和人脉表的 `入库时间` 是系统 `created_at`，再读取三个目标 Base 的真实字段和选项，并统计每个项目目录中的 Markdown。其他字段缺失、taxonomy 不兼容、业务键重复或同名记录无法唯一匹配时停止，禁止猜测字段、创建隐式选项或覆盖不确定记录。
3. 项目结构化记录写入 Watching List；用「公司名称」精确匹配现有记录。People 结构化记录写入 People Base；先按「人名」查找，再结合「所属组织&身份」唯一匹配，`类型` 只保留一个主类型。行业事件写入行业动态 Base；只按稳定「事件ID」精确去重，旧版证据状态和建议动作先归一到当前契约。
4. 仅项目文档创建飞书 Wiki 文档。使用 canonical 领域／主子领域和 `folder_map.md` 定位目标文件夹；找不到唯一目录时停止该项目，禁止降级到 Wiki 根目录或猜测分类。
5. `项目主页.md` 创建为目标子领域下的项目主页；同一项目的纪要、研究及其他 Markdown 创建为项目主页的子文档。本地图片按原文位置上传，其他原始附件继续保留在本地。人物主页和行业事件 Markdown 不额外创建 Wiki 文档，它们的结构化内容分别进入 People Base 与行业动态 Base。
6. 同名在线文档只有在本地迁移账本能证明是 domi 先前创建时才允许覆盖更新；未知来源的同名文档一律报告冲突，不得覆盖。
7. 项目主页与子文档逐篇回读成功后，才创建或更新 Watching List 并回填项目主页链接。纯机械迁移不刷新已有项目记录的「最后更新时间」。
8. 项目、人脉和行业事件的每条 Base 写入都必须按业务键重新查询，并验证本次写入字段；新增项目和人脉还要验证系统生成的 `入库时间` 非空。`record-upsert` 不得被误认为会自动按业务键去重，写入 payload 不得包含系统时间字段。
9. 所有项目文档、项目记录、人脉记录和行业事件都成功并回读验证后，客户端才把 `storageBackend` 改为 `feishu`。任一条失败时继续保持 `local`；已成功写入的在线内容不删除，后续按文档迁移账本和业务键幂等重试。
10. 迁移永远不删除或移动本地 SQLite、Markdown、图片和附件。用户关闭迁移开关时，仅切换后端，不执行跨库复制。

迁移完成回执至少包含：

```yaml
migration_receipt:
  source_backend: local
  target_backend: feishu
  project_count: 12
  people_count: 36
  news_count: 120
  document_count: 37
  image_count: 8
  failed_count: 0
  target_verified: true
  local_files_preserved: true
  backend_switched: true
```

## 2. 本地后端的三层一致性

本地模式把原“三端统一”改为同一资料库内的三层一致性：

1. **SQLite**：项目、人脉、行业事件等结构化权威记录。
2. **Markdown**：项目主页、人物主页、行业事件、纪要与研究文档。
3. **资料文件夹**：BP、录音、文字稿、财务表格、图片和其他原始附件。

本地资料库初始化结构为：

```text
<localRepositoryDir>/
├── 0.待办事项.md
├── 1.行业研究/
├── 2.行业动态/
├── 3.项目库/
└── 4.人脉库/
```

`0.待办事项.md` 是本地待办事项维护文档。初始化和后续 `domi-repo init` 只能在文件不存在时创建，禁止覆盖用户已有内容。

项目目录固定为：

```text
<localRepositoryDir>/3.项目库/<领域>/<主子领域>/<项目名称>/
├── 项目主页.md
├── 纪要/        # 有第一篇纪要时创建
├── 研究/        # 有第一篇研究时创建
├── 原始材料/    # 有 BP、录音或附件时创建
└── 导出/        # 首次导出时创建
```

项目根目录不要带日期、评级或进展状态；这些会变化的信息只写 SQLite 与 `项目主页.md`。多子领域时，SQLite 可保存多个，目录只使用第一个主子领域。四个内容子目录按需创建，禁止为了占位初始化空文件夹。

领域和主子领域都未知时，使用紧凑路径
`3.项目库/_未分类/<项目名称>/`，不得创建
`3.项目库/_未分类/_未分类/<项目名称>/`。旧版重复层在项目下一次受控
`project upsert` 时仅在目标目录不存在的情况下原地折叠；不得覆盖同名目录。

项目文档的阅读顺序跨后端保持一致：若项目先完成桌面研究、后产生真实交流纪要，项目主页或合并文档必须先呈现交流纪要，再把桌面研究作为独立 Part 放在后面；不得按生成时间把纪要追加在研究之后，也不得把研究内容改写进纪要。合并文档需要 Part 标签时使用顶格加粗行 `**Part 1｜交流纪要**`、`**Part 2｜桌面研究**`，让两块正文继续使用各自的 `####` / `#####`。本地模式若纪要与研究保存在不同子目录，`项目主页.md` 的索引也按纪要在前、研究在后排列。

行业事件的 Markdown 镜像位于：

```text
<localRepositoryDir>/2.行业动态/<YYYY>/<MM>/<事件ID>.md
```

### 本地资料库的性能与稳定性约束

1. 结构化查询、搜索、去重与统计以 SQLite 为准，禁止为了查找一个项目或人物递归扫描整个 `domi工作区`。
2. 读取项目材料时，先用记录的 `document_path` 定位项目／人物根目录，只扫描该实体目录；只有旧记录尚未建立路径映射时，才运行一次受限索引修复。
3. 新项目、新人物和外部迁入目录通过幂等增量索引进入 SQLite。目录结构签名未变化时不得重复更新全部记录或无意义改写 schema 元数据。
4. 单条编辑使用乐观并发控制：更新前校验 `updated_at`，数据库、Markdown 和目录移动必须同成同败；冲突时回滚文件变化并要求刷新，禁止静默覆盖。
5. 文档树允许使用短时内存缓存；新建、重命名、迁移或用户手动刷新后必须失效。缓存只包含路径和文件元数据，不复制正文或私人资料到插件目录。
6. 批量操作先解析一次配置、复用一次 SQLite 会话并在一个受控事务中执行；不得逐条启动完整同步。保存单条记录后只更新对应缓存记录，完整同步留给显式刷新。
7. OneDrive/iCloud 占位文件读取失败时保留路径并给出可恢复提示，不得因此删除记录、重建目录或切换后端。

## 3. 本地命令

优先把 JSON 写入临时文件后用 `--json-file` 传递，避免 shell 转义破坏内容。临时文件不得放入插件源码。

```bash
# 初始化并检查
node "$DOMI_REPO" init
node "$DOMI_REPO" workspace verify

# 项目
node "$DOMI_REPO" project search --query "公司名"
node "$DOMI_REPO" project upsert --json-file /tmp/project.json
node "$DOMI_REPO" project get --id prj_xxx

# 人脉
node "$DOMI_REPO" person search --query "姓名"
node "$DOMI_REPO" person upsert --json-file /tmp/person.json

# 行业事件
node "$DOMI_REPO" news list --from 2026-07-17T00:00:00+08:00 --to 2026-07-25T00:00:00+08:00
node "$DOMI_REPO" news upsert --json-file /tmp/event.json

# 给已有项目创建纪要／研究文档
node "$DOMI_REPO" document create --json-file /tmp/document.json
```

项目 payload：

```json
{
  "name": "公司名",
  "domain": "AI",
  "subdomains": ["Agent"],
  "status": "已交流",
  "rating": "A",
  "notes": "结构化摘要",
  "cities": ["上海"],
  "financingHistory": "| 融资时间 | 融资轮次 | 投前估值 | 股东出资情况 | 投后估值 |...",
  "latestValuationUsd100m": 1.25,
  "investors": ["红杉", "IDG"],
  "lastUpdatedAt": "2026-07-24T00:00:00+08:00"
}
```

`financingHistory`、`latestValuationUsd100m` 和 `investors` 必须遵循 [financing-fields.md](financing-fields.md)；本地与飞书使用相同口径。

事件 payload：

```json
{
  "eventId": "稳定事件ID",
  "title": "新闻标题",
  "domains": ["AI"],
  "subdomains": ["Agent"],
  "types": ["公司动态"],
  "publishedAt": "2026-07-24T09:00:00+08:00",
  "summary": "核心事实",
  "investmentMeaning": "投资含义",
  "url": "https://example.com/original",
  "source": "来源",
  "importance": 8,
  "confidence": 9,
  "evidenceStatus": "官方确认",
  "action": "继续跟踪",
  "worthFollowing": true
}
```

文档 payload：

```json
{
  "ownerType": "project",
  "ownerId": "prj_xxx",
  "kind": "纪要",
  "title": "20260724-创始人交流纪要",
  "contentFile": "/absolute/path/to/notes.md"
}
```

## 4. 统一回执

不论后端，工作流完成时都要在后台生成并核验可验证的回执；不得未经回读就把任务标记为“已入库”：

```yaml
storage_receipt:
  backend: local | feishu
  project_id: prj_xxx | rec_xxx
  project_uri: domi://project/prj_xxx | feishu-record-url
  document_uri: file:///.../项目主页.md | https://...wiki...
  library_path: /.../项目名称
  record_verified: true
  document_verified: true
  files_verified: true
  status: managed
```

本地模式只有在 SQLite 反查、Markdown 存在且项目目录验证均通过时才可返回 `managed`。飞书模式继续遵循 Wiki 回读、父链验证、Base 反查和本地材料核验。

`storage_receipt` 是机器审计信息，不是研究报告正文。默认给用户的完成报告只写简洁的入库结果（成功／部分完成／失败、更新了什么、失败项及下一步），不得粘贴 `project_id`、URI、本机路径、Base 标识或逐字段验证明细。只有以下情况才展开回执：用户明确要求查看；出现失败、冲突或部分完成；需要用户据此执行人工修复。即使不在报告中展示，后台回读和回执保存也不得省略。
