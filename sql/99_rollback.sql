-- Rollback for the demo objects. Views are dropped; append-only tables are kept by default (they are evidence).
DROP VIEW IF EXISTS analytics.v_report_facts, analytics.v_coverage_daily, analytics.v_load_run_check,
  analytics.v_cash_calendar_daily, analytics.v_ship_reco_sku_cluster, analytics.v_cluster_order_share,
  analytics.v_promo_summary, analytics.v_promo_participation_calc, analytics.v_breakeven_daily, analytics.v_unit_margin_day,
  analytics.v_ads_day_total, analytics.v_ads_cpc_campaign_day, analytics.v_source_freshness,
  analytics.v_realization_day, analytics.v_fbo_stock_day, analytics.v_seller_price_day, analytics.v_posting_line_current,
  analytics.v_orders_day, analytics.v_orders_day_sku, analytics.v_sku_cost_current, ops.v_param_current CASCADE;
-- To remove everything in a throw-away database:  DROP SCHEMA analytics, ops, raw CASCADE;
