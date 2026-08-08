# 飞书知识外挂契约

飞书是 domi 的可选知识外挂和外部文档通道，永远不是项目、人脉、行业事件、待办事项或研究文档的权威资料库。权威数据始终保存在本机 SQLite、Markdown 与工作区附件目录。

## 1. 连接边界

- 连接飞书只建立当前用户的飞书身份与外部能力，不修改 `repositoryBackend`；运行时始终按 `local` 处理。
- **授权能力范围与原完整飞书连接保持一致，不因本地主库而缩减**：连接时保留 Base、Wiki、Docs、Drive、IM 与 Contact 所需权限。一次连接应完成这些能力的统一授权，不要求用户在每次任务中重新授权。
- **连接权限与本轮操作授权是两层概念**：连接完成表示 domi 具备调用能力；只有本轮用户明确要求搜索、读取、创建、编辑、上传、发送或解析收件人时，才实际调用对应 `lark-*` Skill。不能因为已有权限就主动读取或上传内容。
- 不自动创建或迁移项目 Base、人脉 Base、行业动态 Base，不要求用户手工填写 Base Token、Table ID、Wiki Space ID，也不把飞书资源回填成权威记录。用户明确指定某个既有 Base／Wiki／Doc／Drive 资源时，可以把链接或从当前账号可见范围解析出的标识作为本轮目标。
- 账号未连接或权限过期时，只请求用户完成飞书登录／授权，然后从当前飞书阶段恢复。本地归档、查询和编辑继续可用。

完整能力路由：

| 飞书能力 | Skill | 连接后允许的显式动作 | 与本地主库的关系 |
|---|---|---|---|
| Base | `lark-base` | 搜索／读取既有 Base、表、视图、字段和记录；用户明确指定目标与变更时可创建或编辑外部 Base 内容 | 仅作外部参考或用户指定的协作产物，不成为项目／人脉／行业／待办管理账本 |
| Wiki | `lark-wiki` | 浏览／搜索空间与节点；用户明确要求时创建、移动或整理节点 | 是外部知识空间或发布位置，不替代本地目录 |
| Docs | `lark-doc` | 读取、创建、编辑飞书文档 | 是参考文档或发布副本，不替代本地 Markdown |
| Drive | `lark-drive` | 搜索、读取、上传、下载及按明确目标整理文件 | 是外部文件来源或交付位置，不替代本地附件目录 |
| IM | `lark-im` | 向当前用户或已确认收件人发送消息／文档链接 | 仅作交付通道 |
| Contact | `lark-contact` | 按姓名／邮箱解析当前租户内的唯一用户身份 | 仅作收件人与协作者解析，不写入本地人脉库，除非用户另行要求人物入库 |

删除、覆盖、移动等破坏性外部操作仍遵循对应 `lark-*` Skill 的确认规则；“权限完整”不等于允许模型无指令扩大本轮动作范围。

## 2. 按需搜索与读取

设置 `feishu_knowledge_action=search|read` 的触发条件：

- 用户明确说“去飞书知识库／飞书文档／多维表格／云盘里搜”“读取这个飞书链接”，或提供飞书 Base／Wiki／Doc／Drive URL；
- 或用户已明确把本轮“内部知识”范围扩展到飞书。仅因为飞书已连接、或本地没有命中，不得自动外查。

执行规则：

1. 完整采用 `lark-shared`；Base 使用 `lark-base`，知识空间使用 `lark-wiki`，文档正文使用 `lark-doc`，云盘文件使用 `lark-drive`，统一使用当前用户身份。
2. 搜索当前用户有权访问且符合用户指定范围的候选，不要求预先绑定某个 Base 或 Wiki Space。多个同名候选时展示资源类型、标题／表名、所属空间和更新时间，请用户选择；不得凭名称猜测唯一资源。
3. 默认只读。把采用的文档标题、链接和必要证据作为来源记录在本轮研究中；不得把整篇飞书正文静默复制到本地资料库。
4. 用户明确要求“把这份飞书文档保存到本地／并入项目”时，才按本地 `document create` 契约创建 Markdown，并回读 SQLite 文档索引。该动作是导入，不建立双向同步。
5. 搜索／读取失败只影响飞书外挂阶段，不得切换、重建或清空本地资料库。

## 3. 明确命令创建或编辑飞书外部内容

设置 `feishu_knowledge_action=create|edit`，并兼容已有的 `delivery_only=feishu_doc`：

- “创建／发到飞书文档”且没有目标文档：普通文本或模型新生成内容可按明确指令通过 `lark-doc` 创建；若源是现有本地 Markdown，则必须走下述 App host 保真搬运。两者都是外部副本，本地 Markdown 仍为权威源。
- 用户提供目标飞书文档并说“编辑／更新／补充”：采用 `lark-doc` 对该目标做最小范围更新，不新建近似标题文档。
- 用户明确说“在这个 Base 新增／更新记录”或“创建这个外部协作 Base”：采用 `lark-base` 对用户唯一指定的外部目标执行；若目标或字段映射有歧义先确认。该 Base 仍是外部协作产物，不能接管 domi 的项目、人脉、行业事件或待办事项管理。
- 用户明确要求上传／整理飞书云盘文件或整理 Wiki 节点时，分别采用 `lark-drive`／`lark-wiki`；移动、覆盖和删除遵循相应 Skill 的确认要求。
- 用户明确要求放入某个飞书知识库／文件夹时，先唯一解析目标；目标缺失或有歧义时请用户选择。不得依赖固定 Wiki Space ID，也不得自行创建一个“domi文档库”。
- 只说“入库”“归档”“研究并入库”时，一律写本地资料库，不能推断为创建或编辑飞书文档。
- 飞书副本的后续编辑不会自动反写本地；需要回写时，用户必须明确要求“把飞书修改导回本地”，再以本地冲突检查和人工确认处理。

## 4. Markdown → 飞书的保真搬运

用户说“把本地 Markdown 搬到／复制到飞书文档”时，必须把源 Markdown 视为权威源，并完整采用 `lark-doc` 的 Markdown 创建／更新规则。禁止先把文档渲染成纯文本再写入。

先调用插件的单篇保真预检／交接契约，而不是自行拼接低保真文档写入：

```bash
# 预检并生成权限为 0600 的本机审计清单；它不是写入授权
node <plugin-root>/scripts/feishu-markdown-export.cjs prepare \
  --source "/absolute/path/report.md" \
  --out "/private/temp/feishu-export-job.json"

# 返回 App host handoff；该命令本身不会写飞书
node <plugin-root>/scripts/feishu-markdown-export.cjs export \
  --source "/absolute/path/report.md"

# App host 完成写入并在内部回读 Markdown 后，使用本命令做结构校验
node <plugin-root>/scripts/feishu-markdown-export.cjs verify \
  --source "/absolute/path/report.md" \
  --fetched "/private/temp/fetched-from-feishu.md"
```

`export` 始终返回 `FEISHU_EXPORT_HANDOFF_REQUIRED` 和 `status=not_exported`；它只表示预检完成并请求 App host 接管，绝不直接写飞书。预检清单本身不是写入授权，Host 不得信任其中的 action／target 作为授权来源。App host 只能依据用户本轮原始明确指令和当前打开的本地 Markdown 路径重新确定操作并执行 `domi.feishuMarkdownExporter.v1`，不向 Codex 暴露 socket、token、run grant 或任何飞书写凭证。Host 完成写入与回读后只把结构化回执返回模型。**绝不能退化为简单 `docs +create`**，因为那会漏掉本地相对图片或结构。`prepare` 和 `export` 都不代表已创建飞书文档。

若当前客户端没有 host 能力，必须保持未导出并告诉用户该交付阶段尚不可用，禁止表述为“已经上传／已可用”。正常的飞书知识库搜索、读取，以及不以本地 Markdown 为源的明确创建／编辑，仍按第 2、3 节使用 `lark-wiki`／`lark-doc`。

### 4.1 必须保留的结构

- 标题层级、普通段落、粗体、斜体、删除线和行内代码；
- 有序列表、无序列表、任务列表、嵌套层级、引用和分隔线；
- 表格的行列、单元格文字和链接；
- 代码块内容及语言标记；
- 链接文字与目标 URL；
- 图片在正文中的相对顺序、替代文字和图片内容；
- 原有换行、段落边界和可表达的数学公式。

### 4.2 图片处理

1. 在写入前扫描 Markdown 图片节点；相对路径以源 `.md` 所在目录解析，绝对路径与 `file://` 路径按本机文件解析，HTTP(S) 图片先验证可读取。
2. 本地图片逐一上传为目标飞书文档内的图片资源，并放回对应 Markdown 图片节点的位置；禁止把本机路径或 `file://` 地址写进飞书正文。
3. 任一图片缺失、无法读取、类型不支持或上传失败时停止“成功”回执，明确列出失败图片；不得跳过图片后仍声称完整搬运。
4. 相同内容图片按哈希复用本轮上传结果，重试不得重复插入。

### 4.3 无损转换与校验

1. 写前生成仅保存在本机临时目录的 `fidelity_manifest`：正文规范化哈希，以及标题、段落、列表项、表格单元格、代码块、链接和图片的数量与顺序。临时文件任务结束后删除，不写入插件或 Git。
2. App host 内部可以使用受控的 Markdown／XML 等价块完成转换；调用本契约的 Skill 或脚本不得自行执行裸文档创建。没有语义等价表示时先提示用户，禁止静默删除、压平或改写。
3. 写后用 `docs +fetch --doc-format markdown` 回读，规范化后与 manifest 比较。至少核验：正文文字、标题／列表层级、全部表格单元格、代码块、链接目标、图片数量与顺序。
4. 首次不一致时只修复差异块并再次回读；仍不一致则返回 `partial`，保留本地源文档和可恢复回执，不得标记“已完整复制”。
5. 只有 `content_verified=true`、`structure_verified=true`、`links_verified=true`、`images_verified=true` 时，才向用户报告“格式和内容已完整搬到飞书”。

保真搬运回执示例：

```yaml
feishu_document_receipt:
  action: create | edit
  source: local_markdown
  content_verified: true
  structure_verified: true
  links_verified: true
  images_verified: true
  status: delivered
```

回执中的本机路径、文档 token、用户标识和空间标识不得出现在默认完成报告或诊断日志中。

## 5. 幂等与隐私

- 创建使用 `workflowRunId + sourceContentHash + targetIdentity` 作为幂等键；编辑使用 `targetDocument + sourceContentHash + operation`。状态不确定时先查询，不直接重建或重写。
- 不把飞书全文、授权凭据、文档 token、空间标识、用户标识或本机路径写入 Skill、Git、公开日志或诊断报告。
- 用户没有明确指定目标或写入范围时，飞书写操作必须停在候选确认，不能扩大权限或写入范围。
