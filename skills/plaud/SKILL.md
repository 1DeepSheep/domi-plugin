---
name: plaud
description: 安全访问本机 PLAUD 录音，上传 Mac 本地录音，查询文件状态，触发生成，等待并下载 transcript，并维护 domi 的可恢复处理队列。当用户提到 PLAUD、上传录音到 PLAUD、未生成录音、生成文字稿、下载 transcript、同步 PLAUD、快速讨论或运行 domi 录音工作流时使用。使用插件内置的安全 CLI，不输出鉴权头，也不调用旧版自动写飞书 pipeline。
---

# PLAUD

使用插件自带的安全 CLI 访问 PLAUD。鉴权来自本机 Tabbit 已登录会话；任何授权头、Cookie 或 Tabbit profile 都不得写入插件、工作产物或消息。

## 入口

从本 `SKILL.md` 所在目录解析脚本绝对路径：

```text
scripts/plaud.js
```

使用 `node <resolved-script-path> <command> ...` 调用。需要完整参数说明时读取 [references/commands.md](references/commands.md)。

## 用户设置守卫

运行任何 PLAUD 命令前，先读取环境变量 `DOMI_CONFIG_PATH` 指向的 JSON 配置（只读取，不在输出中打印配置内容）：

- `plaudConnectionMode: "disabled"`：立即停止，不运行 `doctor`、`queue`、上传、生成、下载或任何其他 PLAUD 命令；告诉用户可在豆米“设置 → 录音转写”中开启。
- `plaudConnectionMode: "enabled"`：继续本 Skill。
- 配置文件或该字段不存在：仅视为旧版本兼容状态；仍须遵循下方授权与安全边界，不得把缺失配置解释为新的上传授权。

用户选择“暂时不用”后，任何通用工作流都不得为了健康检查、诊断或恢复队列而探测 Tabbit / PLAUD。

## 账户内已有录音的标准流程

以下 1–5 步只适用于 PLAUD 账户里已经存在、但尚未生成或整理的录音。若上游已经给出精确本地 `audioPath`，尤其是 `workflowKind=quick-discussion`，直接走“本地录音上传与转写”分支；不得先运行 `queue`、`pending` 或 `sync-pending`，也不得让其他队列项阻塞当前讨论。

1. 先运行 `doctor`，仅检查 Node、Tabbit、登录数据和内置依赖是否存在。
2. 运行 `queue`，优先恢复之前已生成但尚未完成纪要、评分、文档归档或入库的项目；对 `notes_project`、`reviewed`、`documented` 项先运行 `verify <fileId>` 只读核验审计与文件哈希。
3. 运行 `pending 100` 查询最近未生成文字稿的录音。
4. 用户明确要求生成或运行 domi 主工作流时，运行 `sync-pending <count> <outDir> [timeoutSec] [pollSec]`。
5. 使用返回的 `transcriptPath` 生成简短回忆提示，在运行下游 Skill 前确认对话背景和参会人；每完成一阶段就调用 `mark` 更新队列。

## 本地录音上传与转写

`mac-recording` 已正常停止并返回经过音频校验的 `audioPath` 后，运行：

```text
transcribe-local <audioPath> [outDir] [timeoutSec] [pollSec] [title] [--workflow-id ID] [--adopt-file-id ID] [--retry-upload] [--retry-generation]
```

- 该命令按源音频 SHA-256 去重，使用稳定远端标题上传，只对返回的精确 `fileId` 触发一次生成，再等待并下载 transcript；不得改用 `pending` 或 `sync-pending` 猜测刚上传的文件。
- `--workflow-id` 只用于 `quick-discussion`，必须传入 `mac-recording` 返回的 16 位 ID；不带该参数的普通本地转写标记为 `local_transcription`，不得进入快速讨论终态。
- `transcript_ready`、`generating`、`generation_submitting`、`generation_unknown`、`generation_timeout` 或 `download_failed` 重试时复用既有 `fileId`，优先下载，不得重新上传或盲目重新生成。
- `upload_unknown` 表示 PLAUD 可能已确认上传但响应丢失。命令会先多次按稳定标题恢复；远端仍不可见时必须保留该阶段并稍后重试。只有用户明确同意可能重复上传时才追加 `--retry-upload`。
- `upload_recovery_ambiguous` 会在队列中列出候选 `uploadCandidateFileIds`。用户明确选定其中一条后，用 `--adopt-file-id <fileId>` 恢复；CLI 仍会验证该 ID 的远端标题与本地音频的稳定标题完全一致，不接受任意 ID。
- `generation_submitting`、`generation_unknown` 或 `generation_timeout` 长时间仍无文字稿时，报告生成请求结果不确定并暂停。只有用户明确同意可能重复提交生成请求后，才可用同一命令追加 `--retry-generation`；该选项只接受上述三个阶段，并在重提前再下载检查一次，仍无文字稿才提交并记录确认时间。
- 输出只使用白名单字段，不得返回预签名 URL、`uploadId`、`objectName`、API 原始响应、Cookie 或鉴权头。

## 安全边界

- 禁止调用全局 CLI 的 `plaud auth`；它会输出鉴权头。
- 禁止调用旧版 `plaud pipeline ...`；该流程会自行启动 Codex 并写飞书，不属于 domi 的受控链路。
- `status`、`pending`、`queue`、`verify` 和 `doctor` 是只读操作。
- `sync-pending` 会在 PLAUD 中触发生成。只有用户明确要求生成、同步或运行 domi 主工作流时才能执行。
- `transcribe-local` 会把本地音频上传到 PLAUD 并触发生成。只有用户明确要求上传／生成，或明确启动了说明“停止后上传 PLAUD 并整理”的快速讨论工作流时才能执行；普通 Mac 录音停止不构成上传授权。
- `--retry-upload` 与 `--retry-generation` 都是结果不确定后的显式风险恢复选项；必须分别取得用户对“可能重复上传”或“可能重复提交生成”的明确同意，不得自动追加。
- 如果待生成数量超过 10，先向用户报告数量并确认本批处理范围。
- 默认把下载文件写到当前工作区的 `work/domi/plaud/<run-id>/`；不要写入插件目录。
- 不得把 `~/.plaud-cli`、`~/.domi`、Tabbit profile、Cookies 或鉴权信息复制进输出目录。

## 队列阶段

`queue` 保存于 `~/.domi/plaud-workflow.json`，只包含文件标识、产物路径、处理阶段，以及用户提供的必要对话背景和参会人摘要；不得保存完整文字稿、无关聊天内容或任何认证信息。

- `generating`：已触发 PLAUD 生成。
- `uploading` / `uploaded`：本地录音正在上传，或已取得精确 PLAUD `fileId`。
- `upload_failed`：上传在确认前明确失败，可在用户原有上传授权范围内恢复。
- `upload_unknown` / `upload_recovery_ambiguous`：上传确认结果不明，或稳定标题匹配到多个远端文件；不得自动重复上传。歧义项只可用用户选定且经精确标题校验的 `--adopt-file-id` 恢复。
- `generation_submitting` / `generation_unknown`：生成请求正在提交，或请求结果不明；优先轮询下载。持续无结果时只能在用户明确同意后用 `--retry-generation` 恢复。
- `download_failed`：文字稿下载异常；复用同一 `fileId` 重试下载。
- `transcript_ready`：文字稿已下载，尚未向用户询问对话背景和参会人。
- `context_pending`：已发送文字稿回忆提示，等待用户补充或明确跳过。
- `context_ready`：用户已提供具体信息，或未提供具体信息并选择继续；等待整理纪要。
- `notes_project`：已生成创业项目/创始人交流纪要，且实体、数字、核心成员学历、履历、职级和模型工作证据审计声明已通过，等待投资评分。CLI 校验审计声明的必填字段，并把它绑定到纪要文件 SHA-256；它能阻止纪要被替换或绕过阶段，但不能替代对底层来源的人工/模型核验。
- `notes_non_project`：非项目纪要，流程结束。
- `reviewed`：投资快评已完成，评分/评级及学历、履历、模型归因一致性声明已绑定到快评文件哈希，等待飞书 Wiki 文档与本地资料库归档。
- `documented`：飞书 Wiki 文档和本地资料库归档已完成，等待 Watching List 写入与链接回填。
- `managed`：Watching List 已新增或更新，流程结束。
- `discussion_notes_ready`：快速讨论的完整纪要已生成，并绑定文字稿、上下文和纪要哈希；等待讨论摘要。
- `discussion_complete`：完整纪要与讨论摘要均已生成并绑定哈希，快速讨论流程结束。
- `generation_failed` / `generation_timeout` / `failed`：需要报告并按具体错误恢复。

禁止把失败项目直接标为完成。账户内已有录音的批处理在重新运行时先处理 `queue`；快速讨论按其精确 `workflowId` 和音频继续，不先处理无关队列项。

## 依赖

- macOS 与 Node.js。
- `ffmpeg`（把 `mac-recording` 的 M4A 转为 PLAUD 上传所需的 MP3）。
- `/Applications/Tabbit.app` 以及其中已登录的 PLAUD 会话。
- 插件内置的 `playwright` 依赖和 PLAUD 客户端代码。
