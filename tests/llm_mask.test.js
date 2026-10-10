'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { maskFacts, loadConfig } = require('../llm/mask');
const { flatten, factLines } = require('../llm/facts');
const sample = () => JSON.parse(JSON.stringify(require('../examples/facts_example.json')));

test('product names are removed and SKU codes are kept', () => {
  const { facts, report } = maskFacts(sample());
  const text = JSON.stringify(facts);
  assert.doesNotMatch(text, /Eye cream|Крем для век|Sun stick|Глиняная/);
  assert.equal(facts.stock.critical[0].offer, 'DEMO-007');
  assert.ok(report.dropped.includes('stock.critical.0.name_ru'));
});

test('supplier prices and unit costs are dropped wherever they appear', () => {
  const facts = { today: '2026-04-15', sku: [{ offer: 'DEMO-001', cogs_ex_vat_rub: 321.5, supplier: 'Factory Ltd', supplier_price_usd: 4.8, landed_cost_rub: 512, price: 1990 }] };
  const { facts: masked, sensitive } = maskFacts(facts);
  assert.deepEqual(masked.sku[0], { offer: 'DEMO-001', price: 1990 });
  assert.ok(sensitive.strings.includes('Factory Ltd'));
  assert.ok(sensitive.numbers.includes(321.5) && sensitive.numbers.includes(512));
});

test('counterparty free text is redacted and cash is aggregated to thousands', () => {
  const { facts, sensitive } = maskFacts(sample());
  assert.equal(facts.cash.next_out.events, '[скрыто]');
  assert.equal(facts.cash.next_out.balance_before, 140000);
  assert.ok(sensitive.strings.some((s) => s.includes('Loan interest')));
  assert.ok(sensitive.numbers.includes(140100));
});

test('null stays null after masking (unknown is never turned into a value)', () => {
  const { facts } = maskFacts(sample());
  assert.equal(facts.ads.drr_pct, null);
  assert.equal(facts.ads.ppo_orders, null);
});

test('e-mails, phones, tax ids and bot tokens inside any string are replaced', () => {
  const facts = { note: 'call +7 (912) 345-67-89 or mail owner@example.com, INN 7701234567, token 123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
  const { facts: masked, report } = maskFacts(facts);
  assert.doesNotMatch(masked.note, /912|example\.com|7701234567|AAAA/);
  assert.deepEqual(report.patterns.map((p) => p.pattern).sort(), ['email', 'inn_or_account', 'phone', 'telegram_token']);
});

test('the prompt fact list built from masked facts contains no sensitive value', () => {
  const original = sample();
  const { facts, sensitive } = maskFacts(original);
  const prompt = factLines(flatten(facts)).join('\n');
  for (const s of sensitive.strings) assert.ok(!prompt.includes(s), s);
  assert.doesNotMatch(prompt, /= 140100$/m);
  assert.match(prompt, /^ads\.drr_pct = null$/m);
});

test('masking config is valid and every rule explains why', () => {
  const config = loadConfig();
  for (const r of config.rules) { assert.ok(['drop', 'redact', 'round'].includes(r.action)); assert.ok(r.why); }
});
