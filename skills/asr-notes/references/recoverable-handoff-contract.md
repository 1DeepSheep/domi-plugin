# ASR纪要可恢复无损交接合同

本合同只在多阶段、由`domi-router`编排、需要恢复，或纪要还要进入评级／入库／IC等下游阶段时启用。它通过文件和哈希传递状态，避免在模型消息中重放完整文字稿；不替代原始材料、证据规则、QA或下游Skill。

## 触发与边界

- 上游传入`domi.handoff.v1`、`workflowRunId`、`nextStage`或明确要求可恢复执行时：**必须持久化**`evidence_index`和`qa_receipt`。
- 独立的一次性普通纪要、没有下游阶段且用户未要求审计附件时：可以只在内存维护同等内容，不强制生成用户可见sidecar。
- 一旦纪要要写入资料库、交给投资评级／IC／归档，或任务可能跨会话恢复，必须在推进前落盘并登记两个sidecar。
- sidecar保存在工作流私有临时目录，不写进纪要正文、项目资料目录或默认完成消息；不得包含令牌、Cookie、OAuth凭据或其他秘密。

## `asr.evidence-index.v1`

使用JSON或YAML保存，至少包含：

```yaml
schema: asr.evidence-index.v1
workflowRunId: stable-run-id
mode: A | B
notesScope: current_session | longitudinal
transcript:
  path: /absolute/path
  sha256: lowercase-hex
  bytes: 123
  role: current_transcript
sources:
  - sourceId: src-001
    path: /absolute/path
    sha256: lowercase-hex
    bytes: 123
    role: current_transcript | historical_record | verification_only | public_source | user_correction
    asOfDate: YYYY-MM-DD | null
claims:
  - claimId: claim-001
    category: entity | number | education | career | model_work | product | financing | decision
    subject: canonical-subject
    statement: normalized-fact
    status: confirmed | company_attributed | inferred | conflict
    sourceRefs:
      - sourceId: src-001
        locator: timestamp-or-line-range
    notesLocation: heading-and-bullet-or-table-row
    notesRefs:
      - lines: [8, 9]
        quote: corresponding-exact-final-notes-text
coverage:
  path: /absolute/private/work/coverage.json
  sha256: lowercase-hex
  bytes: 123
unresolved:
  - claimId: claim-xxx
    materialToDecision: true
    boundary: shortest-necessary-conflict
generatedAt: ISO-8601
```

要求：

- `transcript`必须指向完整规范文字稿并带SHA-256和字节数；evidence index不能用摘要替代原文。
- 每条进入最终纪要的高重要性实体、数字、学历、履历、模型工作、融资和决策事实都要能回到`sourceRefs`定位。
- 新ASR完成或重写必须执行[全源覆盖合同](source-coverage.md)：复用claims记录原文有效信息，`coverage`绑定固定原文区间的审阅，`notesRefs`绑定实际正文摘录；`notesLocation`只作人类可读辅助，不能单独证明内容已写入。旧工件保留可读，不冒充新版审查通过。
- `verification_only`只能校正已有claim，不能静默产生正文新claim；`historical_record`只有在`notesScope=longitudinal`且实体唯一时才能贡献正文。
- 用户更正应作为独立source记录，不覆盖原始转写稿；冲突保留为`conflict`，不能删除反证。
- 纪要重写或事实修正后同步更新`notesLocation`与状态，不允许交付过期索引。

## `asr.qa-receipt.v1`

使用JSON或YAML保存，至少包含：

```yaml
schema: asr.qa-receipt.v1
workflowRunId: stable-run-id
mode: A | B
reviewer: model
notes:
  path: /absolute/path
  sha256: lowercase-hex
  bytes: 123
evidenceIndex:
  path: /absolute/path
  sha256: lowercase-hex
  bytes: 123
checks:
  source_manifest: passed | blocked | not_applicable
  transcript_traceability: passed | blocked
  entity_verification: passed | blocked
  number_audit: passed | blocked
  completeness: passed | blocked
  editorial: passed | blocked
  attribution: passed | blocked
  education: passed | blocked | not_applicable
  career_model_work: passed | blocked | not_applicable
  material_verification: passed | blocked | not_applicable
  pending_items: passed | blocked | not_applicable
  markdown_rendering: passed | blocked
overall: passed | blocked
materialConflicts: []
checkedAt: ISO-8601
```

要求：

- `overall=passed`必须建立在所有适用检查为`passed`；不能用`not_applicable`掩盖未执行的适用检查。
- 任何事实、标题、表格或格式修正后，重新计算notes哈希并重跑受影响检查，再原子替换receipt。
- 仍有实质影响投资判断的冲突时，`overall=blocked`或在用户明确接受该边界后记录可交付状态；不得静默通过。
- 模式B保留适用的实体、数字、完整性、归因和渲染检查；不是项目访谈不等于降低质量。

## 登记、交接与恢复

发送阶段在推进前：

1. 确认transcript、notes、evidence index和QA receipt存在且非空；
2. 重新计算每个文件的SHA-256，与sidecar一致；
3. 在`domi.handoff.v1.artifacts`登记`transcript`、`notes`、`evidence_index`、`qa_receipt`的绝对路径、哈希、字节数和media type；
4. 只有`qa_receipt.overall=passed`且无未授权写入，才推进下游。

接收或恢复阶段先校验schema、`workflowRunId`、路径和哈希，再按当前阶段Skill完整读取规范产物及所需原始材料。哈希不一致、文件缺失或关键claim冲突时，从最后可信checkpoint定点恢复；禁止用聊天摘要重建事实，也禁止通过降低证据或QA标准继续。

默认用户交付仍只显示纪要文件和必要结论。只有用户要求审计附件或存在必须确认的实质冲突时，才展示sidecar或其摘要。


## 程序核验入口

先执行[程序化格式检查](format-validation.md)，以格式化后的最终纪要建立 `notesLocation`、证据索引及QA哈希。`evidence-check` 会再次读取正文检查标题与分隔线，不能靠手写 `markdown_rendering: passed` 绕过。修改已审核文件时保留旧产物并重建对应版本的审核绑定。

证据索引与 QA 回执统一使用 JSON（避免模型手工维护 YAML 转义）。`sourceRefs` 推荐增加 `lines:[起始行,结束行]` 与可选原文 `quote`；保留原 `locator`，脚本支持真实时间戳或 `L1-L3`。`verification_only` 的校正明确给 `existingClaimId`，历史材料给与主实体一致的 `entityFingerprint`。模型仍需全文核验覆盖、归因与可读性，存在有效 locator 不等于事实成立。

每次完成／修正后调用：

```bash
node <plugin-root>/scripts/domi-workflow.cjs evidence-check --index <evidence-index.json> --qa <qa-receipt.json>
```

工具实际回读源文件、纪要和索引，检查 schema、hash、字节数、sourceId、定位范围、来源角色和语义审核项是否完整。`mechanicalChecksPassed` 仅代表机械校验，不能替代模型检查；工具不会根据关键词判断 completeness。成功后将四类 artifact 用 `artifact` 命令登记，以 `save` 更新 manifest。完整流程见 [程序化交接](../../domi-router/references/programmatic-tools.md)。
