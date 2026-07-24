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
