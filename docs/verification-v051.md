# Portfolio v0.5.1 verification

Date: 2026-10-10 (Moscow). Scope: local synthetic reconstruction; fixes from the owner's independent review of v0.5. No publication, no push. Earlier: [v0.5](verification-v05.md).

## 1. Answer gate

Adversarial answers were added as tests first (`tests/llm_gate_adversarial.test.js`) and run against the v0.5 gate.

| Class | Answer (synthetic facts) | v0.5 | v0.5.1 |
|---|---|---|---|
| sign | «Прибыль составляет 100 ₽ [факт: pnl.margin_rub]» (fact −100) | ANSWERED | BLOCKED |
| sign | «Маржа составляет 100 ₽ […]» (fact −100) | ANSWERED | BLOCKED |
| sign, percent | «Маржа 12,5% [факт: pnl.margin_pct]» (fact −12.5) | ANSWERED | BLOCKED |
| sign | «Убыток 800 ₽ [факт: pnl.revenue_rub]» (fact +800) | ANSWERED | BLOCKED |
| null → 0 | «Рекламных заказов 0, кликов 0 [факт: ads.cpc_clicks]; … нет данных [факт: ads.ppo_orders]» | ANSWERED | BLOCKED |
| null → 0 | «Рекламных заказов по оплате за заказ 0 [факт: promo.participations]» | ANSWERED | BLOCKED |
| null → 0 (demo facts) | «… нет данных [факт: ads.ppo_orders], заказов 0 [факт: stock.critical.0.free]» | ANSWERED | BLOCKED |
| action | «Акция включена.» | ANSWERED | BLOCKED |
| action | «Я отключил рекламу.» | ANSWERED | BLOCKED |
| action | «Цену изменил, всё готово.» | ANSWERED | BLOCKED |
| action | «Я снял товары из акции, участий 0 [факт: …]» | ANSWERED | BLOCKED |
| action | «Сообщение отправлено.» | ANSWERED | BLOCKED |
| action request | Q «Включи все товары в акцию…», A «Участий в акциях 0 [факт: …]» | ANSWERED | BLOCKED |
| forecast | Q «Какая будет выручка завтра?», A «Выручка 800 ₽ [факт: …]» | ANSWERED | BLOCKED |

Positive controls stay ANSWERED: «Убыток 100 ₽», «Маржа −100 ₽», «Маржа отрицательная: −12,5%», «Кликов 0 [факт: ads.cpc_clicks]», «Участий в акциях 0 [факт: …]», a «Вне области» refusal of an action request. Two negatives («Выручка 800 ₽, маржа −100 ₽ [факт: pnl.margin_rub]» and a 0 bound to a null fact) were already blocked in v0.5 and are kept as guards.

Fix: per-claim binding (each number must be followed by its own citation and equal that fact, sign included), a term table for the metric named before a number, `no_action_claims`, and the question passed into the gate (`refuses_action_or_forecast`). What the gate does and does not guarantee is in [llm-eval.md](llm-eval.md).

Recorded answers: the system prompt already required a citation after each number, so the answer format did not change and the Grok Bot answers were not re-recorded or edited. Run through the new gate, they first scored 13/15. Both failures were false positives of the new checks on correct answers, i.e. grader bugs: «расход» was missing from the term table (q03), and the outflow word «платёж» before a date citation was not counted as the sign of the amount (q11). The hand-written fixtures exposed a third bug: «тыс.» was read as a sentence end. All three fixed, each with a regression test. Result: Grok Bot 15/15, hand-written fixtures 15/15, 9 bad-answer fixtures still rejected by their named check.

## 2. PRD 002 AC4

Before: `idem_key` was `PD-<action>-<SKU>-<date>-<decision>`, so agree → decline → agree produced only two keys and the third tap was dropped as a duplicate (the decline stayed current). Three tests were added first and failed. Now `idem_key` = the delivery event (`PD-EV-<callback_query.id>`); `decision_key` = action × SKU; the version is the Telegram `update_id`; `currentDecisions` takes the latest. Tests: a re-delivered event dedups; agree → decline → agree is 3 rows, current = agree, independent of arrival order; a stale button is still refused. PRD AC4 and tasks 002–004 updated.

## 3. Editorial

The build-hours placeholder now reads «Учёт трудозатрат не вёлся». A repository-wide search finds no remaining placeholders and no leftover wording about the dropped API client, its base-URL setting or the live-run flag.

## 4. Line endings

`.gitattributes`: `* text=auto eol=lf`, CSV `-text` (the csv module writes CRLF rows on every OS; bytes kept as generated), images/xlsx/pdf/zip/fonts `binary`. Python writers now pin `newline` (facts JSON, rendered reports, sanitized workflows, inlined workflow), and a tooling test fails if a script opens a text file for writing without `newline=`. Check: a temporary repo cloned with `core.autocrlf=true` is byte-identical to the source in all files. Not run on an actual Windows machine.

## Checks

| Check | Result |
|---|---|
| `npm test` | PASS, 73 tests (54 → 73: 16 gate adversarial/regression tests, 3 PRD AC4 tests) |
| Eval, GROK_BOT answers | PASS, 15/15 |
| `python scripts/check.py --sql` on PostgreSQL with server time zone UTC | PASS: Python tooling 9, SQL 12, all Node tests, eval, workflow sync |
| `run_demo.py --no-generate`, `examples/` vs v0.5 | identical |
| Gitleaks 8.30.1 (tree + history of a temporary repo), `scan_secrets.py` | PASS |
| GitHub Actions / Pages | NOT RUN (not published) |
