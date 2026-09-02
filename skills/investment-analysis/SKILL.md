---
name: investment-analysis
description: 公司基本面与投资研究工作流，覆盖二级市场公司深度研究、财报前瞻/复盘、盘中或当日异常涨跌归因、市场预期与预期差、盈利预测、FCF/FCFE、资本配置、估值与投资判断，也覆盖招股书/S-1/A1、年报季报、财务模型、BP和投行/咨询风格 slides。用户提到“分析公司基本面”“是否值得投资”“为什么大涨/大跌”“财报前瞻/复盘”“一致预期/目标价/催化剂/估值”“券商研报分析”“招股书/IPO分析”“做成 slides/PPT/deck/HTML/PDF”时使用。slides/PPT 默认表示报告形态，交付 Morgan Stanley 风格 HTML + PDF；只有用户明确要求 PPTX、可编辑 PowerPoint 或 PowerPoint 源文件时才制作 PPTX。不要用于只需 3-5 条快速判断、评级打分或组会快评的请求，那类使用 investment-review。
---

# Investment Analysis

## 定位

以买方基本面分析师/投资经理视角完成深度研究。不要复述材料；重建公司的价值创造机制、市场预期、财务传导、资本回报、估值和可证伪投资判断。

用户明确要求发送、下载或查看实际 HTML、PDF、PPTX、模型或报告文件时，完整读取并执行[跨客户端真实附件交付](../domi-router/references/artifact-delivery.md)；不得用普通路径、source link 或原始内部文件指令代替附件。附件交付不改变本 Skill 的研究深度、模型、证据、排版与视觉 QA 门槛。

所有二级市场研究遵循同一条决策链：

```text
市场在预期什么
→ 我们在哪个经营假设上不同
→ 证据是否支持这个差异
→ 差异修改哪个财务字段
→ 对每股价值影响多少
→ 哪个公开指标会证明我们对/错
→ 触发什么模型与投资动作
```

## 先锁定研究模式

将任务归入一个主要内容模式；`deck-output` 只能是完成研究后的输出适配层，不能替代内容模式。

| 模式 | 触发场景 | 必读 reference |
|---|---|---|
| `public-equity-deep-dive` | 上市公司基本面、是否值得投资、目标价、建仓逻辑 | `references/public-equity-analysis.md`、`references/source-intelligence.md` |
| `earnings-preview` | 财报前瞻、市场预期、关键验证指标 | 上述两份 + `references/earnings-event-analysis.md` |
| `earnings-review` | 财报复盘、beat/miss、预测与估值更新 | 上述两份 + `references/earnings-event-analysis.md` |
| `abnormal-move` | 今天/盘中为何大涨大跌、是否错杀 | `references/public-equity-analysis.md`、`references/source-intelligence.md`、`references/earnings-event-analysis.md` |
| `sell-side-report` | 券商研报拆解、反推假设、复算目标价 | `references/public-equity-analysis.md`、`references/source-intelligence.md`、`references/financial-model-analysis.md` |
| `prospectus` | 招股书、S-1、A1、聆讯后资料集、IPO分析 | `references/prospectus-analysis.md`、`references/research-ledgers.md` |
| `financial-statements` | 年报、季报、审计报告、三张表和附注 | `references/financial-statement-analysis.md` |
| `financial-model-audit` | Excel模型、收入/成本 build、预算、估值模型 | `references/financial-model-analysis.md` |
| `deck-output` | slides/PPT/deck/HTML/PDF | 完成主要研究后读取 `references/investment-banking-slides.md` |

任务包含多类材料时，先确定投资问题，再加载必要 reference；不要把所有 reference 无差别塞入上下文。

## 开工口径锁

在检索和建模前记录：

- 法律主体、品牌、证券代码、交易所、上市/私有状态及可投资证券；同名公司、母子公司和被收购资产必须隔离。
- `as_of`、股价时间戳、财报截止期、预测期、币种、单位、GAAP/non-GAAP、合并/分部口径和稀释股本。
- 任务模式、投资期限、需要回答的核心争论，以及是否需要评级、合理价值、建仓区间或仓位。
- 数字身份：`actual`、`guidance`、`consensus`、`broker_estimate`、`third_party`、`proprietary`、`our_estimate`、`scenario`、`unknown`。

如果公司没有公开交易证券，先明确这一事实并追踪用户可能指代的上市母公司、债券、被收购标的或同名证券；不得为私营公司编造“今日股价大跌”。

## 研究控制件

二级市场 deep-dive、财报事件和异常波动任务，按材料性维护以下控制件；可用 Markdown/JSON/YAML，但正文中的承重数字只能引用同一套底层数据：

1. `research_contract`：对象、as-of、口径、模式、期限和必答问题。
2. `evidence_ledger`：原子命题、根来源、日期、身份、口径、独立来源簇、限制、材料性和模型字段。
3. `expectation_ledger`：公司指引、dated consensus、券商预测、我们预测、差异和修正方向。
4. `thesis_map`：市场共识、差异化判断、正反证据、机制、模型和估值影响、证伪条件。
5. `model_data` / `valuation_bridge`：分部、三张表、现金/债务、情景和每股价值的唯一数字源。
6. `unknown_registry`：未披露但承重的信息、合理区间、Base Case处理和下一项验证证据。

招股书 full analysis 继续使用 `evidence_ledger.md`、`entity_map.md`、`calculation_policy.md`、`disclosure_checklist.md`，具体格式见 `references/research-ledgers.md`。

## 二级市场标准动作

1. 先提出 3-5 个真正决定未来 1-3 年盈利和估值的投资争论，再按问题找信息；不要按网站或报告章节堆材料。
2. 重建分部 driver tree：量、价、mix、留存、产能/交付约束、单位成本、固定/变动成本和资本需求。
3. 建立预期三角：公司指引 vs 有日期的一致预期/市场门槛 vs 我们预测。保留分布和修正方向，不只抄平均数。
4. 完成三座桥：经营指标→收入/EBIT；EBIT→EPS/FCF/FCFE；预测变化→EV→股权价值→每股价值。
5. 对资本密集型业务建立 cohort 状态桥：现金投入→建设/部署→可用→可售→利用/交易→计费→收入→D&A→现金回报/ROIC。
6. 用历史范围、公司指引、共识、同业和物理/合同约束校准承重假设；偏离基准必须有机制解释。
7. 先做反向估值，说明当前价格隐含的增长、利润率、资本强度或终值，再给自己的估值。
8. 构建联动的 Bear/Base/Bull；不能只改倍数，经营、资本投入、融资成本和估值要同向传导。
9. 每条核心 thesis 配最强反面证据、公开可观察指标、阈值、模型字段和重新评估动作。
10. 结论明确回答：市场在赌什么、我们不同在哪里、差多少、价值多少、什么会证明我们错。

## 异常涨跌归因纪律

- 先锁定证券、交易所、价格区间、比较基准、成交量/换手、盘前盘后和当地交易日期；“今天”必须转换成明确日期。
- 将原因拆为：公司新信息、财报/指引、行业/宏观、监管/诉讼、资本结构/供给、指数/被动资金、技术与拥挤交易。区分直接披露、市场报道和我们的推断。
- 对每个候选原因记录事件时间是否早于价格反应、是否足够材料、是否为全行业共振、是否已有反证。没有直接证据时使用“更可能/与之吻合”，不得伪装成唯一原因。
- 把一次性价格冲击与长期价值变化分开：分别估算对未来收入、EBIT、FCF、净债务、稀释股本和估值倍数的影响。
- “跌得多”不是买入理由。只有新的合理价值区间、下行风险、催化剂和证伪条件能够支持投资判断。

## 信息与合规硬门

- 读取 `references/source-intelligence.md`，按待证明的命题选择来源；“一手”“官方”不自动等于独立或适配。
- 事实、公司口径、可观察动作、推算、假设和 unresolved 分开。未披露不是零；未找到只有在数据库本应完整覆盖时才可作为负面证据。
- 多个 URL 若共享同一根文件、数据面板、专家或经济利益，只算一个来源簇。承重非官方事实原则上需要直接公共原始证据或至少两个真正独立的证据簇。
- 单个专家、供应商或未经历史校准的另类数据只能进入待验证假设或情景，不能直接进入 Base Case。
- 高材料性冲突未解决时使用区间/替代情景并降低置信度，不得静默取平均。
- 可能重大且无法确认已公开的信息、数据权利不明或隐私状态不清的信息必须隔离，不进入模型、报告或投资动作。
- 每个承重数字保留观察期、发布日期、获取日期、根来源、转换公式和限制；使用截止日后的信息分析历史观点属于 as-of 泄漏。

## 不可跳过的质量门

- 不得把 `consensus`、券商预测、第三方数据或本人模型写成公司实际或指引。
- 不得把 TAM、订单、backlog、预算、建设中产能、产品发布或“售罄”直接等同收入、利润或现金流。
- 分部必须桥到集团；EBIT必须桥到税前利润、净利润和稀释EPS；CFO、cash capex、租赁、净借款与FCF/FCFE不得重复。
- 估值必须可复算到企业价值、股权价值和每股价值；无独立估值时不得复述第三方目标价作为结论。
- 预测必须有经营驱动，风险必须有观察指标/阈值/模型动作，核心结论必须处理最强替代解释。
- 评级、合理价值、回报、建仓区间和仓位不得与自身情景结果矛盾。
- 低可信高增量线索不得进入 Base Case；高可信低材料信息不得挤占摘要。
- 信息不足时输出 `decision-critical unresolved` 与下一项判别性证据，不用背景材料掩盖缺口。

二级市场交付前运行 `scripts/audit_public_equity.py`；脚本不可运行时，手工输出所选 profile、每项 gate 的 `pass/fail`、对应证据及修复动作，不能只声称“等价检查已完成”。脚本或手工 gate 失败时先补底稿和控制件。招股书/slides继续运行 `scripts/audit_research_deck.js` 及视觉 QA。

## 默认二级市场输出

1. 一句话投资结论：期限、现价时点、合理价值/区间、预期回报和最大不确定性。
2. 今日/本次事件及市场反应：事实、候选原因、归因置信度、是否改变长期价值。
3. 三个核心市场争论：市场共识、我们的差异、正反证据和财务传导。
4. 业务与分部 driver tree、历史兑现度及管理层质量。
5. Actual / Guidance / Consensus / Our Estimate 与未来 2-3 年模型。
6. EBIT、EPS、FCF/FCFE、资本周期、净现金/债务和融资需求。
7. 反向估值、主估值、可比校准和联动情景。
8. 催化剂、证伪条件、记分卡和下一项判别性信息。

## Slides 输出守卫

- 先完成对应研究模式和控制件，再读取 `references/investment-banking-slides.md`；slides必须从研究底稿映射，不得先排版后补研究。
- 用户仅说 slides/PPT/deck 时，默认交付 Morgan Stanley 风格 HTML 和由其导出的 PDF；HTML是唯一事实源。只有明确要求 `PPTX`、`.pptx`、可编辑 PowerPoint 或源文件时才制作PPTX。
- 公共股票 deck 不得强制融资历史、股东IRR、解禁和匿名客户/供应商等IPO模块；改用预期差、预测修正、资本/现金桥、估值、催化剂和财报scorecard。
- IPO deck继续遵循 `references/prospectus-analysis.md` 的完整披露要求。使用 `scripts/init_deck.js` 初始化，运行内容审计、`scripts/qa_deck.js`，再由 `scripts/export_pdf.js` 导出；最终PDF必须渲染contact sheet逐页检查。

## 与 investment-review 的边界

- 使用 `investment-analysis`：需要拆材料、搜集与判断信息、重建模型、解释事件、形成深度基本面和估值结论。
- 使用 `investment-review`：只需要3-5条投资判断、快速评级或组会快评。
- 同时要求深度分析和投资建议时，先完成本Skill的证据与模型闭环，再给投资含义；不要自动套用B/A/S或1-10评分。
