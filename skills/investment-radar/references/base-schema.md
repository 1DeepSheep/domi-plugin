# 本地行业事件资料库契约

执行前读取 `../../investment-mgmt/references/storage-backends.md`。行业事件固定写入本地 SQLite `news_events`，并生成 `2.行业动态/<YYYY>/<MM>/<事件ID>.md`；不得要求飞书 Base Token、Table ID、Wiki Space ID 或飞书授权。

使用插件根目录 `scripts/domi-repo.cjs news get/list/upsert`。以 `eventId` 去重：写前 `news get --id <事件ID>`；0 条创建，1 条仅在有实质增量时 upsert。写后再次 get，并验证记录、Markdown 和链接字段。taxonomy 以 `investment-mgmt/references/taxonomy.md` 为 canonical；新子领域请求必须经用户确认。

重点项目与人脉从本地 SQLite／本机私有快照读取。普通扫描不得因新闻命中而修改项目、人脉的评级、跟踪状态、最后更新时间、Notes 或互动记录。

## 字段

| 字段 | 类型 | 写入要求 |
|---|---|---|
| title | text | 必填；事件级标题，包含核心主体和动作 |
| domains | string[] | 必填；canonical 领域，可跨多个 |
| subdomains | string[] | 可选；符合父子映射 |
| types | string[] | 必填 |
| publishedAt | datetime | 必填；原始来源时间 |
| summary | text | 必填；1–3 句事实摘要 |
| investmentMeaning | text | 值得关注事件必填，与事实分开 |
| url | URL | 必填；优先最上游来源 |
| source | text | 必填 |
| companies / institutions | string[] | 归一化实体 |
| importance | 1–10 | 必填 |
| confidence | 1–10 | 必填 |
| evidenceStatus | enum | 独立核实／公司或机构口径／可观察动作／二手报道／传闻待核验 |
| worthFollowing | boolean | 必填 |
| action | enum | 立即关注／继续跟踪／进入深研／加入候选池／仅归档 |
| eventId | text | 必填；跨批次业务键 |
| batch | text | 创建批次与最近扫描批次 |
| intakeTime / updatedAt | system | 只读，不由 payload 覆盖 |

## 写入前检查

1. `news list` 一次性读取扫描窗口内的事件 ID、标题、链接与发布时间，建立内存索引。
2. canonical taxonomy 来自本地项目 schema 与 `taxonomy.md`；Radar 不镜像任何飞书选项，也不调用 `lark-base`。
3. 无法映射的新子领域输出 `taxonomy_request(kind=new_subdomain,target_field=subdomain)`，等待用户确认；一级领域不得自动创建。
4. SQLite schema 或工作区不可写时继续完成只读研究，但状态为“搜索完成、归档未完成”，不得改写飞书作为替代。

## 事件 ID

格式：`evt_v1_<SHA-256 前 20 位>`。哈希输入：

```text
核心实体集合｜信息类型｜不可变事件键
```

金额、投资方、公告日期、媒体名称、标题、URL、评分和扫描批次不得进入事件键。传闻转官宣、金额修正、投资方补充和来源增加都更新原事件并保留旧 ID。无法唯一判断时跳过自动写入，不得靠日期生成新 ID。

## 创建与更新

```bash
node <plugin-root>/scripts/domi-repo.cjs news get --id "evt_v1_xxx"
node <plugin-root>/scripts/domi-repo.cjs news upsert --json-file "/private/temp/event.json"
node <plugin-root>/scripts/domi-repo.cjs news get --id "evt_v1_xxx"
```

连续写入可在一个受控 SQLite 事务中执行。超时或未知结果先按事件 ID 回查，不直接重放。成功回读事件 ID、标题、发布时间、链接、评分与 Markdown 后才报告完成。
