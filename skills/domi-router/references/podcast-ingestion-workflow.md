# 播客信源与 PLAUD 纪要工作流

## 触发

- 用户添加、启用或检查播客信源。
- 用户粘贴公开播客单集并要求下载、生成纪要或归档。
- 已明确启用 `autoProcess` 的播客发现命中关注规则的新单集。

只有“添加信源”而没有开启自动处理时，只保存配置并测试公开页面，不下载、不上传 PLAUD。

## 顺序

```text
investment-radar sources/podcast
  → 公开元数据与授权闸门
  → 公开音频临时下载
  → plaud transcribe-local
  → asr-notes（只读 PLAUD transcript，模式 B）
  → investment-mgmt 选择唯一主归档
  → investment-radar 拆分、核验并写入有增量的行业事件
```

每一阶段开始前完整采用对应插件 Skill。播客发现、公开下载、小宇宙解析和主归档判定完整遵循 `investment-radar/references/podcast-ingestion.md`。

## 输入交接

```yaml
sourceKind: podcast
sourceId: src_v1_xxx
provider: rss|xiaoyuzhou-public-page|public-web-page
episodeId: provider GUID
episodeUrl: 公开 URL
podcastName: 节目名
episodeTitle: 单集标题
publishedAt: ISO-8601
description: 公开简介
guests: 公开元数据可确认的嘉宾
authorization: single_episode|source_auto_process
```

## PLAUD 闸门

- 进入上传前读取 `DOMI_CONFIG_PATH`；`plaudConnectionMode` 不是 `enabled` 时标记 `waiting_for_plaud`，不得回退本地 ASR。
- 下载成功只代表取得音频，不代表 PLAUD 成功；只有 `transcribe-local` 返回精确 `fileId` 且文字稿下载成功后才能进入纪要。
- 使用 episode 元数据直接构造上下文并标记 `context_ready`；无需再次询问“参会人”，但嘉宾身份必须在纪要阶段根据公开页面和文字稿核验。
- 上传或生成结果不确定时完整遵循 `plaud` 的恢复规则，禁止盲目重复上传、重复提交生成或为了恢复弹出浏览器。

PLAUD 成功后，Router 交给 `asr-notes` 的参数合同为：

```yaml
sourceKind: podcast
transcriptProvider: plaud
transcriptPath: /absolute/private/path/from/plaud.md
sourceId: src_v1_xxx
provider: rss|xiaoyuzhou-public-page|public-web-page
episodeId: provider GUID
episodeUrl: 公开 URL
podcastName: 节目名
episodeTitle: 单集标题
publishedAt: ISO-8601
description: 公开简介
guests: [公开元数据可确认的嘉宾]
```

`transcriptPath` 必须是 PLAUD 已下载且与当前 `episodeId` 绑定的本机绝对路径。上游的 `audioPath` 只能交给 PLAUD，不得同时交给 `asr-notes`。

## 纪要与归档

- `asr-notes` 输入必须是 PLAUD `transcriptPath`，并传 `sourceKind=podcast`、`transcriptProvider=plaud`。禁止把临时音频交给本地 Qwen。
- 默认模式 B；播客中一家公司自述其项目，也不自动执行投资评级或项目库写入。
- `investment-mgmt` 先查重再判断 `project_dominant / industry_dominant / ambiguous`。歧义时让用户点击选择；不得凭单集标题新建项目。
- 只创建一份可编辑主纪要。行业事件、项目主页、人物主页和行业索引只保存同一 `canonicalDocumentId` 的引用。
- PLAUD 文字稿可在主归档目录保存一次；临时音频按用户保留策略在上传确认后清理。

`asr-notes` 不直接写资料库，而是返回下列结果供 Router 交给 `investment-mgmt`：

```yaml
notesPath: /absolute/private/path/to/canonical-notes.md
canonicalDocumentTitle: YYYYMMDD-节目名-单集主题
archiveSignals:
  companies:
    - name: 规范公司名
      aliases: [别名]
      contentShare: 0.0-1.0
      guestAffiliation: founder|executive|employee|investor|expert|other|unknown
  domains: [canonical domain]
  subdomains: [canonical subdomain]
  guests:
    - name: 姓名
      affiliation: 公司或机构
      role: 公开可核验职务
```

`investment-mgmt` 归档后返回：

```yaml
canonicalDocumentId: provider+episodeId+contentVersion 的稳定 ID
primaryArchive: project_dominant|industry_dominant|ambiguous
primaryUri: 唯一可编辑主文档 URI，歧义未解决时为空
linkedProjectIds: [已匹配的规范项目 ID]
linkedIndustryNodes: [已匹配的领域/子领域]
```

`ambiguous` 时不得先写多份再让用户删除；应在写入前暂停并返回候选项目和行业节点。

## 完成标准

只有以下全部满足才返回“播客已生成纪要并归档”：

1. 公开音频来源和授权已验证。
2. PLAUD 文字稿已下载并绑定同一 episode。
3. 结构化纪要已从 PLAUD 文字稿生成并完成实体、数字与观点归因核验。
4. 唯一主文档已写入并回读，项目／行业引用没有复制正文。
5. 有事件增量时已按 Radar 契约写入；没有增量也正常完成，不创建空事件。

PLAUD 暂不可用、归档目标歧义或写后验证失败时保留队列，从失败点恢复，不重做前序成功阶段。
