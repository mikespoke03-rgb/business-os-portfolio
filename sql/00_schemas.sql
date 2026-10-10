-- Business OS (demo) - schemas and shared helpers.
-- landing.*   append-only full payloads as written by the n8n collector workflows
-- raw.*       append-only snapshots exactly as loaded from the marketplace APIs (one row per observation)
-- ops.*       run ledger, delivery ledger, parameters (also append-only)
-- analytics.* read-only views; the daily report reads ONE view (analytics.v_report_facts)
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS landing;   -- full API payloads written by the n8n collectors (sql/02_collector_tables.sql)
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS analytics;

-- "Today" in the business time zone. The demo pins it with:  SET bos.today = '2026-04-15';
CREATE OR REPLACE FUNCTION analytics.today_msk() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('bos.today', true), '')::date,
                  (now() AT TIME ZONE 'Europe/Moscow')::date)
$$;

-- Append-only guard: attached to every raw.* / ops.* table (UPDATE, DELETE, TRUNCATE are rejected).
CREATE OR REPLACE FUNCTION ops.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %.%: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END $$;
