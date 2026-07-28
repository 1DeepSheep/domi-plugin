# 待办事项账本契约

当前资料库待办事项文档中 caption 为 `domi-task-board-v1` 的 JSON 代码块是客户端与技能共享的单一事实源：飞书模式使用 `1.待办事项`，本地模式使用工作区根目录的 `0.待办事项.md`。marker 沿用旧名称以兼容既有数据。

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

## 隐私

账本只存待办事项所需的显示名称和飞书 record ID。不得存 Base token、Table ID、文档 URL、邮箱、电话、家庭住址、访问令牌或本机路径。

`suggestedAction.prompt` 不得包含私人邮箱或文档链接。执行时由技能从本机配置解析。
