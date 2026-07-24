# Priority Watchlist Runtime Contract

真实重点项目名单属于团队运行数据，禁止写入插件源码或随 GitHub、DMG 发布。

Radar 在运行时读取：

```text
~/Library/Application Support/豆米/investment-radar/priority-watchlist.md
```

该文件由豆米在本机初始化，或由用户明确执行“同步重点项目名单”时生成。文件不存在或无法解析时，Radar 才可以回源读取 Watching List；普通扫描不得为刷新名单而重新读取项目表。

运行时文件至少包含：

```yaml
snapshot_version: 1
generated_at: ISO-8601
review_after_days: 14
selection: 项目评级 in [A, S] AND 进展状态 = 深度跟踪
priority_project_count: 0
```

随后使用 Markdown 表格保存 `项目名称 / 评级 / 领域 / 子领域 / 首页范围`。插件仓库只保留本契约，不保留项目名称、评级、内部状态或其他真实记录。
