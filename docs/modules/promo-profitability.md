# Promo profitability

**Goal.** For every marketplace promotion and every SKU offered in it, show the unit margin at the promo price, how much sales would have to grow to earn the same total margin as today, and a recommendation with a reason.

**Inputs.** Latest promo read (`raw.promo_action_obs`, `raw.promo_action_product_obs` – participating products, candidates, auto-add lists), current seller price, COGS, 14-day sales, FBO stock, shop-level CPC DRR (28 days), parameters.

**Logic** (`sql/14_views_promo.sql`):
* unit margin at price P = P − commission − acquiring − CPC ads (DRR) − pay-per-order ads − logistics − VAT (model) − COGS;
* `required_uplift_pct` = (margin_now / margin_promo − 1) × 100;
* recommendation: missing input → `OWNER_DECIDES`; loss or margin < minimum → `DONT`; margin between minimum and target, FBO stock below the promo's minimum, or required uplift above the limit → `OWNER_DECIDES`; otherwise `ENTER`. Each row has a human-readable `reason`.
* `v_promo_summary` – nearest promotion and the auto-add list (with the margin change per day if nothing changes in volume).

**Outputs.** Promo section of the daily report.

**Limits.** Calculation only: nothing is joined or left automatically. The sales-boost effect of a promotion is unknown and is not modelled; the CPC DRR is a shop-level estimate applied to every SKU. If the action price is missing, the maximum action price is used and labelled `ESTIMATE`.
