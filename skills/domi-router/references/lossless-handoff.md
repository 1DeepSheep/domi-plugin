# domi 多阶段无损交接合同

本合同只用于多阶段工作流的状态与产物交接，目标是避免在模型消息中反复粘贴长篇文字稿、研究报告或交付物。它不替代任何原始材料、下游 Skill、证据规则、QA 或写入授权。

## 核心原则

1. **规范产物先落盘**：每个阶段结束前先保存完整产物，再计算 SHA-256。不得把聊天正文或模型摘要当成唯一产物。
2. **引用而非重放**：阶段间传路径、哈希、类型、实体 ID 和证据索引，不在交接消息中复制完整正文。
3. **接收方按需读原文**：下一阶段先校验哈希；凡涉及事实判断、引用、评级、写作、归档或 QA，必须按该 Skill 的规则读取完整规范产物及所需原始材料。manifest 摘要不能作为证据。
4. **规则按阶段加载**：只读取当前阶段主 Skill 与其明确要求的 references。路由或要求不明确时，保守读取所有可能适用的完整规则，不能为节省 token 省略质量规则。
5. **授权不继承扩张**：manifest 只能记录用户授权的来源和范围，不能由旧消息、旧 manifest、只读命中或既有回执推导新的写入／外发权限。
6. **失败可恢复**：状态不确定时先验证 artifact、实体与回执；哈希不匹配、文件缺失或关键字段冲突时停止并从最后一个可信 checkpoint 恢复，禁止继续使用过期聊天内容。

## `domi.handoff.v1`

manifest 保存于当前工作流的私有临时目录，不进入资料库正文或默认用户答复。至少包含：

```yaml
schema: domi.handoff.v1
workflowRunId: stable-run-id
workflow: project-intake | plaud-investment-recording | people-intake | ...
mode: research | intake | update | ...
currentStage: stage-name
nextStage: stage-name | null
repository:
  backend: local | legacy_feishu_primary | null
  lockedAt: ISO-8601 | null
authorization:
  sourceTurnId: current-user-turn-id
  internalWrite: true | false
  externalWrite: true | false
  externalTargets: []
entity:
  type: project | person | recording | industry | ...
  fingerprint: stable-entity-fingerprint
  canonicalName: display-name
  projectId: optional-internal-id
  recordId: optional-legacy-id
artifacts:
  - role: transcript | research_report | evidence_index | notes | review | source_material | qa_receipt
    path: /absolute/private/path
    sha256: lowercase-hex
    bytes: 123
    mediaType: text/markdown
    evidenceIndexPath: /absolute/private/path-or-null
    qaReceiptPath: /absolute/private/path-or-null
receipts:
  storage: optional-storageReceipt
  delivery: optional-deliveryReceipt
completedStages: []
pendingQuestions: []
failureCheckpoint: null
updatedAt: ISO-8601
```

可增加阶段需要的字段，但不得把访问令牌、Cookie、OAuth 凭据、完整 Base／Wiki 标识或其他秘密写入 manifest。绝对路径和内部 ID 只在受控本机交接中使用，默认不展示给用户。

## 阶段完成与接收

发送阶段在推进前必须确认：

- 规范产物存在、非空且 SHA-256 与 manifest 一致；
- 必需的 evidence index 和 QA receipt 已生成并通过；
- 实体指纹与锁定后端没有发生静默变化；
- 当前阶段完成标准满足，下一阶段和失败恢复点明确。

接收阶段必须：

1. 读取 manifest 并验证 schema、阶段、实体、授权与后端锁；
2. 对将使用的 artifact 重新计算 SHA-256；
3. 采用当前阶段主 Skill，并按其要求读取完整 artifact、证据索引和相关原始材料；
4. 产出新的规范文件与回执后原子更新 manifest；
5. 保留旧 artifact 的路径和哈希形成可审计链，不覆盖不同版本。

任何校验失败都不得通过降低证据标准、缩短交付物、跳过 QA、切换模型／推理强度或重做整个工作流来掩盖。先从最后可信 checkpoint 定点恢复；恢复仍不能满足完整规则时，停止并报告具体缺口。


## 可执行合同

上述合同现在由 `<plugin-root>/scripts/domi-workflow.cjs` 执行，完整命令与 JSON 输入见 [程序化工具](programmatic-tools.md)。首次创建、阶段推进、失败恢复均调用工具；`inspect` 返回失败时禁止继续消费失效产物。每个 artifact 额外记录 `stage`，每个阶段在 `stagePlan` 注册 `name/skill/mode/requiredRoles/ruleBundleSha256`。规则依赖哈希由 `context` 返回，不能自行编造。

`workflowRunId` 在同一任务的重试中保持不变；播客固定为 `podcast:<jobId>`。`executionRunId` 是当前客户端 claim ID，重新执行前先 `inspect`，再以回读的 manifest 哈希调用 `rebind`；旧成功回执不能证明新执行已完成。`invalidate` 只撤销指定阶段及其依赖阶段、保存旧产物元数据与失败点，不能重写实体或扩大授权。事实修正使用新的版本路径，保留旧版本。
