# Task 004: n8n buttons workflow (planned)

Status: planned, not implemented. Needs owner approval for deployment and an n8n instance; cannot be completed in the synthetic repository alone. PRD: [002](../prd/002-promo-approve.md), AC6.

## Scope

- Export a new inactive workflow: schedule → read facts → Code node with `buildPromoKeyboard` (inlined like the report renderer, with a `--check` drift test) → Telegram send (dry-run ledger first, same live flag rules as the report).
- Telegram trigger for `callback_query` → Code node with `parseCallback` + `decisionRow` (passes `callback_query.id` and the update `update_id`) → Postgres insert `ON CONFLICT (idem_key) DO NOTHING` (task 003) → `answerCallbackQuery`.
- `scripts/check.py` already fails (since v0.3) if an exported workflow references marketplace write methods (`/actions/products/activate`, `/actions/products/deactivate`, price/stock import); keep the list current when adding the new workflow.

## Acceptance

Tests run the exported Code nodes like `tests/renderer.test.js` does; owner id and chat id come only from n8n credentials/variables; a staging run on the owner's n8n is recorded in a verification note before any live use.
