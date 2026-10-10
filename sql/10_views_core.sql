-- Core "latest observation" views. Pattern: DISTINCT ON (business key) ... ORDER BY captured_at DESC.

CREATE VIEW ops.v_param_current AS
SELECT DISTINCT ON (param_key) param_key, param_value, status, note, set_at
FROM ops.param ORDER BY param_key, set_at DESC, row_id DESC;

CREATE FUNCTION analytics.param(p_key text) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT param_value FROM ops.v_param_current WHERE param_key = p_key
$$;

CREATE VIEW analytics.v_sku_cost_current AS
SELECT DISTINCT ON (offer_id) offer_id, cogs_ex_vat_rub, customs_vat_rub, valid_from
FROM raw.sku_cost_obs WHERE valid_from <= analytics.today_msk()
ORDER BY offer_id, valid_from DESC, captured_at DESC, row_id DESC;

CREATE VIEW analytics.v_orders_day_sku AS
SELECT DISTINCT ON (business_date, offer_id) business_date, offer_id, ordered_units, cancelled_units, order_revenue_rub, captured_at
FROM raw.order_day_sku_obs
ORDER BY business_date, offer_id, captured_at DESC, row_id DESC;

CREATE VIEW analytics.v_orders_day AS
SELECT business_date, sum(ordered_units) AS ordered_units, sum(cancelled_units) AS cancelled_units,
       sum(order_revenue_rub) AS order_revenue_rub, max(captured_at) AS loaded_at
FROM analytics.v_orders_day_sku GROUP BY business_date;

CREATE VIEW analytics.v_posting_line_current AS
SELECT DISTINCT ON (posting_number, line_ordinal) *
FROM raw.fbo_posting_line_obs
ORDER BY posting_number, line_ordinal, captured_at DESC, row_id DESC;

CREATE VIEW analytics.v_seller_price_day AS
SELECT DISTINCT ON (business_date, offer_id) business_date, offer_id, seller_price_rub, marketing_seller_price_rub, captured_at
FROM raw.seller_price_obs ORDER BY business_date, offer_id, captured_at DESC, row_id DESC;

CREATE VIEW analytics.v_fbo_stock_day AS
SELECT business_date, offer_id, cluster_name, sum(free_to_sell) AS free_to_sell, max(captured_at) AS captured_at
FROM (SELECT DISTINCT ON (business_date, offer_id, warehouse_name) * FROM raw.fbo_stock_obs
      ORDER BY business_date, offer_id, warehouse_name, captured_at DESC, row_id DESC) s
GROUP BY business_date, offer_id, cluster_name;

CREATE VIEW analytics.v_realization_day AS
SELECT DISTINCT ON (accrual_date) accrual_date, sold_units, sales_rub, marketplace_charges_rub, captured_at
FROM raw.realization_day_obs ORDER BY accrual_date, captured_at DESC, row_id DESC;
