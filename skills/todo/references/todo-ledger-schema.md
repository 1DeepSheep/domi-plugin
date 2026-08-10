# 待办事项账本契约

本地主库中，工作区根目录 `0.待办事项.md` 里 caption 为 `domi-task-board-v1` 的 JSON 代码块，是客户端与技能共享的唯一可写事实源；marker 沿用旧名称以兼容既有数据。只有 `repositoryBackend=legacy_feishu_primary` 时，既有飞书 `1.待办事项`／`1.Task` 才继续作为唯一主账本读写；已完成安全迁移后只能读取旧飞书账本用于核对，不得继续写入。

## 顶层结构

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "tasks": []
}
```

待办事项结构：

```json
{
  "id": "task_random-id",
  "title": "约见新入库的某项目团队",
  "summary": "用一句话说明要做什么",
  "reason": "说明触发证据和为什么现在做",
  "priority": "P1",
  "category": "new-entry",
  "status": "open",
  "signalKey": "created:2026-01",
  "source": {
    "kind": "project",
    "recordId": "record-id",
    "displayName": "显示名称"
  },
  "dueAt": null,
  "suggestedAction": {
    "kind": "schedule",
    "label": "约日程",
    "prompt": "采用 $domi:schedule，为该对象安排会面；缺少时间时先询问。"
  },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

## 枚举

- `priority`: `P1 | P2 | P3`
- `status`: `open | in_progress | done | ignored`。客户端只展示 `open` 与 `in_progress`，并始终按 `category` 分栏；状态不是看板列。
- `source.kind`: `project | person | news | manual`
- `suggestedAction.kind`: `schedule | research | contact | review | custom`
- `category`:
  - `key-milestone`：关键节点
  - `new-entry`：新入库约见
  - `relationship-follow-up`：人脉跟进
  - `project-follow-up`：项目跟踪

旧账本中的细分类会在读取时映射到以上四类。`ignoredAt`、`completedAt` 只在对应状态出现。未知扩展字段可以保留，但客户端不会依赖它们。

## 日期约束

`dueAt` 只表示来源可核验的真实截止／节点日期；没有时必须为 `null`。扫描时间、当前时间、模型推算日期和建议跟进时间都不是 `dueAt`。合并候选没有真实日期时，不得清空或覆盖既有可核验日期；只有来源证明日期改变或节点取消时才更新。

## 旧飞书账本导入

以 `id` 或 `category + source.kind + source.recordId + signalKey` 幂等去重；保留所有生命周期状态和时间戳。导入后必须重新读取本地 ledger 并逐项核对，全部通过才可记录迁移完成。读取失败、字段丢失或有多个冲突账本时保持 `legacyFeishuReadCompatible=true` 并提示用户处理，不得覆盖旧文档或自行选择一个非空账本。

## 隐私

账本只存待办所需的显示名称和本地记录 ID。不得存 Base token、Table ID、文档 URL、邮箱、电话、家庭住址、访问令牌或本机路径。

`suggestedAction.prompt` 不得包含私人邮箱或文档链接。执行时由技能从本机配置解析。
