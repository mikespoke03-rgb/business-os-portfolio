#!/usr/bin/env node
'use strict';
// Owner Q&A eval gate.
//   node llm/eval.js                     replay the default cassette llm/eval/cassettes/grok_bot.json (no API key, used in CI)
//   node llm/eval.js --cassette <file>   replay another cassette (e.g. llm/eval/fixtures/hand_written.json)
//   node llm/eval.js --json out.json     also write per-question results (used by the static site)
// The AI layer is the owner's Grok Bot desktop assistant (connected to Neon and n8n); there is no model API client.
// Cassette sources: GROK_BOT (answers recorded via Grok Bot, not an API call),
// HAND_WRITTEN_FIXTURE (written by hand; grader tests only).
const fs = require('node:fs');
const path = require('node:path');
const { maskFacts, loadConfig } = require('./mask');
const { flatten } = require('./facts');
const { gradeAnswer } = require('./grader');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, 'eval', 'golden.json');
const DEFAULT_CASSETTE = path.join(__dirname, 'eval', 'cassettes', 'grok_bot.json');
const SOURCES = {
  GROK_BOT: { label: 'Grok Bot (desktop assistant, not an API call)', requires: ['note', 'recorded_at'] },
  HAND_WRITTEN_FIXTURE: { label: 'hand-written fixture, not model output', requires: ['warning'] },
};

function loadCassette(file = DEFAULT_CASSETTE) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const spec = SOURCES[c.source];
  if (!spec) throw new Error(`CASSETTE_UNKNOWN_SOURCE: ${c.source}`);
  const missing = spec.requires.filter((k) => !c[k]);
  if (missing.length) throw new Error(`CASSETTE_INCOMPLETE: ${c.source} needs ${missing.join(', ')}`);
  if (!c.answers || typeof c.answers !== 'object') throw new Error('CASSETTE_INCOMPLETE: answers');
  return { ...c, label: spec.label };
}

function loadEval() {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const facts = JSON.parse(fs.readFileSync(path.join(ROOT, golden.facts), 'utf8'));
  const masked = maskFacts(facts, loadConfig());
  return { golden, masked, flat: flatten(masked.facts) };
}

function gradeAll(answers, { golden, masked, flat } = loadEval()) {
  return golden.questions.map((q) => {
    const answer = answers[q.id];
    if (typeof answer !== 'string') return { id: q.id, question: q.question, type: q.expect.type, answer: null, pass: false, failed: ['no_recorded_answer'] };
    const g = gradeAnswer(answer, { facts: masked.facts, flat, sensitive: masked.sensitive, expect: q.expect, question: q.question });
    return { id: q.id, question: q.question, type: q.expect.type, answer, pass: g.pass, failed: g.failed.map((c) => (c.detail ? `${c.id}: ${c.detail}` : c.id)) };
  });
}

function main(argv) {
  const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
  const file = argv.includes('--cassette') ? path.resolve(argv[argv.indexOf('--cassette') + 1]) : DEFAULT_CASSETTE;
  const cassette = loadCassette(file);
  const results = gradeAll(cassette.answers);
  const passed = results.filter((r) => r.pass).length;
  console.log(`Owner Q&A eval · answers: ${cassette.source} — ${cassette.label}${cassette.recorded_at ? ` · ${cassette.recorded_at}` : ''}`);
  if (cassette.source === 'HAND_WRITTEN_FIXTURE') console.log('NOTE: hand-written fixtures, not model outputs. This checks the grader and format, not a model.');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} [${r.type}] ${r.question}${r.pass ? '' : `\n     ${r.failed.join('; ')}`}`);
  console.log(`EVAL_${passed === results.length ? 'PASS' : 'FAIL'}: ${passed}/${results.length}`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ source: cassette.source, label: cassette.label, recorded_at: cassette.recorded_at, passed, total: results.length, results }, null, 2) + '\n', 'utf8');
  return passed === results.length ? 0 : 1;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(String(e.message || e)); process.exit(2); }
}
module.exports = { gradeAll, loadEval, loadCassette, main, DEFAULT_CASSETTE, SOURCES };
