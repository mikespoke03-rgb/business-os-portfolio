-- Daily margin (order model vs realised) and break-even coverage.
-- Two margins are computed side by side and NEVER summed:
--   order model: ordered revenue of day D, model fee rates, "if everything is bought out" (+ a buyout-adjusted variant)
--   realised   : finance accruals of day D (actual marketplace charges); COGS and VAT still by model.
CREATE VIEW analytics.v_unit_margin_day AS
WITH p AS (SELECT analytics.param('commission_pct') comm, analytics.param('acquiring_pct') acq,
                  analytics.param('logistics_rub_per_unit') logu, analytics.param('vat_rate') vat,
                  analytics.param('vat_base_share') vshare, analytics.param('buyout_rate') buyout),
o AS (SELECT o.business_date,
             sum(o.ordered_units - o.cancelled_units) AS units,
             sum(o.order_revenue_rub * (o.ordered_units - o.cancelled_units) / NULLIF(o.ordered_units, 0)) AS rev,
             sum((o.ordered_units - o.cancelled_units) * c.cogs_ex_vat_rub) AS cogs,
             sum((o.ordered_units - o.cancelled_units) * c.customs_vat_rub) AS customs_vat,
             count(*) FILTER (WHERE c.offer_id IS NULL) AS sku_without_cost
      FROM analytics.v_orders_day_sku o LEFT JOIN analytics.v_sku_cost_current c USING (offer_id)
      GROUP BY o.business_date)
SELECT o.business_date, o.units, round(o.rev, 2) AS order_revenue_rub, round(o.cogs, 2) AS cogs_rub, round(o.customs_vat, 2) AS customs_vat_rub,
       round(o.rev * p.comm + o.rev * p.acq + o.units * p.logu, 2) AS marketplace_fees_model_rub,
       round(o.rev * p.vshare * p.vat / (1 + p.vat) - o.customs_vat, 2) AS vat_model_rub,
       CASE WHEN o.sku_without_cost > 0 THEN NULL ELSE
         round(o.rev - (o.rev * p.comm + o.rev * p.acq + o.units * p.logu) - o.cogs
             - (o.rev * p.vshare * p.vat / (1 + p.vat) - o.customs_vat), 2) END AS margin_before_ads_rub,
       p.buyout, o.sku_without_cost
FROM o CROSS JOIN p;

CREATE VIEW analytics.v_breakeven_daily AS
WITH p AS (SELECT analytics.param('fixed_costs_month_rub') fix, analytics.param('financing_cost_month_rub') fin,
                  analytics.param('vat_rate') vat, analytics.param('vat_base_share') vshare),
avg_cost AS (  -- weighted model COGS per unit, last 30 loaded days (used for realised sales)
  SELECT sum(cogs_rub) / NULLIF(sum(units), 0) AS cogs_unit,
         sum(customs_vat_rub) / NULLIF(sum(units), 0) AS customs_vat_unit
  FROM analytics.v_unit_margin_day WHERE sku_without_cost = 0 AND business_date > (SELECT max(business_date) FROM analytics.v_unit_margin_day) - 30),
ads AS (SELECT stat_day, cpc_spend_rub + ppo_spend_expense_rub AS ads_rub,
               cpc_status, ppo_status FROM analytics.v_ads_day_total),
x AS (
  SELECT m.*, a.ads_rub, r.sold_units, r.sales_rub, r.marketplace_charges_rub,
         extract(day FROM date_trunc('month', m.business_date) + interval '1 month - 1 day')::numeric AS dim
  FROM analytics.v_unit_margin_day m
  LEFT JOIN ads a ON a.stat_day = m.business_date
  LEFT JOIN analytics.v_realization_day r ON r.accrual_date = m.business_date)
SELECT x.business_date, x.units, x.order_revenue_rub, x.ads_rub,
       round(x.margin_before_ads_rub - x.ads_rub, 2) AS contribution_order_model_rub,
       round(x.buyout * x.margin_before_ads_rub - x.ads_rub, 2) AS contribution_order_buyout_rub,
       x.sold_units AS realised_units, x.sales_rub AS realised_sales_rub,
       CASE WHEN x.sales_rub IS NULL THEN NULL ELSE round(
         x.sales_rub + x.marketplace_charges_rub - x.sold_units * ac.cogs_unit
         - (x.sales_rub * p.vshare * p.vat / (1 + p.vat) - x.sold_units * ac.customs_vat_unit) - x.ads_rub, 2) END AS contribution_realised_rub,
       CASE WHEN x.sales_rub IS NULL THEN 'REALISED_MISSING' ELSE 'REALISED_PRESENT' END AS realised_state,
       round((p.fix + p.fin) / x.dim, 2) AS breakeven_bar_day_rub,
       round(100 * (x.margin_before_ads_rub - x.ads_rub) / NULLIF((p.fix + p.fin) / x.dim, 0), 1) AS coverage_order_pct,
       CASE WHEN count(*) FILTER (WHERE x.margin_before_ads_rub IS NULL OR x.ads_rub IS NULL OR p.fix IS NULL OR p.fin IS NULL)
                 OVER (PARTITION BY date_trunc('month', x.business_date) ORDER BY x.business_date) > 0 THEN NULL ELSE
         round(sum(x.margin_before_ads_rub - x.ads_rub - (p.fix + p.fin) / x.dim)
             OVER (PARTITION BY date_trunc('month', x.business_date) ORDER BY x.business_date), 2) END AS gap_mtd_order_rub,
       'ESTIMATE: fee rates, VAT and COGS are model parameters (ops.param); realised uses actual marketplace charges'::text AS note
FROM x CROSS JOIN p CROSS JOIN avg_cost ac;
COMMENT ON VIEW analytics.v_breakeven_daily IS 'Daily contribution vs the daily break-even bar = (fixed + financing)/days in month. Order model and realised are separate columns and are never added together.';
