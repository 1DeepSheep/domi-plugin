# 用户信源注册表

行业动态除了通用联网检索，还可以从用户明确维护的新闻、RSS、重点公众号和播客信源发现候选。注册表只保存信源配置，不保存账号密码、登录 Cookie、文章正文、音频或完整文字稿。

## 1. 私有运行数据

注册表属于单个用户的本机运行数据，推荐由客户端保存在：

```text
~/Library/Application Support/domi/investment-radar/sources.json
```

也可以由 `DOMI_CONFIG_PATH` 指向的配置文件引用其他绝对路径。真实信源名称、内部关键词、公众号清单和播客关注规则不得写入插件源码、Git、诊断报告或发布包。注册表文件权限应为 `0600`，父目录为 `0700`。

凭据不属于注册表。需要认证的源默认不支持自动读取；以后若接入正式 OAuth，令牌只能进入 macOS 钥匙串。不得读取用户日常 Chrome／Tabbit Profile、复制 Cookie 或绕过登录墙。

## 2. 数据模型

```json
{
  "version": 1,
  "sources": [
    {
      "id": "src_v1_stable-id",
      "kind": "rss | website | wechat_official | podcast",
      "name": "用户可读名称",
      "url": "公开 URL",
      "enabled": true,
      "priority": "normal | important",
      "domains": ["AI"],
      "subdomains": ["Agent"],
      "keywords": ["公开关键词"],
      "excludeKeywords": [],
      "autoProcess": false,
      "lastCheckedAt": "ISO-8601 或空",
      "lastSuccessAt": "ISO-8601 或空",
      "failureCount": 0,
      "lastErrorCode": ""
    }
  ]
}
```

- `id` 从 kind、规范 URL 和用户配置生成稳定哈希；名称变化不得导致重复信源。
- `autoProcess` 对新闻仅表示自动加入 Radar 候选；对播客表示用户已明确授权“命中规则后下载公开音频、上传到自己的 PLAUD 并生成纪要”。默认必须为 `false`。
- 只允许 canonical 领域／子领域。无法映射的用户词保留在 `keywords`，不能暗中修改 taxonomy。
- 状态写入必须原子替换；抓取失败不得删除信源或重置成功水位。

## 3. 各类信源

### RSS

- 读取标准 RSS／Atom 条目，优先使用 GUID，其次使用 canonical URL 去重。
- 把标题、摘要、发布时间和公开链接送入候选队列；不长期保存全文。
- 301／308 后可在验证同源或用户确认后更新规范 URL；跨域跳转不得静默改写。

### Website

- 只读取公开页面、公开 sitemap、公开 RSS 或用户给出的具体文章 URL。
- 遵守站点访问限制；遇到登录墙、付费墙或 robots 限制时记录 `unavailable`，不绕过。

### 重点公众号

- 注册表保存公众号名称、公开主页／文章链接和关键词，不保存微信账号或 Cookie。
- 自动发现可以使用公开可检索页面、用户提供的文章 URL 或用户自行提供的 RSS bridge；不得承诺完整覆盖。
- 无法访问正文时只保留标题、公开摘要和原始链接，不得根据搜索摘要伪造正文事实。

### Podcast

- 优先使用节目公开 RSS 的 `enclosure`；其次使用节目官方公开页面中的 JSON-LD、OpenGraph 音频字段。
- 小宇宙只按 [podcast-ingestion.md](podcast-ingestion.md) 解析公开 `/episode/<id>` 页面。
- 付费、私密、无公开直链、HLS／DASH、DRM 或需要账号 Cookie 的单集一律跳过。

## 4. 发现与处理分层

每轮先做轻量、确定性的信源读取，再让 Radar 做核验和评分：

```text
读取已启用信源
  → 按 GUID／canonical URL／内容哈希去重
  → 关键词与重点对象匹配
  → 建立候选和来源状态
  → 打开原文核验
  → Radar 事件归一、评分与归档
```

已知信源之间可以并发抓取；同一信源的水位更新必须串行。候选失败与 Radar 其他领域隔离，不得因为一个源超时阻塞整轮扫描。

## 5. 用户操作语义

- “添加信源”：只保存配置并执行一次只读连接测试，不自动补抓历史全文。
- “立即检查”：只检查选中的源；不扩大到通用全网扫描，除非用户同时要求。
- “开启自动处理”：对播客必须明确展示将发生“下载公开音频 → 上传用户 PLAUD → 生成纪要”。用户确认后才设置 `autoProcess=true`。
- “停用”：保留历史事件和纪要，只停止新发现。
- “删除信源”：删除配置，不删除已经归档的事件、纪要或项目关联。

## 6. 完成回执

信源轮次至少返回：

```yaml
source_coverage:
  enabled: 8
  checked: 8
  succeeded: 7
  failed: 1
  items_discovered: 14
  items_deduplicated: 9
  candidates_forwarded: 5
  failures:
    - source_id: src_v1_xxx
      code: SOURCE_TIMEOUT
```

回执默认不展示完整私有信源清单，只显示聚合数量与需要用户处理的失败源名称。

