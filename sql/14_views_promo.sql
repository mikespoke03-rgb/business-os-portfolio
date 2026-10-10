-- Promo profitability per SKU per action (read-only calculation; nothing is joined to a promo automatically).
-- unit margin at price P = P - commission - logistics - acquiring - CPC ads (DRR) - PPO ads - VAT(model) - COGS
-- required_uplift_pct = how much sales must grow so that total margin at the promo price equals today's total margin.
CREATE VIEW analytics.v_promo_participation_calc AS
WITH p AS (SELECT analytics.param('commission_pct') comm, analytics.param('acquiring_pct') acq, analytics.param('logistics_rub_per_unit') logu,
                  analytics.param('ppo_pct') ppo, analytics.param('vat_rate') vat, analytics.param('vat_base_share') vshare,
                  analytics.param('promo_min_margin_pct') min_m, analytics.param('promo_target_margin_pct') tgt_m,
                  analytics.param('promo_max_required_uplift_pct') max_up),
run AS (SELECT run_id, max(captured_at) AS measured_at FROM raw.promo_action_obs GROUP BY run_id ORDER BY 2 DESC LIMIT 1),
act AS (SELECT DISTINCT ON (a.action_id) a.* FROM raw.promo_action_obs a JOIN run USING (run_id) ORDER BY a.action_id, a.captured_at DESC),
px AS (SELECT DISTINCT ON (offer_id) offer_id, business_date AS px_date, seller_price_rub FROM analytics.v_seller_price_day
       ORDER BY offer_id, business_date DESC),
drr AS (  -- shop-level CPC DRR over the last 28 loaded days (estimate applied to every SKU)
  SELECT sum(cpc_spend_rub) / NULLIF(sum(shop_order_revenue_rub), 0) AS drr_cpc
  FROM analytics.v_ads_day_total WHERE shop_order_revenue_rub IS NOT NULL AND cpc_spend_rub IS NOT NULL
    AND stat_day > (SELECT max(business_date) FROM analytics.v_orders_day) - 28),
sales AS (SELECT offer_id, round(sum(ordered_units - cancelled_units) / 14.0, 2) AS units_day_14d
          FROM analytics.v_orders_day_sku WHERE business_date > (SELECT max(business_date) FROM analytics.v_orders_day) - 14 GROUP BY 1),
stk AS (SELECT offer_id, sum(free_to_sell) AS fbo_free, max(business_date) AS fbo_date FROM analytics.v_fbo_stock_day
        WHERE business_date = (SELECT max(business_date) FROM analytics.v_fbo_stock_day) GROUP BY 1),
b AS (
  SELECT r.run_id, a.action_id, a.title, a.action_type, a.date_start, a.date_end, ap.offer_id, ap.source, ap.min_stock, ap.auto_add_date,
         COALESCE(NULLIF(ap.action_price_rub, 0), ap.max_action_price_rub) AS action_price,
         CASE WHEN NULLIF(ap.action_price_rub, 0) IS NOT NULL THEN 'action_price' ELSE 'max_action_price (ESTIMATE)' END AS action_price_src,
         px.seller_price_rub AS current_price, px.px_date, c.cogs_ex_vat_rub AS cogs, c.customs_vat_rub AS cvat,
         drr.drr_cpc, coalesce(s.units_day_14d, 0) AS units_day_14d, st.fbo_free, st.fbo_date, r.measured_at
  FROM raw.promo_action_product_obs ap JOIN run r USING (run_id)
  JOIN act a ON a.action_id = ap.action_id
  LEFT JOIN px ON px.offer_id = ap.offer_id
  LEFT JOIN analytics.v_sku_cost_current c ON c.offer_id = ap.offer_id
  LEFT JOIN sales s ON s.offer_id = ap.offer_id
  LEFT JOIN stk st ON st.offer_id = ap.offer_id
  CROSS JOIN drr),
e AS (
  SELECT b.*,
    b.action_price - b.action_price * (p.comm + p.acq + b.drr_cpc + p.ppo) - p.logu
      - (b.action_price * p.vshare * p.vat / (1 + p.vat) - b.cvat) - b.cogs AS m_action,
    b.current_price - b.current_price * (p.comm + p.acq + b.drr_cpc + p.ppo) - p.logu
      - (b.current_price * p.vshare * p.vat / (1 + p.vat) - b.cvat) - b.cogs AS m_current,
    array_remove(ARRAY[
      CASE WHEN b.action_price IS NULL THEN 'no promo price' END,
      CASE WHEN b.current_price IS NULL THEN 'no current price' END,
      CASE WHEN b.cogs IS NULL THEN 'no COGS' END,
      CASE WHEN b.drr_cpc IS NULL THEN 'no CPC DRR' END], NULL) AS missing
  FROM b CROSS JOIN p),
g AS (
  SELECT e.*, round(100 * e.m_action / NULLIF(e.action_price, 0), 1) AS margin_pct_action,
         CASE WHEN e.m_action IS NULL OR e.m_current IS NULL THEN NULL
              WHEN e.action_price >= e.current_price THEN 0
              WHEN e.m_action <= 0 OR e.m_current <= 0 THEN NULL
              ELSE round(100 * (e.m_current / e.m_action - 1), 0) END AS required_uplift_pct
  FROM e)
SELECT g.run_id, g.measured_at, g.action_id, g.title, g.action_type, g.date_start, g.date_end, g.source, g.auto_add_date,
       g.offer_id, g.action_price, g.action_price_src, g.current_price, g.px_date,
       round(g.m_action) AS margin_unit_action_rub, g.margin_pct_action, round(g.m_current) AS margin_unit_current_rub,
       g.required_uplift_pct, round(100 * g.drr_cpc, 2) AS drr_cpc_pct_estimate,
       g.units_day_14d, g.fbo_free, g.fbo_date, g.min_stock,
       round((g.m_action - g.m_current) * g.units_day_14d) AS margin_delta_day_rub_no_uplift,
       CASE WHEN cardinality(g.missing) > 0 THEN 'OWNER_DECIDES'
            WHEN g.m_action < 0 THEN 'DONT'
            WHEN g.margin_pct_action < p.min_m THEN 'DONT'
            WHEN g.margin_pct_action < p.tgt_m THEN 'OWNER_DECIDES'
            WHEN g.min_stock IS NOT NULL AND coalesce(g.fbo_free, 0) < g.min_stock THEN 'OWNER_DECIDES'
            WHEN g.required_uplift_pct > p.max_up THEN 'OWNER_DECIDES'
            ELSE 'ENTER' END AS recommendation,
       CASE WHEN cardinality(g.missing) > 0 THEN 'missing: ' || array_to_string(g.missing, '; ')
            WHEN g.m_action < 0 THEN 'loss ' || round(-g.m_action) || ' RUB/unit at promo price'
            WHEN g.margin_pct_action < p.min_m THEN 'margin ' || g.margin_pct_action || '% < minimum ' || p.min_m || '%'
            WHEN g.margin_pct_action < p.tgt_m THEN 'margin ' || g.margin_pct_action || '% between minimum and target'
            WHEN g.min_stock IS NOT NULL AND coalesce(g.fbo_free, 0) < g.min_stock THEN 'FBO stock ' || coalesce(g.fbo_free::text, 'unknown') || ' < required ' || g.min_stock
            WHEN g.required_uplift_pct > p.max_up THEN 'needs +' || g.required_uplift_pct || '% sales to break even vs today'
            ELSE 'margin ' || g.margin_pct_action || '%, needs +' || coalesce(g.required_uplift_pct, 0) || '% sales' END AS reason,
       'calculation only - no promo is joined or left automatically; boosting effect on sales is unknown'::text AS note
FROM g CROSS JOIN p;

CREATE VIEW analytics.v_promo_summary AS
WITH c AS (SELECT * FROM analytics.v_promo_participation_calc),
nx AS (SELECT action_id, title, date_start FROM c WHERE date_start >= analytics.today_msk()
       GROUP BY 1, 2, 3 ORDER BY date_start, action_id LIMIT 1)
SELECT (SELECT max(measured_at) FROM c) AS measured_at,
       (SELECT count(DISTINCT action_id) FROM c) AS n_actions,
       (SELECT count(*) FROM c WHERE source = 'PRODUCTS') AS n_participating,
       nx.title AS nearest_title, nx.date_start AS nearest_start,
       count(*) FILTER (WHERE c.action_id = nx.action_id) AS nearest_n_sku,
       count(*) FILTER (WHERE c.action_id = nx.action_id AND c.recommendation = 'ENTER') AS nearest_enter,
       count(*) FILTER (WHERE c.action_id = nx.action_id AND c.recommendation = 'DONT') AS nearest_dont,
       count(*) FILTER (WHERE c.action_id = nx.action_id AND c.recommendation = 'OWNER_DECIDES') AS nearest_decide,
       count(*) FILTER (WHERE c.source = 'AUTOADD') AS autoadd_n_sku,
       min(c.auto_add_date) AS autoadd_date,
       count(*) FILTER (WHERE c.source = 'AUTOADD' AND c.recommendation = 'DONT') AS autoadd_dont,
       sum(c.margin_delta_day_rub_no_uplift) FILTER (WHERE c.source = 'AUTOADD') AS autoadd_margin_delta_day_rub
FROM c LEFT JOIN nx ON true
GROUP BY nx.title, nx.date_start;
