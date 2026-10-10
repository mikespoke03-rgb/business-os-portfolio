-- Demand by buyer cluster (from FBO postings: financial_data.cluster_to) and a shipment recommendation per SKU x cluster.
-- Share rule: SKU with >= N units in 90 days -> its own cluster share; otherwise the shop-wide cluster share (30 days).
-- If postings are stale, shares are NULL with share_source = 'NO_FRESH_ORDERS' (no recommendation is produced).
CREATE VIEW analytics.v_cluster_order_share AS
WITH p AS (SELECT analytics.param('order_share_window_days')::int AS win, analytics.param('orders_max_staleness_days')::int AS stale),
f AS (SELECT max(order_date_msk) AS max_d, max(captured_at) AS last_load FROM raw.fbo_posting_line_obs),
a AS (SELECT least(f.max_d, analytics.today_msk() - 1) AS d_to, f.max_d, f.last_load FROM f),
o AS (SELECT c.cluster_to AS cluster_name, sum(c.quantity) AS units
      FROM analytics.v_posting_line_current c, a, p
      WHERE c.status <> 'cancelled' AND c.order_date_msk BETWEEN a.d_to - (p.win - 1) AND a.d_to GROUP BY 1)
SELECT a.d_to AS orders_as_of_date, p.win AS window_days, a.last_load AS orders_last_load,
       (analytics.today_msk() - 1 - a.max_d) < p.stale AS orders_fresh,
       o.cluster_name, o.units AS units_window, round(o.units / NULLIF(sum(o.units) OVER (), 0), 4) AS share
FROM o, a, p;

CREATE VIEW analytics.v_ship_reco_sku_cluster AS
WITH p AS (SELECT analytics.param('sku_share_min_units_90d') AS min_u, analytics.param('cover_days_target') AS cover),
cs AS (SELECT * FROM analytics.v_cluster_order_share),
fr AS (SELECT bool_and(orders_fresh) AS fresh, max(orders_as_of_date) AS d_to FROM cs),
so AS (SELECT c.offer_id, c.cluster_to AS cluster_name,
              sum(c.quantity) FILTER (WHERE c.order_date_msk > fr.d_to - 90) AS u90,
              sum(c.quantity) FILTER (WHERE c.order_date_msk > fr.d_to - 28) AS u28
       FROM analytics.v_posting_line_current c, fr WHERE c.status <> 'cancelled' AND c.order_date_msk <= fr.d_to GROUP BY 1, 2),
st AS (SELECT offer_id, sum(u90) AS sku_u90, sum(u28) AS sku_u28 FROM so GROUP BY 1),
stock AS (SELECT offer_id, cluster_name, free_to_sell, business_date FROM analytics.v_fbo_stock_day
          WHERE business_date = (SELECT max(business_date) FROM analytics.v_fbo_stock_day)),
grid AS (SELECT s.offer_id, s.abc_class, cs.cluster_name, cs.share AS cluster_share FROM raw.sku s CROSS JOIN cs),
x AS (
  SELECT g.offer_id, g.abc_class, g.cluster_name,
         CASE WHEN NOT fr.fresh THEN NULL
              WHEN coalesce(st.sku_u90, 0) >= p.min_u THEN round(coalesce(so.u90, 0) / st.sku_u90, 4)
              ELSE g.cluster_share END AS demand_share,
         CASE WHEN NOT fr.fresh THEN 'NO_FRESH_ORDERS'
              WHEN coalesce(st.sku_u90, 0) >= p.min_u THEN 'SKU_ORDERS_90D' ELSE 'ALL_ORDERS_30D' END AS share_source,
         round(coalesce(st.sku_u28, 0) / 28.0, 3) AS sku_units_day_28d,
         stock.free_to_sell AS cluster_free, stock.business_date AS stock_date, p.cover, fr.d_to AS orders_as_of_date
  FROM grid g CROSS JOIN p CROSS JOIN fr
  LEFT JOIN so ON so.offer_id = g.offer_id AND so.cluster_name = g.cluster_name
  LEFT JOIN st ON st.offer_id = g.offer_id
  LEFT JOIN stock ON stock.offer_id = g.offer_id AND stock.cluster_name = g.cluster_name)
SELECT x.*,
       round(x.sku_units_day_28d * x.demand_share * x.cover, 1) AS need_units_cover,
       CASE WHEN x.demand_share IS NULL THEN NULL
            ELSE greatest(0, ceil(x.sku_units_day_28d * x.demand_share * x.cover - coalesce(x.cluster_free, 0)))::int END AS ship_units_reco,
       CASE WHEN x.cluster_free IS NULL THEN 'stock row missing for this cluster (treated as 0 for the recommendation)' END AS stock_note
FROM x;
COMMENT ON VIEW analytics.v_ship_reco_sku_cluster IS 'Recommendation only: units to ship to each cluster to cover cover_days_target of demand. The owner approves every shipment.';
