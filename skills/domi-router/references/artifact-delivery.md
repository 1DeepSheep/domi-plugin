# 文档预览与跨客户端真实附件交付合同

## 适用范围

文档完成后的默认反馈，以及用户要求“查看／打开已有文档”时，按下节提供可点击的文档入口。只有用户明确要求“把文件发我”“给我下载”“提供附件”或跨端发送时，才进入后续真实附件流程。本机预览入口不等于附件已发送；移动端或其他不能读取本机文件的渠道不能用本地链接代替附件。

本合同只负责交付已经生成并通过质量门的 artifact。不得为了发送而重新运行研究、录音生成、ASR、写作或 Slides 生产流程；现有文件缺失、损坏或未通过其主 Skill 的 QA 时，回到对应生产阶段修复，不能把半成品当附件。

## 本机文档入口与完成反馈

- 从本轮已回读的 artifact 或归档回执取得真实文件。已经归档时优先链接正式文档，未归档时可链接已验证的工作区文件；不要猜路径或把暂存结果说成已入库。
- domi／支持本地文件预览的桌面宿主使用命名 Markdown 链接，例如 `[查看纪要](</absolute/path/会议纪要 (修订).md>)`。实际输出替换为已验证的绝对路径，标签用文档名或“查看纪要／完整文字稿”。含空格、中文或括号的路径用 `<...>` 包住，**必须以 `>)` 完整闭合**；不能省略 `>`、截断路径、把链接转义或放进代码块。路径只在链接目标中出现，不作为可见标签或普通文本展开。
- 默认用一句完成情况和所需文档链接收尾。录音任务先给纪要入口，可再给已有完整文字稿；不因此额外生成精修逐字稿。需要解释时只补充影响使用或判断的实质结果，不复述处理过程。
- `context_ready`、`notes_non_project`、`managed` 等状态迁移，`score/projectId/recordId` 等内部字段、空值、哈希、manifest、证据索引、QA 回执及“回读校验通过”等过程备注仅保存到内部工件；默认完成反馈不列这些字段或链接。用户明确索要审计／排障时再提供相关内容。
- 非项目会议省略“评分不适用”“项目库未新增”“字段为空”等模板项。用户明确要求的入库／发送尚未完成、文件缺失或有影响内容判断的未决问题时，必须简短说明实际缺口和可执行的下一步，不能用简洁反馈掩盖失败。

本机预览示例仅表示文件已生成：`已整理完成：[查看纪要](</absolute/path/会议纪要.md>) · [完整文字稿](</absolute/path/完整文字稿.md>)`。只有已完成归档回读才可改为“已归档”；链接存在不证明附件已发送。

## 真实附件交付前验证

1. 从当前 `domi.handoff.v1` 或本轮已验证产物中解析唯一文件；聊天里的旧路径、历史任务同名文件和来源材料都不能代替当前 artifact。
2. 确认它是普通文件、非零字节，扩展名与 MIME 类型一致，并重新计算 SHA-256。需要 PDF、PPTX、音频等格式时还要运行对应文件类型的可打开性／页数／媒体完整性检查。
3. 确认主 Skill 的内容、证据、格式和视觉 QA 已通过。真实附件交付不降低研究深度、交付物质量、推理强度或视觉检查标准。
4. 交付显示名称应是适合收件人阅读的最终文件名；不得暴露本机用户名、临时目录、内部 run ID 或鉴权信息。

交给宿主或客户端的内部记录至少包含：

```json
{
  "schemaVersion": "domi.delivery-artifact.v1",
  "workflowRunId": "run_xxx",
  "artifactId": "artifact_xxx",
  "displayName": "最终报告.pdf",
  "path": "/absolute/internal/path/最终报告.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 12345,
  "sha256": "...",
  "purpose": "deliverable",
  "deliveryMode": "attachment"
}
```

附件记录中的 `path` 只用于内部结构化交接；不得把这段 JSON、原始内部文件指令或绝对路径打印成面向用户的普通文本。本机预览链接目标按上节处理。

## 真实附件的客户端交付语义

- **Codex 桌面端／支持 Codex 文件引用的宿主**：最终答复必须在内部发出 `:codex-file-citation{path="/absolute/..." purpose="deliverable"}`，由用户界面渲染成可点击、可下载的真实附件。只能把已验证 artifact 的绝对路径填入 `path`；原始 marker 不得作为普通文本显示给用户，也不得退化成普通路径字符串。
- **移动端／微信桥接**：桥接层必须从上述 `purpose="deliverable"` marker 解析 `path`，读取该文件的真实字节，以文件消息上传，并返回平台的 `fileId`、消息 ID 或等价送达回执。绝不能把 marker 序列化成聊天文本，也不能把 `purpose="deliverable"` 改成 `purpose="source"` 或普通超链接。
- **飞书或其他消息渠道**：采用该渠道的原生文件上传／发送能力；来源引用和交付附件分开处理。研究来源 URL 只能作为 citation，不能冒充 deliverable。

如果当前客户端不能消费 Codex deliverable marker、没有原生附件能力，或上传失败且无法确认送达，状态必须是 `blocked_missing_attachment_channel` 或 `delivery_failed`，明确告诉用户文件尚未发出并保留可恢复 checkpoint。不得把 marker 或本机路径作为“临时替代”，不得声称已经发送成功。

## 幂等与送达回读

以 `workflowRunId + artifactId + channel + target + sha256` 作为交付幂等键。重连或重试前先查询既有回执；相同哈希已经成功送达时复用回执，不重复上传。文件内容变化后必须生成新 SHA-256 和新交付记录，不能沿用旧成功状态。

成功回执至少记录：

```json
{
  "status": "delivered",
  "channel": "codex|wechat|feishu|other",
  "target": "current_conversation_or_resolved_recipient",
  "artifactId": "artifact_xxx",
  "sha256": "...",
  "remoteFileId": "optional_platform_file_id",
  "messageId": "optional_platform_message_id",
  "deliveredAt": "ISO-8601"
}
```

只有附件 API 返回成功并能以回执确认目标会话中的真实文件时，才标记 `delivered`。最终回复简洁说明附件名称和交付状态，不显示内部路径、协议文本或上传实现细节。
