'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeAnswer, extractNumbers } = require('../llm/grader');
const { gradeAll, loadEval, loadCassette, DEFAULT_CASSETTE } = require('../llm/eval');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const bad = require('../llm/eval/bad_answers.json');
const handWritten = loadCassette(path.join(__dirname, '../llm/eval/fixtures/hand_written.json'));
const grokBot = loadCassette(DEFAULT_CASSETTE);

const ev = loadEval();
const grade = (answer, qid) => gradeAnswer(answer, { facts: ev.masked.facts, flat: ev.flat, sensitive: ev.masked.sensitive,
  expect: qid ? ev.golden.questions.find((q) => q.id === qid).expect : null });

test('number extraction reads Russian formatting and ignores dates, times, SKU codes and citations', () => {
  const nums = extractNumbers('15.04 07:15 DEMO-007 [факт: orders.8.u]: 112 577 ₽, 112,6 тыс. ₽, 2,8%, −1 538, 4278.05');
  assert.deepEqual(nums.map((n) => n.value), [112577, 112600, 2.8, -1538, 4278.05]);
});

test('eval set has 15 questions incl. «нет данных» and out-of-scope cases', () => {
  const types = ev.golden.questions.map((q) => q.expect.type);
  assert.equal(types.length, 15);
  assert.ok(types.filter((t) => t === 'missing').length >= 3);
  assert.ok(types.filter((t) => t === 'refuse').length >= 2);
});

test('hand-written positive fixtures pass the gate', () => {
  const results = gradeAll(handWritten.answers, ev);
  assert.deepEqual(results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.failed.join('; ')}`), []);
  assert.match(handWritten.warning, /NOT model outputs/);
});

test('the CI cassette is the Grok Bot recording and says it was not an API call', () => {
  assert.equal(grokBot.source, 'GROK_BOT');
  assert.match(grokBot.note, /not an API call/);
  assert.match(grokBot.recorded_at, /\+03:00$/);
  assert.equal(Object.keys(grokBot.answers).length, 15);
});

test('cassette loader rejects unknown and API-recorded sources and unlabelled recordings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cassette-'));
  const write = (obj) => { const f = path.join(dir, `${Math.random()}.json`); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  assert.throws(() => loadCassette(write({ source: 'MODEL', answers: {} })), /CASSETTE_UNKNOWN_SOURCE/);
  assert.throws(() => loadCassette(write({ source: 'LIVE', model: 'm', recorded_at: 'x', answers: {} })), /CASSETTE_UNKNOWN_SOURCE: LIVE/);
  assert.throws(() => loadCassette(write({ source: 'GROK_BOT', recorded_at: 'x', answers: {} })), /needs note/);
});

for (const c of bad.cases) {
  test(`grader rejects a deliberately bad answer: ${c.id}`, () => {
    const g = grade(c.answer, c.question);
    assert.equal(g.pass, false);
    assert.ok(g.failed.some((f) => f.id === c.fails), `expected ${c.fails}, got ${g.failed.map((f) => f.id).join(', ')}`);
  });
}

test('real zero is accepted when the cited fact is zero', () => {
  assert.equal(grade('DEMO-007 [факт: stock.critical.0.offer]: остаток 0 шт [факт: stock.critical.0.free].').pass, true);
});

test('runtime gate without golden expectations still blocks ungrounded numbers', () => {
  const g = grade('Вчера продали 500 шт [факт: orders.8.u].');
  assert.equal(g.pass, false);
  assert.ok(g.failed.some((f) => f.id === 'numbers_match_facts'));
});

test('saved Grok Bot prompts are exactly what the module builds from masked facts (no drift)', () => {
  const { buildMessages } = require('../llm/answer');
  for (const q of ev.golden.questions) {
    const saved = JSON.parse(fs.readFileSync(path.join(__dirname, `../llm/eval/grok_bot/prompts/${q.id}.json`), 'utf8'));
    assert.deepEqual(saved.messages, buildMessages(q.question, ev.masked.facts), q.id);
    assert.doesNotMatch(JSON.stringify(saved), /Крем для век|Eye cream|Loan interest|140100/);
  }
});
