# Task 003: promo decision log (planned)

Status: planned, not implemented. PRD: [002](../prd/002-promo-approve.md), AC4–AC5.

## Scope

- `sql/03_promo_decision.sql`: `ops.promo_decision (idem_key unique /* PD-EV-<callback_query.id> */, decision_key /* action × SKU */, action_id, offer_id, decision, decided_at, source, telegram_update_id, callback_query_id, executed boolean default false check (executed = false))`, the same `ops.forbid_mutation` trigger as `raw.*`.
- `INSERT … ON CONFLICT (idem_key) DO NOTHING RETURNING` as the only write path.
- `analytics.v_report_facts`: per nearest action, counts of decided / undecided SKUs.
- Current decision view: `DISTINCT ON (decision_key) … ORDER BY decision_key, telegram_update_id DESC`.
- `tests/test_sql.py`: a re-delivered event is one row; agree → decline → agree is three rows and the view shows agree; UPDATE/DELETE are rejected.

## Acceptance

All SQL tests pass on the disposable demo DB; `examples/` regenerate deterministically; the report shows «решено N из M» or «нет данных».

## Stop conditions

Any change to existing promo recommendation rules requires an owner decision first.
