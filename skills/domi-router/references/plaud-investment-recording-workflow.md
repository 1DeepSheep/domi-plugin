# PLAUD 投资录音处理工作流

## 目标

把 PLAUD 尚未生成文字稿的投资录音处理为结构化纪要；若内容属于创业项目或创始人交流，则继续完成投资快评、飞书 Wiki 文档归档、本地资料库归档，并新增或更新飞书多维表格“1.0 项目Watching List”。

## 一、恢复未完成任务

1. 采用 domi 的 `plaud` Skill，运行 `queue`。
2. 按阶段恢复：
   - `transcript_ready` → 第三步生成回忆提示并询问上下文。
   - `context_pending` → 第三步处理用户补充或跳过指令；不得重新生成文字稿。
   - `context_ready` → 第四步 ASR Notes。
   - `notes_project` → 先运行 `verify <fileId>`；通过时进入第六步投资快评，旧记录缺失/失效时回到第四步重做最终事实审计并重新标记。
   - `reviewed` → 先运行 `verify <fileId>`；通过时进入第七步，旧记录缺失/失效时回到第四至第六步补审计。
   - `documented` → 先运行 `verify <fileId>`；通过时进入第八步，旧记录缺失/失效时回到第四至第七步补审计并同步归档文档。
   - 失败或超时项先报告原因；`generation_timeout` 先尝试下载，不要重复生成。
3. 恢复项处理完后再发现新的未生成录音。

## 二、发现、生成并下载文字稿

1. 运行 `pending 100`。
2. 没有 pending 项时，报告“没有未生成文字稿的 PLAUD 录音”，继续处理队列中的恢复项后结束。
3. pending 数量为 1-10 时，运行 `sync-pending` 处理全部。
4. 超过 10 条时，先报告总数并让用户确认本次处理数量，避免一次性消耗过多 PLAUD 生成额度和处理时间。
5. 输出目录使用当前工作区：`work/domi/plaud/<YYYYMMDD-HHMMSS>/`。
6. 生成完成标准：每条录音都获得 `transcriptPath`，并在队列中为 `transcript_ready`。失败项不得进入下一步。

## 三、生成回忆提示并确认对话上下文

每条录音获得 `transcriptPath` 后、采用 `asr-notes` 前，必须执行本阶段。不要在 PLAUD 生成文字稿之前询问，因为回忆提示需要来自实际文字稿。

### 生成回忆提示

1. 只做轻量扫描，不开始 ASR Notes 的实体核验、联网搜索或结构化整理。
2. 优先读取 PLAUD 元数据中的录音标题、日期、时间和时长；再抽样查看文字稿开头、结尾及高频主题段落。
3. 每条录音生成一段不超过 150 字的回忆提示，包含：
   - 录音时间／标题／时长中可用的信息；
   - 2–4 个主要话题线索；
   - 文字稿中疑似出现的公司、项目或姓名。此时尚未核验，必须写成“文字稿疑似提到”，不得当作确定事实。
4. 多条录音合并为一次询问，每条分别编号，避免连续打断用户。

### 询问用户

在发送问题前，先为每条录音运行：

```text
mark <fileId> context_pending - {"contextPromptedAt":"<ISO-8601>","recallSummary":"<不超过150字的回忆提示>"}
```

然后询问：

```text
这段录音大概是什么对话？参会人有哪些？

回忆线索：<简短提示>

请尽量补充：
- 对话类型和目的（如创始人项目交流、行业专家访谈、内部讨论）；
- 参会人姓名、公司／机构和职位，知道多少写多少。

如果记不清，可以回复“直接处理”，我会根据文字稿继续。
```

本轮到此暂停，不得在同一条问题之后假设用户已经回答并继续 ASR Notes。

### 处理用户回复

- 用户给出任何具体对话背景或参会人信息：保留其原意，标记 `contextStatus=provided`，把 `conversationType`、`conversationPurpose`、`participants` 和必要的 `userContext` 写入 `context_ready` metadata，然后继续第四步。只保存 ASR Notes 所需的简要上下文，不复制整段回复或文字稿。
- 用户回复“不知道”“不确定”“记不清”“跳过”“直接处理”“继续”，或在下一次明确要求继续该工作流但没有提供上述具体信息：标记 `contextStatus=skipped` 后直接继续第四步，不再追问。
- 用户尚未回复、也没有再次要求继续：保持 `context_pending`，不要后台等待或自行运行后续步骤。
- 用户只补充部分信息也属于 `provided`；不要为了补齐所有姓名、公司或职位再次追问。

示例：

```text
mark <fileId> context_ready - {"contextStatus":"provided","conversationType":"创始人项目交流","participants":["A公司创始人张三","B基金李四"]}
mark <fileId> context_ready - {"contextStatus":"skipped"}
```

完成标准：每条待处理录音均为 `context_ready`。未达到该阶段的录音不得进入 ASR Notes。

## 四、使用 ASR Notes 生成纪要

1. 对每个 `context_ready` 项，把 `transcriptPath`、`contextStatus` 及用户提供的对话背景和参会人信息一并传给 domi 的 `asr-notes` Skill，并完整遵循其实体核验、数字审计、联网搜索、结构化和完整性审计规则。
2. PLAUD transcript 已经是文字文件，因此跳过本地 Qwen 音频转写阶段。
3. 上游已完成一次上下文确认，`asr-notes` 不得重复询问参会人：`provided` 时优先利用用户信息并与文字稿交叉核对；`skipped` 时直接从文字稿推断，无法确认则按 `asr-notes` 规则标记待补充。
4. 每条录音默认只输出一个结构化纪要 Markdown；用户明确要求时才额外输出精修逐字稿。
5. 项目访谈中，纪要交付前必须完成三张核心人物证据表：学历原子证据表、履历/职级时间线、模型工作表。本科/硕士/博士分别绑定证据；职级、岗位、预算/实际人数分别记录；模型工作区分提出、主导、带队、参与、共同作者和团队完成。对确定语气但无合格证据的事实，删除或标记待确认，不得串层级、串人物或弱化明确主责。
6. 材料校验和待确认项联网复核全部结束后，对**最终纪要文件**重新完成实体、数字、学历分层、履历覆盖、模型归因、句内冲突和完整性审计，再生成 `notesAudit`。三个 claim count 统计进入纪要的证据表行；即使为 0，也必须明确记录审计已执行。
7. 纪要生成后执行第五步分类并更新队列：
   - `project`：运行下列命令；`<notesPath>` 必须指向最终纪要文件。CLI 将校验声明并自动绑定文件 SHA-256。
     ```text
     mark <fileId> notes_project <notesPath> {"notesAudit":{"status":"passed","evidenceLedgerComplete":true,"degreeIsolation":true,"claimConsistency":true,"careerLedgerComplete":true,"modelWorkLedgerComplete":true,"attributionConsistency":true,"educationClaimCount":<非负整数>,"careerClaimCount":<非负整数>,"modelWorkClaimCount":<非负整数>,"unresolvedDefinitiveEducationClaims":0,"unresolvedDefinitiveCareerClaims":0,"unresolvedDefinitiveModelWorkClaims":0}}
     ```
   - `non_project`：标记 `notes_non_project`。

完成标准：纪要文件存在、分类已完成；`project` 项还必须成功写入通过状态的 `notesAudit`。未满足时不得进入投资快评、飞书文档或 Watching List。

## 五、判断是否属于创业项目或创始人交流

不要仅因为 `asr-notes` 默认采用投资模板就判为项目。根据实质内容判断。

满足以下多数条件时标记为 `project`：

- 参会方包含创始人、联合创始人、核心管理者或代表公司融资／业务的人。
- 对话围绕一个具体公司或创业项目，而不是泛行业话题。
- 内容涉及团队、产品／技术、商业化、客户、竞争、融资或估值中的多个维度。
- 交流目的包含项目介绍、融资沟通、投资判断、尽调或后续跟踪。

以下通常标记为 `non_project`：行业专家访谈、内部会议、播客／媒体采访、培训、纯技术讨论、LP／基金交流、没有具体公司标的的行业交流。

如果证据相互冲突且会影响 Watching List 写入，先向用户确认。`non_project` 只保留纪要并结束，不评分、不写 Watching List。

## 六、使用 Investment Review 评分

1. 对 `project` 纪要采用 domi 的 `investment-review` Skill。
2. 纪要是主要输入；必要时用公开信息交叉验证创始人、公司、竞品和融资事实。
3. 完整遵循 3-5 个关键问题、对应判断、1-10 分且禁用 5 分、B/A/S 评级的输出格式。
4. 快评不得新增、改写或跨层级传播纪要中的学历、职级、组织责任和模型归因；完成后逐项对照纪要的团队背景和技术章节。若确需更正，先回到第四步更新纪要并重做 `notesAudit`，再重新生成快评。
5. 将快评保存为与纪要同目录的 `[纪要标题]-review.md`。
6. 一致性通过后运行 `mark <fileId> reviewed <reviewPath> '{"score":X,"rating":"A","reviewAudit":{"status":"passed","educationConsistency":true,"careerModelConsistency":true}}'`。评级必须使用 Investment Review 原样输出，不自行重映射；CLI 自动绑定快评 SHA-256。

## 七、按当前后端归档文档与项目资料

本阶段是 `project` 类型录音的强制阶段。先读取 `investment-mgmt/references/storage-backends.md` 并锁定后端：

- 飞书模式：采用并完整遵循 `lark-doc`、`lark-wiki` 和 `investment-mgmt` 的当前规则。
- 本地模式：只采用 `investment-mgmt` 的本地网关；用 `project search/upsert` 与 `document create` 完成 SQLite、Markdown 和资料目录闭环，不要求 Wiki。

当前后端缺少经过验证的文档 URI 或项目库路径时，不得进入结构化项目记录写入。

### 1. 确定分类与目标目录

1. 从纪要和快评提取规范公司名、会议日期、领域、子领域和评级；分类必须来自 `investment-mgmt/references/taxonomy.md`。
2. 用 `investment-mgmt/references/folder_map.md` 把主子领域映射到 Wiki 文件夹。多个子领域时选择最能代表当前项目的一个作为 Wiki 和本地资料库主目录，其他子领域仍可写入 Watching List。
3. 无法高置信度确定公司名或主目录时暂停写入并让用户确认，不得放入猜测目录。

### 2. 文档查重与写入

飞书模式按以下 Wiki 规则执行：

1. 从 `$DOMI_CONFIG_PATH` 读取 `wikiSpaceId`，在该 Wiki 空间中按公司中文名、英文名、产品名和主体名查重；同时排除聚合文档和同名无关项目。配置缺失时停止并提示用户到 domi“设置 → 资料连接”补充。
2. 唯一明确匹配时复用既有 `wiki_node_token` 和 `doc_token` 更新正文，保留用户已有的独立章节、图片、附件和产品更新；不得再建同名节点。若既有正文含先前桌面研究，本次新增真实交流纪要时必须重排为“交流纪要在前、桌面研究作为独立 Part 在后”，不得把纪要追加在研究末尾或把两者交叉改写。需要 Part 标签时使用顶格加粗行 `**Part 1｜交流纪要**` 与 `**Part 2｜桌面研究**`，保留两块正文原有的 `####` / `#####` 层级。
3. 无匹配时，在目标行业文件夹下创建新的 Docx Wiki 节点。标题使用 `YYYYMMDD-公司名-主题-评级`；如果评级不适合进入标题，可省略评级，但必须保留日期和公司名。
4. 多个相似匹配时先让用户确认，不得盲目创建或覆盖。
5. 文档至少包含结构化纪要与投资快评；有辅助 slides、BP 或研究底稿时，在正文中保留其关键事实校验结果，原文件归档到项目库。
6. 写入后执行 `docs +fetch` 核验标题、参会人、核心章节、评分／评级和关键数字；存在桌面研究时还要核验交流纪要位于研究之前，再用 Wiki `get_node` 核验父节点链确实位于目标行业目录。

本地模式改为：

1. 用 `project search` 按公司中文名、英文名、产品名和主体名查重；多匹配时先确认。
2. 用 `project upsert` 建立／更新 SQLite 记录、稳定项目目录和 `项目主页.md`。
3. 用 `document create` 把纪要和快评分别写入 `纪要/` 与 `研究/`。
4. 写后用 `project get` 和 `workspace verify` 回读；禁止仅创建 Markdown 而不写 SQLite。

### 3. 本地材料归档

1. 从 `$DOMI_CONFIG_PATH` 读取 `localLibraryDir` 作为根目录；兼容旧配置时回退到 `oneDriveProjectDir`。不得在 Skill 中固定用户名、同步服务商或个人目录。
2. 飞书模式沿用现有规范目录；本地模式固定使用 `<领域>/<主子领域>/<公司名>/`，日期、评级和状态写入文档与 SQLite，不进入项目根目录名。
3. 归档当前流程中实际存在的源材料：slides／BP、PLAUD 原始文字稿、结构化纪要、投资快评及用户提供的其他项目材料。不得复制认证信息、Cookie、PLAUD 状态文件或无关聊天内容。
4. 同名文件已存在时先比较内容：相同则跳过；内容不同则使用明确版本名保留双方，不静默覆盖用户文件。
5. 写后列出目录文件并校验关键二进制文件的大小或校验和。

### 4. 阶段标记

完成标准：当前后端的结构化记录、文档正文和项目目录均已写后验证。飞书模式运行：

```text
mark <fileId> documented - {"wikiUrl":"WIKI_NODE_URL","wikiNodeToken":"NODE_TOKEN","docToken":"DOC_TOKEN","oneDrivePath":"/absolute/project/path"}
```

本地模式运行：

```text
mark <fileId> documented - {"projectId":"prj_xxx","storageReceipt":{"backend":"local","projectId":"prj_xxx","documentUri":"file:///.../项目主页.md","libraryPath":"/absolute/project/path","recordVerified":true,"documentVerified":true,"filesVerified":true,"status":"managed"}}
```

任一可恢复的归档步骤失败时保持 `reviewed`，用 `mark <fileId> reviewed <reviewPath> '{"score":X,"rating":"A","reviewAudit":{"status":"passed","educationConsistency":true,"careerModelConsistency":true},"archiveError":"reason"}'` 保存错误并重新绑定同一快评文件；只有确认无法继续的非恢复性错误才标记 `failed`。不得伪造 `documented`，也不得跳过归档继续写入 Watching List。

## 八、使用 Investment Mgmt 新增或维护项目记录

采用 domi 的 `investment-mgmt` Skill，并严格遵守它当前的工具、字段 schema、分类和状态规则。

### 去重

1. 从纪要中提取规范公司名；无法确认公司名时停止写入并让用户补充。
2. 飞书模式使用 `公司名称 contains`；本地模式使用 `project search --query`。两者都检查中英文名、产品名和主体名。
3. 唯一明确匹配时更新该 record；无匹配时新增；多个相似匹配时先让用户确认。

### 字段

- `公司名称`：纪要中核实后的规范名称。
- `领域` / `子领域`：优先保留现有合法分类；新增项目按 `investment-mgmt/references/taxonomy.md` 判断，低置信度时让用户确认。
- `进展状态`：创始人／项目交流默认 `已交流`；只有持续跟进事实成立时才改为 `深度跟踪`，不得因评级自动升级。
- `项目评级`：直接使用 Investment Review 的 B/A/S 评级。
- `最后更新时间`：第一次入库，或本次补充公司／创始人重要信息、更新项目纪要、评级、状态、链接等关键内容时，填写 Asia/Shanghai 的操作当天；不要用会议日期或录音日期替代。只做查询、格式整理或无实质增量时不更新。
- `Notes`：写入 `投资快评：X/10，评级Y。` 加 1-2 句 conviction，不粘贴整篇纪要。
- `文档 URI`：飞书模式使用已验证的 Wiki URL；本地模式使用项目主页 `file://` URI。缺失时回到第七步恢复。

涉及重要内容更新时，把业务字段和 `最后更新时间` 放在同一次写入请求中。飞书模式使用 `lark-cli base +record-upsert`；本地模式使用 `domi-repo.cjs project upsert`。不要绕过当前后端网关。

### 完成

写入后重新搜索公司名，核对公司名称、进展状态、评级、链接和最后更新时间。成功后运行：

```text
mark <fileId> managed - {"action":"created|updated","recordId":"recXXX","wikiUrl":"WIKI_NODE_URL","oneDrivePath":"/absolute/project/path"}
```

本地模式将 `recordId` 替换为 `projectId`，并继续携带第七步的 `storageReceipt`。

## 九、最终报告

按录音输出：

| 录音 | 文字稿 | 纪要 | 类型 | 评分／评级 | 文档 URI | 资料目录 | 项目记录 |
|---|---|---|---|---|---|---|---|

另列后端、失败、待确认说话人、分类低置信度项和实际写入的最后更新时间。`project` 类型若缺失当前后端的文档 URI、结构化记录或项目路径，应报告为未完成而不是成功。不要在最终报告中输出任何 PLAUD 鉴权信息。
