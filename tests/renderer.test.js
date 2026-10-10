'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderReport } = require('../scripts/render_report.js');
const root = path.resolve(__dirname, '..');
const sample = () => JSON.parse(fs.readFileSync(path.join(root, 'examples/facts_example.json'), 'utf8'));
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'workflows/daily_report_0900.json'), 'utf8'));
function build(facts, triggerType = 'SCHEDULED') {
  const ctx = { todayMsk: '2026-04-15', triggerType };
  const lookup = name => ({ first: () => ({ json: name === 'Prepare Report' ? ctx : { j: facts } }) });
  const code = workflow.nodes.find(n => n.name === 'Build Report Message').parameters.jsCode;
  return new Function('$', code)(lookup)[0].json;
}
function maySend(report) {
  const gate = workflow.nodes.find(n => n.name === 'IF Live Send Allowed');
  assert.ok(gate, 'The real workflow live-send gate must exist');
  const expression = gate.parameters.conditions.conditions[0].leftValue.slice(3, -2);
  return new Function('$json', `return (${expression});`)(report);
}
test('dry-run report explicitly says it was not sent', () => {
  assert.match(renderReport(sample(), { lang: 'en', mode: 'DRY_RUN' }).text, /draft, not sent to Telegram/);
});
test('stale orders show the missing target day and the actual loaded day', () => {
  assert.match(renderReport(sample(), { lang: 'en' }).text, /no data for 14.04; last loaded day 13.04/);
});
test('timestamps are shown in Moscow time whatever offset the database session used', () => {
  const utc = sample();
  utc.prices.cap = '2026-04-15T05:48:41+00:00';
  utc.stock.cap = '2026-04-15T04:15:59Z';
  utc.promo.measured_at = '2026-04-15 05:41:31+00';
  utc.orders[utc.orders.length - 1].loaded_at = '2026-04-14T02:30:59+00:00';
  const msk = renderReport(sample(), { lang: 'en' }).text;
  assert.equal(renderReport(utc, { lang: 'en' }).text, msk);
  assert.match(msk, /snapshot 15\.04 08:48/);
  assert.match(msk, /FBO stock 15\.04 07:15/);
  assert.match(msk, /loaded 14\.04 05:30/);
});
test('a UTC timestamp just before midnight belongs to the next Moscow day', () => {
  const f = sample();
  f.stock.d = '2026-04-15'; f.stock.cap = '2026-04-14T22:10:00Z';
  assert.match(renderReport(f, { lang: 'en' }).text, /FBO stock 15\.04 01:10/);
});
test('missing PPO report remains unknown, not zero orders', () => {
  assert.match(renderReport(sample(), { lang: 'en' }).text, /orders from this model are unknown \(not zero\)/);
});
test('empty facts give missing sections, not fictitious sales', () => {
  const text = renderReport({ today: '2026-04-15' }, { lang: 'en' }).text;
  assert.match(text, /No day row — margin not computed/);
  assert.match(text, /FBO stock — no snapshots/);
  assert.doesNotMatch(text, /NaN|undefined|Infinity/);
});
test('real zero orders are shown as zero, rather than missing', () => {
  const text = renderReport({ today: '2026-04-15', orders: [{ d: '2026-04-14', u: 0, rev: 0, canc: 0, cm: 0, cm_buyout: 0, ads: 0 }] }, { lang: 'en' }).text;
  assert.match(text, /0 units, 0 k RUB/);
});
test('null contribution must not be rendered as zero margin or zero coverage', () => {
  const f = sample(); f.orders.at(-1).cm = null; f.orders.at(-1).cm_buyout = null;
  const text = renderReport(f, { lang: 'en' }).text;
  assert.match(text, /Order contribution is not computed/);
  assert.doesNotMatch(text, /by orders: 0%/);
});
test('model and realised values have separate labels, never a combined total', () => {
  const text = renderReport(sample(), { lang: 'en' }).text;
  assert.match(text, /two different numbers — never added up/);
  assert.match(text, /actual marketplace charges, COGS and VAT by model/);
});
test('incomplete month contribution does not become zero coverage', () => {
  const f = sample(); f.mtd.o_cm = null;
  const text = renderReport(f, { lang: 'en' }).text;
  assert.doesNotMatch(text, /Month to date .*by orders: 0%/);
  assert.match(text, /Month-to-date coverage is unavailable/);
});
test('missing realised month contribution is not shown as zero', () => {
  const f = sample(); f.mtd.r_cm = null;
  const text = renderReport(f, { lang: 'en' }).text;
  assert.doesNotMatch(text, /by realised accruals \(12 days\) 0%/);
});
test('malformed contribution is missing rather than NaN', () => {
  const f = sample(); f.orders.at(-1).cm = 'not-a-number';
  const text = renderReport(f, { lang: 'en' }).text;
  assert.match(text, /Order contribution is not computed/);
  assert.doesNotMatch(text, /NaN/);
});
test('loaded accruals with missing contribution are not called unloaded', () => {
  const f = sample();
  for (const row of f.orders) { row.realised_state = 'REALISED_PRESENT'; row.r_cm = null; }
  const text = renderReport(f, { lang: 'en' }).text;
  assert.match(text, /Accruals are loaded/);
  assert.doesNotMatch(text, /accruals .*not loaded yet|No accruals yet/);
});
test('unknown PPO spend and month ads do not become zero or an invented missing-orders reason', () => {
  const f = sample(); f.ads.ppo_status = 'OK'; f.ads.ppo_spend_expense_rub = null;
  f.ads.drr_pct = null; f.ads.shop_order_revenue_rub = 1000;
  f.ads_mtd.spend = null; f.ads_mtd.spend_with_rev = null;
  const text = renderReport(f, { lang: 'en' }).text;
  assert.match(text, /Pay-per-order: unknown/);
  assert.doesNotMatch(text, /Month to date: 0k RUB|ACoS 0%|orders of that day are not loaded/);
});
for (const [status, value, trigger, expected] of [
  ['DRAFT', 1, 'SCHEDULED', false], ['OWNER_STATED', 1, 'SCHEDULED', false],
  ['OWNER_ACCEPTED', 0, 'SCHEDULED', false], ['OWNER_ACCEPTED', 1, 'MANUAL', false],
  ['OWNER_ACCEPTED', 1, 'SCHEDULED', true],
]) test(`send gate: ${status}/${value}/${trigger} => ${expected}`, () => {
  const f = sample(); f.live_send = { status, value };
  assert.equal(maySend(build(f, trigger)), expected);
});
test('live gate refuses oversized, empty and internal-error messages', () => {
  const r = build({ ...sample(), live_send: { status: 'OWNER_ACCEPTED', value: 1 } });
  for (const replyText of [' ', 'x'.repeat(4097)]) assert.equal(maySend({ ...r, replyText }), false);
  assert.equal(maySend({ ...r, forbiddenWords: true }), false);
});
test('an oversized protected line blocks live delivery rather than discarding caveats', () => {
  const f = sample(); f.promo.nearest_title = 'x'.repeat(8000); f.live_send = { status: 'OWNER_ACCEPTED', value: 1 };
  assert.equal(maySend(build(f)), false);
});
