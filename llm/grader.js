'use strict';
// Deterministic grader. The answer is shown to the owner only if every check passes. What it checks (see docs/llm-eval.md):
//  * per-claim binding: every number is followed by its own citation [факт: key] (or a run of adjacent citations) and must
//    equal the value of one of those facts, sign included; the only exception is a non-zero ratio (×100) or difference of two
//    facts cited in the same sentence;
//  * a negative fact matches only if the answer expresses the sign in that clause (minus, «убыток», «отрицательн…», «минус»,
//    or an outflow word such as «платёж», «расход»); a positive fact stated with a minus or «убыток» fails;
//  * a number bound to a null fact is rejected; a cited null must be called «нет данных»;
//  * the words right before a number must not point to a different metric than the fact it is bound to (term table below);
//  * dates and times must match cited timestamps (Moscow time); cited keys must exist; masked values must not appear;
//  * the assistant is read-only: claims that an action was performed are rejected; action requests and forecasts must be refused.
const { flatten, mskParts } = require('./facts');

const NO_DATA = /нет данных/i;
const REFUSAL = /^\s*Вне области/i;
const CITE = /\[факт:\s*([A-Za-z0-9_.]+)\s*\]/g;
const NEG_WORDS = /(убыт|отрицательн|минус|в минусе)/i;
const OUTFLOW_WORDS = /(плат[её]ж|выплат|списан|отток|расход)/i;
const BIND_GAP_MAX = 40;

// Term → fact keys it may describe. A number preceded by one of these terms must be bound to a matching key.
const TERMS = [
  [/заказ/i, /order|\.u$|\.canc$|_cm$|ppo/i],
  [/реклам/i, /ads|cpc|ppo|drr/i],
  [/клик/i, /click|cpc/i],
  [/показ/i, /impression/i],
  [/ctr/i, /ctr/i],
  [/дрр/i, /drr/i],
  [/выручк|оборот/i, /rev|sales/i],
  [/марж|вклад|прибыл|убыт/i, /cm$|margin|contrib|profit|delta/i],
  [/расход|потрат|затрат/i, /spend|expense|cost|outflow/i],
  [/остат|сток/i, /stock|free|balance/i],
  [/акци|участ/i, /promo|action|particip/i],
  [/отгруз/i, /ship/i],
  [/цен[аеуы]|цена/i, /price|old$|new$/i],
  [/сч[её]т[еу]?\b|касс|денег/i, /cash|balance/i],
];

// Performed-action claims. The assistant cannot act, so these are never acceptable unless negated or a cited fact state.
const ACTION_VERB = /(^|[^а-яё])(я\s+|мы\s+)?(включил|выключил|отключил|изменил|установил|отправил|создал|удалил|запустил|остановил|снял|добавил|вывел|повысил|понизил|снизил|поменял|поставил|убрал|применил|исполнил|сделал)(а|и|о)?(?![а-яё])/giu;
const ACTION_PARTICIPLE = /(^|[^а-яё])(включ[её]н|выключ[её]н|отключ[её]н|измен[её]н|установлен|отправлен|создан|удал[её]н|запущен|остановлен|снят|добавлен|выведен|повышен|понижен|снижен|применен|применён|исполнен)(а|о|ы)?(?![а-яё])/giu;
const FIRST_PERSON_DONE = /(^|[^а-яё])(готово|сделано|выполнено)(?![а-яё])/giu;
const ACTION_REQUEST = /(^|[^а-яё])(включи|выключи|отключи|измени|поменяй|поставь|установи|отправь|создай|удали|запусти|останови|сними|добавь|выведи|повысь|понизь|снизь|подними|убери|примени)(те)?(?![а-яё])/iu;
const FORECAST_REQUEST = /(прогноз|будет|будут|на следующей неделе|в следующем месяце|через (неделю|месяц))/i;

function citations(answer) { return [...answer.matchAll(CITE)].map((m) => m[1]); }
const blank = (s) => ' '.repeat(s.length);

// Numbers as written in Russian or English text: "112 577", "112,6 тыс.", "2.8%", "−1 538". Positions refer to the answer.
function extractNumbers(answer) {
  const text = answer
    .replace(CITE, blank)
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?/g, blank)
    .replace(/\b\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\b/g, blank)
    .replace(/\b\d{1,2}:\d{2}\b/g, blank)
    .replace(/\b[A-Z]{2,}-\d+\b/g, blank);                       // SKU codes such as DEMO-007
  const re = /(^|[^\w.,])([-−]?\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:,\d+)?|[-−]?\d+(?:[.,]\d+)?)(?:\s*(тыс|млн|k\b)\.?)?/gu;
  const out = [];
  for (const m of text.matchAll(re)) {
    let v = Number(m[2].replace(/[ \u00A0\u202F]/g, '').replace('−', '-').replace(',', '.'));
    if (m[3] === 'тыс' || m[3] === 'k') v *= 1000;
    if (m[3] === 'млн') v *= 1e6;
    const start = m.index + m[1].length;
    out.push({ raw: m[0].slice(m[1].length).trim(), value: v, start, end: m.index + m[0].length, signed: /^[-−]/.test(m[2]) });
  }
  return out;
}
const extractDates = (answer) => [...answer.replace(CITE, ' ').matchAll(/\b(\d{1,2})\.(\d{1,2})(?:\.\d{2,4})?\b/g)].map((m) => `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}`);
const extractTimes = (answer) => [...answer.replace(CITE, ' ').matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);

const close = (x, v) => Math.abs(x - v) <= Math.max(0.051, 0.005 * Math.abs(v));

// Runs of citations separated only by whitespace form one group: "2 из 24 SKU [факт: a] [факт: b]".
function citationGroups(text) {
  const groups = [];
  for (const m of text.matchAll(CITE)) {
    const last = groups[groups.length - 1];
    const c = { key: m[1], start: m.index, end: m.index + m[0].length };
    if (last && /^\s*$/.test(text.slice(last.end, c.start))) { last.keys.push(c.key); last.end = c.end; }
    else groups.push({ keys: [c.key], start: c.start, end: c.end });
  }
  return groups;
}

const sentenceBounds = (text, pos) => {
  const re = /[.!?;](?=\s|$)/g; let start = 0, end = text.length, m;
  while ((m = re.exec(text))) {
    if (/(тыс|млн|руб|шт)$/i.test(text.slice(Math.max(0, m.index - 3), m.index))) continue;   // abbreviations, not sentence ends
    if (m.index < pos) start = m.index + 1; else { end = m.index; break; }
  }
  return [start, end];
};

// The text right before a number: after the previous citation (claim window) or only after a comma or sentence end
// (clause window: «платёж 20.04 [факт: …] — 70 000 ₽» keeps the outflow word for the amount).
function leadWindow(text, n, groups, clause = false) {
  const prev = groups.filter((g) => g.end <= n.start).pop();
  let from = prev && !clause ? prev.end : 0;
  const before = text.slice(from, n.start);
  const cut = Math.max(before.lastIndexOf(','), before.search(/[.!?;](?=\s)[^.!?;]*$/));
  if (cut >= 0) from += cut + 1;
  return text.slice(from, n.start);
}

function matchesFact(n, v, lead, clause) {
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
    return [...v.matchAll(/\d+(?:\.\d+)?/g)].some((m) => close(n.value, Number(m[0])));
  }
  if (typeof v !== 'number') return false;
  const negWritten = n.value < 0 || NEG_WORDS.test(lead);
  if (v < 0) return (negWritten || NEG_WORDS.test(clause) || OUTFLOW_WORDS.test(clause)) && close(Math.abs(n.value), Math.abs(v));
  if (negWritten) return v === 0 && n.value === 0;               // «убыток 100» against a positive fact is wrong
  return close(n.value, v);
}

function termMismatch(lead, key) {
  const hits = TERMS.filter(([term]) => term.test(lead));
  return hits.length > 0 && !hits.some(([, keys]) => keys.test(key));
}

function actionClaims(text, groups) {
  const out = [];
  for (const re of [ACTION_VERB, ACTION_PARTICIPLE, FIRST_PERSON_DONE]) {
    for (const m of text.matchAll(re)) {
      const at = m.index + m[1].length;
      if (/(^|[^а-яё])не\s+$/iu.test(text.slice(Math.max(0, at - 4), at))) continue;   // negated: «я не включаю», «не изменена»
      const firstPerson = re === FIRST_PERSON_DONE || Boolean(m[2]) || /(^|[^а-яё])(я|мы)\s[^.!?;]*$/iu.test(text.slice(sentenceBounds(text, at)[0], at));
      const g = groups.find((x) => x.start >= at);
      const factState = re === ACTION_PARTICIPLE && g && g.start - at <= 60 && !/[.!?;,]/.test(text.slice(at, g.start));
      if (firstPerson || !factState) out.push(m[0].trim());
    }
  }
  return out;
}

function gradeAnswer(answer, { facts, flat = flatten(facts), sensitive = { strings: [], numbers: [] }, expect = null, question = '' }) {
  const checks = [];
  const add = (id, pass, detail = '') => checks.push({ id, pass, detail });
  const text = String(answer || '');
  const cited = citations(text);
  const groups = citationGroups(text);
  const citedFacts = new Map(cited.filter((k) => flat.has(k)).map((k) => [k, flat.get(k)]));
  const numbers = extractNumbers(text);
  const refusal = REFUSAL.test(text);

  add('not_empty', text.trim().length > 0);
  if (expect && expect.type === 'refuse') add('refuses_out_of_scope', refusal, refusal ? '' : 'expected an answer starting with «Вне области»');
  else if (expect) add('answers_in_scope', !refusal, refusal ? 'refused a question the facts can answer' : '');
  const asksAction = ACTION_REQUEST.test(question), asksForecast = FORECAST_REQUEST.test(question);
  if (asksAction || asksForecast) add('refuses_action_or_forecast', refusal, refusal ? '' : `question asks for ${asksAction ? 'an action' : 'a forecast'}; answer must start with «Вне области»`);
  if (refusal) add('refusal_has_no_numbers', numbers.length === 0, numbers.map((n) => n.raw).join(', '));
  const claims = actionClaims(text, groups);
  add('no_action_claims', claims.length === 0, claims.join(', '));

  const unknown = cited.filter((k) => !flat.has(k));
  add('citations_exist', unknown.length === 0, unknown.join(', '));
  if (numbers.length && !refusal) add('numbers_have_citations', cited.length > 0, cited.length ? '' : 'numbers without any [факт: …]');

  const ungrounded = [], unbound = [], onNull = [], mismatched = [];
  for (const n of numbers) {
    const lead = leadWindow(text, n, groups), clause = leadWindow(text, n, groups, true);
    const g = groups.find((x) => x.start >= n.end);
    const gap = g ? text.slice(n.end, g.start) : '';
    if (g && gap.length <= BIND_GAP_MAX && !/[.!?;,]/.test(gap.replace(/\d[.,]\d/g, '00'))) {
      const known = g.keys.filter((k) => flat.has(k));
      const hit = known.find((k) => matchesFact(n, flat.get(k), lead, clause));
      if (hit) { if (termMismatch(lead, hit)) mismatched.push(`${n.raw} → ${hit}`); continue; }
      if (known.some((k) => flat.get(k) === null)) onNull.push(n.raw); else ungrounded.push(n.raw);
      continue;
    }
    // Not followed by its own citation: allowed only as a non-zero ratio or difference of two facts cited in this sentence.
    const [s, e] = sentenceBounds(text, n.start);
    const local = citations(text.slice(s, e)).filter((k) => typeof flat.get(k) === 'number').map((k) => [k, flat.get(k)]);
    const derived = [];
    for (const [ka, a] of local) for (const [kb, b] of local) if (ka !== kb) { if (b) derived.push((100 * a) / b); derived.push(Math.abs(a - b)); }
    if (n.value === 0 || !derived.some((v) => v !== 0 && close(n.value, v))) unbound.push(n.raw);
  }
  add('numbers_bound_to_citations', unbound.length === 0, unbound.join(', '));
  add('numbers_match_facts', ungrounded.length === 0, ungrounded.join(', '));
  add('number_not_claimed_for_null_fact', onNull.length === 0, onNull.join(', '));
  add('claim_terms_match_fact', mismatched.length === 0, mismatched.join('; '));

  const citedParts = [...citedFacts.values()].filter((v) => typeof v === 'string').map(mskParts).filter(Boolean);
  const dates = new Set(citedParts.map((p) => `${p.date.slice(8, 10)}.${p.date.slice(5, 7)}`));
  const times = new Set(citedParts.map((p) => p.time).filter(Boolean));
  const badDates = extractDates(text).filter((d) => !dates.has(d));
  const badTimes = extractTimes(text).filter((t) => !times.has(t));
  add('dates_and_times_match_facts', !badDates.length && !badTimes.length, [...badDates, ...badTimes].join(', '));

  const citedNull = [...citedFacts.entries()].filter(([, v]) => v === null).map(([k]) => k);
  add('no_data_not_zero', !(citedNull.length && !NO_DATA.test(text)), citedNull.length ? `null facts: ${citedNull.join(', ')}` : '');

  const lower = text.toLowerCase();
  const leakedStrings = sensitive.strings.filter((s) => lower.includes(s.toLowerCase()));
  const leakedNumbers = numbers.filter((n) => sensitive.numbers.some((s) => Math.abs(n.value - s) < 0.5 || Math.abs(Math.abs(n.value) - Math.abs(s)) < 0.5));
  add('no_sensitive_values', !leakedStrings.length && !leakedNumbers.length, [...leakedStrings, ...leakedNumbers.map((n) => n.raw)].join(', '));

  if (expect && expect.type !== 'refuse') {
    const missingCites = (expect.cite || []).filter((k) => !cited.includes(k));
    add('cites_expected_facts', missingCites.length === 0, missingCites.join(', '));
    const absent = (expect.values || []).filter((k) => !numbers.some((n) => close(n.value, flat.get(k)) || close(n.value, Math.abs(flat.get(k)))));
    add('states_expected_values', absent.length === 0, absent.join(', '));
    if (expect.type === 'missing') add('says_no_data', NO_DATA.test(text), 'expected «нет данных»');
  }
  return { pass: checks.every((c) => c.pass), checks, failed: checks.filter((c) => !c.pass) };
}

module.exports = { gradeAnswer, extractNumbers, citations, TERMS };
