# 快速讨论工作流

## 目录

- [目标与触发](#目标与触发)
- [阶段与完成标准](#阶段与完成标准)
- [一、立即开始录音](#一立即开始录音)
- [二、停止并取得已校验音频](#二停止并取得已校验音频)
- [三、上传-plaud-并取得文字稿](#三上传-plaud-并取得文字稿)
- [四、确认对话上下文](#四确认对话上下文)
- [五、生成完整结构化纪要](#五生成完整结构化纪要)
- [六、生成讨论摘要与跟进事项](#六生成讨论摘要与跟进事项)
- [七、恢复与去重](#七恢复与去重)
- [八、最终交付](#八最终交付)

## 目标与触发

把一次临时讨论从 Mac 本机录音连续处理为 PLAUD 文字稿、完整结构化纪要、讨论核心要点和跟进事项。

以下表达启动完整工作流：无修饰的“开始录音”“现在开始录音”“启动 Mac 录音”“录下这段讨论”，以及“开始快速讨论”“开个快速讨论录音”“录下这段讨论，结束后上传 PLAUD 整理”“开始讨论模式，主题是……”。只有用户明确说“开始本地录音”“仅本地录音”“只录音，不上传／不整理”“停止后只保存文件”时，才进入 Mac 单阶段录音。

上述默认触发表达（包括“开始录音”）同时授权：立即打开默认麦克风录音，并在用户之后明确停止时，把该录音上传 PLAUD、触发生成和整理。启动时简短提醒确保已取得适用场景下的参会人知情与同意，但不要重复确认或延迟启动。

## 阶段与完成标准

| 阶段 | 完成标准 | 交接产物 |
|---|---|---|
| `recording` | `mac-recording start` 返回 `recording:true` | `workflowId`、`sessionId`、`outputPath`、主题和已知上下文 |
| `audio_ready` | `stop` 返回 `completed:true`，M4A 已通过系统音频校验 | `audioPath`、时长、`workflowKind/workflowId` |
| `uploading/uploaded` | 本地音频按 SHA-256 去重上传并取得唯一 PLAUD `fileId` | `fileId`、源音频哈希、稳定远端标题 |
| `generating` | 只对该 `fileId` 提交一次生成请求 | `generationRequestedAt` |
| `transcript_ready` | transcript JSON 和 Markdown 已下载 | `transcriptPath`、`transcriptRawPath` |
| `context_pending/context_ready` | 已获得具体上下文，或用户明确跳过 | `contextStatus`、类型、目的、参会人 |
| `discussion_notes_ready` | ASR Notes 纪要已绑定文字稿、上下文和文件哈希 | `notesPath` |
| `discussion_complete` | 讨论摘要已生成，纪要和摘要哈希均通过校验 | `briefPath` 与最终交付清单 |

上一步未达到完成标准时不得进入下一步。即使讨论内容涉及创业项目，本工作流也只完成纪要和讨论提炼；没有用户另行授权时，不做投资评级、飞书归档或 Watching List 写入。

## 一、立即开始录音

1. 采用并完整遵循插件内 `mac-recording` Skill。
2. 在同一次工具往返中读取该 Skill 并且只执行一次：

   ```text
   node <mac-recording-cli> start --workflow-kind quick-discussion [--name <quick-discussion-主题>] [--duration-seconds N]
   ```

3. 不在启动前后运行 `doctor`、`status`、`last` 或 `--dry-run`。返回 `recording:true` 后立即报告开始状态、路径、`workflowId`、自动停止时长和 `timings.totalMs`。
4. 用户在启动消息中给出的主题、对话类型、目的和参会人作为后续上下文保留；缺失时不得阻塞启动。

## 二、停止并取得已校验音频

1. 当前活动录音的 `workflowKind=quick-discussion` 时，“停止录音”“讨论结束”“停止快速讨论并整理”都继续本流程。
2. 采用 `mac-recording` 运行一次 `stop`，等待正常封装。只有返回 `completed:true` 且存在 `audioPath` 时才进入上传。
3. 用户明确说“只停止，不上传／不整理”时，到 `audio_ready` 暂停并交付音频；不得上传。之后用户说“继续整理刚才的讨论”时，可从 `last` 返回的 `workflowKind/workflowId/audioPath` 恢复。
4. “取消快速讨论”默认解释为停止并保留音频、不上传；除非用户明确要求删除，否则不得删除录音。

## 三、上传 PLAUD 并取得文字稿

1. 采用并完整遵循插件内 `plaud` Skill。第一次进入本阶段时运行 `doctor` 和只读 `connection`；domi 客户端内置的 FFmpeg/ffprobe 会把 M4A 转为 Opus，不要求用户安装 Homebrew。用户所选 domi 专用浏览器中的 PLAUD 登录和其余内置依赖仍须通过检查。
2. 输出目录使用：

   ```text
   <当前工作区>/work/domi/plaud/<workflowId>/
   ```

3. 运行：

   ```text
   node <plaud-cli> transcribe-local <audioPath> <outDir> 1800 15 <主题> --workflow-id <workflowId>
   ```

4. 只根据 JSON 的精确 `fileId`、`stage` 和 `transcriptPath` 判断结果。禁止改用 `pending` 或 `sync-pending`，避免误处理账户中的其他录音。
5. `generation_submitting`、`generation_timeout`、`generation_unknown` 或 `download_failed` 保留队列，稍后用同一命令继续下载，不重新上传或自动重新生成。前三种生成不确定阶段长时间仍无文字稿时，报告风险并暂停；只有用户明确同意可能重复提交生成请求后，才在同一命令追加 `--retry-generation`。CLI 会在重提前再下载检查一次，已就绪则不重提；`download_failed` 只重试下载。
6. `upload_unknown` 先等待稳定标题出现在 PLAUD；不得默认使用 `--retry-upload`。只有用户明确接受潜在重复上传时才追加该选项。
7. `upload_recovery_ambiguous` 必须暂停并展示 `queue` 返回的 `uploadCandidateFileIds`。用户选定后，重新运行同一命令并追加 `--adopt-file-id <所选ID>`；CLI 会校验该 ID 的远端标题与稳定标题完全一致。不能猜测，也不能直接采用未经校验的 ID。

## 四、确认对话上下文

PLAUD 文字稿完成后、采用 `asr-notes` 前执行。

- 启动或后续消息已经给出具体主题、对话类型、目的或参会人中的任一项：写入必要的简要 metadata，标记 `contextStatus=provided` 和 `context_ready`，不重复询问。
- 完全没有具体上下文：轻量扫描文字稿的开头、结尾和高频主题，生成不超过 150 字的回忆提示。先标记 `context_pending`，再询问这是什么对话、目的是什么、参会人有哪些，并附 2–4 个“文字稿疑似提到”的主题／实体线索。本轮暂停。
- 用户补充任何具体信息即标记 `provided`；不要为了补齐字段反复追问。
- 用户回复“不知道／记不清／直接处理／继续”，或下一次只要求继续而未补充具体信息，标记 `contextStatus=skipped` 后继续。
- 用户未回复时保持 `context_pending`，不得自行假设已回答。

标记示例：

```text
mark <fileId> context_pending - {"contextPromptedAt":"<ISO-8601>","recallSummary":"<提示>"}
mark <fileId> context_ready - {"discussionTopic":"产品方案评审","contextStatus":"provided","conversationType":"内部讨论","conversationPurpose":"产品方案评审","participants":["张三","李四"]}
mark <fileId> context_ready - {"discussionTopic":"<从启动主题或文字稿提炼>","contextStatus":"skipped"}
```

## 五、生成完整结构化纪要

1. 采用并完整遵循插件内 `asr-notes` Skill。
2. 传入 `transcriptPath`、`workflowKind=quick-discussion`、`outputProfile=quick_discussion`、`contextStatus` 和全部已知上下文。PLAUD 已生成文字稿，跳过本地 Qwen 音频转写和重复的参会人询问。
3. 内部讨论默认使用模式 B；用户明确说明是项目拜访／创始人交流时可使用模式 A，但仍不自动进入投资流程。
4. 不得因“快速讨论”跳过实体、数字、联网核验和完整性审计。输出完整纪要：

   ```text
   [YYYYMMDD]-[主题]-快速讨论.md
   ```

5. 纪要存在且最终审计完成后运行：

   ```text
   mark <fileId> discussion_notes_ready <notesPath>
   ```

CLI 会把 `workflow/workflowId`、`discussionTopic`、transcript、规范化上下文和纪要哈希绑定；失败时不得继续。工作流身份不可由下游 `mark` metadata 覆盖；主题或上下文在审计后变化时必须重新生成或重新核验纪要。

## 六、生成讨论摘要与跟进事项

只基于最终纪要和原始文字稿创建同目录 companion 文件：

```text
[纪要标题]-讨论摘要.md
```

固定结构：

```markdown
# [日期]-[主题]-讨论摘要
参会人：……

#### 核心要点
- 3–7 条关键结论、判断及其理由

#### 已形成决定
- 仅列明确达成的决定；没有则省略本节

#### 分歧与待确认
- 仅在确有分歧、假设或开放问题时出现

#### 跟进事项
| 事项 | 负责人 | 截止时间 | 交付物／完成标准 | 状态 |
|---|---|---|---|---|
| …… | 待确认 | 待确认 | …… | 已确认／建议／待确认 |
```

提炼规则：

- 核心要点优先保留决定、关键判断、原因、约束和分歧，不把完整纪要再压缩成流水账。
- 明确区分“已达成结论”“参会人观点”“尚未验证的推测”。
- 只有原文明确承诺或分配的动作才标记“已确认”。模型根据讨论推导的动作必须标记“建议”，不能伪装成已分配任务。
- 不得虚构负责人、截止时间或完成标准；原文未明确时写“待确认”。没有明确事项时写“本次讨论未形成明确跟进事项”。

摘要完成后运行：

```text
mark <fileId> discussion_complete <briefPath>
```

## 七、恢复与去重

每次“继续处理／处理到哪了”先采用 `plaud` 运行 `queue`，再按阶段恢复：

- `uploading/upload_failed`：复用源音频哈希恢复上传；同源命令有互斥锁。
- `upload_unknown/upload_recovery_ambiguous`：按第三节安全规则处理，不自动重复上传；歧义项只能采用用户明确选定且通过稳定标题校验的候选 ID。
- `uploaded/generation_submitting/generating/generation_unknown/generation_timeout/download_failed`：只认已保存的精确 `fileId`，优先下载；生成不确定阶段只有在用户明确同意潜在重复提交后才加 `--retry-generation`，`download_failed` 不加。
- `transcript_ready`：进入上下文确认。
- `context_pending`：处理用户本次回复；不得重复询问或重做 PLAUD。
- `context_ready`：从已有文字稿运行 ASR Notes。
- `discussion_notes_ready`：先运行 `verify <fileId>`；通过后只生成讨论摘要，不重做 PLAUD 或纪要。
- `discussion_complete`：运行 `verify <fileId>` 后直接复用最终产物。

用户明确选择“仅本地录音”后生成、且没有 `workflowKind=quick-discussion` 的 Mac 录音不得接入本流程。一次只能有一条活动 Mac 录音，但可有多条已停止讨论在 PLAUD 队列中等待后处理。

## 八、最终交付

最终消息必须：

1. 直接展示 3–7 条核心要点。
2. 直接展示跟进事项；没有明确事项时明确说明。
3. 提供四类产物：本地音频、PLAUD 文字稿、完整纪要、讨论摘要。
4. 报告仍待确认的参会人、实体、分歧或任务负责人／截止时间。

不得输出 PLAUD 鉴权信息、Cookie、预签名 URL 或 API 原始响应。
