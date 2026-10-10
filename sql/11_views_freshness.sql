-- Data freshness per source. The report never presents stale data as "today":
-- every section prints the date of the data it shows, and the reason when it is not the expected day.
CREATE VIEW analytics.v_source_freshness AS
WITH t AS (SELECT analytics.today_msk() AS today),
x AS (
  SELECT 'orders_by_sku' AS source, 'yesterday' AS expected, max(business_date) AS last_day, max(captured_at) AS last_captured_at FROM analytics.v_orders_day_sku
  UNION ALL SELECT 'fbo_postings', 'yesterday', max(order_date_msk), max(captured_at) FROM raw.fbo_posting_line_obs
  UNION ALL SELECT 'realization', 'yesterday', max(accrual_date), max(captured_at) FROM raw.realization_day_obs
  UNION ALL SELECT 'seller_prices', 'today', max(business_date), max(captured_at) FROM raw.seller_price_obs
  UNION ALL SELECT 'fbo_stock', 'today', max(business_date), max(captured_at) FROM raw.fbo_stock_obs
  UNION ALL SELECT 'ads_cpc', 'yesterday', max(stat_day), max(captured_at) FROM raw.ads_cpc_campaign_day_obs
  UNION ALL SELECT 'ads_ppo', 'yesterday', max(stat_day), max(captured_at) FROM raw.ads_ppo_day_obs
  UNION ALL SELECT 'ads_expense', 'yesterday', max(provider_day), max(captured_at) FROM raw.ads_expense_obs
  UNION ALL SELECT 'promo', 'today', max((captured_at AT TIME ZONE 'Europe/Moscow')::date), max(captured_at) FROM raw.promo_action_obs
),
lr AS (SELECT DISTINCT ON (source) source, status AS last_run_status, error AS last_run_error, finished_at AS last_run_at
       FROM ops.load_run ORDER BY source, finished_at DESC, row_id DESC)
SELECT x.source, x.expected,
       CASE x.expected WHEN 'today' THEN t.today ELSE t.today - 1 END AS expected_day,
       x.last_day, x.last_captured_at,
       (CASE x.expected WHEN 'today' THEN t.today ELSE t.today - 1 END) - x.last_day AS days_behind,
       CASE WHEN x.last_day IS NULL THEN 'NO_DATA'
            WHEN x.last_day >= (CASE x.expected WHEN 'today' THEN t.today ELSE t.today - 1 END) THEN 'FRESH'
            ELSE 'STALE' END AS freshness,
       lr.last_run_status, lr.last_run_error, lr.last_run_at
FROM x CROSS JOIN t
LEFT JOIN lr ON lr.source = CASE x.source WHEN 'fbo_postings' THEN 'fbo_postings' ELSE x.source END;
COMMENT ON VIEW analytics.v_source_freshness IS 'Per source: last day present, expected day, days behind, FRESH/STALE/NO_DATA and the last loader run status. NO_DATA is never shown as 0.';
