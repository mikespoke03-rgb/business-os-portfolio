'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPrompt, gateAnswer } = require('../llm/answer');
const facts = require('../examples/facts_example.json');

test('the prompt for Grok Bot carries masked facts only', () => {
  const sent = JSON.stringify(buildPrompt('Какой товар закончился?', facts).messages);
  assert.doesNotMatch(sent, /Крем для век|Eye cream|Loan interest|140100/);
  assert.match(sent, /stock\.critical\.0\.offer = \\"DEMO-007\\"/);
});

test('a grounded answer is shown', () => {
  const { masked } = buildPrompt('Какой товар закончился?', facts);
  assert.equal(gateAnswer('DEMO-007 [факт: stock.critical.0.offer]: остаток 0 шт [факт: stock.critical.0.free].', masked).status, 'ANSWERED');
});

test('an answer that turns «нет данных» into 0 is blocked, not shown', () => {
  const { masked } = buildPrompt('Какой ДРР за 14.04?', facts);
  const r = gateAnswer('ДРР за 14.04 [факт: ads.stat_day] — 0% [факт: ads.drr_pct].', masked);
  assert.equal(r.status, 'BLOCKED');
  assert.match(r.text, /не прошёл проверку/);
  assert.doesNotMatch(r.text, /0%/);
});

test('CLI: prompt prints masked facts; check exits 1 on a blocked answer', () => {
  const cli = path.join(__dirname, '../llm/answer.js');
  const out = execFileSync(process.execPath, [cli, 'prompt', 'Какой товар закончился?'], { encoding: 'utf8' });
  assert.match(out, /--- system ---/);
  assert.doesNotMatch(out, /Крем для век|Eye cream/);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ans-')), 'a.txt');
  fs.writeFileSync(f, 'ДРР за 14.04 [факт: ads.stat_day] — 0% [факт: ads.drr_pct].');
  assert.throws(() => execFileSync(process.execPath, [cli, 'check', 'Какой ДРР за 14.04?', f], { encoding: 'utf8' }), (e) => e.status === 1 && /BLOCKED/.test(e.stdout));
});
