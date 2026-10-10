'use strict';
// PRD 002 acceptance criteria that are testable without Telegram or n8n.
const test = require('node:test');
const assert = require('node:assert/strict');
const { callbackData, buildPromoKeyboard, parseCallback, decisionRow, appendDecision, currentDecisions, MAX_CALLBACK_BYTES } = require('../scripts/promo_decision.js');

const action = { id: 987654321012, title: 'Weekend flash sale', start: '2026-04-17' };
const recs = [{ offer: 'DEMO-001', verdict: 'OWNER_DECIDES', margin_pct: 18 }, { offer: 'DEMO-015', verdict: 'DONT', margin_pct: null }];
const ctx = { today: '2026-04-15', ownerUserId: 111, fromUserId: 111, actionStart: '2026-04-17' };

test('AC1: every SKU gets approve and reject buttons within the Telegram 64-byte limit', () => {
  const kb = buildPromoKeyboard(action, recs, '2026-04-15');
  assert.equal(kb.reply_markup.inline_keyboard.length, 2);
  for (const row of kb.reply_markup.inline_keyboard) for (const b of row) assert.ok(Buffer.byteLength(b.callback_data) <= MAX_CALLBACK_BYTES);
  assert.match(kb.text, /DEMO-015: рекомендуем не входить, маржа: нет данных/);
  assert.match(kb.text, /ничего не добавляется автоматически/);
});

test('AC2: a valid owner tap round-trips to a decision', () => {
  const p = parseCallback(callbackData(action.id, 'DEMO-001', 'A', '2026-04-15'), ctx);
  assert.deepEqual(p, { ok: true, action_id: action.id, offer: 'DEMO-001', decision: 'APPROVE', as_of: '2026-04-15' });
});

test('AC3: taps from someone else, old buttons, started actions and tampered data are refused', () => {
  const data = callbackData(action.id, 'DEMO-001', 'R', '2026-04-15');
  assert.equal(parseCallback(data, { ...ctx, fromUserId: 222 }).reason, 'NOT_OWNER');
  assert.equal(parseCallback(data, { ...ctx, today: '2026-04-16' }).reason, 'STALE_BUTTON');
  assert.equal(parseCallback(data, { ...ctx, actionStart: '2026-04-15' }).reason, 'ACTION_ALREADY_STARTED');
  for (const bad of ['pd1|1|DEMO-001|X|20260415', 'pd0|1|DEMO-001|A|20260415', 'pd1|1|demo 1|A|20260415', 'pd1|1|DEMO-001|A', 'x'.repeat(65)])
    assert.equal(parseCallback(bad, ctx).reason, 'MALFORMED', bad);
});

const tap = (d, updateId, callbackId) => decisionRow(parseCallback(callbackData(action.id, 'DEMO-001', d, '2026-04-15'), ctx),
  { decidedAt: `2026-04-15T09:${String(updateId).padStart(2, '0')}:00+03:00`, telegramUpdateId: updateId, callbackQueryId: callbackId });

test('AC4: a decision is recorded with a delivery-event key and is never executed', () => {
  const row = tap('A', 42, 'cbq-42');
  assert.equal(row.idem_key, 'PD-EV-cbq-42');
  assert.equal(row.decision_key, `PD-${action.id}-DEMO-001`);
  assert.equal(row.executed, false);
  assert.throws(() => decisionRow({ ok: false, reason: 'NOT_OWNER' }, {}), /REFUSED_NOT_OWNER/);
  assert.throws(() => decisionRow(parseCallback(callbackData(action.id, 'DEMO-001', 'A', '2026-04-15'), ctx), { decidedAt: 'x', telegramUpdateId: 1 }), /MISSING_EVENT_ID/);
});

test('AC4: a repeated delivery of the same tap is deduplicated', () => {
  let log = [];
  const first = tap('A', 42, 'cbq-42');
  log = appendDecision(log, first).log;
  const again = appendDecision(log, tap('A', 42, 'cbq-42'));
  assert.equal(again.inserted, false);
  assert.equal(again.log.length, 1);
});

test('AC4: agree → decline → agree is three distinct events and the last decision wins', () => {
  let log = [];
  for (const [d, u] of [['A', 42], ['R', 43], ['A', 44]]) log = appendDecision(log, tap(d, u, `cbq-${u}`)).log;
  assert.equal(new Set(log.map((r) => r.idem_key)).size, 3);
  assert.deepEqual(log.map((r) => r.decision), ['APPROVE', 'REJECT', 'APPROVE']);
  const current = currentDecisions(log);
  assert.equal(current.length, 1);
  assert.equal(current[0].decision, 'APPROVE');
  assert.equal(current[0].telegram_update_id, 44);
  // order of arrival does not matter: the latest Telegram update wins
  assert.equal(currentDecisions([log[2], log[0], log[1]])[0].decision, 'APPROVE');
});

test('AC3/AC4: a stale button is still refused and never reaches the log', () => {
  const p = parseCallback(callbackData(action.id, 'DEMO-001', 'A', '2026-04-14'), ctx);
  assert.equal(p.reason, 'STALE_BUTTON');
  assert.throws(() => decisionRow(p, { decidedAt: 'x', telegramUpdateId: 50, callbackQueryId: 'cbq-50' }), /REFUSED_STALE_BUTTON/);
});

test('invalid inputs cannot produce a button', () => {
  assert.throws(() => callbackData('abc', 'DEMO-001', 'A', '2026-04-15'), /BAD_ACTION_ID/);
  assert.throws(() => callbackData(1, 'DEMO-001', 'Z', '2026-04-15'), /BAD_DECISION/);
});
