#!/usr/bin/env node
'use strict';
// Static demo site built only from committed synthetic outputs: examples/*.txt|json and the eval cassettes.
// No build tool, no external scripts or fonts. Output: site/dist/ (uploaded by .github/workflows/pages.yml).
const fs = require('node:fs');
const path = require('node:path');
const { gradeAll, loadCassette } = require('../llm/eval');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'dist');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => (v === null || v === undefined ? '<em>нет данных</em>' : typeof v === 'number' ? esc(v.toLocaleString('ru-RU')) : esc(v));
const repo = process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : null;

const facts = JSON.parse(read('examples/facts_example.json'));
const report = read('examples/report_example.txt');
const cassette = loadCassette();
const results = gradeAll(cassette.answers);
const passed = results.filter((r) => r.pass).length;
const last = (facts.orders || []).slice(-1)[0] || {};
const li = `orders.${Math.max(0, (facts.orders || []).length - 1)}`;

const keyFacts = [
  ['today', 'Дата отчёта', facts.today],
  [`${li}.d`, 'Последний загруженный день заказов', last.d],
  [`${li}.u`, 'Заказано, шт', last.u],
  [`${li}.rev`, 'Выручка заказов, ₽', last.rev],
  [`${li}.cm`, 'Вклад по модели заказов, ₽', last.cm],
  [`${li}.r_cm`, 'Вклад по начислениям, ₽', last.r_cm],
  ['mtd.o_cm', 'Вклад с начала месяца (заказы), ₽', facts.mtd && facts.mtd.o_cm],
  ['mtd.bar', 'Порог безубыточности с начала месяца, ₽', facts.mtd && facts.mtd.bar],
  ['ads.cpc_spend_rub', 'Реклама «оплата за клики» за 14.04, ₽', facts.ads && facts.ads.cpc_spend_rub],
  ['ads.drr_pct', 'ДРР за 14.04, %', facts.ads && facts.ads.drr_pct],
  ['ads.ppo_orders', 'Заказы «оплата за заказ» за 14.04', facts.ads && facts.ads.ppo_orders],
  ['stock.n_zero', 'SKU без свободного остатка', facts.stock && facts.stock.n_zero],
  ['ship.units', 'Рекомендация к отгрузке, шт', facts.ship && facts.ship.units],
];
const freshness = Object.entries(facts.freshness || {}).map(([k, v]) =>
  `<tr><td>${esc(k)}</td><td>${fmt(v.expected_day)}</td><td>${fmt(v.last_day)}</td><td><span class="badge ${v.freshness === 'FRESH' ? 'pass' : 'fail'}">${esc(v.freshness)}</span></td><td>${fmt(v.run_error)}</td></tr>`).join('\n');

const box = (x, y, w, h, title, sub, fill) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="#9aa6bd"/>` +
  `<text x="${x + w / 2}" y="${y + 22}" text-anchor="middle" font-weight="700" font-size="14">${esc(title)}</text>` +
  sub.map((s, i) => `<text x="${x + w / 2}" y="${y + 42 + i * 16}" text-anchor="middle" font-size="12" fill="#4a5568">${esc(s)}</text>`).join('') + '</g>';
const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#5b6475" stroke-width="1.6" marker-end="url(#a)"/>`;
const diagram = `<svg viewBox="0 0 1000 330" role="img" aria-label="Архитектура Business OS" font-family="system-ui, sans-serif">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#5b6475"/></marker></defs>
${box(10, 20, 170, 90, 'Ozon API', ['Seller: заказы, остатки,', 'цены, акции · Performance'], '#eef3ff')}
${box(220, 20, 170, 90, 'n8n по расписанию', ['5 сборщиков, только чтение', 'квитанции, SHA-256'], '#eef3ff')}
${box(430, 20, 180, 90, 'PostgreSQL (Neon)', ['raw.*: неизменяемые снимки', 'ops.*: журналы, параметры'], '#eaf7ef')}
${box(650, 20, 170, 90, 'SQL-представления', ['свежесть, маржа, ТБУ,', 'реклама, акции, касса'], '#eaf7ef')}
${box(650, 150, 170, 70, 'v_report_facts', ['один JSON фактов'], '#eaf7ef')}
${box(860, 150, 130, 70, 'Отчёт 09:00', ['рендер без LLM', '→ Telegram'], '#fff7e6')}
${box(430, 240, 180, 80, 'Вопрос владельца', ['маскирование → LLM', '→ проверка по фактам'], '#fff7e6')}
${box(650, 250, 170, 70, 'Гейт ответа', ['числа = факты SQL,', 'иначе ответ скрыт'], '#fdeceb')}
${box(10, 150, 380, 70, 'Агенты разработки (Codex, Claude Code)', ['меняют код только через тесты, CI', 'и подтверждение владельца'], '#f3f0ff')}
${arrow(180, 65, 220, 65)}${arrow(390, 65, 430, 65)}${arrow(610, 65, 650, 65)}${arrow(735, 110, 735, 150)}${arrow(820, 185, 860, 185)}
${arrow(700, 220, 560, 240)}${arrow(610, 285, 650, 285)}
</svg>`;

const evalRows = results.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.question)}</td><td>${esc(r.type)}</td><td>${esc(r.answer || '')}</td>` +
  `<td><span class="badge ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span>${r.pass ? '' : `<br><small>${esc(r.failed.join('; '))}</small>`}</td></tr>`).join('\n');
const sourceNote = cassette.source === 'GROK_BOT'
  ? `Ответы записаны через Grok Bot — настольный AI-ассистент владельца (не вызов API), ${esc(cassette.recorded_at)}. Каждый ответ дан по точному промпту модуля (системный промпт + замаскированные факты) и не правился после проверки. Оговорка: та же сессия ранее составила вопросы и эталоны, поэтому ответы не «слепые».`
  : '<span class="badge fixture">ФИКСТУРЫ</span> Ответы написаны вручную, это не ответы модели.';
const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Business OS — демо на синтетических данных</title><link rel="stylesheet" href="style.css"></head>
<body>
<header><div class="wrap">
<h1>Business OS</h1>
<p>Система управленческой аналитики для небольшого бренда на Ozon: данные API каждое утро ложатся в Postgres, SQL считает маржу, безубыточность, рекламу, акции, отгрузки и кассу, а владелец в 09:00 получает один отчёт, где у каждой цифры есть дата.</p>
<p>Собрана владельцем вместе с AI-агентами (Codex, Claude Code). Все данные на этой странице синтетические, бренд — DemoBrand.</p>
<p class="links">${repo ? `<a href="${esc(repo)}">Репозиторий</a><a href="${esc(repo)}/blob/main/docs/case-study.md">Кейс</a><a href="${esc(repo)}/blob/main/docs/llm-eval.md">Eval</a>` : '<span>Ссылка на репозиторий появится после публикации.</span>'}</p>
</div></header>
<main>
<section><h2>Архитектура</h2>${diagram}
<p class="note">Цифры считает SQL, а не модель. LLM в ежедневном отчёте нет; модель только отвечает на вопросы владельца по готовым фактам, и ответ показывается, только если все его числа совпадают с фактами.</p></section>
<section><h2>Утренний отчёт (демо, 15.04)</h2>
<p class="note">В демо-данных намеренно есть сбои: заказы за вчера не загрузились (HTTP 429), отчёта «оплата за заказ» нет, начисления отстают. Отчёт пишет «нет данных», а не 0.</p>
<pre class="report">${esc(report)}</pre></section>
<div class="grid">
<section><h2>Ключевые факты</h2><table><tr><th>Факт</th><th>Ключ</th><th>Значение</th></tr>
${keyFacts.map(([k, label, v]) => `<tr><td>${esc(label)}</td><td><code>${esc(k)}</code></td><td class="num">${fmt(v)}</td></tr>`).join('\n')}
</table><p class="note">Источник: <code>analytics.v_report_facts</code> → <code>examples/facts_example.json</code>.</p></section>
<section><h2>Свежесть источников</h2><table><tr><th>Источник</th><th>Ожидался</th><th>Последний</th><th>Статус</th><th>Ошибка</th></tr>
${freshness}</table></section>
</div>
<section><h2>Вопросы владельца: проверка ответов</h2>
<p>Результат: <strong>${passed}/${results.length}</strong>. ${sourceNote}</p>
<p class="note">AI-слой системы — Grok Bot, настольный AI-ассистент владельца, подключённый к Neon и n8n. Своего API-клиента модели в системе нет; eval проверяет записанные ответы Grok Bot.</p>
<p class="note">Грейдер детерминированный: извлекает числа, даты и время из ответа и сверяет их с процитированными фактами; проверяет, что «нет данных» не стало нулём, что ключи фактов существуют, что вопрос вне области отклонён и что замаскированные значения (названия товаров, контрагенты, точные суммы кассы) не появились.</p>
<table><tr><th>#</th><th>Вопрос</th><th>Тип</th><th>Ответ</th><th>Гейт</th></tr>
${evalRows}</table></section>
</main>
<footer>Business OS · портфолио v0.5.1 · синтетические данные · сгенерировано <code>site/build.js</code> из выходов демо</footer>
</body></html>
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
fs.copyFileSync(path.join(__dirname, 'style.css'), path.join(OUT, 'style.css'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`site written to ${path.relative(ROOT, OUT)}/index.html · eval ${passed}/${results.length} (${cassette.source})`);
