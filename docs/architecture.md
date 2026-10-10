# Architecture

```
marketplace APIs ──► n8n collectors (cron, read endpoints only) ──► raw.* append-only observations
                                                                      │  + ops.load_run receipts (parsed vs landed rows, SHA-256)
                                                                      ▼
                                       analytics.v_* views (latest observation wins, freshness, models)
                                                                      │
                                                                      ▼
                     analytics.v_report_facts (one jsonb row) ──► pure renderer ──► gate ──► Telegram
                                                                                     └──► ops.report_delivery ledger
```

## Layers

| Layer | Where | Rule |
|---|---|---|
| Collection | `workflows/*.json` (n8n) | Read endpoints only. Every run writes a receipt: status, rows parsed from the body, rows that actually landed (read back by run id), response hash. |
| Raw storage | `sql/01_tables.sql`, schema `raw` | Append-only. `UPDATE`/`DELETE` are rejected by a trigger (`ops.forbid_mutation`). A re-load is a new observation with a newer `captured_at`. |
| Parameters | `ops.param` | Every model constant (commission, VAT, fixed costs, thresholds) is a row with a status: `OWNER_ACCEPTED`, `OWNER_STATED`, `ESTIMATE`, `DRAFT`. The latest row per key wins. |
| Analytics | `sql/1*.sql`, schema `analytics` | Views only, no materialised copies. Latest observation is selected with `DISTINCT ON … ORDER BY captured_at DESC`. Missing data stays `NULL`, never `0`. |
| Report facts | `sql/20_view_report_facts.sql` | One `jsonb` row with everything the morning report needs, including freshness and the live-send flag. |
| Rendering | `scripts/render_report.js` | Pure function `facts → text`. The same file runs in the n8n Code node and from the CLI, so the report can be tested without n8n. |
| Delivery | `workflows/daily_report_0900.json`, `ops.report_delivery` | Dry run by default. Live send needs the flag, a scheduled trigger, no forbidden words, ≤ 4096 chars and a free per-day idempotency key. |
| Operations | `scripts/n8n_backup.py`, `scripts/n8n_rollback.py` | Backup before change, SHA-256 receipts, rollback is a dry run unless `--apply`. |

## Demo vs. production

The demo schema is a compact re-implementation of the real model with the same rules:

* `landing.*` – full API payloads exactly as the collectors write them (`sql/02_collector_tables.sql`): three stock methods,
  seven promo tables, the pay-per-order report receipts (written only through the SECURITY DEFINER function
  `ops.ads_ppo_capture`), raw seller-price items;
* `raw.*` – the normalised observations the views read. The postings collector and the seller-price collector write here
  directly; everything else is filled from the synthetic CSV in this demo;
* `ops.*` – parameters, run ledgers (`ops.load_run`, `ops.collector_run`, `ops.cluster_load_run`) and the report delivery ledger;
* `analytics.*` – views only.

The real system had more schemas (one per contour/loader) and more views. All collector workflows in `workflows/` reference
only tables that exist in this demo schema; `sql/optional/collector_role.sql` shows the least-privilege grants for the
Postgres credential used by n8n.

## Owner Q&A (AI layer: Grok Bot)

```
v_report_facts JSON ──► llm/mask.js (config: names → SKU codes, costs dropped, counterparties redacted, cash in thousands)
                    ──► llm/answer.js prompt ──► Grok Bot (the owner's desktop AI assistant, connected to Neon and n8n)
                    ──► llm/grader.js (numbers, dates and times must match cited facts; null never becomes 0)
                    ──► answer shown to the owner, or blocked with the reason
```

There is no model API client in the system: the AI layer is the Grok Bot desktop assistant. It never computes business numbers; it only phrases facts that SQL already produced, and the eval gate checks its recorded answers.
See [llm-eval.md](llm-eval.md).
