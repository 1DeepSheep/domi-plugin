# domi 本地权威资料库契约

所有 domi 用户都使用同一种权威资料库：本机 SQLite + Markdown + 工作区附件目录。飞书只作为可选知识外挂和外部文档通道，完整遵循 [feishu-knowledge-extension.md](feishu-knowledge-extension.md)；连接飞书永远不改变本契约。

## 1. 固定路由

从 `investment-mgmt/SKILL.md` 所在插件根目录解析本地网关：

```bash
DOMI_REPO="<plugin-root>/scripts/domi-repo.cjs"
node "$DOMI_REPO" config get
```

返回的 `backend` 必须为 `local`。项目、人脉、行业事件、待办事项、研究文档和材料归档均通过 `domi-repo.cjs` 或工作区中的 Markdown 完成。

强制守卫：

- 禁止因飞书已连接、用户给出飞书链接、飞书授权失败或本地未命中而切换 `repositoryBackend`。
- 禁止**自动**创建、迁移或维护项目／人脉／行业 Base 作为 domi 管理后端，不要求用户手工填写 Base Token、Table ID 或固定 Wiki Space ID。用户明确要求搜索／读取既有 Base，或明确指定外部 Base 的创建／编辑动作时，按 [feishu-knowledge-extension.md](feishu-knowledge-extension.md) 使用 `lark-base`；该外部动作不改变本地权威源。
- 禁止把普通飞书文档或 Wiki 节点当作权威项目主页、人物主页、行业事件或待办事项账本。
- 旧配置含 `storageBackend=feishu` 且尚未完成经回读验证的本地导入时，设置 `legacyFeishuReadCompatible=true`：现有 Base／Wiki 继续作为**只读历史来源**，避免升级后资料突然不可见；所有新写入仍只进入本地。完成下述显式导入并验证后才关闭兼容读取。不得删除任何已有飞书或本地内容。
- 本地配置缺失时只提示用户选择工作区目录；不得让用户通过连接飞书绕过本地初始化。

### 飞书外挂与交付不是资料库后端

用户明确要求飞书搜索、读取、创建或编辑时，读取 [feishu-knowledge-extension.md](feishu-knowledge-extension.md)。已有 `delivery_only=feishu_doc|feishu_dm` 继续兼容：

- 飞书连接继续保留 Base、Wiki、Docs、Drive、IM、Contact 的完整授权能力；本地主库只改变数据权威与默认路由，不缩减飞书连接权限。
- Base／Wiki／Docs／Drive 可以在用户明确指定时作为外部参考搜索读取；外部创建、编辑和发布同样按明确目标执行，但不进入本地管理事务，也不反向切换后端。

- `delivery_only=feishu_doc` 等价于明确创建或编辑飞书文档；本地源仍为权威。
- `delivery_only=feishu_dm` 只发送用户指定的摘要或文档链接。
- 两者都不写回后端配置，不触发迁移，不要求任何 Base／Table／Wiki 映射。
- 普通“研究”“归档”“入库”没有飞书外部动作授权。

### 旧飞书管理库 → 本地的显式导入

这只服务于已安装旧版且尚未迁移的用户，不是新的双后端模式：

1. 先初始化本地工作区与 SQLite；未初始化时继续允许只读旧飞书数据，并提示完成迁移，不能假装本地已有全部资料。
2. 从本机旧配置读取既有 Base／Wiki 映射，禁止让用户重新粘贴 Token／ID，也禁止发现不到时另建同名 Base 或 Wiki。
3. 旧项目、人脉、行业事件与文档按业务键读取，逐条写入本地网关；同名多候选、schema 冲突、目标已有不同内容时停止对应条目并展示差异，不猜测覆盖。
4. Wiki 文档导出为本地 Markdown 时保留标题、段落、列表、表格、代码、链接和图片；图片下载到实体目录并改写为相对引用。任何图片或 block 丢失都使该文档为失败。
5. 每条记录和文档写后回读 SQLite、Markdown、目录与附件；全部对象验证成功后才写入 `localAuthorityMigrationCompleted=true` 并关闭 `legacyFeishuReadCompatible`。
6. 迁移期间新任务产生的项目、人脉、行业事件、纪要和研究只写本地，不能继续写旧 Base／Wiki。
7. 导入永远不删除、移动或覆盖原飞书内容。部分失败时保留只读兼容和迁移账本，后续幂等恢复。

迁移完成前的搜索应合并“本地结果 + 旧飞书只读结果”，明确标注来源并按 canonical 实体去重；本地命中优先。迁移完成后普通内部搜索只查本地，用户仍可按 [feishu-knowledge-extension.md](feishu-knowledge-extension.md) 显式搜索飞书知识库。

## 2. 本地资料库三层一致性

1. **SQLite**：项目、人脉、行业事件、文档索引和关系的结构化权威记录。
2. **Markdown**：项目主页、人物主页、行业事件、纪要与研究文档的可读权威内容。
3. **资料文件夹**：BP、录音、文字稿、财务表格、图片和其他原始附件。

初始化结构：

```text
<localRepositoryDir>/
├── 0.待办事项.md
├── 1.行业研究/
├── 2.行业动态/
├── 3.项目库/
└── 4.人脉库/
```

`0.待办事项.md` 只在不存在时创建，升级不得覆盖用户内容。

项目目录：

```text
<localRepositoryDir>/3.项目库/<领域>/<主子领域>/<项目名称>/
├── 项目主页.md
├── 纪要/        # 有第一篇纪要时创建
├── 研究/        # 有第一篇研究时创建
├── 原始材料/    # 有第一份附件时创建
└── 导出/        # 首次导出时创建
```

项目根目录不包含日期、评级或进展状态。多子领域只用主子领域定位目录，SQLite 保留全部子领域。领域和主子领域都未知时使用 `3.项目库/_未分类/<项目名称>/`，禁止重复 `_未分类/_未分类`。

人物目录：

```text
<localRepositoryDir>/4.人脉库/<姓名>/
├── 人物主页.md
├── 研究/
└── 纪要/
```

不得再创建第二份“人物资料”主档。完整人物研究进入 `研究/`，真实交流进入 `纪要/`；两者都登记本地文档索引，交流纪要同时维护人脉记录中的交流文档引用。

行业事件镜像：

```text
<localRepositoryDir>/2.行业动态/<YYYY>/<MM>/<事件ID>.md
```

行业主导播客的唯一主纪要：

```text
<localRepositoryDir>/1.行业研究/<领域>/<主子领域>/播客/<节目名称>/
├── <YYYYMMDD>-<单集主题>.md
└── <YYYYMMDD>-<单集主题>-PLAUD文字稿.md
```

公司主导播客进入唯一既有项目的 `纪要/`，其他入口只保存引用，不复制正文。

项目先研究、后交流时，阅读顺序始终为“交流纪要在前，桌面研究作为独立 Part 在后”。不得把研究改写进纪要；不同文件保存时，`项目主页.md` 的索引仍按该顺序排列。

## 3. 稳定性与性能

1. 搜索、去重和统计先查 SQLite，禁止为了查一个项目递归扫描整个工作区。
2. 通过 `document_path` 定位实体目录；旧记录缺映射时只运行一次受限索引修复。
3. 新建、外部迁入或手动移动目录使用幂等增量索引；结构签名未变化时不重复全量同步。
4. 单条编辑校验 `updated_at`；SQLite、Markdown 和目录移动同成同败，冲突时回滚文件变化并要求刷新。
5. 文档树缓存只含路径和元数据；新建、重命名、移动和用户刷新后失效，不把正文复制到插件目录。
6. 批量操作复用一次配置和 SQLite 会话，在受控事务中执行；保存单条记录只更新对应缓存。
7. OneDrive／iCloud 占位文件读取失败时保留路径并给出可恢复提示，不删除记录、不重建目录，也不改用飞书。

## 4. 本地命令

多行 JSON 优先通过权限受控的临时文件和 `--json-file` 传递，任务后删除，禁止放入插件源码。

```bash
node "$DOMI_REPO" init
node "$DOMI_REPO" workspace verify

node "$DOMI_REPO" project search --query "公司名"
node "$DOMI_REPO" project upsert --json-file /tmp/project.json
node "$DOMI_REPO" project get --id prj_xxx

node "$DOMI_REPO" person search --query "姓名"
node "$DOMI_REPO" person upsert --json-file /tmp/person.json

node "$DOMI_REPO" news list --from 2026-07-17T00:00:00+08:00 --to 2026-07-25T00:00:00+08:00
node "$DOMI_REPO" news upsert --json-file /tmp/event.json

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

本地人物 intake 必须把完整研究写入 Markdown。可在同一次 `person upsert` 中提交 `researchTitle` 与 `researchContentFile`；写后用 `person search` 确认文档索引包含研究文档。真实交流使用 `document create`，`ownerType=person`、`kind=交流纪要`。

## 5. 外部资料导入与飞书副本

- 从飞书读取后导入本地：必须由用户明确要求，先提取为 Markdown 临时文件，再通过对应实体的 `document create` 写入；写后回读本地文档索引。飞书原文保持不变。
- 从本地搬到飞书：按 [feishu-knowledge-extension.md](feishu-knowledge-extension.md) 的保真清单、图片上传和写后 AST 对比执行。本地 Markdown 不移动、不删除、不被飞书回读覆盖。
- 不提供隐式双向同步。若用户明确要求同步，先说明方向、源和冲突处理，并以本地版本为默认源；发现两侧都被编辑时停止并展示差异。

## 6. 统一回执

任何入库动作都要后台回读验证：

```yaml
storage_receipt:
  backend: local
  project_id: prj_xxx
  project_uri: domi://project/prj_xxx
  document_uri: file:///.../项目主页.md
  record_verified: true
  document_verified: true
  files_verified: true
  status: managed
```

只有 SQLite 反查、Markdown 存在且实体目录验证均通过时才返回 `managed`。回执是机器审计信息，默认报告只写成功／部分完成／失败以及必要下一步，不展示本机路径、内部 ID 或逐字段验证细节。
