#!/usr/bin/env node
'use strict';
// Owner Q&A over v_report_facts: mask -> prompt -> Grok Bot answers -> deterministic gate -> answer or block.
// The AI layer is the owner's Grok Bot desktop assistant (connected to Neon and n8n); there is no model API client here.
// The model never computes the business numbers; SQL does. The model only phrases facts and must cite them.
//   node llm/answer.js prompt "<question>" [facts.json]          print the exact prompt (system + MASKED facts) for Grok Bot
//   node llm/answer.js check  "<question>" <answer.txt> [facts.json]   gate an answer: exit 0 = show it, 1 = blocked
const fs = require('node:fs');
const path = require('node:path');
const { maskFacts, loadConfig } = require('./mask');
const { flatten, factLines } = require('./facts');
const { gradeAnswer } = require('./grader');

const DEFAULT_FACTS = path.resolve(__dirname, '..', 'examples', 'facts_example.json');

const SYSTEM_PROMPT = [
  'Ты — интерфейс владельца бизнеса к фактам утреннего отчёта. Отвечай по-русски, 1–3 предложения.',
  'Используй ТОЛЬКО факты из списка «путь = значение». Ничего не придумывай и не считай, кроме доли или разности двух фактов.',
  'После каждого числа или даты ставь ссылку на факт в виде [факт: путь], например [факт: orders.8.u].',
  'Если значение null или нужного факта нет — пиши «нет данных». Никогда не заменяй отсутствие данных нулём.',
  'Время в фактах — московское; даты пиши как ДД.ММ.',
  'Если вопрос не про эти факты, просит прогноз или действие (включить акцию, изменить цену, отправить сообщение) — начни ответ словами «Вне области:» и не приводи чисел.',
  'Значение [скрыто] не раскрывай и не угадывай. Товары называй только кодами SKU.',
].join('\n');

function buildMessages(question, maskedFacts) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Факты (путь = значение):\n${factLines(flatten(maskedFacts)).join('\n')}\n\nВопрос: ${question}` },
  ];
}

// Only masked facts ever reach the prompt: product names -> SKU codes, costs and counterparties dropped, cash rounded.
function buildPrompt(question, facts, config = loadConfig()) {
  const masked = maskFacts(facts, config);
  return { messages: buildMessages(question, masked.facts), masked };
}

// The gate: an answer is shown only if every number, date and time matches the cited SQL facts.
// The question is part of the gate: action requests and forecasts must be refused, whatever the answer says.
function gateAnswer(raw, masked, question = '') {
  const grade = gradeAnswer(raw, { facts: masked.facts, sensitive: masked.sensitive, question });
  if (grade.pass) return { status: 'ANSWERED', text: raw, raw, grade };
  const reasons = grade.failed.map((c) => c.id).join(', ');
  return { status: 'BLOCKED', raw, grade, text: `Ответ не прошёл проверку по фактам SQL и не показан (${reasons}). Смотрите утренний отчёт.` };
}

function main(argv) {
  const [cmd, question, ...rest] = argv;
  if (cmd === 'prompt' && question) {
    const facts = JSON.parse(fs.readFileSync(rest[0] || DEFAULT_FACTS, 'utf8'));
    for (const m of buildPrompt(question, facts).messages) console.log(`--- ${m.role} ---\n${m.content}`);
    return 0;
  }
  if (cmd === 'check' && question && rest[0]) {
    const facts = JSON.parse(fs.readFileSync(rest[1] || DEFAULT_FACTS, 'utf8'));
    const r = gateAnswer(fs.readFileSync(rest[0], 'utf8').trim(), buildPrompt(question, facts).masked, question);
    console.log(`${r.status}: ${r.text}`);
    return r.status === 'ANSWERED' ? 0 : 1;
  }
  console.error('usage: node llm/answer.js prompt "<question>" [facts.json] | check "<question>" <answer.txt> [facts.json]');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { SYSTEM_PROMPT, buildMessages, buildPrompt, gateAnswer };
