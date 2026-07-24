# Domi 资料库后端契约

所有会读取或写入项目、人脉、行业事件、项目文档或资料文件的 Domi 工作流，必须先解析资料库后端。后端是显式配置，不得根据飞书令牌、授权状态或网络错误猜测。

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
- 配置缺失时停止并提示用户到豆米“设置 → 资料连接”选择模式。
- 飞书授权过期只报告飞书错误，不得静默切换本地。
- 切换后端不代表迁移数据；没有显式迁移命令时禁止复制、删除或覆盖另一后端的数据。

### 本地 → 飞书的显式迁移

豆米客户端从本地模式切换到飞书模式时，可由用户明确开启“先迁移本地资料，再切换到飞书”。只有这条受控路径获得了跨后端写入授权：

1. 切换前验证飞书用户身份、项目 Base、People Base、行业动态 Base、Wiki Space、本地资料库和所有必需连接；任何一项缺失都不开始迁移。
2. 预检本地 SQLite 中的项目、人脉与行业事件，读取三个目标 Base 的真实字段和选项，并统计每个项目目录中的 Markdown。字段缺失、taxonomy 不兼容、业务键重复或同名记录无法唯一匹配时停止，禁止猜测字段、创建隐式选项或覆盖不确定记录。
3. 项目结构化记录写入 Watching List；用「公司名称」精确匹配现有记录。People 结构化记录写入 People Base；先按「人名」查找，再结合「所属组织&身份」唯一匹配，`类型` 只保留一个主类型。行业事件写入行业动态 Base；只按稳定「事件ID」精确去重，旧版证据状态和建议动作先归一到当前契约。
4. 仅项目文档创建飞书 Wiki 文档。使用 canonical 领域／主子领域和 `folder_map.md` 定位目标文件夹；找不到唯一目录时停止该项目，禁止降级到 Wiki 根目录或猜测分类。
5. `项目主页.md` 创建为目标子领域下的项目主页；同一项目的纪要、研究及其他 Markdown 创建为项目主页的子文档。本地图片按原文位置上传，其他原始附件继续保留在本地。人物主页和行业事件 Markdown 不额外创建 Wiki 文档，它们的结构化内容分别进入 People Base 与行业动态 Base。
6. 同名在线文档只有在本地迁移账本能证明是豆米先前创建时才允许覆盖更新；未知来源的同名文档一律报告冲突，不得覆盖。
7. 项目主页与子文档逐篇回读成功后，才创建或更新 Watching List 并回填项目主页链接。纯机械迁移不刷新已有项目记录的「最后更新时间」。
8. 项目、人脉和行业事件的每条 Base 写入都必须按业务键重新查询，并验证本次写入字段；`record-upsert` 不得被误认为会自动按业务键去重。
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

项目目录固定为：

```text
<localRepositoryDir>/3.项目库/<领域>/<主子领域>/<项目名称>/
├── 项目主页.md
├── 纪要/
├── 研究/
├── 原始材料/
└── 导出/
```

项目根目录不要带日期、评级或进展状态；这些会变化的信息只写 SQLite 与 `项目主页.md`。多子领域时，SQLite 可保存多个，目录只使用第一个主子领域。

行业事件的 Markdown 镜像位于：

```text
<localRepositoryDir>/2.行业动态/<YYYY>/<MM>/<事件ID>.md
```

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
  "investors": ["示例机构"],
  "lastUpdatedAt": "2026-07-24T00:00:00+08:00"
}
```

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

不论后端，工作流完成时都要输出可验证的回执；不得只说“已入库”：

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
