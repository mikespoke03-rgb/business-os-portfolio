# n8n workflows (sanitized)

Exported from the real n8n instance and passed through `scripts/sanitize_n8n_workflow.py`:
credentials blocks, credential ids, workflow/instance ids, `pinData`, `staticData`, version metadata, tags, webhook ids,
Telegram chat id and the n8n instance URL were removed; node ids were regenerated; the hard-coded SKU list and the ads
campaign id were replaced with placeholders. Table names were re-pointed at the demo schema (`sql/00-02`), internal
notes were removed and the remaining comments/error messages are in English. Node logic (Code nodes, SQL, HTTP calls,
retries, gates) is otherwise unchanged unless noted. All workflows are exported with `"active": false`.

| File | Schedule (MSK) | What it does | Notes |
|---|---|---|---|
| `ads_ppo_day_report.json` | 06:20 | Ozon Performance "pay-per-order, all products" report for one MSK day, two report kinds (products / orders). Orders the async report, polls, downloads; 429/5xx or still pending → wait 15 s and call again (max 5 order attempts, poll gives up after ~2 min as `POLL_TIMEOUT`); empty result → one retry after 60 s. Stores the body + SHA-256 through one SECURITY DEFINER function. | Writes through `ops.ads_ppo_capture()` into `landing.ads_ppo_report_receipt`. One fix vs. the original: an inline `//` comment had swallowed the PENDING/POLL_TIMEOUT branch; the comment was moved to its own line. |
| `stock_and_cluster_orders_daily.json` | 07:15 | 3 stock methods (turnover, stock on warehouses, FBO stock by warehouse) → insert → **readback of landed rows by run id** → receipt row → fail-closed gate. Second branch: FBO postings D-4..D-1 with `cluster_to`/`cluster_from`, deduplicated against the current observation, plus a load-run row. | SKU universe from `raw.sku`; stock → `landing.stock_turnover`, `landing.stock_on_warehouses`, `landing.fbo_stock_by_warehouse`; run record → `ops.collector_run`; postings → `raw.fbo_posting_line_obs` (deduplicated against `analytics.v_posting_line_current`) + `ops.cluster_load_run`. |
| `promo_read_daily.json` | 08:40 | Read-only promo sink: actions → products / candidates / auto-add lists → seller actions; 1 request per 1.5 s; retry ladder 20/40/60/60 s on 429/5xx/network; pagination by last_id/offset/cursor; insert → readback → `run_event` STARTED/FINISHED with SUCCEEDED / PARTIAL / FAILED; keys like phone/driver/vehicle/passport are dropped before storing raw JSON. | `landing.promo_*`, `landing.seller_action*`, run events in `landing.promo_run_event`. |
| `seller_price_snapshot_daily.json` | 08:48 | `/v5/product/info/prices` for all SKUs → append-only insert (`ON CONFLICT DO NOTHING`), response SHA-256, price-index colour + raw commissions. | Rows → `raw.seller_price_obs` (the table the price views read), items → `landing.seller_price_raw`. SKU list replaced with synthetic `DEMO-001..024`. |
| `daily_report_0900.json` | 09:00 | One SELECT on `analytics.v_report_facts` → pure renderer → dry-run ledger row → IF live flag (`1` + `OWNER_ACCEPTED`), scheduled trigger, no forbidden words, ≤ 4096 chars → claim the per-day idempotency key → Telegram → `SENT` ledger row. | **Adapted to the demo schema** (`ops.report_delivery`, `analytics.v_report_facts`); the renderer is generated from `scripts/render_report.js` by `scripts/inline_renderer_into_workflow.py`. In the original the facts came from three views and the renderer contained business-specific wording. |

## Import

1. n8n → *Import from file*. 2. Create your own credentials (Postgres, Ozon Seller API header auth with your client id and API key,
Ozon Performance API, Telegram) and attach them to the nodes marked *"Credential required"*. 3. Set the Telegram chat id
(the node reads `$env.TELEGRAM_CHAT_ID`; if env access is blocked on your instance, type it into the node).
4. Run the manual trigger first: the report workflow writes a `DRY_RUN_NOT_SENT` ledger row and does not send anything until
`report_live_send_enabled = 1` with status `OWNER_ACCEPTED` is inserted into `ops.param`.
