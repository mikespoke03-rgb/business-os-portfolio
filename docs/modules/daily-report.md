# Daily report (09:00 MSK)

**Goal.** One short Telegram message every morning that answers "what happened yesterday, can I trust it, and what needs a decision" – without the owner opening dashboards.

**Inputs.** `analytics.v_report_facts` (one `jsonb` row built from all other views).

**Logic.**
* `scripts/render_report.js` – pure renderer `renderReport(facts, {lang, mode, maxChars})`, RU and EN. Sections: data freshness, orders (yesterday + month-to-date), ads, prices, promo, stock & shipments, cash. Every section prints the date of its data and `STALE` / `NO_DATA` with the reason; protected lines (freshness, warnings) are never cut when the text is shortened to fit 4096 characters.
* `workflows/daily_report_0900.json` – SELECT facts → render → write a `DRY_RUN_NOT_SENT` row to `ops.report_delivery` → IF gate (live flag `report_live_send_enabled = 1` with status `OWNER_ACCEPTED`, trigger is the schedule, no forbidden words, ≤ 4096 chars) → claim the per-day idempotency key → send → `SENT` row.

**Outputs.** `examples/report_example.txt` (RU), `examples/report_example_en.txt`, `examples/facts_example.json`.

**Run.** `make demo` or `python3 scripts/run_demo.py` (needs a Postgres in `DATABASE_URL`); `node scripts/render_report.js examples/facts_example.json en DRY_RUN` (no database needed).

**Limits.** The renderer is rule-based text, not an LLM; wording thresholds live in the renderer and `ops.param`.

In v0.2 an oversized protected report is kept intact in the ledger and blocked from live sending. Optional lines may be dropped, but a protected warning is not discarded to force a send. A CLAIM prevents repeat permission; it does not prove Telegram delivery. This demo's SENT ledger does not store a numeric message id, so verified delivery receipts remain deferred.
