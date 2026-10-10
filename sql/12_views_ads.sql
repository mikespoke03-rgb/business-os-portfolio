-- Ads metrics per day: CPC campaigns (impressions, clicks, CTR, CPC) + pay-per-order (PPO).
-- A missing report day is MISSING/NULL, never 0. Report spend is reconciled with the expense ledger.
CREATE VIEW analytics.v_ads_cpc_campaign_day AS
SELECT DISTINCT ON (stat_day, campaign_id) stat_day, campaign_id, campaign_title, NULLIF(offer_id, '') AS offer_id,
       spend_rub, impressions, clicks, cart_adds, orders, order_revenue_rub,
       round(100.0 * clicks / NULLIF(impressions, 0), 2) AS ctr_pct,
       round(spend_rub / NULLIF(clicks, 0), 2) AS cpc_rub, captured_at
FROM raw.ads_cpc_campaign_day_obs ORDER BY stat_day, campaign_id, captured_at DESC, row_id DESC;

CREATE VIEW analytics.v_ads_day_total AS
WITH cal AS (SELECT d::date AS stat_day FROM generate_series((SELECT min(provider_day) FROM raw.ads_expense_obs),
                                                             analytics.today_msk() - 1, interval '1 day') d),
c AS (SELECT stat_day, sum(spend_rub) spend, sum(impressions) imp, sum(clicks) clk, sum(orders) ord, sum(order_revenue_rub) rev
      FROM analytics.v_ads_cpc_campaign_day GROUP BY stat_day),
e AS (SELECT provider_day AS stat_day,
             sum(expense_rub) FILTER (WHERE campaign_id NOT LIKE 'PPO%') cpc_exp,
             sum(expense_rub) FILTER (WHERE campaign_id LIKE 'PPO%') ppo_exp
      FROM (SELECT DISTINCT ON (provider_day, campaign_id) * FROM raw.ads_expense_obs
            ORDER BY provider_day, campaign_id, captured_at DESC, row_id DESC) z GROUP BY provider_day),
p AS (SELECT DISTINCT ON (stat_day) stat_day, spend_rub, orders, order_revenue_rub FROM raw.ads_ppo_day_obs
      ORDER BY stat_day, captured_at DESC, row_id DESC)
SELECT cal.stat_day,
       CASE WHEN c.stat_day IS NULL THEN 'MISSING' ELSE 'OK' END AS cpc_status,
       c.spend AS cpc_spend_rub, c.imp AS cpc_impressions, c.clk AS cpc_clicks,
       round(100.0 * c.clk / NULLIF(c.imp, 0), 2) AS cpc_ctr_pct, round(c.spend / NULLIF(c.clk, 0), 2) AS cpc_cpc_rub,
       c.ord AS cpc_orders, c.rev AS cpc_order_revenue_rub,
       round(c.spend - e.cpc_exp, 2) AS cpc_spend_diff_vs_expense_rub,
       CASE WHEN p.stat_day IS NULL THEN 'MISSING' ELSE 'OK' END AS ppo_status,
       e.ppo_exp AS ppo_spend_expense_rub, p.spend_rub AS ppo_spend_report_rub,
       p.orders AS ppo_orders, p.order_revenue_rub AS ppo_order_revenue_rub,
       o.order_revenue_rub AS shop_order_revenue_rub,
       round(100 * (c.spend + e.ppo_exp) / NULLIF(o.order_revenue_rub, 0), 2) AS drr_pct
FROM cal LEFT JOIN c USING (stat_day) LEFT JOIN e USING (stat_day) LEFT JOIN p USING (stat_day)
LEFT JOIN analytics.v_orders_day o ON o.business_date = cal.stat_day;
COMMENT ON VIEW analytics.v_ads_day_total IS 'Ads per calendar day up to yesterday. DRR = (CPC spend + PPO expense) / shop order revenue; NULL when orders of that day are not loaded.';
