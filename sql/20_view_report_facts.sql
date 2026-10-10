-- One read-only row (column j jsonb) with everything the 09:00 report needs.
-- The n8n workflow runs a single SELECT on this view and passes j to a pure renderer (scripts/render_report.js).
CREATE VIEW analytics.v_report_facts AS
WITH t AS (SELECT analytics.today_msk() AS today),
fr AS (SELECT jsonb_object_agg(source, jsonb_build_object('last_day', last_day, 'expected_day', expected_day, 'freshness', freshness,
                 'captured_at', last_captured_at, 'run_status', last_run_status, 'run_error', last_run_error)) j
       FROM analytics.v_source_freshness),
od AS (SELECT o.business_date AS d, o.ordered_units AS u, o.cancelled_units AS canc, round(o.order_revenue_rub) AS rev, o.loaded_at,
              round(b.contribution_order_model_rub) AS cm, round(b.contribution_order_buyout_rub) AS cm_buyout,
              round(b.ads_rub) AS ads, b.realised_state, b.realised_units AS r_u, round(b.realised_sales_rub) AS r_sales,
              round(b.contribution_realised_rub) AS r_cm, round(b.breakeven_bar_day_rub) AS bar
       FROM analytics.v_orders_day o JOIN analytics.v_breakeven_daily b USING (business_date), t
       WHERE o.business_date < t.today AND o.business_date >= t.today - 40),
od_last AS (SELECT max(d) AS d FROM od),
mtd AS (SELECT count(*) AS n, CASE WHEN count(*) FILTER (WHERE cm IS NULL) > 0 THEN NULL ELSE sum(cm) END AS o_cm, sum(bar) AS bar, sum(ads) AS ads, sum(rev) AS rev,
               count(*) FILTER (WHERE realised_state = 'REALISED_PRESENT') AS n_realised,
               CASE WHEN count(*) FILTER (WHERE realised_state = 'REALISED_PRESENT' AND r_cm IS NULL) > 0 THEN NULL ELSE sum(r_cm) FILTER (WHERE realised_state = 'REALISED_PRESENT') END AS r_cm,
               sum(bar) FILTER (WHERE realised_state = 'REALISED_PRESENT') AS r_bar
        FROM od WHERE date_trunc('month', d) = (SELECT date_trunc('month', d) FROM od_last)),
ad AS (SELECT a.* FROM analytics.v_ads_day_total a, t WHERE a.stat_day = t.today - 1),
ad_mtd AS (SELECT CASE WHEN count(*) FILTER (WHERE cpc_spend_rub IS NULL OR ppo_spend_expense_rub IS NULL) > 0 THEN NULL ELSE sum(cpc_spend_rub + ppo_spend_expense_rub) END AS spend,
                  sum(shop_order_revenue_rub) FILTER (WHERE shop_order_revenue_rub IS NOT NULL) AS rev,
                  CASE WHEN count(*) FILTER (WHERE shop_order_revenue_rub IS NOT NULL AND (cpc_spend_rub IS NULL OR ppo_spend_expense_rub IS NULL)) > 0 THEN NULL ELSE sum(cpc_spend_rub + ppo_spend_expense_rub) FILTER (WHERE shop_order_revenue_rub IS NOT NULL) END AS spend_with_rev
           FROM analytics.v_ads_day_total, t WHERE date_trunc('month', stat_day) = date_trunc('month', t.today - 1)),
sp_days AS (SELECT DISTINCT business_date AS d FROM analytics.v_seller_price_day ORDER BY 1 DESC LIMIT 15),
sp_pairs AS (SELECT a.business_date AS d, b.business_date AS d_prev, a.offer_id, b.seller_price_rub AS p_old, a.seller_price_rub AS p_new
             FROM analytics.v_seller_price_day a
             JOIN analytics.v_seller_price_day b ON b.offer_id = a.offer_id
              AND b.business_date = (SELECT max(d) FROM sp_days WHERE d < a.business_date)
             WHERE a.business_date IN (SELECT d FROM sp_days)),
sp_last AS (SELECT max(business_date) AS d, max(captured_at) AS cap, count(*) AS n,
                   count(*) FILTER (WHERE marketing_seller_price_rub < seller_price_rub) AS promo_below
            FROM analytics.v_seller_price_day WHERE business_date = (SELECT max(d) FROM sp_days)),
sp_chg_day AS (SELECT max(d) AS d FROM sp_pairs WHERE p_old IS DISTINCT FROM p_new),
sp_chg AS (SELECT jsonb_agg(jsonb_build_object('offer', x.offer_id, 'name_ru', s.short_name_ru, 'name_en', s.short_name_en,
                    'old', x.p_old, 'new', x.p_new) ORDER BY abs(x.p_new - x.p_old) DESC) j
           FROM sp_pairs x JOIN raw.sku s USING (offer_id)
           WHERE x.d = (SELECT d FROM sp_chg_day) AND x.p_old IS DISTINCT FROM x.p_new),
stk AS (SELECT offer_id, sum(free_to_sell) AS free, max(business_date) AS d, max(captured_at) AS cap
        FROM analytics.v_fbo_stock_day WHERE business_date = (SELECT max(business_date) FROM analytics.v_fbo_stock_day) GROUP BY 1),
stk_sum AS (SELECT max(d) AS d, max(cap) AS cap, (SELECT count(*) FROM raw.sku) AS n_sku,
                   (SELECT count(*) FROM raw.sku s WHERE NOT EXISTS (SELECT 1 FROM stk WHERE stk.offer_id = s.offer_id AND stk.free > 0)) AS n_zero,
                   analytics.param('critical_stock_units') AS crit_units FROM stk),
crit AS (SELECT jsonb_agg(jsonb_build_object('offer', s.offer_id, 'name_ru', s.short_name_ru, 'name_en', s.short_name_en, 'free', coalesce(k.free, 0))
                          ORDER BY coalesce(k.free, 0), s.offer_id) j
         FROM raw.sku s LEFT JOIN stk k USING (offer_id)
         WHERE s.abc_class IN ('A', 'B') AND coalesce(k.free, 0) <= analytics.param('critical_stock_units')),
ship AS (SELECT analytics.param('cover_days_target') AS cover_days, sum(ship_units_reco) AS units, count(*) FILTER (WHERE ship_units_reco > 0) AS lines,
                max(orders_as_of_date) AS orders_as_of, max(stock_date) AS stock_date,
                count(*) FILTER (WHERE share_source = 'NO_FRESH_ORDERS') AS n_no_fresh,
                (SELECT jsonb_agg(z) FROM (SELECT r.cluster_name AS cluster, sum(r.ship_units_reco) AS units
                                           FROM analytics.v_ship_reco_sku_cluster r GROUP BY 1 HAVING sum(r.ship_units_reco) > 0
                                           ORDER BY 2 DESC LIMIT 4) z) AS top_clusters
         FROM analytics.v_ship_reco_sku_cluster),
cash AS (SELECT min(opening_as_of) AS as_of, min(opening) AS opening, min(opening_status) AS opening_status FROM analytics.v_cash_calendar_daily),
cash_next AS (SELECT c.day, c.events, c.outflow_rub, c.balance_rub, c.balance_rub - c.inflow_rub - c.outflow_rub AS balance_before
              FROM analytics.v_cash_calendar_daily c, t WHERE c.day >= t.today AND c.outflow_rub <= -30000 ORDER BY c.day LIMIT 1),
cash_min AS (SELECT c.day, c.balance_rub FROM analytics.v_cash_calendar_daily c, t
             WHERE c.day BETWEEN t.today AND t.today + 30 ORDER BY c.balance_rub, c.day LIMIT 1),
cov AS (SELECT jsonb_object_agg(coverage_state, n) j FROM (SELECT coverage_state, count(*) n FROM analytics.v_coverage_daily, t
        WHERE day BETWEEN t.today - 30 AND t.today - 1 GROUP BY 1) z),
runs AS (SELECT jsonb_agg(jsonb_build_object('source', source, 'state', check_state, 'error', error)) j
         FROM analytics.v_load_run_check, t WHERE (finished_at AT TIME ZONE 'Europe/Moscow')::date = t.today AND check_state <> 'OK')
SELECT jsonb_build_object(
  'today', (SELECT today FROM t),
  'freshness', (SELECT j FROM fr),
  'orders', (SELECT jsonb_agg(to_jsonb(od) ORDER BY d) FROM od WHERE d >= (SELECT d FROM od_last) - 8),
  'mtd', (SELECT to_jsonb(mtd) FROM mtd),
  'ads', (SELECT to_jsonb(ad) FROM ad), 'ads_mtd', (SELECT to_jsonb(ad_mtd) FROM ad_mtd),
  'prices', (SELECT to_jsonb(sp_last) || jsonb_build_object('prev_d', (SELECT max(d) FROM sp_days WHERE d < sp_last.d),
              'last_change_day', (SELECT d FROM sp_chg_day), 'changes', (SELECT j FROM sp_chg)) FROM sp_last),
  'promo', (SELECT to_jsonb(s) FROM analytics.v_promo_summary s),
  'stock', (SELECT to_jsonb(stk_sum) || jsonb_build_object('critical', (SELECT j FROM crit)) FROM stk_sum),
  'ship', (SELECT to_jsonb(ship) FROM ship),
  'cash', (SELECT to_jsonb(cash) || jsonb_build_object('next_out', (SELECT to_jsonb(cash_next) FROM cash_next), 'min_30d', (SELECT to_jsonb(cash_min) FROM cash_min)) FROM cash),
  'coverage_30d', (SELECT j FROM cov), 'failed_runs_today', (SELECT j FROM runs),
  'live_send', (SELECT jsonb_build_object('value', param_value, 'status', status) FROM ops.v_param_current WHERE param_key = 'report_live_send_enabled')
) AS j;
COMMENT ON VIEW analytics.v_report_facts IS 'Single input of the daily report. Read-only; NULL means "no data", never zero.';
