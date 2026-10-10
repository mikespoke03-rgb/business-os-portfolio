-- Append-only snapshot tables. Re-reading the same day appends a new observation;
-- views pick the latest one with DISTINCT ON (...) ORDER BY captured_at DESC.

CREATE TABLE raw.sku (
  offer_id text PRIMARY KEY, sku bigint UNIQUE NOT NULL,
  short_name_en text, short_name_ru text, abc_class text CHECK (abc_class IN ('A','B','C')));

CREATE TABLE raw.sku_cost_obs (               -- landed cost model per unit
  row_id bigserial PRIMARY KEY, offer_id text NOT NULL REFERENCES raw.sku,
  cogs_ex_vat_rub numeric NOT NULL, customs_vat_rub numeric NOT NULL,
  valid_from date NOT NULL, captured_at timestamptz NOT NULL, source text);

CREATE TABLE raw.order_day_sku_obs (          -- /v1/analytics/data: ordered units & revenue per SKU per MSK day
  row_id bigserial PRIMARY KEY, business_date date NOT NULL, offer_id text NOT NULL, sku bigint,
  ordered_units int NOT NULL, cancelled_units int NOT NULL, order_revenue_rub numeric NOT NULL,
  captured_at timestamptz NOT NULL, run_id text NOT NULL);

CREATE TABLE raw.fbo_posting_line_obs (       -- /v3/posting/fbo/list: one row per posting line observation
  row_id bigserial PRIMARY KEY, posting_number text NOT NULL, line_ordinal int NOT NULL,
  created_at_utc timestamptz NOT NULL, order_date_msk date NOT NULL, offer_id text, sku bigint, quantity int NOT NULL,
  price_rub numeric, status text, cluster_from text, cluster_to text, warehouse_name text,
  row_sha256 text NOT NULL UNIQUE,            -- hash of business fields: identical re-read => no new row
  captured_at timestamptz NOT NULL DEFAULT now(), run_id text NOT NULL,
  -- extra fields written by workflows/stock_and_cluster_orders_daily.json (empty in the synthetic CSV)
  source_endpoint text, exec_id text, raw_sha256 text, order_id bigint, order_number text, substatus text,
  cancellation_type text, cancel_reason text, cancel_reason_id int, in_process_at_utc timestamptz, product_name text,
  currency text, old_price numeric, payout numeric, commission_amount numeric, warehouse_id bigint,
  delivery_type text, city text, is_premium boolean, is_legal boolean);

CREATE TABLE raw.realization_day_obs (        -- finance accruals (realised sales and all marketplace charges)
  row_id bigserial PRIMARY KEY, accrual_date date NOT NULL, sold_units int, sales_rub numeric,
  marketplace_charges_rub numeric, captured_at timestamptz NOT NULL, run_id text NOT NULL);

CREATE TABLE raw.seller_price_obs (           -- /v5/product/info/prices daily snapshot (08:48)
  row_id bigserial PRIMARY KEY, business_date date NOT NULL, offer_id text NOT NULL, product_id bigint,
  seller_price_rub numeric NOT NULL, marketing_seller_price_rub numeric, old_price_rub numeric,
  captured_at timestamptz NOT NULL, run_id text NOT NULL,
  -- extra fields written by workflows/seller_price_snapshot_daily.json (empty in the synthetic CSV)
  min_price_rub numeric, retail_price_rub numeric, net_price_rub numeric, currency_code text, vat numeric,
  auto_action_enabled boolean, auto_add_to_ozon_actions_list_enabled boolean, ozon_actions_count int,
  price_index_color text, price_index_value numeric, source_endpoint text, source_workflow_id text,
  response_sha256 text, price_index_logic text,
  UNIQUE (business_date, offer_id, run_id));

CREATE TABLE raw.fbo_stock_obs (              -- FBO stock by warehouse/cluster (07:15)
  row_id bigserial PRIMARY KEY, business_date date NOT NULL, offer_id text NOT NULL, sku bigint,
  cluster_name text NOT NULL, warehouse_name text, free_to_sell int NOT NULL,
  captured_at timestamptz NOT NULL, run_id text NOT NULL);

CREATE TABLE raw.ads_cpc_campaign_day_obs (   -- Performance API: CPC campaigns per day
  row_id bigserial PRIMARY KEY, stat_day date NOT NULL, campaign_id text NOT NULL, campaign_title text,
  offer_id text, spend_rub numeric, impressions bigint, clicks bigint, cart_adds bigint, orders int,
  order_revenue_rub numeric, captured_at timestamptz NOT NULL);

CREATE TABLE raw.ads_ppo_day_obs (            -- Performance API: pay-per-order report for one MSK day
  row_id bigserial PRIMARY KEY, stat_day date NOT NULL, spend_rub numeric, orders int, order_revenue_rub numeric,
  captured_at timestamptz NOT NULL);

CREATE TABLE raw.ads_expense_obs (            -- Performance API expense ledger (used to reconcile reports)
  row_id bigserial PRIMARY KEY, provider_day date NOT NULL, campaign_id text NOT NULL, expense_rub numeric,
  captured_at timestamptz NOT NULL);

CREATE TABLE raw.promo_action_obs (           -- /v1/actions (read-only)
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, action_id text NOT NULL, title text, action_type text,
  date_start date, date_end date, captured_at timestamptz NOT NULL);

CREATE TABLE raw.promo_action_product_obs (   -- /v1/actions/products | candidates | auto-add list
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, action_id text NOT NULL, offer_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('PRODUCTS','CANDIDATES','AUTOADD')),
  action_price_rub numeric, max_action_price_rub numeric, min_stock int, auto_add_date date,
  captured_at timestamptz NOT NULL);

CREATE TABLE raw.cash_event (                 -- planned / confirmed money movements
  row_id bigserial PRIMARY KEY, event_date date NOT NULL, direction text CHECK (direction IN ('IN','OUT')),
  label text NOT NULL, amount_rub numeric NOT NULL,
  status text CHECK (status IN ('CONFIRMED','PLANNED','ESTIMATE')), source text);

CREATE TABLE ops.param (                      -- parameters with an explicit status; latest row wins
  row_id bigserial PRIMARY KEY, param_key text NOT NULL, param_value numeric NOT NULL,
  status text NOT NULL CHECK (status IN ('OWNER_ACCEPTED','OWNER_STATED','ESTIMATE','DRAFT')),
  note text, set_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE ops.cash_opening_meta (row_id bigserial PRIMARY KEY, as_of_date date NOT NULL);

CREATE TABLE ops.load_run (                   -- one row per loader run: parsed vs landed rows, body hash
  row_id bigserial PRIMARY KEY, run_id text NOT NULL, source text NOT NULL, business_date date,
  finished_at timestamptz NOT NULL, status text NOT NULL CHECK (status IN ('COMPLETED','PARTIAL','FAILED')),
  rows_parsed int, rows_landed int, response_sha256 text, error text);

CREATE TABLE ops.report_delivery (            -- delivery ledger of the daily report; idempotency key per day
  row_id bigserial PRIMARY KEY, idem_key text NOT NULL,
  event text NOT NULL CHECK (event IN ('DRY_RUN_NOT_SENT','CLAIM','SENT')),
  as_of_date date NOT NULL, message_text text NOT NULL, message_sha256 text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE (idem_key, event));

-- attach the append-only guard to every table in raw / ops
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('raw','ops') LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION ops.forbid_mutation()',
                   t.tablename || '_ao', t.schemaname, t.tablename);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation()',
                   t.tablename || '_ao_trunc', t.schemaname, t.tablename);
  END LOOP;
END $$;

CREATE INDEX ON raw.order_day_sku_obs (business_date, offer_id, captured_at DESC);
CREATE INDEX ON raw.fbo_posting_line_obs (order_date_msk);
CREATE INDEX ON raw.fbo_posting_line_obs (posting_number, line_ordinal, captured_at DESC);
CREATE INDEX ON raw.seller_price_obs (business_date, offer_id, captured_at DESC);
CREATE INDEX ON raw.fbo_stock_obs (business_date, offer_id);
