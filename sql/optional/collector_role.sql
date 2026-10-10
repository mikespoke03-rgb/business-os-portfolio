-- OPTIONAL (not applied by scripts/load_sample_data.py): least-privilege role for the n8n Postgres credential.
-- The collectors only need SELECT + INSERT on their tables; ops.collector_run additionally needs UPDATE (run status).
-- Create the role yourself (CREATE ROLE collector LOGIN PASSWORD '...') and keep the password in n8n credentials only.
GRANT USAGE ON SCHEMA raw, landing, ops, analytics TO collector;
GRANT SELECT ON raw.sku TO collector;                                   -- SKU universe for the stock collector
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA landing TO collector;
GRANT SELECT, INSERT ON raw.fbo_posting_line_obs, raw.seller_price_obs, ops.cluster_load_run, ops.report_delivery TO collector;
GRANT SELECT, INSERT, UPDATE ON ops.collector_run TO collector;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA raw, landing, ops TO collector;
GRANT SELECT ON analytics.v_posting_line_current, analytics.v_report_facts TO collector;
REVOKE ALL ON landing.ads_ppo_report_receipt FROM collector;            -- written only through the function below
GRANT EXECUTE ON FUNCTION ops.ads_ppo_capture(jsonb) TO collector;
