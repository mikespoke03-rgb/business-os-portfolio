-- Coverage-based load verification.
-- 1) per loader run: rows parsed from the API body == rows that actually landed in the table (read back by run id)
-- 2) per day: units in FBO postings (all statuses) vs units in the analytics orders source - two independent APIs.
CREATE VIEW analytics.v_load_run_check AS
SELECT run_id, source, business_date, finished_at, status, rows_parsed, rows_landed, response_sha256,
       CASE WHEN status = 'FAILED' THEN 'FAILED'
            WHEN rows_parsed IS DISTINCT FROM rows_landed THEN 'LANDED_COUNT_MISMATCH'
            WHEN coalesce(rows_landed, 0) = 0 THEN 'NO_ROWS_LANDED'
            ELSE 'OK' END AS check_state, error
FROM ops.load_run;

CREATE VIEW analytics.v_coverage_daily AS
WITH pst AS (SELECT order_date_msk AS d, sum(quantity) AS units_postings, count(DISTINCT offer_id) AS sku_postings
             FROM analytics.v_posting_line_current GROUP BY 1),
an AS (SELECT business_date AS d, sum(ordered_units) AS units_analytics, count(DISTINCT offer_id) AS sku_analytics
       FROM analytics.v_orders_day_sku GROUP BY 1)
SELECT coalesce(pst.d, an.d) AS day, pst.units_postings, an.units_analytics,
       pst.units_postings - an.units_analytics AS diff_units,
       CASE WHEN an.d IS NULL THEN 'NO_SECOND_SOURCE'
            WHEN pst.d IS NULL THEN 'NO_POSTINGS'
            WHEN pst.units_postings = an.units_analytics THEN 'MATCH' ELSE 'DIFF' END AS coverage_state
FROM pst FULL JOIN an ON an.d = pst.d;
