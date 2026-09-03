# Morgan Stanley Chart Recipes

Use these chart recipes as the default visual grammar for investment-analysis decks. Pick the chart by the analytical question, not by decoration.

Before drawing, pick a layout from `layout-recipes.md`. The chart is only one evidence block inside the page:

- Trend chart + supporting data table: use `top-chart-bottom-table`.
- Financial or operating model + interpretation: use `left-data-right-analysis`.
- One dominant chart with two smaller checks: use `asymmetric-main-plus-minis`.
- Peer/small-multiple comparison: use `four-exhibit-grid` or `six-mini-chart-grid`.
- Margin, cash flow, valuation, or return formation: use `waterfall-plus-bridge`.
- Wide disclosure table with qualitative remarks: use `full-table-plus-sidebar`, not a bottom KPI-card strip.

## Revenue And Mix

- Use stacked bars for revenue by business line, product, region, customer type, or deployment mode.
- Use 100% stacked bars when the conclusion is mix shift rather than absolute growth.
- Add CAGR, major inflection year, and one short annotation explaining the mix driver.

## Unit Economics And Margin

- Use waterfall / bridge when showing how revenue turns into gross profit, contribution profit, adjusted loss, or operating cash flow.
- Use grouped bars when comparing revenue, cost, sales & marketing, and compute / resource cost in the same year.
- Use a line chart for gross margin, cost ratio, sales & marketing ratio, R&D ratio, DSO, or DPO over time.

## Operating Metrics

- Use bars or lines for users, customers, token usage, orders, seats, capacity, utilization, ARPU/ARPC, or take rate.
- Put operating metric and financial metric on the same page when the point is whether growth monetizes.
- Mark disclosure-period changes, actual/forecast boundaries, and one-off events.

## Financial Quality

- Use bridge tables for net loss -> adjusted loss -> operating cash flow.
- Use a two-line chart for DSO vs DPO, or AR / AP days, when working capital is central.
- Use a compact table beside the chart for receivables, payables, contract liabilities, prepayments, and cash runway.

## Valuation And Returns

- Use trading multiples table for comparables; show target company, peer median, range, and key caveats.
- Use scatter plot for PS/ARR/revenue growth/gross margin comparisons when there are enough peers.
- Use return decomposition table for investor IRR, absolute gain, old-share proceeds, and largest external shareholder.

## Customers, Suppliers And Competition

- Use ranked bar charts for market share, customer concentration, or supplier concentration.
- Use annual grouped disclosure tables for customer/supplier identities, revenue/procurement, share, terms, and anonymous identification notes.
- Keep detective work in notes/remarks; do not make identity guessing the main visual unless the task is purely detective.
- When the source table is text-heavy, keep the table in the prior black-header information style; when the table is mainly revenue/procurement/share/terms data, use the Morgan Stanley white horizontal-rule financial table style.

## Market Views

- Use a two-column matrix: external view / our validation.
- Put source, date, viewpoint, quoted metric, confidence, company facts, and investment implication in the same page.
- If using media or industry estimates, label the confidence level and separate quoted facts from our inference.
