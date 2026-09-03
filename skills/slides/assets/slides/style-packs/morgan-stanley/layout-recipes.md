# Morgan Stanley Layout Recipes

Use this file before laying out a deck. The goal is to keep the Morgan Stanley visual identity while varying page structure according to the analytical job.

## Layout Selection Rules

1. Start from the page question: what does the page need to prove?
2. Pick one primary evidence type: table, chart, text analysis, timeline, risk matrix, or financial statement.
3. Pick a layout that makes the evidence readable before adding metrics.
4. Use KPI cards only when they add a new layer of interpretation. Do not use a four-card strip as the default ending.
5. Avoid using the same template on more than two consecutive pages.
6. Across a deck longer than 12 pages, use at least five layout families.
7. When the page already has enough data, use one of these lighter endings instead of four cards:
   - `metric-strip compact-ribbon`: two-row continuous proof strip for short takeaways.
   - `chart-pair-only`: two small charts when the two numeric cards would repeat the text/table.
   - right-side `callout-stack`: 2-4 implications next to a table, especially for customer, supplier, financing, and risk pages.
8. Do not treat whitespace as a defect by itself. In Morgan Stanley research pages, whitespace often works because the main evidence block is aligned, readable, and sufficient. Add content only when it improves the analysis path.

## Layout Families

### cover-with-findings

Use for the first page. Left side is title and 5-7 substantive findings; right side is material scope, source, sector tag, and disclaimer. Do not use generic “core conclusion” text.

### full-table-plus-sidebar

Use for customer/supplier disclosure, financing history, source lists, risk register, or market view matrices. A wide table takes 65-75% of the page; a right sidebar gives the 2-4 implications, caveats, or follow-up questions. Better than bottom KPI cards when the page is table-heavy.

### single-stock-memo

Use for a security or IPO snapshot when the page needs to read like a Morgan Stanley stock detail page. Top half is a concise investment memo with `Focus points`, `Catalysts & risks`, and `Valuation / key debate`; lower half is a compact chart plus forecast / operating table. This pattern can have intentional whitespace; do not add bottom cards if the memo and lower evidence already carry the conclusion.

### thematic-table-plus-trends

Use for category / operating data pages similar to Morgan Stanley thematic pages. Left side is a dense historical table occupying roughly 50-60% of the content width; right side is `Trends by category` analysis plus one supporting chart or mini table. This is preferred for revenue mix, customer/supplier concentration, operating KPIs, and market share pages when the goal is to explain what the data says, not just display the data.

### left-data-right-analysis

Use for UE, revenue quality, financial quality, working capital, pricing validation, and operating metrics. Left side is a traceable table/chart; right side explains the rows and gives the investment/product implication.

### top-chart-bottom-table

Use when a chart explains the main trend and a table provides the supporting data. Good for revenue mix, margin trend, customer concentration, supplier concentration, and usage metrics.

### two-exhibit-plus-note

Use for two equally important exhibits. Add one conclusion note below, not four cards. Good for “growth vs quality”, “revenue vs cost”, “DSO vs DPO”.

If the page needs bottom evidence, prefer two small charts or a compact-ribbon proof strip. Only use four cards when all four are distinct and cannot fit naturally in the exhibits.

### asymmetric-main-plus-minis

Use when one exhibit is dominant and 2-3 smaller exhibits provide evidence. Good for market size + peers, business model + KPIs, stock/valuation chart + operating table.

### four-exhibit-grid

Use for true small multiples: four charts/tables with parallel logic and comparable axes. Good for peer comparison, segment trends, multiple indicators for one topic. Do not use if each panel requires long text.

### six-mini-chart-grid

Use sparingly for market/peer pages where six small charts show comparable trend lines. Keep labels short and axes readable.

### timeline-plus-table

Use for financing history, product roadmap, regulatory milestones, or lock-up schedule. Timeline explains sequence; table quantifies amount, valuation, ownership, or implication.

### waterfall-plus-bridge

Use for margin, contribution, cash flow, valuation, and return formation. Pair a bridge/waterfall with a compact table of assumptions and a short interpretation note.

### valuation-table-with-callouts

Use for peer multiples, investor return, or scenario valuation. Main table is centered; small callouts appear on the side only for deltas, medians, and outliers.

For investor-return pages, avoid four-card endings if the table already includes IRR, absolute value creation, personal proceeds, and largest holder. Use two charts for the most visual comparisons, or a two-row compact proof strip.

### risk-matrix-table

Use for rating/risk/upside/downside pages. This is a wide black-header table with compact text, not a KPI-card page.

### financial-statement-dense

Use for income statement, balance sheet, cash flow, and financial model appendix. Full-page white horizontal-rule table with a short subtitle and source. No KPI cards.

### section-marker-with-context

Use only if a section break is necessary. Add a mini agenda or 3-4 data points. Do not use a blank divider page unless the user explicitly asks.

## Anti-Repetition Rules

- No more than two consecutive pages may use the same `data-template`.
- Four-card metric strips should appear on no more than 20% of non-appendix pages.
- In decks longer than 12 pages, no more than one of every five consecutive pages should end with a four-card block.
- Never place a metric strip at the bottom simply because the page has empty space.
- If a page already has a large table plus a conclusion note, use sidebar notes or inline callouts instead of bottom cards.
- If a layout feels empty, first enlarge the primary table/chart, add a side analysis column, add a relevant chart, or merge with a related page. Do not solve whitespace by dropping four generic cards at the bottom.
- Before adding a bottom strip, ask whether the four numbers would still be needed if the slide were printed in black-and-white as an equity research exhibit. If not, remove them or move the useful one into the table/chart annotation.

## Observed Morgan Stanley Patterns From Reference Decks

- Coverage pages: full-width dense tables with blue headers.
- Single-stock pages such as the MIDSMALL reference pages 16 and 21: investment memo text first, then a lower stock chart and forecast table; no forced KPI strip.
- Thematic pages such as the MIDSMALL reference page 24: large left table, right-side trend commentary, and one supporting line chart; the page is comfortable because the table, text, and chart form one analytical chain.
- IBD pitchbook valuation pages such as the Douyu and Pivotal references: left-side assumptions or numbered methodologies plus a large football-field / valuation-range exhibit; use side tables or callouts for selected value, not bottom metric cards.
- IBD valuation matrix pages: full-width sensitivity grids with one selected row/column highlighted; use these for IPO price, PS/ARR multiple, GM recovery, DCF output, or investor-return sensitivity.
- IBD DCF and WACC pages: compact assumption bullets, dense financial table, lower sensitivity matrix, and sparse highlights. Do not split the assumptions and sensitivity onto weak separate pages unless the table is unreadable.
- IBD benchmarking pages: 2x2 grouped bars, ranking bars, or scatter plots with the subject company highlighted and median/range markers. This is better than a pure text peer-comparison page when comparable data exists.
- IBD transaction / premium pages: horizontal premium or multiple bar charts with median and selected-target annotations; useful for old-share transfer valuation, strategic investment premium, and precedent transaction analysis.
- IBD ownership pages: contribution, cap table, and exchange-ratio style tables; useful for lock-up, largest external investor, H-share full circulation, and post-IPO sell-down pressure.
- Thematic pages: one large table plus one or two small charts.
- Working-capital / cash-flow pages: left financial table + right interpretation, then two charts for DSO/DPO or adjusted loss/OCF. Avoid repeating numeric cards that are already in the table.
- Multi-chart pages: four charts in a 2x2 grid with consistent labels and sources.
- Driver pages: bullet analysis plus three trend charts.
- Valuation pages: centered peer table with side callouts for averages/medians.
- Risk pages: wide black-header table with upside/downside text.
- Disclosure pages: dense text/table pages without decorative cards.
