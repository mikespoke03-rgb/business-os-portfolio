-- Landing tables of the n8n collectors (workflows/*.json). Each collector stores the full API payload it received
-- (plus run id, HTTP status and SHA-256 of the response), so every number can be traced back to a response body.
-- The analytics views read the normalised raw.* tables; in this demo raw.* is filled from synthetic CSV,
-- while two collectors (postings, seller prices) write into raw.* directly.

-- ---------- stock: workflows/stock_and_cluster_orders_daily.json (07:15) ----------
CREATE TABLE landing.stock_turnover (                 -- /v1/analytics/turnover/stocks
  row_id bigserial PRIMARY KEY, business_date date NOT NULL, sku bigint NOT NULL, offer_id text, warehouse_name text,
  turnover_days numeric, current_stock numeric, daily_sales numeric,
  source_endpoint text NOT NULL, run_id text NOT NULL, captured_at timestamptz NOT NULL, revision int NOT NULL,
  http_status int, response_sha256 text, row_sha256 text, raw jsonb);
CREATE TABLE landing.stock_on_warehouses (            -- /v2/analytics/stock_on_warehouses
  row_id bigserial PRIMARY KEY, business_date date NOT NULL, sku bigint NOT NULL, offer_id text, warehouse_name text,
  product_name text, present numeric, reserved numeric,
  source_endpoint text NOT NULL, run_id text NOT NULL, captured_at timestamptz NOT NULL, revision int NOT NULL,
  http_status int, response_sha256 text, row_sha256 text, raw jsonb);
CREATE TABLE landing.fbo_stock_by_warehouse (         -- /v1/product/info/stocks-by-warehouse/fbo
  row_id bigserial PRIMARY KEY, business_date date NOT NULL, sku bigint NOT NULL, offer_id text, warehouse_name text,
  item_name text, free_to_sell_amount numeric, promised_amount numeric, reserved_amount numeric,
  source_endpoint text NOT NULL, run_id text NOT NULL, captured_at timestamptz NOT NULL, revision int NOT NULL,
  http_status int, response_sha256 text, row_sha256 text, raw jsonb);
CREATE INDEX ON landing.stock_turnover (run_id);
CREATE INDEX ON landing.stock_on_warehouses (run_id);
CREATE INDEX ON landing.fbo_stock_by_warehouse (run_id);

-- One status row per collector run: inserted as RUNNING, finished as COMPLETED / FAILED, then read back and verified
-- by the workflow (fail-closed gate). This is the only table in the demo that is updated in place.
CREATE TABLE ops.collector_run (
  run_id text PRIMARY KEY, run_date date NOT NULL, trigger_type text, status text NOT NULL
    CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  started_at timestamptz NOT NULL, finished_at timestamptz, items_written int, error text, detail jsonb, generated_by text);

-- ---------- FBO postings by cluster: same workflow, branch "CL" (rows go to raw.fbo_posting_line_obs) ----------
CREATE TABLE ops.cluster_load_run (
  row_id bigserial PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT now(),
  run_tag text NOT NULL, kind text NOT NULL,           -- DAILY | HISTORY
  date_from date, date_to date, requests_n int, http_statuses jsonb,
  postings_n int, lines_n int, lines_inserted int,     -- lines_inserted < lines_n is normal: unchanged lines are skipped
  exec_ids text, status text, note text);

-- ---------- seller prices: workflows/seller_price_snapshot_daily.json (rows go to raw.seller_price_obs) ----------
CREATE TABLE landing.seller_price_raw (
  row_id bigserial PRIMARY KEY, business_date date NOT NULL, run_id text NOT NULL, offer_id text NOT NULL, product_id bigint,
  color_index text, commissions jsonb, marketing_actions jsonb, acquiring numeric, raw jsonb,
  captured_at timestamptz NOT NULL, source_workflow_id text, response_sha256 text);

-- ---------- promotions (read-only): workflows/promo_read_daily.json (08:40) ----------
CREATE TABLE landing.promo_run_event (
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, event text NOT NULL CHECK (event IN ('STARTED','FINISHED')),
  status text NOT NULL, detail jsonb, recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE landing.promo_api_call (
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, call_key text NOT NULL, endpoint text NOT NULL, action_id bigint,
  request jsonb, http_status int, attempts int, item_count int, total_reported int, error text,
  captured_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE landing.promo_action (                    -- /v1/actions
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, action_id bigint NOT NULL, title text, action_type text,
  date_start timestamptz, date_end timestamptz, freeze_date text, auto_add_dates jsonb,
  potential_products_count numeric, participating_products_count numeric, is_participating boolean,
  discount_type text, discount_value numeric, with_targeting boolean, raw jsonb, captured_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE landing.promo_action_product (            -- /v2/actions/products | /v2/actions/candidates
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, action_id bigint NOT NULL,
  source text NOT NULL CHECK (source IN ('PRODUCTS','CANDIDATES')), product_id bigint,
  action_price numeric, price numeric, marketplace_seller_price numeric, min_seller_price numeric, max_action_price numeric,
  alert_max_action_price numeric, alert_max_action_price_failed boolean, add_mode text,
  current_boost numeric, min_boost numeric, max_boost numeric, price_min_elastic numeric, price_max_elastic numeric,
  min_stock numeric, stock numeric, recommended_stock numeric, is_quarantined boolean,
  website_price numeric, website_prices jsonb, total_reported numeric, raw jsonb, captured_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE landing.promo_action_autoadd (            -- /v2/actions/auto-add/products/list
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, action_id bigint NOT NULL, auto_add_date timestamptz,
  product_id bigint, sku bigint, offer_id text, action_price_to_auto_add numeric, price numeric, base_price numeric,
  marketplace_seller_price numeric, min_seller_price numeric, max_discount_price numeric,
  quantity_to_auto_add numeric, min_action_quantity numeric, add_mode boolean, website_prices jsonb, raw jsonb,
  captured_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE landing.seller_action (                   -- /v1/seller-actions/list
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, action_id bigint NOT NULL, title text, action_type text,
  date_start timestamptz, date_end timestamptz, is_turn_on boolean, sku_count numeric, raw jsonb,
  captured_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE landing.seller_action_product (           -- /v1/seller-actions/products/list
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, action_id bigint NOT NULL, product_id bigint, sku bigint, offer_id text,
  action_price numeric, base_price numeric, price numeric, discount_percent numeric, is_active boolean,
  min_seller_price numeric, raw jsonb, captured_at timestamptz NOT NULL DEFAULT now());

-- ---------- ads, pay-per-order day report: workflows/ads_ppo_day_report.json (06:20) ----------
-- The report body is stored verbatim; byte count and SHA-256 are set by a trigger. The workflow role only needs
-- EXECUTE on ops.ads_ppo_capture() (SECURITY DEFINER), no direct table privileges - see sql/optional/collector_role.sql.
CREATE TABLE landing.ads_ppo_report_receipt (
  receipt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id text NOT NULL, execution_id text NOT NULL, run_mode text NOT NULL,  -- schedule | backfill | test
  report_day date NOT NULL,                                                     -- MSK day requested
  request_body jsonb NOT NULL,                                                  -- {kind, method, path, query} as sent
  report_uuid text, order_http_status int, order_attempts int, poll_attempts int,
  final_state text,                     -- OK_ROWS | OK_EMPTY | ORDER_FAILED | ORDER_HTTP_xxx | REPORT_ERROR | POLL_TIMEOUT | EXCEPTION
  download_http_status int, empty_retry int NOT NULL DEFAULT 0,
  body_text text, body_byte_count int, body_sha256 text,
  parsed_row_count int, error_text text,
  observed_at_utc timestamptz NOT NULL, stored_at_utc timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION landing.ads_ppo_receipt_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.body_byte_count := octet_length(convert_to(coalesce(NEW.body_text, ''), 'UTF8'));
  NEW.body_sha256 := encode(sha256(convert_to(coalesce(NEW.body_text, ''), 'UTF8')), 'hex');
  NEW.stored_at_utc := now();
  RETURN NEW;
END $$;
CREATE TRIGGER ads_ppo_report_receipt_hash BEFORE INSERT ON landing.ads_ppo_report_receipt
  FOR EACH ROW EXECUTE FUNCTION landing.ads_ppo_receipt_hash();

CREATE FUNCTION ops.ads_ppo_capture(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r landing.ads_ppo_report_receipt%ROWTYPE;
BEGIN
  INSERT INTO landing.ads_ppo_report_receipt (workflow_id, execution_id, run_mode, report_day, request_body, report_uuid,
    order_http_status, order_attempts, poll_attempts, final_state, download_http_status, empty_retry, body_text,
    parsed_row_count, error_text, observed_at_utc)
  VALUES (p->>'workflow_id', p->>'execution_id', p->>'run_mode', (p->>'report_day')::date, p->'request_body',
    nullif(p->>'report_uuid', ''), (p->>'order_http_status')::int, (p->>'order_attempts')::int, (p->>'poll_attempts')::int,
    p->>'final_state', (p->>'download_http_status')::int, coalesce((p->>'empty_retry')::int, 0),
    CASE WHEN coalesce(p->>'body_b64', '') = '' THEN NULL ELSE convert_from(decode(p->>'body_b64', 'base64'), 'UTF8') END,
    (p->>'parsed_row_count')::int, nullif(p->>'error_text', ''), now())
  RETURNING * INTO r;
  RETURN jsonb_build_object('receipt_id', r.receipt_id, 'report_day', r.report_day, 'final_state', r.final_state,
    'empty_retry', r.empty_retry, 'parsed_row_count', r.parsed_row_count, 'body_sha256', r.body_sha256,
    'body_byte_count', r.body_byte_count);
END $$;
REVOKE ALL ON FUNCTION ops.ads_ppo_capture(jsonb) FROM PUBLIC;

-- append-only guard on every landing table and on ops.cluster_load_run (ops.collector_run is the documented exception)
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_tables
           WHERE schemaname = 'landing' OR (schemaname = 'ops' AND tablename = 'cluster_load_run') LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation()',
                   t.tablename || '_ao', t.schemaname, t.tablename);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation()',
                   t.tablename || '_ao_trunc', t.schemaname, t.tablename);
  END LOOP;
END $$;
