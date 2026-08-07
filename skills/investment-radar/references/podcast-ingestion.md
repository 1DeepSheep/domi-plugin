# 播客发现、PLAUD 转写与归档契约

播客是行业雷达的一类重要公开信源。domi 可以发现新单集、按关注规则筛选、临时下载公开音频、上传到用户自己的 PLAUD、基于 PLAUD 文字稿生成结构化纪要，并把同一主文档关联到项目和行业入口。

## 1. 授权边界

- 单次“生成纪要”按钮授权处理该单集。
- 用户为某个播客明确开启 `autoProcess`，构成对该信源未来命中规则单集的持续授权；关闭后立即停止发现后的下载和上传。
- 下载到本地不等于允许上传。没有上述单次或持续授权时，只保存候选元数据并等待用户选择。
- PLAUD 连接关闭、登录失效或远端不可用时，队列进入 `waiting_for_plaud`；禁止回退到 Qwen、Whisper 或任何本地 ASR，也禁止改用其他云端转写。
- 原音频和完整文字稿只用于用户自己的资料处理，不进入插件、Git、诊断报告或公开行业事件正文。

## 2. 发现与准入

按优先级读取：

1. 公开 RSS／Atom 的 episode GUID 与 `enclosure`。
2. 节目官方公开页面的 JSON-LD `PodcastEpisode.associatedMedia.contentUrl`。
3. 公开页面的 `og:audio`／`og:audio:url`。
4. 页面内公开嵌入数据的 `enclosure.url`。

只有同时满足以下条件才允许自动处理：

- 单集公开且免费，音频为可直接下载的 HTTP(S) MP3／M4A／AAC／Opus 等文件。
- 不需要登录 Cookie、私有 API、付费解锁、DRM、HLS／DASH 抓流或绕过访问限制。
- 标题、简介、嘉宾或正文元数据命中用户领域、关键词、重点项目或重点人物。
- 未按 `provider + episode GUID/canonical URL` 处理过；下载后再用音频 SHA-256 做第二次去重。
- 单集大小、时长、每日数量和网络条件符合用户设置。

## 3. 小宇宙公开单集

仅接受：

```text
https://www.xiaoyuzhoufm.com/episode/<公开单集ID>
```

使用本 Skill 自带的纯 Node helper：

```bash
node <investment-radar-skill>/scripts/xiaoyuzhou-public.js resolve "<episode-url>"
node <investment-radar-skill>/scripts/xiaoyuzhou-public.js download "<episode-url>" "<absolute-cache-path>.m4a" --max-bytes 1073741824
```

helper 只读取公开单集 HTML，并依次查找 JSON-LD、`og:audio` 和公开嵌入数据的 `enclosure`。它不调用小宇宙私有 API、不发送 Cookie、不读取浏览器 Profile。付费／受限标记、无公开直链或只有 HLS／DRM 时返回明确错误并停止。

页面结构变化导致解析失败时，把单集保留为 `metadata_only` 并提示用户；不得改用浏览器自动登录或持续重试抢焦点。

## 4. 下载队列

下载目录属于本机临时运行数据，例如：

```text
~/Library/Application Support/domi/podcast-cache/<source-id>/<episode-id>.m4a.part
```

- 目录权限 `0700`，文件权限 `0600`。
- 使用 `.part`、HTTP Range 与原子重命名支持断点续传；服务端不支持 Range 时从头覆盖临时文件。
- 校验 Content-Type、Content-Length、最大字节数和最终 SHA-256；HTML、播放列表和 DRM 内容不得冒充音频。
- 同时默认只下载／上传一个长音频，不能拖慢对话和 Radar 轻量刷新。
- PLAUD 确认接收且 SHA-256、远端 `fileId` 已记入私有队列后，可按用户保留策略删除临时音频；结果不确定时不得删除。

## 5. PLAUD 转写

对已校验音频采用 `domi:plaud`，调用：

```text
transcribe-local <audioPath> <outDir> <timeoutSec> <pollSec> <stableTitle>
```

- `stableTitle` 应含播客源短名、发布日期、单集 ID 的短哈希，保证恢复时可唯一定位；不得包含用户私人标签。
- 复用 `plaud` 的 SHA-256 去重、精确 `fileId`、结果不确定恢复和登录守卫；不得先跑 `pending` 猜测刚上传的文件。
- episode 元数据已经提供主题、节目名、嘉宾和简介时，可把它作为 `context_ready` 上下文，不需要再次询问用户参会人；缺失嘉宾时写“嘉宾待识别”，由文字稿和公开页面核验。
- 把 `sourceKind=podcast`、`transcriptProvider=plaud`、`episodeUrl`、`episodeId`、`podcastName` 与 `publishedAt` 交给 `asr-notes`。下游必须读取 `transcriptPath`，禁止重新读取音频做本地 ASR。

## 6. 纪要与主归档判定

播客默认使用 `asr-notes` 模式 B，纪要至少包含：核心观点、关键事实／数据、嘉宾判断、涉及公司与人物、行业含义、值得继续验证的问题和原始单集链接。纠错和联网核验过程不写入纪要。

先判定唯一 `primaryArchive`：

### `project_dominant`

满足任一强条件，并且主要内容围绕同一家公司：

- 该公司创始人／高管是主嘉宾；
- 超过一半实质内容讨论该公司的团队、产品、技术、商业化、融资或经营；
- 单集本身是该公司的正式访谈或项目更新。

主文档归入既有项目：

```text
3.项目库/<领域>/<主子领域>/<项目名称>/纪要/<YYYYMMDD>-<播客名>-<主题>.md
```

先按中英文名、品牌名、产品名和主体名查重；不能唯一匹配时停止归档并让用户点击选择，不得新建近似项目。行业动态和行业研究只保存对该主文档的引用、摘要和事件关系，不复制正文。

### `industry_dominant`

适用于讨论多家公司、技术路线、政策、市场格局或行业方法论，单一公司只是案例的单集。主文档归入：

```text
1.行业研究/<领域>/<主子领域>/播客/<节目名称>/<YYYYMMDD>-<单集主题>.md
```

提到的既有项目在项目主页／相关文档索引中增加同一主文档引用，不复制正文。

### `ambiguous`

无法稳定判断时返回可点击选择：`归入行业研究 / 归入候选项目 / 暂不归档`。选择“同时关联”仍只能产生一个主文档，其余位置保存引用。

## 7. 一份主文档，多处关联

- `canonicalDocumentId` 对同一纪要稳定不变，由 provider、episode ID 和内容版本生成。
- 只允许一个可编辑主文档；项目主页、行业研究索引、行业动态事件和人物相关文档均保存 `canonicalDocumentId + URI + 摘要`。
- 更新 PLAUD 文字稿或纪要时只更新主文档，引用自动读取最新内容；禁止复制同名 Markdown 到多个目录。
- 完整 PLAUD 文字稿可以作为主归档目录内的独立原始文档保存一次，行业动态中只保留短摘要和单集链接。
- 当前后端缺少可写的唯一行业研究根目录时，先保留在私有处理队列并要求用户配置；不得猜测 `1.行业研究` 的父目录。

## 8. 行业事件写入

播客不是“因为发布了新单集就自动成为重要新闻”。只有包含具体、可归因、可证伪且会影响投资判断的技术、商业化、竞争、政策或融资信息时，才形成 Radar 行业事件。

事件记录使用原始单集 URL，`source` 写节目名，证据状态明确为“公开访谈／嘉宾观点”或“公司口径”，并把观点与已发生事实分开。一个单集可形成多个真实世界事件；同一个真实事件被多期节目重复讨论时仍按事件级去重。

## 9. 完成与恢复

队列至少记录：

```yaml
podcast_job:
  source_id: src_v1_xxx
  episode_id: provider-guid
  status: discovered|downloading|downloaded|waiting_for_plaud|transcribing|notes_ready|archived|failed
  audio_sha256: 成功下载后填写
  plaud_file_id: 上传确认后填写
  transcript_path: PLAUD 下载成功后填写
  canonical_document_id: 纪要生成后填写
  primary_archive: project_dominant|industry_dominant|ambiguous
  retry_count: 0
  next_retry_at: ISO-8601 或空
```

下载、上传、转写、纪要和归档各阶段幂等恢复。PLAUD 上传／生成结果不确定时完整遵循 `plaud` Skill，不自动重复上传或重复提交生成。

