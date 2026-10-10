# Task 002: promo decision button contract

Status: implemented locally in v0.3. PRD: [002](../prd/002-promo-approve.md), AC1–AC4.

## Result for the owner

A pure, tested contract for approve/reject buttons, so the n8n part (task 004) only moves data and cannot invent rules.

## Scope

`scripts/promo_decision.js`, `tests/promo_decision.test.js`. No Telegram, n8n or database calls. No marketplace write methods.

## Acceptance

- `buildPromoKeyboard` returns text + `inline_keyboard`; each `callback_data` is at most 64 bytes; missing margin is rendered as «нет данных».
- `parseCallback` accepts only `pd1|<action>|<offer>|A|R|<yyyymmdd>` from the owner, for today, before the action starts.
- `decisionRow` keys the row by the delivery event (`PD-EV-<callback_query.id>`) and carries `decision_key` (action × SKU) and the Telegram `update_id` as the version; `executed: false`; it refuses any rejected tap and a tap without event ids.
- `appendDecision` dedups a re-delivered event; `currentDecisions` returns the latest tap per action × SKU (v0.5.1 fix: before, agree → decline → agree reused the first key and the third tap was lost).

## Stop conditions

Any need for Telegram tokens, chat ids or network access stops the task: that belongs to task 004.

## Work record

Tests written from AC1–AC4 first, then the module. v0.5.1: three AC4 tests added first (they failed on the old key), then the fix. Result: 8 tests pass (`npm test`).
