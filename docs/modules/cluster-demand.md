# Cluster demand and shipment recommendation

**Goal.** Decide how many units of each SKU to ship to each marketplace warehouse cluster so stock covers N days of demand where buyers actually are.

**Inputs.** FBO postings with the buyer cluster (`cluster_to`, loaded daily for D-4..D-1), FBO stock by cluster, SKU list, parameters (`order_share_window_days`, `sku_share_min_units_90d`, `cover_days_target`, `orders_max_staleness_days`).

**Logic** (`sql/15_views_cluster_demand.sql`):
* shop-wide cluster share over the last 30 days (`v_cluster_order_share`);
* per SKU: if it sold ≥ N units in 90 days, use its own cluster split (`SKU_ORDERS_90D`), otherwise the shop-wide split (`ALL_ORDERS_30D`);
* need = units/day (28 d) × share × cover days; recommendation = max(0, need − free stock in the cluster);
* if postings are stale, shares are `NULL` with `NO_FRESH_ORDERS` and no recommendation is produced.

**Outputs.** "Ship" lines of the daily report (units, lines, top clusters).

**Limits.** Recommendation only; the owner approves every shipment. Velocity is a simple 28-day average (no seasonality); a missing stock row for a cluster is treated as 0 and flagged.
