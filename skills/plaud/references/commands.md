# PLAUD 安全 CLI

从 `skills/plaud/SKILL.md` 所在目录解析 `scripts/plaud.js` 的绝对路径，以下以 `<plaud-cli>` 代替。

## 命令

```bash
node <plaud-cli> doctor [chrome|tabbit]
node <plaud-cli> login [chrome|tabbit]
node <plaud-cli> connection [chrome|tabbit]
node <plaud-cli> logout [chrome|tabbit]
node <plaud-cli> status [limit]
node <plaud-cli> pending [limit]
node <plaud-cli> queue
node <plaud-cli> verify <fileId>
node <plaud-cli> sync-pending [count] [outDir] [timeoutSec] [pollSec]
node <plaud-cli> transcribe-local <audioPath> [outDir] [timeoutSec] [pollSec] [title] [--workflow-id ID] [--adopt-file-id ID] [--retry-upload] [--retry-generation]
node <plaud-cli> download <fileId> [outDir]
node <plaud-cli> mark <fileId> <stage> [artifactPath|-] [metadataJson]
```

## 行为

- `doctor`：不登录 PLAUD，只检查运行环境、所选浏览器、Playwright，以及 domi 内置 FFmpeg/ffprobe；客户端外单独调用时可使用 PATH 中的音频工具。
- `login`：打开 domi 专用 Chrome／Tabbit Profile，等待用户亲自登录，并通过一次只读远端请求验证账号；不读取日常浏览器 Profile。
- `connection`：用当前 domi 专用 Profile 发起只读远端验证，返回浏览器类型和不可逆账号指纹，不返回账号标识或鉴权信息。
- `logout`：只删除所选 domi 专用浏览器 Profile；不影响用户日常 Chrome／Tabbit Profile。
- `status`：读取最近文件的聚合状态。
- `pending`：只返回尚无文字稿且无摘要的录音，字段经过清理，不包含鉴权信息。
- `queue`：读取 `~/.domi/plaud-workflow.json` 中尚未结束的 domi 处理项。
- `verify`：只读校验指定队列项的 `notesAudit`、`reviewAudit`、评分/评级和已绑定文件 SHA-256；失败时输出 `ok:false` 并以非零状态退出。
- `sync-pending`：触发最多 `count` 条未生成录音，轮询等待 transcript，下载 JSON 和 Markdown，并写出 manifest。
- `transcribe-local`：对一条已校验的本地音频计算 SHA-256；MP3/ASR/Opus 直接上传，其余受支持格式用 domi 内置的离线 FFmpeg 转为单声道 Opus，再按稳定标题去重上传。只针对上传返回的精确 `fileId` 触发生成并下载 transcript。`--workflow-id` 把该音频绑定到快速讨论；不带时为普通 `local_transcription`。`--adopt-file-id` 只用于用户从歧义候选中明确选择一条且远端稳定标题校验通过的恢复。`--retry-upload` 仅用于用户明确接受 `upload_unknown` 可能导致重复上传的情况；`--retry-generation` 仅用于用户明确接受 `generation_submitting/generation_unknown/generation_timeout` 可能导致重复提交生成请求的情况。
- `download`：下载指定 fileId 的 transcript，不重新触发生成。
- `mark`：更新 domi 工作流阶段。`metadataJson` 必须是 JSON 对象。
  - `notes_project` 只能从 `context_ready` 进入（已生成项目纪要的重试、纠正分类、旧队列回补审计，或显式重开已完成记录除外），必须提供实际存在的纪要文件和新的 `notesAudit`。除原有实体/数字/学历字段外，还必须包含：`careerLedgerComplete=true`、`modelWorkLedgerComplete=true`、`attributionConsistency=true`、非负整数 `careerClaimCount/modelWorkClaimCount`、`unresolvedDefinitiveCareerClaims=0`、`unresolvedDefinitiveModelWorkClaims=0`。CLI 自动计算并保存纪要 SHA-256，不接受继承旧审计来批准另一份文件。
  - `reviewed` 只能从 `notes_project` 进入或同阶段重试，必须提供实际存在的快评文件、新的 `score`/`rating` 和 `reviewAudit`：`status=passed`、`educationConsistency=true`、`careerModelConsistency=true`。`score` 必须为 1-10 的整数且禁用 5，`rating` 必须为 B/A/S。CLI 自动绑定快评 SHA-256，并在进入 `documented`、`managed` 前重新校验纪要与快评文件未变化。
  - `documented` 只能从 `reviewed` 进入或同阶段重试，并强制要求 `wikiUrl`、`wikiNodeToken`、`docToken`、`oneDrivePath`。
  - `managed` 只能从 `documented` 进入或同阶段重试，并强制要求 `recordId`；CLI 会拒绝从 `reviewed` 直接跳过归档。
  - `discussion_notes_ready` 只能从 `context_ready` 进入或同阶段重试，且记录必须有 `workflow=quick_discussion`、合法 `workflowId` 与非空 `discussionTopic`；CLI 自动把工作流身份、主题、文字稿、规范化上下文与纪要 SHA-256 绑定。`mark` metadata 不得覆盖 `workflow/workflowId`、源音频身份、文字稿路径或讨论审计字段。
  - `discussion_complete` 只能从 `discussion_notes_ready` 进入或同阶段重试，必须提供讨论摘要文件；CLI 会重新校验纪要输入指纹并绑定摘要 SHA-256。

## mark 示例

```bash
node <plaud-cli> mark FILE_ID notes_project /absolute/path/to/notes.md '{"notesAudit":{"status":"passed","evidenceLedgerComplete":true,"degreeIsolation":true,"claimConsistency":true,"careerLedgerComplete":true,"modelWorkLedgerComplete":true,"attributionConsistency":true,"educationClaimCount":3,"careerClaimCount":8,"modelWorkClaimCount":6,"unresolvedDefinitiveEducationClaims":0,"unresolvedDefinitiveCareerClaims":0,"unresolvedDefinitiveModelWorkClaims":0}}'
node <plaud-cli> mark FILE_ID notes_non_project /absolute/path/to/notes.md
node <plaud-cli> mark FILE_ID context_pending - '{"contextPromptedAt":"2026-07-12T12:00:00Z","recallSummary":"AI Agent项目交流，提到融资和客户试点"}'
node <plaud-cli> mark FILE_ID context_ready - '{"discussionTopic":"产品路线讨论","contextStatus":"provided","conversationType":"创始人项目交流","participants":["某公司创始人张三","某基金李四"]}'
node <plaud-cli> mark FILE_ID context_ready - '{"contextStatus":"skipped"}'
node <plaud-cli> mark FILE_ID discussion_notes_ready /absolute/path/to/notes.md
node <plaud-cli> mark FILE_ID discussion_complete /absolute/path/to/discussion-brief.md
node <plaud-cli> mark FILE_ID reviewed /absolute/path/to/review.md '{"score":8,"rating":"A","reviewAudit":{"status":"passed","educationConsistency":true,"careerModelConsistency":true}}'
node <plaud-cli> mark FILE_ID documented - '{"wikiUrl":"WIKI_NODE_URL","wikiNodeToken":"NODE_TOKEN","docToken":"DOC_TOKEN","oneDrivePath":"/absolute/project/path"}'
node <plaud-cli> mark FILE_ID managed - '{"action":"updated","recordId":"recXXX"}'
node <plaud-cli> mark FILE_ID failed - '{"error":"reason"}'
```

允许阶段：`uploading`、`uploaded`、`upload_failed`、`upload_unknown`、`upload_recovery_ambiguous`、`generation_submitting`、`generating`、`generation_unknown`、`generation_failed`、`generation_timeout`、`download_failed`、`transcript_ready`、`context_pending`、`context_ready`、`notes_project`、`notes_non_project`、`reviewed`、`documented`、`managed`、`discussion_notes_ready`、`discussion_complete`、`failed`。

## 输出约定

所有命令将机器可读 JSON 写到 stdout。`sync-pending` 同时在输出目录写入 `domi-plaud-manifest-<timestamp>.json`。调用方必须从 JSON 字段读取 `fileId`、`fileName`、`transcriptPath` 和 `manifestPath`，不要从人类可读日志猜测路径。

## 恢复规则

- `transcript_ready`：先生成回忆提示并询问对话背景与参会人，不得直接调用 `asr-notes`。
- `context_pending`：等待用户补充；用户提供具体信息或表示不知道、跳过、直接处理后，标记为 `context_ready`。
- `context_ready`：从文字稿和已保存的上下文继续调用 `asr-notes`。
- `notes_project`：先运行 `verify <fileId>`；通过后从纪要继续调用 `investment-review`，旧记录缺审计时先重做事实审计并重新标记 `notes_project`。
- `reviewed`：先运行 `verify <fileId>`；通过后从快评继续创建或更新飞书 Wiki 项目文档，并完成本地资料库归档，旧记录缺审计时回退重做审计，不得直接跳到 Watching List。
- `documented`：复用已保存的 `wikiUrl`、`wikiNodeToken`、`docToken` 和 `oneDrivePath`，继续调用 `investment-mgmt` 写入 Watching List并回填链接；不得重复创建文档或项目目录。
- `notes_non_project` 和 `managed` 是结束状态，不出现在 `queue`。
- `generation_timeout` 不代表 PLAUD 已停止处理。稍后先尝试 `download <fileId>`；成功后标记为 `transcript_ready`，不要再次生成。
- `upload_unknown` 先重新运行同一 `transcribe-local` 等待稳定标题出现，不得默认追加 `--retry-upload`。
- `upload_recovery_ambiguous`：从 `queue` 读取 `uploadCandidateFileIds`，让用户明确选择后，用同一命令追加 `--adopt-file-id <所选ID>`；CLI 校验不通过时继续暂停，不得猜测。
- `generation_unknown`、`generation_timeout` 和 `download_failed` 都复用已保存的精确 `fileId` 继续下载，不重新上传或重复生成。
- `generation_submitting`、`generation_unknown` 或 `generation_timeout` 长时间仍无文字稿时，先报告不确定性；用户明确同意潜在重复生成请求后，才用同一 `transcribe-local` 命令追加 `--retry-generation`。CLI 仍会在重提前再下载检查一次，已就绪则不重提；`download_failed` 只重试下载，不使用该选项。
- `discussion_notes_ready`：校验通过后只补讨论摘要并标记 `discussion_complete`，不得重做 PLAUD 生成或 ASR Notes。
- `discussion_complete` 是快速讨论终态，不出现在 `queue`。
