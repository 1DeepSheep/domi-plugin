# 信息源路由 + 飞书落库

目录：1. 信息源路由表 · 2. 中文/另类数据源 · 3. 平台访问壁垒与绕法 · 4. 检索算子工具箱 · 5. 一手源优先级 · 6. 调用要点 · 7. 取数纪律 · 8. 飞书落库（文档/多维表格）

## 1. 信息源路由表

按「维度 × 市场」选源，**优先专业/内部源，公开搜索补全与交叉验证**。所有这些都是已存在的能力，本 skill 只负责调用。

| 需求 | 一级（primary） | 二级（secondary） |
|---|---|---|
| 公开事实/新闻/访谈/政策 | `web-search`、`news-search`（Brave） | 同左 |
| 深度多源研究（带校验） | `deep-research`、`product-deep-research` | `deep-research`、`bigdata-com:financial-research-analyst` |
| 公司基本面/简报 | 搜索 + 一手信源 | `bigdata-com:company-brief`、`daloopa:tearsheet` |
| 财报/建模 | —（多无公开财报） | `daloopa:build-model`、`daloopa:earnings`、`daloopa:working-capital` |
| 可比公司 | 同类创业公司横评（搜索） | `daloopa:comps` / `daloopa:comp-sheet`、`bigdata-com:peer-comparables` |
| 估值 | 一级估值靠融资轮次/对标 | `daloopa:dcf`、`bigdata-com:valuation-snapshot`、`bigdata-com:scenario-analysis` |
| 催化剂/预期差 | 里程碑/融资窗口 | `bigdata-com:catalyst-monitor`、`bigdata-com:variant-perception`、`daloopa:guidance-tracker` |
| 行业/赛道 | `product-deep-research`、搜索 | `bigdata-com:sector-analysis`、`bigdata-com:sector-playbook`、`daloopa:industry` |
| 风险/治理 | 单点依赖/合规（搜索+判断） | `bigdata-com:risk-assessment`、`bigdata-com:moat-governance-review`、`bigdata-com:earnings-quality-screen` |
| 产业链/上下游 | 搜索 + 访谈 | `daloopa:supply-chain` |
| 内部已有材料 | `investment-mgmt`、`lark-wiki`、`lark-base`、`feishu-doc-reader` | 同左 |

> bigdata-com / daloopa 是带 OAuth 的付费数据源 plugin。若调用返回未认证错误，提示用户先在终端完成对应 plugin 的授权，再继续。

## 2. 中文 / 另类数据源（按用途）

上面路由表偏通用/英文源；做中国一二级投研时，下面这些中文与另类数据源往往才是一手主力。取信优先级与「一手 > 二手」一致（见第 5 节）。

| 用途 | 源 + 获取方式 |
|---|---|
| 一级融资/项目动态 | IT桔子、烯牛数据、36Kr、晚点 LatePost；`web-search` + `site:` 限定 |
| 工商/股权/对外投资 | 天眼查、企查查（登录/付费墙 → 取免费层，深度字段标「受限」） |
| 公司公告/招股书/年报 | A股巨潮资讯 cninfo、港股披露易 HKEXnews、美股 SEC EDGAR（直链 fetch；招股书 / 10-K 是一手） |
| 券商研报 | 慧博投研、发现报告（二手，验证与对标用） |
| 二级散户情绪/催化 | 雪球、东方财富股吧（多数可直接 `baoyu-url-to-markdown` 抓正文） |
| 行业数据/景气 | 国家统计局、行业协会、艾瑞/易观；Wind/Choice（如内部有） |
| 技术/研究型标的产出与采用度 | **GitHub org + HuggingFace org**（仓库/模型清单 + star/下载 + 创建/push 日期 = 产出全集+采用度+迭代节奏）。注意 GitHub 匿名 API 很快限流、环境未必装 `gh`，可用浏览器或网页抓取 `github.com/orgs/<org>/repositories` 取 star |
| 标的官网（SPA） | 首页常 JS 渲染，静态抓取容易抓不全；用浏览器/CDP 渲染**索引页**（/blog、/news、/benchmarks、/changelog、/product）枚举其全部工作与时间线 |
| 公司考古/产品转型 | 官网 About/Blog/Changelog、创始人长访谈、融资稿、旧域名与 Wayback、Product Hunt/HN launch、应用商店版本记录；把主体、产品版本、pivot 与量化节点放到同一时间线 |
| 商业动作/增长机制 | 官方 pricing.md/定价页、docs/integrations、Marketplace/App Store、Creator/Affiliate/Referral 页面、客户案例、评价平台、招聘 JD、sitemap/blog 索引；先证明动作存在，再找开始时间和归因数据 |
| 消费品牌/口碑 | 小红书、B站、抖音、大众点评；KOL 与高频评论 |
| 公众号深度文/行业洞察 | 搜狗微信检索 → 解析真实 mp.weixin 链接 → Chrome CDP（`baoyu-url-to-markdown`）抓正文；**完整 SOP 见第 3 节**（注意：Brave `site:` 与直抓都拿不到正文） |
| 团队/组织扩张信号 + 投资方/战略线索 | 脉脉、BOSS直聘、LinkedIn、猎聘——除在招岗位数与方向外，**招聘页还常暴露投资方**（如「XX 成员企业」标签、由某机构代招）**与战略自述**（JD 里的业务定位）。本次实测：融资数据库零命中时，招聘页的「红杉成员企业」标签反而成了确认投资方的最强一手线索 |
| 专家访谈/纪要 | 内部纪要库优先；公开端用精确短语搜「{公司} 调研纪要 / 业绩说明会纪要」 |

## 3. 平台访问壁垒与绕法

许多源有反爬、登录墙或付费墙。先用绕法拿公开层；拿不到就在信源清单标「受限/未覆盖」，**不要编造**。

| 平台 | 障碍 | 绕法 |
|---|---|---|
| 微信公众号 | 不被通用搜索完整索引；正文有「环境异常」验证墙 | **必须 Chrome CDP 抓正文**——见下方实测 SOP。普通搜索、`curl` 或静态抓取直抓 mp.weixin 均可能返回「当前环境异常」墙，搜索引擎 `site:mp.weixin.qq.com` 常只回验证页，**都拿不到正文** |
| 雪球 / 股吧 | 部分内容需登录 | 多数帖/文可直接 `baoyu-url-to-markdown`；抓不到换网页搜索缓存 |
| 天眼查 / 企查查 | 登录 + 付费墙 | 取免费可见层（成立时间/股东/融资摘要）；深度字段标「受限」 |
| 招股书 / 年报 | 散落各处 | 直链官方披露端：巨潮 cninfo、披露易 HKEXnews、SEC EDGAR |
| X / Twitter | 要登录 | Google / `site:twitter.com` 检索，或 Nitter 镜像 |
| Reddit | 封爬虫 | 改用 Google `site:reddit.com/r/<sub>` |
| App 数据 | SensorTower / data.ai 付费墙 | 回退官方 App Store / Google Play 页（评分/下载档位/排名）；聚合器（SimilarWeb/AppBrain）只作估算并标推测 |

### 微信公众号正文抓取 SOP（实测可复现，三步缺一不可）

> 命门是第 ③ 步：`curl`、静态抓取或搜索引擎 `site:` 直抓 mp.weixin 都可能撞「环境异常」验证墙，**只有真实浏览器（Chrome CDP）能过**。

1. **搜狗微信检索文章**：`https://weixin.sogou.com/weixin?type=2&query=<关键词>`
   - 带浏览器 UA + cookie jar（`curl -A <UA> -c jar.txt`）直连即可，返回标题/公众号名/跳转链接，不必登录。
2. **解析真实 mp.weixin 链接**：搜狗结果是 `/link?url=...` 的 **JS 跳转**（非 302，`curl -L` 跟不动）。
   - 带 cookie + `Referer:` 拉回该页，正则抽取 JS 里 `url += '...'` 拼接段，得到真实 `https://mp.weixin.qq.com/s?...` 链接（签名有时效，**现解析现抓**）。
3. **Chrome CDP 抓正文**：`baoyu-url-to-markdown <真实mp链接>`（auto 模式即可，落 markdown 带标题/正文/图片）。
   - 失败时用其 `--wait` 模式人工过验证；或退而抓**可直接访问的镜像**（智源社区 hub.baai.ac.cn、量子位/甲子光年官网、知乎专栏——常转载同一批公众号深度文，知乎偶发 403）。

## 4. 检索算子工具箱

- `site:` 限定站内（绕封爬 + 锁优质域）：`site:mp.weixin.qq.com`、`site:reddit.com/r/<sub>`、`site:cninfo.com.cn`。
- `"精确短语"`：`"{公司} 业绩说明会纪要"`、`"{公司} 调研纪要"`、`"如何用 {产品}"`。
- `filetype:pdf`：找研报 / 纪要 / 招股书原件。
- **别名并查**：公司中英文名 + 股票代码并列搜，区分同名实体（呼应第 0 步标的指纹）。
- **创始人访谈矩阵（一级必跑）**：`"中文名" 访谈/专访/播客/演讲`、`"English Name" interview/podcast/talk`、`"中文名" "公司名"`、`"账号名" founder`；中国项目追加 `site:jazzyear.com`、`site:36kr.com`、`site:latepost.com`、`site:founderpark.com`，并用文章精确标题查转载。搜索不到原站不等于没有文章。
- **公司考古矩阵**：`"公司名" launched/founded/pivot/rebrand/shut down`、`"旧产品名" "新产品名"`、`site:公司域名 blog|changelog|about`、Wayback 旧首页/定价页、Product Hunt/HN launch。优先确认“模型、功能版本、独立产品、公司实体”各自是什么。
- **商业动作矩阵**：检查 `/pricing`、`/pricing.md`、`/enterprise`、`/integrations`、`/customers`、`/creators`、`/affiliates`、`/partners`、`/referral`、`/changelog`、`/sitemap.xml`；再查 Slack/Teams/App Store/Chrome Store Marketplace、G2/Product Hunt 评论与招聘岗位。页面存在只证明动作存在，不证明其贡献。
- **客户工作流检索**：`"how I use {产品}"`、`"{产品} replaced"`、`"{产品} case study"`、`"switched to/from {产品}"`，记录用户角色、公司规模、具体任务、替代对象、结果及是否为付费/赞助内容。
- **Google Trends 对比**（≤5 词）：`trends.google.com/trends/explore?q={标的},{对手1},{对手2}&date=today%205-y`，看相对搜索热度与拐点；中英文/别名也可并查 `?q=A,B`。

## 5. 一手源优先级（核心数字按此排序取信）

> 招股书/年报/公告 > 管理层·创始人自述 > 一手调研纪要/专家访谈 > 券商深度研报 > 主流财经媒体 **>>** PR 稿 / 二手汇编 / 散户帖

- **一手页面取数，不信聚合器**：下载/用户/财务直接看官方页或披露文件；第三方聚合（SimilarWeb/AppBrain/烯牛/Getlatka）滞后，只作估算且标「（推测）」。
- **官方「关于我们」不自动可信**：可能漏掉真创始人；目录/profile 类产品页上的样例可能被误当团队成员。
- **一手不等于独立核实**：公司官网、创始人帖子、投资方文章、公司投放到 PR Newswire 的通稿，适合确认“谁在何时声称了什么”或“某动作确实存在”，但经营数字仍标「公司口径」。几家媒体若都引用同一公告，只算一条来源链。
- **可观察动作不等于经营贡献**：定价档位、Creator Program、Marketplace 上架、内容数量、招聘岗位可以直接观察；它们不能单独证明收入结构、获客占比、客户留存或平台优待。

## 6. 调用要点

- **先内部后外部**：开工先用 `investment-mgmt` / `lark-wiki` 查内部是否已有该标的/赛道材料，接续而非重复。若当前环境没有连接或权限，标注“内部资料未覆盖”后继续公开源研究；连接缺失不等于内部没有记录。
- **网页正文抓取**：需要把某篇长文/网页转成可分析文本时，用 `baoyu-url-to-markdown`；本地 PDF/研报用 `pdf` skill 提取。
- **SPA 站点用 CDP 渲染索引页**：标的官网/产品站多为 JS 渲染，静态抓取首页常只回一句 slogan、漏掉绝大部分内容；要枚举其产出，用 CDP 渲染 /blog、/news、/benchmarks、/changelog 等**索引页**（本次实测：UniPat 首页静态抓取几乎空，CDP 渲染 /blog+/benchmarks 才拿到全部 7 项工作）。这是「公众号必须 CDP」（§3）的通用化。
- **深度编排**：depth=deep 时优先让 `deep-research` / `product-deep-research` 做 fan-out 检索与校验，本 skill 负责把结果套进框架并落库。子报告不是事实库：先抽取其 Claim Ledger、回溯最上游来源、折叠同源转载、解决跨模块冲突，再吸收进投资结论。

## 7. 取数纪律

- 每条关键事实记录**来源 + 日期**，核心数字尽量交叉验证（≥2 个**真正独立**的源）。**多源 ≠ 交叉验证**：几家媒体若同回溯到一篇 PR 通稿/同一转载源，仍只算 1 个公司口径源。自办 benchmark 的榜首要分清「谁的榜 vs 谁登顶」，勿把第三方模型的成绩误记为标的战绩。
- **证据六态**：关键结论统一标为①独立核实（监管披露/审计数据/真正独立调查）；②公司口径（公司、创始人、投资方或公司通稿声称）；③可观察动作（产品页、定价、上架、招聘、代码与内容确实存在）；④推算（明确公式与输入）；⑤假设（机制解释/因果判断，列替代解释）；⑥缺失或 unresolved。不要用“一手来源”替代这套状态。
- **实体隔离**：母公司/子公司/同名公司的营收、融资、用户数不得串台（见 company-profile.md 标的指纹）。
- **fan-out 防污染**：委派 `deep-research` / `product-deep-research` 等子任务时，编排器传下去的未核实指标一律标「（待验证）」——否则一个错数字会被多个子任务当事实锚定、层层传播。
- **Claim Ledger（company mode 必做）**：维护 `指标｜原始披露术语｜数值｜实体范围｜定义/分母｜截至时间｜最上游来源｜证据状态｜置信度｜冲突/备注`。融资、估值、收入、ARR/RR、客户/用户/安装量、团队、价格等数字必须先进入台账，再进入正文或横评表。数据库 headline、创始人原话和新闻稿若不能对账，不得擅选“最新”单点；并列保留原词、口径与时点，累计类指标报可核验下限或区间。
- **指标语义不可互换**：ARR ≠ annualized revenue run-rate ≠ bookings ≠ GMV；organization/team/workspace/注册/活跃/付费客户分别列示；总员工、工程团队和 LinkedIn 显示人数分别列示。多标的横评若无法统一定义和截至时间，直接标“不可比”。
- **时间因果门槛**：增长动作必须早于被解释的增长结果；同时至少有归因数据、用户来源调查、UTM/渠道转化、cohort 或多个独立客户证言之一，才可写“驱动/导致/主要来自”。否则写“机制存在”“与该假设一致”，并列替代解释。
- **推算纪律**：所有推算紧邻展示公式、输入来源、范围和敏感性。无底层数据时禁止输出收入流占比、付费客户数、用户总体画像占比、单点 TAM/SOM、ACV、runway 或投资人回报；可以给明确标注的情景区间。
- **用户证言纪律**：说明样本来源、数量、时间和是否赞助/合作；评论样本只能描述“本次样本中的高频场景”，不得外推总体构成。quote block 只放实际打开来源中的逐字原话，二手概述写成转述。
- 二级注意**口径**：币种、单位、GAAP/Non-GAAP、报告期、是否最新季度。
- **诚实记缺口**：抓取失败/受限的源（封爬、登录墙、付费墙）写进信源清单，方便复查时知道哪些没覆盖到。
- **长访谈结构化抽取**：用表格记录 `原话事实｜数字/时间｜来源身份｜独立验证｜投资含义｜报告层级(A/B/C)`。教育经历保留学校、专业、学位、导师/实验室、关键任职和代表性发表场所；技术项目保留输入、Pipeline、输出、规模、基准对比、用途、成本/价格决定因素，避免压缩成“技术实力强”。
- **数字保留限定**：区分累计/新增、开源/内部、环境/任务/轨迹、报价/预算/成交价、单月盈利/持续盈利。引用创始人口径必须注明身份和时点，不得因写摘要丢掉限定条件。
- **就近绑定来源**：关键事实和数字在首次出现处附最上游来源、日期和证据状态；章节末信源清单按「独立核实 / 公司口径 / 可观察动作 / 二手背景 / 受限未覆盖」分类，不用一串 URL 代替逐项证据。
- 不提供个性化买卖建议；涉及决策时只做事实与逻辑梳理。

## 8. 飞书落库

所有飞书操作走 **lark-cli / lark-* skill**（不要用 lark MCP 工具）。

### A. 飞书文档（默认：长文画像 / 扫描报告）

1. 用对应 reference 的「报告结构模板」把成果整理成 Markdown；文档标题通过创建参数或 Wiki 节点标题承载，正文主要板块使用 `####`，板块内分组使用 `#####`，禁止生成或自动提升为 `#` / `##` / `###`。
2. 调 `lark-doc` skill：由 Markdown 创建飞书文档（docs 从 markdown 创建）。
3. 拿到文档链接后，回填到内部知识库相应位置（Wiki 节点 / Watching List 记录），保持三系统一致。

### B. 多维表格（结构化 / 可对比 / 入管道）

适用：sector 玩家地图、入围名单、多标的横向打分、把研究结论并入 deal flow。

- 若是在管理投资管道（Watching List / 项目分类 / 进展状态 / 评级 / 跟进时间），**优先走 `investment-mgmt` skill**，它已封装该多维表格的字段 schema 与一致性规则。
- 若是新建一张研究专用表或写入临时对比表，用 `lark-base` skill：建表/字段/写记录。
- 表头建议（company 横评）：标的 ｜ 市场 ｜ 一句话 ｜ 阶段/估值 ｜ 核心发现 ｜ bull ｜ bear ｜ 结论 ｜ 文档链接 ｜ 更新日期。

### C. 衔接下游

落库后，研究底稿可直接喂给：`ic-memo`（一级 IC memo）、`bigdata-com:investment-memo`（二级）、`deal-negotiation`（进入谈判）。
