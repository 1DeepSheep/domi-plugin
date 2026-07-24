# 投行/咨询风格研究 Slides 指南

## 使用场景

当用户要求把基本面分析、招股书分析、IPO文件分析、财务模型分析或已有产品/行业研究底稿“做成 slides 报告”“做成 PPT”“输出 deck”、HTML deck、PDF 报告、投行风格报告或咨询风格报告时，使用本指南。`slides`、`PPT` 和 `deck` 默认表示报告形态，不表示 `.pptx` 文件格式；只有用户明确要求 `PPTX`、`.pptx`、可编辑 PowerPoint 或 PowerPoint 源文件时才制作 PPTX。先完成研究分析，再做展示，不要直接跳到排版。

## 内容工作流

1. 先生成完整研究底稿，通常为 Markdown。底稿应覆盖业务、收入结构、关键经营指标、关键财务报表与财务模型、UE、成本费用、财务质量、融资历史、股东结构、解禁压力、行业格局、客户/供应商/竞对披露、匿名实体备注、市场观点与外部争议、风险和后续 KPI。
2. 再把底稿转换为 slides。每页只承载一个中心判断，但允许放较多文字、表格和数字，不要把研究报告压成过度简略的营销页。
3. 制作前先建立 `slide_plan` 或页级 slide contract。每页必须写清：对应底稿章节/段落、thesis title、本页回答的投资/产品/业务问题、必须保留的关键事实和数字、主图/主表、右侧分析或结论条、投资/产品/业务含义、来源，以及 `必须出现` 的直接答案短句。slides 的内容必须从分析报告/研究底稿派生；除非明确标为新增补充分析，不要凭空加入底稿没有支撑的判断。`必须出现` 用 `短句1 || 短句2` 记录，交付前要在最终 HTML 中逐句命中。
4. 同步建立“底稿覆盖矩阵”：把研究底稿中的核心结论、关键数据表、财务模型、经营 KPI、融资回报、客户/供应商/竞对、市场观点与外部争议、风险和后续验证项映射到具体页码。重要信息没有映射到 slides 时，必须补页、合并到已有页、放入附录或明确说明删减原因；不要让重要分析只停留在 Markdown 报告里。
5. 制作前建立 `layout rhythm plan`：逐页写清 layout family、是否使用 metric strip、主证据类型和预计页面密度。长 deck 不应连续多页使用同一版式；底部四卡片只能作为可选解释层。
6. 初版 slides 完成后，反向对比“底稿 vs slides”，列出缺失信息并补页或补表。重点检查成本费用口径、现金流质量、融资回报、解禁条件、行业份额、客户/供应商历年金额占比和匿名实体备注是否遗漏。
7. 用户要求更新版式时，优先调整表格、图片、图表、文字块、KPI strip 和 note box 的排版密度；不要用奇怪页面比例解决空白。
8. 如果 deck 页数偏多或用户反馈信息密度不足，先做页级审计：删除方法论/过渡/重复解释页，把相邻主题合并为“观点 + 支撑数字/图表 + 投资/产品/业务含义”的高密度页。不要只是压缩字号；优先减少重复页数并提升每页结论含量。
9. 业务模式页不能只讲概念。优先把“业务线 + 经营指标 + 收入/毛利/成本 + UE 含义”放在同页或相邻两页，尤其使用招股书披露的 KPI 表。
10. 参考 Morgan Stanley 研报时，不要只模仿颜色或页眉。先定义本页要回答的分析问题，再选择图表类型和 layout family，把“数据 -> 计算过程 -> 结论”的路径画出来；每张图都必须服务一个可验证判断。
11. 如果参考的是 Morgan Stanley MIDSMALL / Spotify 一类研究报告，先判断本页属于哪种信息组织：单股 memo 页、主题数据页、估值/回报页、财务附录页或风险矩阵页。不要把所有页都做成“上表 + 下方四卡片”。MS 常见舒适感来自主证据块足够大、分析文字贴近数据、图表直接回答问题、留白有节奏，而不是把页面填满。

## 报告意图锁

制作首页和核心结论页前，先锁定报告类型，避免把模板语境带错：

- IPO、招股书、财报、基本面分析：可使用 `IPO FILE ANALYSIS`、`FUNDAMENTAL ANALYSIS`、投资判断、估值争议、投资含义等语言。
- 产品调研、产品深度研究、竞品研究：使用 `PRODUCT RESEARCH`、产品调研核心发现、产品/用户证据、产品含义、Key product questions 等语言；除非用户明确要求，不要把首页写成投资判断、估值含义或承销式摘要。
- 行业扫描、竞对分析、增长研究：按用户目标选择 `INDUSTRY ANALYSIS`、`COMPETITIVE ANALYSIS` 或 `GROWTH RESEARCH`，标题和表格列名要服务对应任务。
- 如果用户给了参考 PDF 或截图，先把参考页和当前页都渲染成图片再改版式；匹配结构和节奏，包括页眉、侧栏、主表、KPI strip、页脚、边距和留白，不只匹配颜色。

## Deck 稳定协议

制作或大改 slides 前，先建立三个轻量文件或等价结构；如果用户只要求小改，也要在脑中按同样顺序检查：

1. `research.md`：完整研究底稿，是 slides 的唯一事实底座。新增外部观点、官网定价、匿名实体识别或手工计算时，先写入底稿或在 slide contract 中标注为“新增补充分析”。
2. `slide_contract.md`：页级内容合同。每页必须包含页码、页面节奏、模板类型、观点标题、对应底稿章节、必须保留数字/事实、主图/主表、右侧分析、投资/产品/业务含义、来源、删减说明和可检索的 `必须出现` 直接答案。融资回报页至少锁定倍数最高、IRR 最高、整轮绝对增值最高、单一机构绝对增值最高和最大外部投资人；首页若有投资建议，锁定评级、目标价、对应市值和估值方法。
3. `style_lock.yml` 或等价设计锁。默认使用 `assets/slides/style-packs/morgan-stanley/style-lock.yml`。固定页面尺寸、品牌、页眉/页脚、字体、主色、表格样式、图表样式、KPI strip 规则、数字格式、来源格式和导出设置。后续迭代不得临时改页面比例、字体、颜色或表格体系，除非用户明确要求。

### Full Workflow Gate

生成 IPO/招股书 deck 时，必须把下面四项视为导出 PDF 前的硬门槛，而不是建议：

1. `research.md` 至少覆盖业务、经营 KPI、财务模型、成本费用/UE、working capital、客户/供应商、融资与股东回报、股东结构/解禁、竞对、外部市场观点、风险和来源；若底稿只有几十行或只是摘要，必须继续读招股书。
   - 若已有旧 deck/旧报告审计失败或被用户指出“深度、信息密度、视觉设计明显不足”，不要只改 CSS 或移动元素。先重建底稿和页级合同，再决定每页是否保留、合并、重画或删除。
2. `slide_contract.md` 不是目录。每页至少写清：页面节奏、layout family、观点标题、对应底稿章节、必须保留数字/事实、主图/主表、分析区、来源、删减说明和 `必须出现` 直接答案；contract 的答案必须原样或等义出现在成稿，而不是只把支撑数据放进表格。
3. coverage matrix 必须能回答“研究底稿每个重要结论在哪一页出现”；找不到页码的信息，要么补到 slides，要么放入附录，要么明确写删减原因。
4. 执行 `scripts/audit_research_deck.js --research <research.md> --contract <slide_contract.md> --html <deck.html> --mode prospectus --strict --evidence <evidence_ledger.md> --entities <entity_map.md> --policy <calculation_policy.md> --checklist <disclosure_checklist.md>` 或手动等价审计。失败时不要导出 PDF；警告项必须人工判断并记录处理结果。

典型失败信号：研究底稿少于完整模块、contract 只有页名、没有 coverage matrix、HTML 里出现旧品牌占位词、连续多页同一模板、图表缩小到轴和标签不可读、页底机械四卡片。出现这些信号时，回到研究或 contract，而不是只微调 CSS。

制作过程中按“Strategist -> Executor -> QA”分工执行：

- Strategist：先决定每页回答哪个投资/产品/业务问题、用哪个模板、放哪些底稿信息；重点防止信息遗漏和页数膨胀。
- Executor：只按 slide contract 和 style lock 落版，避免边写边改风格。每做一页先重读本页 contract 和全局 style lock。
- QA：逐页检查内容覆盖、标题观点性、视觉密度、表格/图表可读性、来源和数字格式。QA 发现问题必须回到 contract 或样式，而不是只在局部硬调。

每页必须先选择页面节奏：

- `dense`：财务模型、经营 KPI、客户/供应商、融资、股东回报、市场观点、来源页。至少有一个主表/主图和一个分析/结论区域。
- `balanced`：核心判断、业务模式、UE、财务质量、竞争格局。优先使用“左数据右分析”或“主图 + 支撑表 + 结论条”。
- `breathing`：封面或少数强调页。即使留白，也必须用高信息量核心结论、投资/产品/业务问题或关键数字支撑。

若页面显空，按以下顺序处理：

1. 查 coverage matrix：是否遗漏底稿中的关键数字、事实、图表、来源或投资/产品/业务含义。
2. 查模板：是否应用了错误模板，例如把复杂财务问题做成单表页，或把文字信息页做成四卡片页。
3. 调整空间：放大主表/主图，改变左右栏宽，合并两张小图为一个主图，或把底部 KPI 卡换成更有信息量的小图/小表。
4. 合并页面：若两个相邻页面都只有半页信息，合并为一页“数据 + 分析 + 含义”。
5. 删除装饰：去掉低价值 KPI 卡、重复 note 和过渡页，不用无关元素填空。

交付前必须形成最小 QA gate：

- 内容 gate：研究底稿核心结论、关键经营指标、财务模型、融资回报、客户/供应商、市场观点和风险均映射到页码。
- 视觉 gate：无巨大空白、无文字重叠、无表格挤压、左右栏高度大体平衡、页底元素不贴边。
- 数据 gate：轴、刻度、单位、来源、千分位、负号、货币空格、品牌和页码一致。
- 导出 gate：HTML 无 overflow；PDF 尺寸正确；最终 PDF 所有页面均已渲染并逐页检查，关键页另做单页放大复核。只抽样检查不算完成。

## 可复用视觉资产

制作 HTML/PDF deck 时默认使用 Morgan Stanley style pack。优先复用 skill 内置资产，不要每次从零写样式：

- `assets/slides/style-packs/morgan-stanley/style-lock.yml`：默认设计锁，固定 Morgan Stanley 页面尺寸、字体、颜色、表格、图表、数字和 QA 规则。
- `assets/slides/style-packs/morgan-stanley/style.css`：默认风格入口，引用 Morgan Stanley 研报式 CSS。
- `assets/slides/style-packs/morgan-stanley/chart-recipes.md`：常用图表语法，规定收入、UE、财务质量、估值、客户/供应商、市场观点等场景用什么图。
- `assets/slides/style-packs/morgan-stanley/layout-recipes.md`：版式选择手册，覆盖左表右分析、宽表+侧栏、上图下表、多图矩阵、估值表+callout、风险矩阵、timeline 等 Morgan Stanley 常见结构。
- `assets/slides/style-packs/morgan-stanley/layout-index.json`：机器可读版式索引和 metric strip 使用限制，用于生成前规划和 QA。
- `assets/slides/style-packs/morgan-stanley/templates.html`：Morgan Stanley 风格页面模板，包括封面、左数据右分析、宽表+侧栏、上图下表、双 exhibit、多图网格、timeline、bridge、估值、风险矩阵、财务报表、市场观点页。
- `assets/slides/ms-research.css`：底层 CSS 实现，固定页面尺寸、页眉页脚、字体、标题、Morgan Stanley 式财务表、黑底文字表、note box、metric strip、左右栏、exhibit grid 和打印样式。保留为兼容入口。
- `assets/slides/base-deck.html`：默认 HTML 骨架，已指向 Morgan Stanley style pack。新 deck 可复制到项目输出目录后替换占位符。
- `assets/slides/page-templates.html`：通用页面片段。制作页面时先选模板再填内容；Morgan Stanley 风格优先使用 style pack 内的 `templates.html`。
- `references/morgan-stanley-ibd-template-notes.md`：Morgan Stanley IBD pitchbook 参考模板，沉淀 Douyu、Pivotal 两份 IBD deck 的 football field、valuation matrix、DCF/WACC、交易溢价、cap table、scenario benchmarking、event-callout chart 等版式和使用场景。
- `scripts/init_deck.js`：初始化新 HTML deck，默认复制 Morgan Stanley style pack、CSS、模板和 style lock。
- `scripts/qa_deck.js`：Playwright 视觉 QA 脚本，检查 `.slide` 溢出、元素越界和明显空白预警。
- `scripts/export_pdf.js`：Playwright HTML -> PDF 导出脚本，默认 `11in x 8.5in`、print background、CSS page size。

推荐流程：

```bash
node ~/.codex/skills/investment-analysis/scripts/init_deck.js outputs <deck> --style morgan-stanley
# 先查看 layout-recipes.md / layout-index.json 做 layout rhythm plan
# 再在 outputs/<deck>.html 中替换占位符，并从 style-packs/morgan-stanley/templates.html 复制页面片段
node ~/.codex/skills/investment-analysis/scripts/audit_research_deck.js --research outputs/<deck>_research.md --contract outputs/<deck>_slide_contract.md --html outputs/<deck>.html --mode prospectus --strict --evidence outputs/<deck>_evidence_ledger.md --entities outputs/<deck>_entity_map.md --policy outputs/<deck>_calculation_policy.md --checklist outputs/<deck>_disclosure_checklist.md
node ~/.codex/skills/investment-analysis/scripts/qa_deck.js outputs/<deck>.html
# 字体敏感交付可强制检查英文/数字 family
node ~/.codex/skills/investment-analysis/scripts/qa_deck.js outputs/<deck>.html --require-latin-font Calibri
node ~/.codex/skills/investment-analysis/scripts/export_pdf.js outputs/<deck>.html outputs/<deck>.pdf
```

如果项目已经有成熟 HTML deck，可不强制重写为模板，但必须把现有 CSS 与 Morgan Stanley style pack 的关键约束对齐：`11in x 8.5in` 页面、Calibre/Calibri 数字英文与楷体中文 fallback、蓝色观点标题、两类表格风格、稳定 footer/source、无 overflow 和无巨大留白。

## 常用页面模板

优先从下列模板中选，避免每页临时发明版式：

- `cover-with-findings`：封面 + 5-7 条核心结论 + 右侧材料信息。用于首页，不能只放泛泛摘要。
- `three-column-thesis`：3 个并列判断 + 一句话投资/产品/业务含义。用于核心判断页。
- `left-data-right-analysis`：左侧财务表/经营数据/模型，右侧逐项解释和小表。用于 UE、收入质量、财务质量、working capital。
- `two-exhibit-plus-note`：上半页两个同高 exhibit，下方结论条或支持图。用于收入/成本、客户/供应商、股东结构。
- `full-table-plus-sidebar`：宽表 + 右侧解释/限制/跟踪指标。用于客户、供应商、融资明细、来源清单、风险登记；比页底四卡片更适合文字/披露密集页。
- `single-stock-memo`：上方是 Focus points / Catalysts & risks / Valuation 或关键争议，下面是小图 + 预测/经营表。用于首页后的一页式投资摘要、估值争议或核心判断页。
- `thematic-table-plus-trends`：左侧大表，右侧趋势分析 + 一个支持图。用于收入结构、经营 KPI、客户/供应商集中度、市场份额和行业主题页。
- `top-chart-bottom-table`：上方主图解释趋势，下方支持表和结论。用于收入 mix、毛利率趋势、客户/供应商集中度和关键经营指标。
- `asymmetric-main-plus-minis`：一个主 exhibit + 两个小 exhibit。用于市场格局、业务模式、估值图 + 财务模型校验。
- `four-exhibit-grid`：2x2 小 multiples。用于并列展示四个指标、四类 peer、四个情景。
- `timeline-plus-table`：左侧时间线 + 右侧金额/估值/持股表。用于产品里程碑、解禁安排或融资摘要；不得作为融资历史明细的主模板。融资历史明细必须优先用 `full-table-plus-sidebar` 或 `full-width-disclosure-table`，保留“融资时间、融资轮次、投前估值、股东出资情况、投后估值”五列表头。
- `waterfall-plus-bridge`：bridge / waterfall + 假设表。用于 UE、现金流、利润率、估值和股东回报形成过程。
- `valuation-table-with-callouts`：估值/回报主表 + 侧边 callout。用于可比公司、IRR、绝对收益、估值争议。
- `risk-matrix-table`：黑底表头宽表。用于风险、rating、上行/下行情景、关键验证点。
- `full-width-disclosure-table`：宽表 + 年度分组 + 备注/置信度。用于客户、供应商、融资明细和来源清单。
- `ms-financial-statement`：Morgan Stanley 式白底横线财务表。用于利润表、资产负债表、现金流量表、财务模型和估值测算。
- `market-views-vs-validation`：外部观点矩阵 + 我们的数字校验。用于市场观点、估值争议和可比公司讨论。
- `appendix-source-table`：来源、用途、链接/口径和置信度。用于来源页。
- `ibd-football-field`：Morgan Stanley IBD 式估值区间图。用于多方法估值、IPO 定价锚、可比公司倍数和海外 peer 对照；左侧放方法/假设，右侧放 valuation range 和选中估值。
- `ibd-valuation-matrix`：全宽估值/敏感性矩阵。用于 PS、ARR、GM、成本率、发行价、股东回报等二维假设推演；用浅色或细边框标 base case。
- `ibd-dcf-model`：左侧假设/右侧模型表/下方敏感性。用于 DCF、财务模型、UE 模型和现金流折现页。
- `ibd-wacc-build`：假设 build-up 表 + selected case 标注 + 小型敏感性或 bridge。用于 WACC、折现率、终值倍数、成本下降假设。
- `ibd-peer-benchmarking`：2x2 peer charts、ranking bar 或 scatter。用于估值、增长、GM、客户集中度、市场份额等同业比较。
- `ibd-event-callout-chart`：大图 + 事件标注。用于股价、估值倍数、收入/成本、政策/融资事件的时间序列解释。
- `ibd-precedent-premium`：precedent transaction / premium ranking bar。用于交易溢价、老股交易估值、战略投资溢价和并购可比。
- `ibd-cap-table-contribution`：贡献/股权/换股/解禁表。用于 cap table、最大外部投资人、H 股全流通、员工平台和退出压力。

## 内容结构

可按项目材料增删，但 IPO/招股书 slides 默认包含：

- 封面：公司名、IPO文件分析、出品方/品牌、日期、核心结论。
- 公司快照：关键三年财务指标、收入、毛利率、现金流、估值锚。
- 核心判断：3-4 个投资判断，亮点和风险混排。
- 收入质量：按实际业务线拆收入、成本、毛利率、经营指标和可持续性，不机械套固定行业模板。
- UE 与成本费用：销售成本、研发、销售及营销、行政费用的口径；识别隐性获客补贴和真实 UE。
- 财务质量：利润表、资产负债表、现金流量表的核心信息；净利润/经调整利润/经营现金流匹配，应收、应付、working capital、回款、付款条件、runway。
- 融资历史：必须从研究底稿映射五列表（融资时间、融资轮次、投前估值、股东出资情况、投后估值），并覆盖全部轮次。股东出资情况列必须区分增资和老股交易：增资写投资方/领投方（未披露就写未逐轮披露），老股写买方、卖方、老股轮次/类型、对价或估值锚。时间线、估值折线图、代表投资人摘要只能作为辅助，不能替代这张表。股东回报页另列 IRR、绝对收益、创始团队套现/低价认购收益和上市前最大外部投资人。
- 股东结构与解禁：主要股东、员工平台、Pre-IPO、战略股东、禁售期、全流通或中期卖压。
- 行业格局与竞对：按招股书披露表呈现市场份额、头部玩家、公司定位、差异化和竞争风险；匿名竞对识别放备注列。
- 客户、供应商与匿名备注：按招股书披露表呈现历年前五大客户/供应商、产品/服务、收入或采购额、占比、信贷期/付款方式；匿名识别、置信度和关键证据放备注列，不以 detective 结论替代披露主线。
- 市场观点与估值争议：汇总市场文章、研报、行业评论和投资人观点中的核心看多/看空逻辑；把外部观点引用的可比公司估值、ARR/收入、PS、GM、商业模式判断与招股书数字并排校验。
- 后续 KPI 与风险：真正能验证商业模型是否成立的指标。
- 财务模型附录：结构化附上利润表、资产负债表、现金流量表；可压缩但必须可读、单位一致、来源明确。
- 来源页：公开文件、官网、交易所文件和交叉验证来源。

## 版式风格

- 默认风格为 Morgan Stanley research deck：克制、信息密集、结论前置、表格清晰、图表服务判断。Goldman Sachs、McKinsey、BCG、Bain 只作为用户明确要求其他风格时的可选参考。
- 若用户提供或要求学习 Morgan Stanley IBD / pitchbook / valuation materials，先阅读 `references/morgan-stanley-ibd-template-notes.md`，把其中的 football field、valuation matrix、DCF/WACC、transaction premium、cap table、peer benchmarking 等作为模板库。借鉴其信息组织和图表语法，不复制 Morgan Stanley / MUFG 品牌、confidential 标识或法律页脚。
- Morgan Stanley 风格默认使用 `letter landscape`：`11in x 8.5in`，PDF 页面尺寸 `792 x 612 pt`。除非用户指定 16:9，不要为了填充空白改成异形比例。
- 不做信息量很低的 divider page。章节过渡页也应包含关键表格、判断、目录进度或指标摘要。
- 每页结构优先使用“标题 + 主体表/图/分析 + 结论条/指标带”，但不要机械固定为同一种结构。先从 `layout-recipes.md` 选择页面家族，再填内容。图表页可采用上半页图表/表格、下半页小表格，也可采用左表右分析、主图+小图、2x2 exhibit、宽表+侧栏等结构。
- 每页蓝色主标题必须是观点型标题（thesis title），直接表达该页的发现、矛盾、风险或投资/产品/业务含义；不要写成“公司快照”“融资历史明细”“财务质量明细”“参考来源”等目录式标题。标题要尽量包含关键数字、方向或判断，例如“收入 7.6x 增长但 GM 转负”优于“公司快照”，“DPO 缩短抵消 DSO 改善”优于“营运资金分析”。
- 每页先设定页面密度/节奏：`dense`、`balanced`、`breathing`。`dense` 用于财务模型、经营 KPI、客户/供应商、竞对、融资和股东回报页，应有主表/主图、分析文字和结论条；`balanced` 用于核心判断、业务模式和财务质量解释页，应保持左右栏或图表 + 分析结构；`breathing` 只用于封面、关键结论或少数强调页，留白必须服务强调，不得成为低信息量空页。
- 页面密度不是靠无关内容填满。若页面显空，优先检查本页是否遗漏底稿中的关键数字、图表、来源、计算过程或投资/产品/业务含义；再决定放大主表/主图、改用更合适图表、补充右侧分析、小表或 panel note。不要用重复 KPI 卡片、装饰图形或无关说明填空。
- 对需要解释趋势、财务质量或 UE 的页面，优先学习 Morgan Stanley research slide 的“左侧数据、右侧分析”结构：左侧放财务报表、经营指标、收入 build、UE bridge 或市场数据底表；右侧写对应的趋势解释、分项分析、投资/产品/业务含义和小图。不要把数据页和分析页拆成两页，也不要只放图表而缺少右侧结论。
- 对需要展示分析过程的页面，可采用 Morgan Stanley 式 exhibit 页面：上半页放一个主图或主表，下半页放两个支持图/小表，或使用 2x2 exhibit 网格。每个 exhibit 有短标题、单位、来源和关键标注；图表之间要形成逻辑链，而不是并列堆图。
- 市场观点页不要做成“文章摘录页”。优先使用左侧“外部观点矩阵”（来源、日期、观点、引用数字、可信度），右侧“我们的校验”（招股书事实、可比公司口径、估值/UE/现金流验证点），标题要直接写出分歧，例如“市场质疑高 PS，本质是在赌 MaaS 入口能否升级企业服务”。
- 避免大面积空白，尤其避免中间空一大片、底部只贴一条小 note。通过放大表格、调整图表尺寸、使用两栏/三栏、补充小表格或换成更适合的 layout family 来提高页面密度。KPI strip 不是默认填空手段，只在它提供独立结论时使用。
- 不要为了“满”而堆无关内容。新增内容必须是投资判断需要的数字、证据或跟踪项。
- 表格优先用于财务、融资、股东、竞对、客户/供应商披露和匿名实体备注；KPI strip 只用于页底的少量核心数字，且不能连续多页重复使用；note box 用于一句话投资/产品/业务含义。
- Morgan Stanley 风格不是“每页底部四个框”。长 deck 中四卡片 metric strip 不超过非附录页的 20%，且最多连续 1 页；如果主表/主图已经清楚表达结论，优先用右侧 sidebar、inline callout、小图或小表承接分析。若只剩一个有价值的数字，把它写进图表标注、表格 subtotal、标题或 note box，不要为了它保留四个卡片。
- 允许有“有意留白”。MS 研报中舒服的留白通常出现在证据块完整、对齐清楚、表格/图表可读、标题结论明确的页面。不要为了消除空白加入重复 KPI、方法论文字或装饰卡片；宁可让主图/主表更大，或保持干净。
- 不要把同一个判断拆成多页弱观点页。常见合并对象包括：业务模式 + 经营 KPI、收入结构 + 收入质量、UE + 获客补贴、成本费用口径 + 明细、财务质量摘要 + 现金流桥、解禁摘要 + 股东结构、行业格局 + 竞争逻辑、客户/供应商原始披露 + 匿名备注。

## 图表与表格排版

- 同一页放两张图表、或左图右表时，使用统一的 exhibit 容器：左右模块同一顶线、同一底线、同一视觉高度，并各自包含标题、图/表、来源。不要让一边图很小、另一边表格悬在中间，导致大片空白。
- 左数据右分析页的左侧必须是可追溯的数据底表或经营指标表，右侧必须直接解释左侧数据：例如“利润表说明什么、资产负债表说明什么、现金流量表说明什么”“收入增长来自哪条业务线、利润率为什么变化、UE 是否成立”。右侧分析不应泛泛重复标题，要逐项回应左侧关键行。
- Working capital 相关页面要把应收、应付、预付款、合同负债和经营现金流放在同一个分析框架，不要只单独展示应收。应付页或财务质量页应拆贸易及其他应付款项构成、DPO 变化、期后结算和供应商付款条件，并解释客户/供应商议价能力对 OCF 的影响。
- 图表 + 表格页优先采用“主 exhibit + 紧邻分析”的结构。可用上半页双 exhibit、左表右分析、左大表右趋势图、2x2 exhibit 等；底部 KPI strip 只是可选，不是默认结构。KPI strip 应承接核心判断，不要只为填空白放重复文字。
- 专业图表选择要匹配分析问题：
  - 收入、成本、客户/供应商采购等结构变化：优先用堆叠柱形图或百分比堆叠柱形图，展示 mix 如何改变总量和利润率。
  - 用户数、客户数、token 用量、订单量、ARPU/ARPC、收入和采购额的时间趋势：优先用柱形图或折线图，并在图上标注 CAGR、拐点、预测/实际分界。
  - 业务线或地区之间的对比：用分组柱形图、小 multiples 或横向条形图，避免只用文字描述排名。
  - 毛利率、费用率、DSO/DPO、留存率、付费率等比率趋势：用折线图或柱线组合图；若同时展示金额和率，可用双轴但必须清楚标单位。
  - 利润率、现金流、估值、股东收益的形成过程：用 bridge / waterfall、敏感性表、DCF bridge、回报拆解表或散点图，而不是只列结果。
  - 估值与可比公司：用 trading multiples 表、散点图或气泡图；重点标出目标公司、均值/中位数和关键异常点。
  - 外部市场观点和估值争议：用观点矩阵、可比公司 multiples 表、PS/ARR 散点图、bull/base/bear case 表或“外部观点 vs 我们校验”双栏表；不要只放长段文字或新闻标题。
  - 市场格局或客户/供应商集中度：用排名条形图、堆叠柱或集中度折线，匿名实体识别放备注，不要让识别过程淹没数值本身。
- 新建图表页前先查看 `assets/slides/style-packs/morgan-stanley/chart-recipes.md`，按“分析问题 -> 图表类型 -> 标注方式”选择图表；不要只按审美偏好选图。
- 涉及估值、融资回报、交易条款、股东结构、DCF/WACC 或 precedent transaction 的页面，还要查看 `references/morgan-stanley-ibd-template-notes.md`，优先使用 IBD pitchbook 中已验证的模板：football field、valuation matrix、return decomposition、event-callout chart、benchmarking grid、cap table contribution。
- 图表页要体现“分析过程”。例如先用堆叠柱回答增长来自哪类收入，再用毛利率/成本率折线回答增长是否赚钱，最后用 OCF/working capital bridge 回答增长是否回款和耗现金。
- 图表标注应像研报而不是仪表盘：直接在图内标 CAGR、峰值/低点、关键年份、预测区间、拐点原因；少用装饰图例，多用紧贴数据的标签和短注释。
- 每页通常不超过一个主图 + 两个支持图，或四个小 exhibit。图表过多时宁可合并为小 multiples 或拆成“主图 + 右侧解释”，不要压到轴和标签不可读。
- 图表可读性要有尺寸底线，不能只靠 QA 的 `overflow: false`。主图或主 exhibit 的 SVG/绘图区高度通常不低于 `180px`；两个并列支持图通常不低于 `150px`；页底支持图如果承担结论证据，不能做成缩略图。若空间不足，优先合并图表、改为一个更大的主图、减少低价值文字块或改用左右栏，而不是把图压小。
- 多图页交付前必须逐页检查图表标题、轴、刻度、数据标签和来源是否肉眼可读；任何图表出现“看不出表达什么”“文字标歪”“横轴和柱形重叠”“两张图大小不一且不对齐”等情况，都视为未通过视觉 QA，即使自动脚本没有报错。
- 左右两栏应按信息量调宽。图表较简单、表格较宽时可用约 `0.9fr / 1.3fr`；两边信息量接近时用 `1fr / 1fr`；表格解释较重时让表格略宽。
- 每个 exhibit 的标题应左对齐或与本页风格一致，标题、图表、表格、来源的间距要稳定；来源文字不能漂到图表中部，也不能缺失。
- 图表应有轴、刻度、数据标签、单位和图例。负数必须带负号，不要只用括号表示；百分比和金额口径要在标题或表头中说明。金额、股数、估值、用户数、订单数、收入/成本明细等 1,000 以上的展示数字必须使用千分位分隔符。货币代码和数字之间必须留空格，例如 `RMB 55.3m`、`HKD 1,200m`、`USD 2.4bn`，不要写成 `RMB55.3m`。年份、页码、股票代码、法规编号、版本号、产品型号、URL/文件编号、交易所文档编号、百分比和小数指标不强行加逗号。
- 如果 donut/pie 图造成信息密度低、标签难读或留白大，优先改成横向条形图、瀑布图、堆叠条形图或小表格。费用结构、收入/成本对比、UE 拆解通常用条形图或表格比 donut 更清楚。
- 图表页要避免“图形孤岛”：用 panel note 或小表格解释图表含义，把图表和投资判断连起来。
- 表格样式按内容属性区分：偏财务数据、业务经营数据、估值/回报测算、客户/供应商金额占比等数据表，可使用 Morgan Stanley 财务报表式白底横线表；偏文字说明、来源清单、风险/评级框架、解禁解释、治理说明、长文本融资交易描述等信息表，使用之前的黑底表头 + 边框网格表格，避免把所有表格一刀切成财务报表风格。
- 表格应铺满所在栏宽，列宽按内容设置；宽表减少空白列，窄表可配 panel note 或指标解释，不要让表格只占栏宽的一小块。
- 客户、供应商和竞对页的表格主列应是招股书披露字段，包含年度、代号、产品/服务、金额和占比；匿名识别只放备注列或脚注。不要将页面标题、表头和 KPI strip 全部围绕“推定实体是谁”展开。
- 市场观点页必须标注来源和日期，并明确区分“外部观点”“披露事实”“我们的推断”。外部观点中的估值、ARR、PS 等数字若来自行业估算，应在表格中降级标注，不要当成确定事实使用。
- 客户、供应商、融资历史等跨年度披露表，如果“年度”在每行重复导致拥挤，优先改成年度分组行，例如 `2023`、`2024`、`2025` 单独占一行，下面列该年的明细；这样保留年度层级，同时释放实体、产品/服务、金额和备注列宽。
- 财务模型附录应使用紧凑但可读的结构化表格，不要只贴截图。利润表、资产负债表和现金流量表可以各一页，也可以在信息量较少时合并为高密度页；每页仍需一句话解释其分析含义。

## 字体和品牌

- 中文字体使用楷体优先：`KaiTi`、`Kaiti SC`、`STKaiti` 等。
- 英文和数字优先使用 `Calibri`；如本机无 Calibri，再使用 Aptos/Arial/Helvetica fallback。
- 若用户指定出品方或品牌，页眉、页脚、封面、文件名和 PDF title metadata 必须一致。
- IPO 文件类报告可使用“IPO文件分析”作为材料类型标签。不要写成“投资者材料”，除非用户明确要求。
- 页眉右上角若使用栏目/报告类型标签，应按 slides 内容动态命名，不要沿用模板占位词。IPO/招股书分析用 `IPO FILE ANALYSIS`；年报/财报分析可用 `FINANCIAL ANALYSIS`；基本面深度分析可用 `FUNDAMENTAL ANALYSIS`；行业格局或竞对页可用 `INDUSTRY ANALYSIS`。
- 如果用户指定 `Noodling Lab | 摸鱼实验室` 或类似品牌，应在左上角和页脚统一体现；不要保留旧项目名作为品牌。

## 字体稳定协议

字体问题必须可证明，不只看 CSS 声明：

- 用户要求英文和数字为 Calibri 时，不要只依赖 `font-family: Calibri` 或 `local("Calibri")`。先确认本机或项目里有真实 Calibri 字体文件；若要精确控制，使用 `@font-face` 直接引用字体文件，并把 family 命名为字面量 `"Calibri"`，不要用 `DeckLatin` 之类别名掩盖实际字体。
- 对中文楷体同样使用明确 fallback 或 `@font-face`；中英文混排时用 `unicode-range` 分离 Latin/数字和 CJK，避免浏览器把英文落到中文字体，或把中文落到无衬线字体。
- 定义所有实际使用的字重，至少覆盖 `400`、`500`、`700`。KPI 数字、标题和加粗表头不能使用未定义字重导致浏览器合成字体。
- 蓝色页标题必须做“真实粗体”检查。不要只看 `.title { font-weight: 700; }`：很多中文楷体只有 Regular，浏览器会合成粗体，视觉上会明显弱于 `Calibri-Bold`。标题中文应使用单独的 title CJK font face，例如 `DeckCJKTitle`，优先绑定 `Kaiti SC Bold`、`STKaitiSC-Bold`、`楷体-简 粗体` 等真实粗楷体；标题字体栈建议为 `Calibri, DeckCJKTitle, DeckCJK, sans-serif`。正文可继续使用普通楷体。
- 导出前等待 `document.fonts.ready`，抽查关键元素的 computed `font-family`、`font-weight` 和 canvas 测宽。若用户质疑字体，必须用代表性英文/数字与显式 Calibri、Arial 的 canvas 宽度对比，确认当前文本匹配 Calibri。
- 可用 `scripts/qa_deck.js <deck.html> --require-latin-font Calibri` 把英文/数字 computed font-family 不含 Calibri 的页面标为失败；若中文字体 family 使用字面量命名，也可加 `--require-cjk-font STKaiti` 或对应名称。
- PDF 导出后检查字体表，确认包含 `Calibri` / `Calibri-Bold`、普通楷体，以及标题用的真实粗中文字体（如 `STKaitiSC-Bold` / `KaitiSC-Bold`）。若 PDF 字体表只有 `KaiTi` 或普通楷体而没有粗体中文字体，蓝色标题不得视为通过；必须换用真实粗楷体或明确改用可加粗的中文字体。若 PDF 查看器缓存旧文件，重新打开或改名导出后再判断。
- 全页 contact sheet 检查中文标题与英文/数字标题粗细是否协调，并至少放大检查封面、数据密集页和财务附录页。字体 QA 不是只检查 `font-family`，还要检查 PDF 实际嵌入字体和视觉效果。

## HTML/PDF 制作要求

- 用户未明确要求 PPTX 时，HTML + PDF 是 slides 报告的默认且必须交付格式；不得把通用 PowerPoint 流程或 `.pptx` 作为替代。若输出目录只有 `.pptx` 而没有最终 HTML/PDF，格式 gate 失败，必须重新生成。
- 优先做 HTML deck 再导出 PDF，便于快速调整表格、图表和字体。PPT 容易错位时，直接切换到 HTML。
- HTML 是唯一事实源，PDF 是最后交付物。生成脚本应先产出 HTML 并完成内容、版式、字体和 overflow QA；PDF 只能在 HTML QA 通过后由 `scripts/export_pdf.js` 或等效 Playwright 流程导出。
- 新建 deck 时优先运行 `scripts/init_deck.js` 初始化 Morgan Stanley style pack；若手工创建，则从 `assets/slides/base-deck.html`、`assets/slides/style-packs/morgan-stanley/templates.html` 和 `assets/slides/style-packs/morgan-stanley/style.css` 开始。已有 deck 也要尽量复用这些类名和结构，减少每页局部硬编码。
- 使用稳定页面尺寸和 `overflow: hidden`，但不能靠隐藏内容掩盖溢出。表格、图表、标题、页脚必须在页面内。
- HTML deck 可为图表/表格组合页建立可复用 exhibit 样式，例如 `exhibit-grid`、`exhibit-panel`、`compact-strip`：统一左右栏高度、标题位置、来源位置和底部 KPI strip 间距。
- 对图表使用响应式尺寸或保证固定尺寸不超过栏宽。图表要有标题、单位和来源。
- 页码、页脚、来源、免责声明保持一致；来源文字可以小，但不能缺失关键引用。
- 文件名按用户要求命名；HTML 文件、PDF 文件和 PDF title metadata 应同步。
- 用浏览器导出 PDF 时必须启用 print media 或等效打印样式，确保每个 `.slide` 独立分页；导出后逐页渲染确认没有相邻页面串页、裁切、内容整体缩小或页码错位。检查 PDF MediaBox 和 HTML 页面比例一致，不能出现内容被二次缩放后四周留出异常大白边。

## 视觉 QA

交付前执行以下检查：

1. 用 `scripts/qa_deck.js`、浏览器或 Playwright 检查每页是否 `overflowX/overflowY`，并统计页面元素是否超出 slide 边界。
2. 用 `pdfinfo` 检查 PDF 页数和页面尺寸。Morgan Stanley 风格应为 `792 x 612 pt (letter)`。
3. 将最终 PDF 全部页面渲染为图片并生成 contact sheet，逐页检查。封面、业务/KPI、UE、working capital、融资/回报、客户、供应商、行业格局、外部观点、三张财务报表附录必须另做单页放大检查；任何未检查页面都不得视为通过。
4. 检查是否存在低信息量页面、巨大空白、文字重叠、表格挤压、页脚遮挡、品牌名不一致。
5. 对图表/表格组合页额外检查左右 exhibit 是否同顶线、同底线、来源位置一致、图表/表格是否填满所在栏宽；发现一侧过空时先调整图表类型、栏宽或补充任务相关注释。
6. 做空白审计：检查主要内容区是否明显偏小、是否中间大块留白而底部只贴 KPI strip、左右栏高度是否严重不均、图表是否小到轴/标签不可读、表格是否只占栏宽一小块。发现问题时优先放大主图/主表、改变栏宽、合并相邻内容、加入底稿中被遗漏的分析或改成更高信息密度的图表。
7. 做版式多样性审计：统计 `data-template`，长 deck 至少五类 layout family；同一模板不得连续超过两页；metric strip 不超过非附录页 30%，且不能连续多页作为固定页脚。
8. 对照研究底稿、coverage matrix 和 slide contract 的 `必须出现` 短句确认 slides 未遗漏关键分析。重点逐字检查投资建议、目标价/对应市值、融资回报直接答案、历年五大客户/供应商、各业务行业格局和 working capital 质量；若遗漏，补表、补页或补指标条，不要只在最终回复里解释。
9. 字体 gate：浏览器端确认关键英文、数字和中文元素实际使用目标字体；PDF 端确认嵌入字体表没有退回 Arial、PingFang 或其他非预期字体。蓝色页标题必须额外确认 PDF 字体表包含真实粗体中文字体；只看到普通 `KaiTi` / `DeckCJK` 不算通过。
10. 参考视觉 gate：如果用户提供参考 PDF/截图，渲染对比参考页和当前页，确认首页、表格页和 KPI 区的视觉结构一致；不要只凭肉眼记忆调整。
11. HTML-first/PDF-last gate：最终 PDF 的生成必须发生在 HTML QA 之后；如果在调试中提前产生过 PDF，应删除或重新导出，避免交付旧版文件。
12. 人工视觉回归 gate：针对用户历史反复指出的问题逐项扫一遍，不要只相信自动 QA。至少检查：标题中文是否真加粗；英文缩写首次出现是否给全称和中文；每张图是否有单位；页底图表是否过小；图表轴/标签/数字是否重叠或缺失；来源是否对齐；note box、页脚和品牌名是否重叠；无必要的横线/竖线是否还残留；是否又把四个卡片当默认页脚使用；左右/上下多图是否同顶线同底线；内容是否被整体缩小导致四周异常白边。

## 输出说明

最终回复应简洁说明：

- 已生成 HTML 和 PDF。
- 页面比例和页数。
- 已完成的 QA：无溢出、页面尺寸、全页 contact sheet 逐页检查和关键页放大复核。
- 给出输出文件链接。
