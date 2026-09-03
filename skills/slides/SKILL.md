---
name: slides
description: domi 的统一演示文稿制作与质量控制 Skill。凡用户要求创建、更新、重做、修复或美化 slides、PPT、PPTX、slide deck、演示文稿，或要求把投资研究、IC memo、行业研究、项目材料做成汇报时使用；也用于编辑用户提供的现有 PPT/PPTX。保留上游研究 Skill 的内容职责，本 Skill 统一负责故事线、外资投行/Morgan Stanley 风格、字体、排版、信息密度、渲染、视觉 QA 与真实附件交付。默认交付 HTML + PDF；只有用户明确要求 PPTX、可编辑 PowerPoint 或 PowerPoint 源文件时才额外交付 PPTX。纯粹询问“为什么之前的 PPT 很丑/打不开”且没有要求修改时只诊断，不擅自生成文件。
---

# Slides

## 定位

这是 domi 所有演示文稿任务的唯一制作与验收层，不负责替代研究本身。

- `investment-analysis`、`ic-memo`、`desk-research`、`investment-review`、`sourcing` 等上游 Skill 负责事实、证据、模型、判断与正文底稿。
- 本 Skill 负责把已完成或本轮形成的底稿转换为可汇报的故事线、页面合同、视觉系统和正式文件。
- 用户从 Skill Hub 选择个人 Skill 后要求做 slides，也必须叠加本 Skill；个人 Skill 负责其领域内容，本 Skill 负责演示交付。
- 通用 `presentations` 只能在用户明确要求可编辑 PPTX 时作为文件实现后端，不能决定内容、主题、字体、版式或 QA 标准。

如果本 Skill、必读 reference、style lock、模板或 QA 脚本缺失，停止并明确报告；不得静默降级到通用模板。

## 开工前先判定

1. **任务意图**：创建、更新、重做、修复、美化或转换；纯诊断不自动改文件。
2. **内容来源**：复用当前任务已有研究、IC memo、报告、数据模型和附件；缺少承重内容时调用或继续对应上游 Skill，不用排版掩盖研究缺口。
3. **输出格式**：
   - 仅说 slides／PPT／deck／演示文稿：HTML 是唯一事实源，正式交付 HTML + 由其导出的 PDF，禁止默认改成 PPTX。
   - 明确说 `.pptx`、可编辑 PowerPoint、PowerPoint 源文件：仍以 HTML 为事实源并交付 PDF，再额外交付 PPTX；不得只交 PPTX。生成最终 PPTX 后，必须把该 PPTX 本身逐页渲染成独立 contact sheet；HTML contact sheet 不能替代 PPTX 渲染证据。用 `scripts/export_pdf.js ... --pptx <final.pptx> --pptx-contact-sheet <pptx-rendered.png>` 建立绑定，查看后再显式补充 PPTX 视觉复核参数，把三份最终文件及两套视觉证据绑定到同一 QA receipt。
4. **既有模板**：用户要求保留原模板、母版或主题时，仍执行本 Skill 的内容、字体、密度、溢出和视觉 QA，只跳过 Morgan Stanley 主题覆盖。
5. **既有文件编辑**：附件是 PPT/PPTX 且用户说“改第二页”“更新图表”“修复排版”等，也属于本 Skill。

只有缺少无法合理推断的必要材料或目标时，明确说明缺口并请用户先补充，收到后再继续。此时仅提出必要问题，不生成占位文件，不声称已完成或 QA 已通过；等待补充不是成品交付。已有材料足够时直接推进，不为不影响结果的偏好反复询问。

## 必读规则

完整读取 [investment-banking-slides.md](references/investment-banking-slides.md)。涉及估值、融资回报、交易条款、股东结构、DCF/WACC 或 precedent transaction 时，再读取 [morgan-stanley-ibd-template-notes.md](references/morgan-stanley-ibd-template-notes.md)。

默认使用：

- `assets/slides/style-packs/morgan-stanley/style-lock.yml`
- `assets/slides/style-packs/morgan-stanley/style.css`
- `assets/slides/style-packs/morgan-stanley/templates.html`
- `assets/slides/style-packs/morgan-stanley/layout-index.json`
- `assets/slides/style-packs/morgan-stanley/layout-recipes.md`
- `assets/slides/style-packs/morgan-stanley/chart-recipes.md`

所有资源和脚本相对当前实际选中的 `$domi:slides` 根目录解析。禁止使用 `~/.codex/skills/slides`、旧的 `~/.codex/skills/investment-analysis` 或插件外同名副本替代。

## 不可省略的制作流程

### 1. 内容底稿

先取得结构完整、可追溯的 `research.md` 或等价正式底稿。不得从聊天摘要、目录或零散 bullets 直接开始画页。上游底稿的研究深度、证据覆盖和思考强度不得因制作 slides 而降低。

### 2. Slide contract

创建 `slide_contract.md`，逐页写明：

- 观点式标题与该页回答的问题；
- 对应底稿章节和证据来源；
- 必须出现的事实、数字、限定语和反证；
- 主图／主表／正文结构；
- 明确删减项及理由；
- 页面模板和信息密度目标。

同时维护 coverage matrix，确保底稿的关键结论、承重数字、风险和来源均有页面映射。不能把“页数更少”当作遗漏信息的理由；应合并重复观点、压缩非承重背景。

### 3. Style lock

在写页面前锁定页面尺寸、字体、字号、颜色、表格、图表、页眉页脚、来源、数字格式和导出参数。默认严格采用 Morgan Stanley 外资投行研究风格：观点先行、高信息密度、窄而稳定的视觉语法、可复算图表和克制配色。

禁止：

- 大面积无意义留白、单句占整页、空洞章节页；
- 渐变封面、装饰性卡片墙、圆角胶囊堆叠、互联网产品发布会模板；
- 把正文缩成难以阅读的小字来制造“信息密度”；
- 连续多页复用同一布局，或每页都放 KPI strip；
- 使用未经 style lock 允许的字体，或让 PowerPoint/浏览器静默替换字体；
- 把事实、公司口径、第三方估计和本方判断混成一句话。

### 4. 生成与迭代

新 deck 优先运行 `scripts/init_deck.js`。它生成的正式 HTML 已内联共享 CSS 和 Morgan Stanley style pack，并用 `DOMI_SLIDES_STYLE_LOCK_V1` 与 CSS SHA-256 标记绑定；输出目录中复制的 CSS、模板和 recipes 只供继续编辑，正式 HTML 不依赖这些旁车文件。不要把内联样式改回本地 `<link>`／`@import`，也不要留下本地图片、字体、脚本或其他资源引用；单独发送这一份 HTML 时必须保持完整样式和内容。先选择模板，再填内容；图表按分析问题选择，不能为装饰而画。每次迭代从同一 HTML 事实源修改，避免 HTML、PDF、PPTX 三套内容漂移。

### 5. Fail-closed QA

正式交付前必须全部完成：

1. 上游内容 Skill 的研究审计；
2. `scripts/audit_research_deck.js` 对底稿、slide contract、coverage matrix 与 HTML 的映射审计，并用 `--output <deck>.content-audit.json` 保存无 failure、无 warning 且绑定最终 HTML 哈希的内容审计；
3. 第一次运行 `scripts/qa_deck.js <deck.html> --strict --content-audit <deck>.content-audit.json --contact-sheet <deck>.contact-sheet.png --require-latin-font Calibri`；中文字体按 style lock 加 `--require-cjk-font`。该次运行生成 contact sheet 后会保持失败状态，不能直接交付；
4. 用图片查看工具打开 contact sheet，逐页检查并放大复核关键页；确认全部页面通过后，用完全相同的 HTML 与 contact sheet 再次运行 QA，并显式增加 `--visual-review-status passed --visual-reviewer <检查者> --visual-review-notes <逐页检查记录>`。只有第二次运行生成的 receipt 可以通过；HTML 一旦变化，contact sheet 会自动重建并再次要求视觉复核；
5. 检查溢出、遮挡、截断、字体替换、低密度、布局重复、表格可读性、图表口径、来源和页码；
6. 生成与最终文件哈希绑定的 `qa_receipt.json`，记录内容审计、视觉 QA、页数、最终文件 SHA-256、检查时间与通过状态。

开工时先检查字体，避免最后导出才发现缺失。严格 QA 默认检查实际渲染的 Calibri，不只检查 CSS 声明。若本机缺字体，优先从用户已经安装且有权使用的字体取得真实字体，并内联为 `data:` 字体资源；不得把缺失字体写在 `font-family` 首位就视为通过。用户未指定不可替代的字体时，可使用本指南已允许的 Aptos／Arial／Helvetica fallback，明确写入 style lock 和交付说明，并用 `--require-latin-font <实际字体>` 验证；用户明确要求 Calibri 时不能静默替换，应说明缺少字体并请求提供或安装。保留现有模板时按该模板的目标字体验收；中文仍按原 style lock 检查。

如果交付 PPTX，还必须对最终 `.pptx` 做第二道、独立于 HTML 的两阶段视觉门：先用 PowerPoint、LibreOffice 或演示文稿渲染工具把最终 PPTX 全页渲染为 PNG/JPEG/PDF contact sheet；第一次带 `--pptx-contact-sheet` 运行 `export_pdf.js` 只生成 `DOMI_SLIDES_PPTX_CONTACT_SHEET_V1` manifest 并故意失败。打开该 contact sheet 逐页检查后，第二次增加 `--pptx-visual-review-status passed --pptx-visual-reviewer <检查者> --pptx-visual-review-notes <逐页检查记录>` 才能把 PPTX 写入通过 receipt。PPTX 发生任何变化都会使 manifest 和复核失效。

零张 `.slide`、仍有 `{{...}}` 占位符、任何页面缺少 `data-template`／`data-layout`、全 deck 使用 `unspecified` 布局、`overflow`、越界、字体不符、明显低密度、连续布局重复、长 deck 布局种类不足、coverage 缺失、内容审计有 warning、缺少 contact sheet／显式视觉复核，或 QA receipt 与最终文件不匹配，均视为失败。必须修正后重新运行；不能把 warning 当作可交付状态，不能在没有打开 contact sheet 的情况下预填 `passed`，也不能只在最终回复中声称“已检查”。

发送前另做单文件检查：默认 Morgan Stanley HTML 必须保留可校验的内联 style-lock，所有正式 HTML 都不能依赖外部 CSS 或资源。资源型属性与 CSS `url()` 只允许 `data:` URL 和页面内 `#fragment`；相对路径、绝对本地路径、`file:`、HTTP(S)、协议相对 URL 和 `blob:` 均不得出现。用户要求保留原模板时不强制 Morgan Stanley 主题，但仍应把原模板需要的 CSS 和资源内联。

## 交付

用户明确要求发送、下载或查看文件时，完整读取并执行 [跨客户端真实附件交付](../domi-router/references/artifact-delivery.md)。交付物必须是可提取、可打开、非零字节的真实附件；普通路径、source link 或内部文件指令不算交付。

最终回复简洁列出：

- HTML、PDF，以及用户明确要求时的 PPTX；
- 页数和一句话故事线；
- QA 是否全部通过及 receipt；
- 尚未解决的内容缺口（如有）。

任何质量门失败时，不得把文件描述为已完成或可发布。
