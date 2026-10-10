# Break-even (daily bar)

**Goal.** Show every day whether the business covered its fixed costs and financing, and the month-to-date gap.

**Inputs.** Orders by SKU, model COGS (+ customs VAT), finance accruals (realisation), ads spend, parameters (`commission_pct`, `acquiring_pct`, `logistics_rub_per_unit`, `vat_rate`, `vat_base_share`, `buyout_rate`, `fixed_costs_month_rub`, `financing_cost_month_rub`).

**Logic** (`sql/13_views_breakeven.sql`):
* `v_unit_margin_day` – order-model margin before ads for each day;
* `v_breakeven_daily` – contribution (order model, buyout-adjusted order model and realised – three separate columns, never added), the daily bar = (fixed + financing) / days in month, coverage %, month-to-date gap. If accruals for the day are not loaded yet, realised is `NULL` with `REALISED_MISSING`.

**Outputs.** Orders/margin lines of the daily report.

**Limits.** Fee rates, VAT and COGS are model parameters (labelled `ESTIMATE`); the realised column uses actual marketplace charges but model COGS.

Missing cost for an observed SKU blocks the day's model contribution. Missing CPC/PPO expense data blocks after-ad contribution and coverage. A monthly gap is unavailable if an included day lacks required inputs; it is not a partial sum labelled as complete. Loaded accruals and computed contribution are separate states. This is not accounting profit or proof that every expected calendar day was collected.
