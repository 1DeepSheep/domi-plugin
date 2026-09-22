# 本地会议信息交接

原生客户端在启动正式纪要任务前完成本节。命令只读取精确录音的本地状态／文字稿并保存用户背景，不使用模型、浏览器或远端 PLAUD。客户端主进程先验证 `fileId` 属于当前连接的成功录音快照；`accountScope` 是主进程生成的连接范围 SHA-256（包括 Profile／配置和登录切换版本），不是用户填写的身份，也不是远端认证回执。

## 准备与回忆提示

```text
node <plaud-cli> context-prepare <fileId> -
```

stdin：`{"accountScope":"<64位SHA-256>"}`。返回 `ok/fileId/accountScope/stage/disposition/recordRevision`、`transcript:{path,sha256,bytes}`、`context`、`contextPath`、可用的 `fileName/createdAt/duration`、旧 `recallSummary` 与 `recallSummaryVerified`。

- `needs_input`：仅 `transcript_ready/context_pending`，显示回忆提示和填写区；准备只读，不改变 stage，不把关闭卡片当作跳过。
- `ready`：已经 `context_ready`，复用已有背景，不重复询问。
- `advanced`：纪要、评分、归档或完成阶段，查看／继续既有结果，不重新提交背景或回退。
- 缺少可读、非空、普通本地文字稿返回 `PLAUD_CONTEXT_TRANSCRIPT_REQUIRED`，不自动下载或生成。

填写时必须默认看得到有辨识度的回忆提示：录音时间／时长、主要产品或议题、两三个具体讨论点／案例。提示约 100–150 字，必须来自该文字稿；不以空表单、泛化会议概述或无关元信息替代。公司、人名、客户、竞品只写“录音中提到／疑似提到”，不得自动变成已确认参会人或把 Speaker 标签按名单顺序映射。

客户端优先使用绑定同一 `accountScope+fileId+transcript.sha256` 的摘要缓存。旧 queue 的 `recallSummary` 没有该绑定，当前接口返回 `recallSummaryVerified:false`，不能直接当作已验证缓存；单独读取文字稿有限片段生成提示后缓存。提示缺失时只执行该窄步骤，不先启动完整 Router、ASR、资料库检索或实体研究；不降低随后完整纪要的质量标准。摘要缓存独立保存，不改变会议信息 revision。

## 原子提交

```text
node <plaud-cli> context-submit <fileId> -
```

stdin JSON：

```json
{
  "accountScope":"<prepare的范围>",
  "submissionId":"<本次确认的稳定幂等ID>",
  "expectedRecordRevision":"<prepare的recordRevision>",
  "expectedTranscriptSha256":"<prepare的transcript.sha256>",
  "contextStatus":"provided",
  "conversationType":"行业交流",
  "projectName":"",
  "participants":["用户填写的姓名／机构／职位"],
  "userContext":"用户补充的背景",
  "extraContext":"其他补充",
  "rawAnswer":"本次用户实际填写／选择的完整原文",
  "sourceTurnId":"<本次确认的来源turn>"
}
```

`conversationPurpose` 为可选补充；其他非身份字段允许为空。`participants` 接受字符串或字符串数组，字符串整体保存为一条，不按逗号猜人名。只提供部分信息也为 `provided`；明确不知道／跳过／直接处理才使用 `skipped`，仍保存实际选择原文与来源 turn。不为填满字段追加提问。

提交在本地状态锁内回读并核验范围、精确 ID、文字稿哈希、当前背景 revision 与阶段；只允许由 `transcript_ready/context_pending` 进入 `context_ready`。同 `submissionId` 和相同内容重放返回 `reused:true`，不重复写入；不同内容、并发变更、稿件变化和后续阶段均拒绝。revision 只覆盖背景、阶段、文字稿及其绑定，不因回忆提示或无关更新时间变化失效。

原始回答先以私有文件原子保存为 `domi.plaud-context.v1`，绑定 `fileId/accountScope/transcript/sourceTurnId/submissionId`，再把哈希回执与规范字段原子写入 queue。返回 `contextPath`、新 revision、`context` 与 `disposition:ready`。该文件属于必须保留的上下文 artifact，模型须读取原文并通过 `domi-workflow.cjs artifact` 登记到无损 handoff，不用摘要替代；不得移入纪要正文或在默认答复展示内部路径。

## 重新登录后的明确恢复

重新登录会改变连接范围，不能直接放宽旧背景的 scope 检查。客户端必须先从当前账号成功的录音快照／分页核实精确 `fileId`，再将当前本地文字稿哈希与原表单持久绑定的哈希比较；只返回可恢复的范围／版本，不在确认前回传旧背景或摘要。缺少该证明、稿件变化、已完成的终态均不迁移。

用户明确选择“确认沿用已填信息”后，客户端调用本地 `context-rebind <fileId> -`，stdin 为 `accountScope`（新范围）、`previousAccountScope`、`expectedTranscriptSha256`、`expectedRecordRevision`（旧范围的准备版本）及 `confirmed:true`。锁内重新验证精确来源、旧 artifact 和 CAS；新 scope 的 artifact 原子保存，完整保留 `rawAnswer/sourceTurnId` 和已有 stage，旧 artifact 不改。尚未提交的草稿只校验，不写背景也不推进阶段。相同确认可安全重放；竞争范围、版本或稿件变化拒绝。恢复成功后仍须明确点击继续生成，不能自动启动模型或重复已有步骤。

错误使用 `PLAUD_CONTEXT_*`：`INPUT_INVALID`、`RECORD_NOT_FOUND`、`TRANSCRIPT_REQUIRED`、`TRANSCRIPT_CHANGED`、`SCOPE_MISMATCH`、`STAGE_CONFLICT`、`REVISION_CONFLICT`、`SUBMISSION_CONFLICT`、`ARTIFACT_INVALID`、`STATE_UNAVAILABLE`；停用返回 `PLAUD_DISABLED`。错误不返回正文、名单或解析异常中的私有片段。失败时保留当前状态，重新读取后明确续接；不得盲重放不同内容或退回旧阶段。

## 后续质量不变

客户端传入已保存的 `contextStatus=provided|skipped`、`contextPath` 和精确文字稿绑定后，Router 直接进入纪要阶段，ASR Notes 不重复问背景。仍完整读取文字稿、当前 Skill 及适用规则；继续执行全源覆盖、实体数字、人物归因、完整性、编辑、格式和 SHA-256／QA 校验，项目流程继续评分及归档回读。这里的本地校验不能批准纪要质量或推断用户未提供的身份。
