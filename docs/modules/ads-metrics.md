# Ads metrics

**Goal.** Daily ads picture: spend, impressions, clicks, CTR, CPC, orders, DRR – with missing reports shown as missing.

**Inputs.** CPC campaign statistics per day, pay-per-order (PPO) day report (`workflows/ads_ppo_day_report.json`), the expense ledger, orders.

**Logic** (`sql/12_views_ads.sql`):
* `v_ads_cpc_campaign_day` – latest observation per campaign/day, CTR = clicks/impressions, CPC = spend/clicks;
* `v_ads_day_total` – calendar up to yesterday; `cpc_status` / `ppo_status` = `OK` or `MISSING`; report spend is reconciled with the expense ledger (`cpc_spend_diff_vs_expense_rub`); DRR = (CPC spend + PPO expense) / shop order revenue, `NULL` when the day's orders are not loaded.

**Collector.** The PPO report is asynchronous: order → poll → download. Retries on 429/5xx, poll timeout, one retry for an empty body; the raw body is stored with its SHA-256 through a single SECURITY DEFINER function (`ops.ads_ppo_capture` in `sql/02_collector_tables.sql`).

**Limits.** Attribution is whatever the marketplace reports; no own attribution model.
