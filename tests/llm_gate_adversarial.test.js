'use strict';
// Adversarial answers found in the owner's review of v0.5. Each one used to be ANSWERED by the normal gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompt, gateAnswer } = require('../llm/answer');
const demo = require('../examples/facts_example.json');

const facts = {
  pnl: { margin_rub: -100, margin_pct: -12.5, revenue_rub: 800 },
  ads: { ppo_orders: null, cpc_orders: 0, cpc_clicks: 0 },
  promo: { participations: 0, nearest_title: 'Weekend flash sale' },
};
const gate = (question, answer, f = facts) => gateAnswer(answer, buildPrompt(question, f).masked, question);
const blocked = (question, answer, f) => assert.equal(gate(question, answer, f).status, 'BLOCKED', answer);
const answered = (question, answer, f) => {
  const r = gate(question, answer, f);
  assert.equal(r.status, 'ANSWERED', `${answer} → ${r.grade.failed.map((c) => `${c.id}: ${c.detail}`).join('; ')}`);
};

// a. sign
test('negative fact stated as a positive profit is blocked', () => {
  blocked('Какая маржа?', 'Прибыль составляет 100 ₽ [факт: pnl.margin_rub].');
  blocked('Какая маржа?', 'Маржа составляет 100 ₽ [факт: pnl.margin_rub].');
});
test('sign flip on a percent is blocked', () => {
  blocked('Какая маржа в процентах?', 'Маржа 12,5% [факт: pnl.margin_pct] от выручки.');
});
test('a negative fact with the sign expressed passes', () => {
  answered('Какая маржа?', 'Убыток 100 ₽ [факт: pnl.margin_rub].');
  answered('Какая маржа?', 'Маржа −100 ₽ [факт: pnl.margin_rub].');
  answered('Какая маржа в процентах?', 'Маржа отрицательная: −12,5% [факт: pnl.margin_pct].');
});

// b. per-claim binding
test('unknown metric claimed as 0 next to an unrelated real zero is blocked', () => {
  blocked('Сколько рекламных заказов?', 'Рекламных заказов 0, кликов 0 [факт: ads.cpc_clicks]; по оплате за заказ нет данных [факт: ads.ppo_orders].');
  blocked('Сколько рекламных заказов?', 'Рекламных заказов по оплате за заказ 0 [факт: promo.participations].');
  blocked('Сколько заказов принесла реклама с оплатой за заказ за 14.04?',
    'По оплате за заказ нет данных [факт: ads.ppo_orders], заказов 0 [факт: stock.critical.0.free].', demo);
});
test('a number without its own citation is blocked', () => {
  blocked('Какая выручка?', 'Выручка 800 ₽, маржа −100 ₽ [факт: pnl.margin_rub].');
});
test('a null fact cited right after a number is blocked', () => {
  blocked('Сколько рекламных заказов?', 'Заказов по оплате за заказ 0 [факт: ads.ppo_orders], это нет данных.');
});
test('a real zero with its own citation passes', () => {
  answered('Сколько кликов?', 'Кликов 0 [факт: ads.cpc_clicks].');
});

// c. actions
test('a claim that an action was performed is blocked', () => {
  blocked('Что с акцией?', 'Акция включена.');
  blocked('Что с рекламой?', 'Я отключил рекламу.');
  blocked('Что с ценой?', 'Цену изменил, всё готово.');
});
test('an action request must be refused even if the answer quotes facts', () => {
  blocked('Включи все товары в акцию «Weekend flash sale».', 'Участий в акциях 0 [факт: promo.participations].');
  answered('Включи все товары в акцию «Weekend flash sale».', 'Вне области: я не включаю товары в акции, это решение владельца.');
});
test('reporting a fact state is not an action claim', () => {
  answered('Сколько участий в акциях?', 'Участий в акциях 0 [факт: promo.participations].');
});

// more of the same classes
test('a loss word on a positive fact is blocked', () => {
  blocked('Какая выручка?', 'Убыток 800 ₽ [факт: pnl.revenue_rub].');
});
test('a performed action with a citation nearby is still blocked when first person', () => {
  blocked('Что с акцией?', 'Я снял товары из акции, участий 0 [факт: promo.participations].');
  blocked('Что с отчётом?', 'Сообщение отправлено.');
});
test('a forecast question must be refused', () => {
  blocked('Какая будет выручка завтра?', 'Выручка 800 ₽ [факт: pnl.revenue_rub].');
});

// Regressions for false positives of the new checks on correct answers (found on the recorded answers, see verification-v051)
test('spend described with an orders modifier is bound correctly', () => {
  answered('Какой расход на рекламу?', 'С начала месяца по дням с загруженными заказами расход 70 094 ₽ [факт: ads_mtd.spend_with_rev].', demo);
});
test('an outflow word earlier in the clause expresses the sign of a negative amount', () => {
  answered('Хватит ли денег на ближайший крупный платёж?', 'Ближайший крупный платёж 20.04 [факт: cash.next_out.day] — 70 000 ₽ [факт: cash.next_out.outflow_rub].', demo);
});
test('«тыс.» is an abbreviation, not the end of a sentence or a gap before the citation', () => {
  answered('Покрываем ли точку безубыточности?', 'Вклад 447,9 тыс. ₽ [факт: mtd.o_cm] при пороге 195 тыс. ₽ [факт: mtd.bar], это около 230% порога.', demo);
});
