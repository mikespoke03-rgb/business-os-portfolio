// Daily 09:00 report renderer - pure function, no I/O.
// The same code is pasted into the n8n Code node "Build Report Message" (see workflows/daily_report_0900.json).
// Input: facts = analytics.v_report_facts.j. Output: { text, parts, chars }.
// Rules (from the production version):
//  * every section prints the date of the data it shows; if it is not the expected day, it says so and why;
//  * missing data is written as "no data", never as 0;
//  * the order-model margin and the realised margin are two separate numbers and are never added up;
//  * estimates are labelled as estimates; recommendations are calculations, nothing is applied automatically;
//  * Telegram limit 4096 chars: protected lines (dates, caveats) are never cut, only optional lines are dropped.
'use strict';

function renderReport(f, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const T = (ru, en) => (lang === 'en' ? en : ru);
  const MAX = opts.maxChars || 3900;
  const WD = T(['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
               ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  // Timestamps are always shown in business time (Europe/Moscow), whatever offset or session time zone the
  // database used. Values with an explicit offset/Z are converted; date-only values and naive strings are kept as is.
  const mskParts = (v) => {
    const s = String(v);
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) || !/(Z|[+-]\d{2}(:?\d{2})?)$/.test(s)) return null;
    const d = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    if (Number.isNaN(d.getTime())) return null;
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
      return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
    } catch (e) { // runtime without time-zone data: Moscow is fixed UTC+3 since 2014
      const m = new Date(d.getTime() + 3 * 3600 * 1000).toISOString();
      return { date: m.slice(0, 10), time: m.slice(11, 16) };
    }
  };
  const iso = (v) => { if (v == null) return null; const m = mskParts(v); return m ? m.date : String(v).slice(0, 10); };
  const dm = (v) => { const s = iso(v); return s ? `${s.slice(8, 10)}.${s.slice(5, 7)}` : '?'; };
  const addDays = (s, n) => { const d = new Date(iso(s) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const hm = (ts) => { if (!ts) return '?'; const m = mskParts(ts); return m ? m.time : String(ts).slice(11, 16); };
  const dmhm = (ts) => (ts ? `${dm(ts)} ${hm(ts)}` : '?');
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const sp = (n) => num(n) === null ? T('нет данных', 'unknown') : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : ' ');
  const dec = (x) => (lang === 'en' ? String(x) : String(x).replace('.', ','));
  const t1 = (n) => num(n) === null ? T('нет данных', 'unknown') : dec(Math.round(Number(n) / 100) / 10);
  const K = T('тыс. ₽', 'k RUB');
  const sgn = (n, fn) => num(n) === null ? T('не рассчитано', 'not computed') : (n > 0 ? '+' : n < 0 ? '−' : '±') + fn(Math.abs(n));
  const pct = (a, b) => (b ? Math.round((100 * (a - b)) / b) : null);
  const sgnPct = (p) => (p === null ? '?' : (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p) + '%');
  const name = (x) => (lang === 'en' ? x.name_en : x.name_ru) || x.offer;
  const fr = f.freshness || {};
  const failed = (src) => (f.failed_runs_today || []).find((r) => r.source === src);
  const today = iso(f.today); const yest = addDays(today, -1);
  const L = []; const P = (s, prot = true) => L.push([s, prot]); const blank = () => P('');

  P(T(`Утренний отчёт DemoBrand · ${dm(today)}, ${WD[new Date(today + 'T12:00:00Z').getUTCDay()]}`,
      `DemoBrand morning report · ${dm(today)}, ${WD[new Date(today + 'T12:00:00Z').getUTCDay()]}`) +
    (opts.mode === 'DRY_RUN' ? T(' · черновик, в Telegram не отправлялся', ' · draft, not sent to Telegram') : ''));

  // 1) Orders --------------------------------------------------------------
  blank();
  const rows = f.orders || []; const last = rows.length ? rows[rows.length - 1] : null;
  if (!last) P(T('1) Заказы — за 40 дней нет ни одного загруженного дня.', '1) Orders — no loaded day in the last 40 days.'));
  else {
    const loaded = last.loaded_at ? T(` (загружен ${dmhm(last.loaded_at)})`, ` (loaded ${dmhm(last.loaded_at)})`) : '';
    if (iso(last.d) === yest) P(T(`1) Заказы за ${dm(last.d)}${loaded}`, `1) Orders for ${dm(last.d)}${loaded}`));
    else {
      const fl = failed('orders_by_sku');
      P(T(`1) Заказы — за ${dm(yest)} данных нет; последний загруженный день ${dm(last.d)}${loaded}`,
          `1) Orders — no data for ${dm(yest)}; last loaded day ${dm(last.d)}${loaded}`) +
        (fl ? T(`. Загрузка сегодня не прошла: ${fl.error || fl.state}.`, `. Today's load failed: ${fl.error || fl.state}.`) : '.'));
    }
    const prev = rows.length > 1 ? rows[rows.length - 2] : null; const w = rows.slice(-8, -1); const n7 = w.length;
    const au = n7 ? w.reduce((s, r) => s + Number(r.u), 0) / n7 : null; const ar = n7 ? w.reduce((s, r) => s + Number(r.rev), 0) / n7 : null;
    let s = T(`${sp(last.u)} шт на ${t1(last.rev)} ${K} (отмен ${sp(last.canc)}).`, `${sp(last.u)} units, ${t1(last.rev)} ${K} (cancelled ${sp(last.canc)}).`);
    if (prev) s += T(` К ${dm(prev.d)}: ${sgn(last.u - prev.u, sp)} шт, ${sgn(last.rev - prev.rev, t1)} ${K}.`, ` vs ${dm(prev.d)}: ${sgn(last.u - prev.u, sp)} units, ${sgn(last.rev - prev.rev, t1)} ${K}.`);
    if (n7) s += T(` К среднему за ${n7} дн. до этого (${dec(Math.round(au * 10) / 10)} шт; ${t1(ar)} ${K} в день): ${sgnPct(pct(last.u, au))} шт, ${sgnPct(pct(last.rev, ar))} ₽.`,
                   ` vs the ${n7}-day average before it (${dec(Math.round(au * 10) / 10)} units; ${t1(ar)} ${K}/day): ${sgnPct(pct(last.u, au))} units, ${sgnPct(pct(last.rev, ar))} revenue.`);
    P(s);
  }

  // 2) Margin: order model vs realised (never summed) -------------------------
  blank();
  P(T('2) Маржа (две разные цифры — не складываются)', '2) Margin (two different numbers — never added up)'));
  if (last) {
    if (num(last.cm) === null || num(last.cm_buyout) === null) {
      P(T('Вклад по заказам не рассчитан: обязательные данные модели или рекламы отсутствуют (не ноль).',
          'Order contribution is not computed: required model or ads data are missing (not zero).'));
    } else {
    P(T(`По заказам ${dm(last.d)}, если всё выкупят: ${sgn(last.cm, t1)} ${K} — после себестоимости, комиссий и логистики (модельные ставки), НДС (модель) и рекламы ${t1(last.ads || 0)} тыс. С учётом доли выкупа: ${sgn(last.cm_buyout, t1)} ${K}.`,
        `Orders of ${dm(last.d)}, if everything is bought out: ${sgn(last.cm, t1)} ${K} — after COGS, marketplace fees and logistics (model rates), VAT (model) and ads ${t1(last.ads || 0)}k. Adjusted for buyout rate: ${sgn(last.cm_buyout, t1)} ${K}.`));
    }
    const rl = [...rows].reverse().find((r) => r.realised_state === 'REALISED_PRESENT');
    if (!rl) P(T('Факт начислений за эти дни ещё не загружен (это не ноль).', 'Realised accruals for these days are not loaded yet (this is not zero).'));
    else if (num(rl.r_cm) === null) P(T(`Начисления за ${dm(rl.d)} загружены; вклад не рассчитан: обязательные данные модели или рекламы отсутствуют.`,
       `Accruals are loaded for ${dm(rl.d)}; contribution is not computed because required model or ads data are missing.`));
    else P(T(`Факт начислений за ${dm(rl.d)} (продано ${sp(rl.r_u)} шт на ${t1(rl.r_sales)} ${K}): ${sgn(rl.r_cm, t1)} ${K} — удержания маркетплейса по факту, себестоимость и НДС по модели.` + (iso(rl.d) < iso(last.d) ? ` За ${addDays(rl.d, 1) === iso(last.d) ? dm(last.d) : dm(addDays(rl.d, 1)) + '–' + dm(last.d)} начислений ещё нет.` : ''),
             `Realised accruals for ${dm(rl.d)} (sold ${sp(rl.r_u)} units for ${t1(rl.r_sales)} ${K}): ${sgn(rl.r_cm, t1)} ${K} — actual marketplace charges, COGS and VAT by model.` + (iso(rl.d) < iso(last.d) ? ` No accruals yet for ${addDays(rl.d, 1) === iso(last.d) ? dm(last.d) : dm(addDays(rl.d, 1)) + '–' + dm(last.d)}.` : '')));
  } else P(T('Нет строки дня — маржу не считаю.', 'No day row — margin not computed.'));

  // 3) Break-even ------------------------------------------------------------
  const m = f.mtd || {};
  if (last && num(last.bar) && num(last.cm) !== null) {
    blank();
    P(T(`3) Безубыточность: нужно ${t1(last.bar)} ${K} маржи в день (постоянные расходы + финансирование, делённые на дни месяца)`,
        `3) Break-even: ${t1(last.bar)} ${K} of contribution needed per day (fixed costs + financing, divided by days in month)`));
    let s = T(`${dm(last.d)} по заказам: ${Math.round((100 * last.cm) / last.bar)}% (${t1(last.cm)} из ${t1(last.bar)}).`,
              `${dm(last.d)} by orders: ${Math.round((100 * last.cm) / last.bar)}% (${t1(last.cm)} of ${t1(last.bar)}).`);
    const gap = (g) => (g < 0 ? T(`не хватает ${t1(-g)} ${K}`, `short by ${t1(-g)} ${K}`) : T(`запас ${t1(g)} ${K}`, `ahead by ${t1(g)} ${K}`));
    if (m.n && num(m.o_cm) !== null && num(m.bar) > 0) {
      s += T(` С начала месяца (${m.n} дн.): по заказам ${Math.round((100 * m.o_cm) / m.bar)}%, ${gap(m.o_cm - m.bar)}`, ` Month to date (${m.n} days): by orders ${Math.round((100 * m.o_cm) / m.bar)}%, ${gap(m.o_cm - m.bar)}`);
      if (m.n_realised && num(m.r_cm) !== null && num(m.r_bar) > 0) s += T(`; по факту начислений (${m.n_realised} дн.) ${Math.round((100 * m.r_cm) / m.r_bar)}%, ${gap(m.r_cm - m.r_bar)}.`, `; by realised accruals (${m.n_realised} days) ${Math.round((100 * m.r_cm) / m.r_bar)}%, ${gap(m.r_cm - m.r_bar)}.`);
      else s += '.';
    } else if (m.n) {
      s += T(' Покрытие с начала месяца недоступно: есть дни без рассчитанного вклада.', ' Month-to-date coverage is unavailable: some loaded days have no computed contribution.');
    }
    P(s);
    P(T('Оценки: ставки комиссии и логистики, НДС и себестоимость — параметры модели, а не факт.', 'Estimates: fee and logistics rates, VAT and COGS are model parameters, not actuals.'));
  }

  // 4) Ads ---------------------------------------------------------------------
  blank();
  const a = f.ads;
  if (!a) P(T(`4) Реклама — за ${dm(yest)} данных нет.`, `4) Ads — no data for ${dm(yest)}.`));
  else {
    P(T(`4) Реклама за ${dm(a.stat_day)}`, `4) Ads for ${dm(a.stat_day)}`));
    let s;
    if (a.cpc_status !== 'OK') s = T('Оплата за клики: отчёта нет (не ноль).', 'Cost-per-click: no report (not zero).');
    else {
      s = T(`Оплата за клики: ${t1(a.cpc_spend_rub)} тыс. ₽; показы ${t1(a.cpc_impressions)} тыс., CTR ${dec(a.cpc_ctr_pct)}%, цена клика ${dec(Math.round(a.cpc_cpc_rub * 10) / 10)} ₽, заказов с рекламы ${sp(a.cpc_orders)}.`,
            `Cost-per-click: ${t1(a.cpc_spend_rub)}k RUB; ${t1(a.cpc_impressions)}k impressions, CTR ${dec(a.cpc_ctr_pct)}%, CPC ${dec(Math.round(a.cpc_cpc_rub * 10) / 10)} RUB, ${sp(a.cpc_orders)} ad orders.`);
      const d = num(a.cpc_spend_diff_vs_expense_rub);
      if (d !== null) s += Math.abs(d) < 5 ? T(' Сходится с выпиской расходов кабинета.', ' Matches the ad-account expense ledger.') : T(` С выпиской расходов расходится на ${sp(Math.abs(d))} ₽.`, ` Differs from the expense ledger by ${sp(Math.abs(d))} RUB.`);
    }
    P(s);
    if (a.ppo_status === 'OK') P(T(`Оплата за заказ: ${t1(a.ppo_spend_expense_rub)} тыс. ₽, заказов ${sp(a.ppo_orders)} на ${t1(a.ppo_order_revenue_rub)} ${K}.`, `Pay-per-order: ${t1(a.ppo_spend_expense_rub)}k RUB, ${sp(a.ppo_orders)} orders for ${t1(a.ppo_order_revenue_rub)} ${K}.`));
    else P(T(`Оплата за заказ: расход по выписке ${a.ppo_spend_expense_rub == null ? 'неизвестен' : t1(a.ppo_spend_expense_rub) + ' тыс. ₽'}; отчёта за ${dm(a.stat_day)} нет — заказы с этой модели неизвестны (не ноль).`,
             `Pay-per-order: expense ledger ${a.ppo_spend_expense_rub == null ? 'unknown' : t1(a.ppo_spend_expense_rub) + 'k RUB'}; no report for ${dm(a.stat_day)} — orders from this model are unknown (not zero).`));
    const am = f.ads_mtd || {};
    let d2 = a.drr_pct == null ? T(`ДРР за ${dm(a.stat_day)} не рассчитана: нет полного расхода рекламы или ненулевой выручки заказов.`, `ACoS for ${dm(a.stat_day)} is not computed: complete ad spend or nonzero order revenue is unavailable.`)
                               : T(`ДРР ${dec(a.drr_pct)}% от заказов дня.`, `ACoS ${dec(a.drr_pct)}% of the day's orders.`);
    if (num(am.rev) && num(am.spend) !== null && num(am.spend_with_rev) !== null) d2 += T(` С начала месяца: ${t1(am.spend)} тыс. ₽, ДРР ${dec(Math.round((1000 * am.spend_with_rev) / am.rev) / 10)}% (по дням, где есть заказы).`,
                             ` Month to date: ${t1(am.spend)}k RUB, ACoS ${dec(Math.round((1000 * am.spend_with_rev) / am.rev) / 10)}% (days with loaded orders).`);
    P(d2);
  }

  // 5) Prices and promos -------------------------------------------------------
  blank();
  P(T('5) Цены и акции', '5) Prices and promotions'));
  const pr = f.prices || {};
  if (!pr.d) P(T('Цена продавца — снимков нет.', 'Seller price — no snapshots.'));
  else {
    let s = iso(pr.d) === today ? T(`Цена продавца: снимок ${dmhm(pr.cap)} (${pr.n} SKU)`, `Seller price: snapshot ${dmhm(pr.cap)} (${pr.n} SKUs)`)
                                : T(`Цена продавца: снимка за ${dm(today)} нет; последний ${dmhm(pr.cap)} (${pr.n} SKU)`, `Seller price: no snapshot for ${dm(today)}; last one ${dmhm(pr.cap)} (${pr.n} SKUs)`);
    const ch = pr.changes || []; const ex = ch.slice(0, 3).map((c) => `${name(c)} ${sp(c.old)}→${sp(c.new)}`).join(', ');
    const up = ch.filter((c) => c.new > c.old).length;
    const dir = up === ch.length ? T('все вверх', 'all up') : up === 0 ? T('все вниз', 'all down') : T(`${up} вверх, ${ch.length - up} вниз`, `${up} up, ${ch.length - up} down`);
    if (!pr.prev_d) s += T(' — сравнить не с чем.', ' — nothing to compare with.');
    else if (iso(pr.last_change_day) === iso(pr.d)) s += T(` против ${dm(pr.prev_d)}: изменились ${ch.length} (${dir}), напр. ${ex}.`, ` vs ${dm(pr.prev_d)}: ${ch.length} changed (${dir}), e.g. ${ex}.`);
    else s += T(` против ${dm(pr.prev_d)}: без изменений.`, ` vs ${dm(pr.prev_d)}: no changes.`) + (ch.length ? T(` Последние изменения ${dm(pr.last_change_day)}: ${ch.length} SKU (${dir}), напр. ${ex}.`, ` Last changes ${dm(pr.last_change_day)}: ${ch.length} SKUs (${dir}), e.g. ${ex}.`) : '');
    P(s);
    P(T(`У ${pr.promo_below} из ${pr.n} SKU цена в акции ниже обычной.`, `${pr.promo_below} of ${pr.n} SKUs have a promo price below the regular price.`), false);
  }
  const po = f.promo;
  if (!po || !po.measured_at) P(T('Акции — замеров нет.', 'Promotions — no measurement.'));
  else {
    let s = T(`Акции (замер ${dmhm(po.measured_at)}`, `Promotions (measured ${dmhm(po.measured_at)}`) + (iso(po.measured_at) < today ? T('; свежее нет', '; nothing newer') : '') +
      T(`): акций ${po.n_actions}, позиций участвует ${po.n_participating}.`, `): ${po.n_actions} actions, ${po.n_participating} SKU entries participating.`);
    if (po.nearest_title) s += T(` Ближайший старт ${dm(po.nearest_start)} «${po.nearest_title}»: ${po.nearest_n_sku} SKU — входить ${po.nearest_enter}, не входить ${po.nearest_dont}, решить владельцу ${po.nearest_decide}.`,
                                 ` Next start ${dm(po.nearest_start)} "${po.nearest_title}": ${po.nearest_n_sku} SKUs — enter ${po.nearest_enter}, don't ${po.nearest_dont}, owner decides ${po.nearest_decide}.`);
    if (num(po.autoadd_n_sku)) {
      s += T(` Автодобавление ${dm(po.autoadd_date)}: ${po.autoadd_n_sku} SKU, из них не входить ${po.autoadd_dont}`, ` Auto-add on ${dm(po.autoadd_date)}: ${po.autoadd_n_sku} SKUs, ${po.autoadd_dont} of them "don't"`);
      if (num(po.autoadd_margin_delta_day_rub) !== null) s += T(`; маржа ${sgn(po.autoadd_margin_delta_day_rub, t1)} ${K}/день при нынешних продажах`, `; margin ${sgn(po.autoadd_margin_delta_day_rub, t1)} ${K}/day at current sales`);
      s += '.';
    }
    P(s + T(' Это оценка; рост продаж от акции неизвестен; акции сами не подключаются.', ' Estimate only; the sales uplift is unknown; nothing is joined automatically.'));
  }

  // 6) Stock and shipments ------------------------------------------------------
  blank();
  P(T('6) Остатки и отгрузки', '6) Stock and shipments'));
  const st = f.stock || {};
  if (!st.d) P(T('Остатки FBO — снимков нет.', 'FBO stock — no snapshots.'));
  else {
    let s = iso(st.d) === today ? T(`Остатки FBO ${dmhm(st.cap)}:`, `FBO stock ${dmhm(st.cap)}:`) : T(`Остатков за ${dm(today)} нет; последние ${dmhm(st.cap)}:`, `No stock snapshot for ${dm(today)}; last one ${dmhm(st.cap)}:`);
    s += T(` без свободного остатка ${st.n_zero} из ${st.n_sku} SKU.`, ` ${st.n_zero} of ${st.n_sku} SKUs have no free stock.`);
    const cr = st.critical || [];
    if (cr.length) s += T(` Важные (A/B) 0–${st.crit_units} шт: `, ` Key (A/B) SKUs at 0–${st.crit_units} units: `) + cr.slice(0, 5).map((c) => `${name(c)} — ${c.free}`).join(', ') + (cr.length > 5 ? T(`, ещё ${cr.length - 5}`, `, ${cr.length - 5} more`) : '') + '.';
    P(s);
  }
  const sh = f.ship || {};
  if (num(sh.n_no_fresh)) P(T('Отгрузки: заказы по кластерам устарели — рекомендации нет.', 'Shipments: cluster orders are stale — no recommendation.'));
  else if (num(sh.units)) P(T(`Отгрузки под ${sh.cover_days} дн. спроса (заказы по кластерам до ${dm(sh.orders_as_of)}, остатки ${dm(sh.stock_date)}): ${sp(sh.units)} шт в ${sh.lines} строках SKU×кластер; больше всего — `,
                              `Shipments for ${sh.cover_days} days of demand (cluster orders to ${dm(sh.orders_as_of)}, stock ${dm(sh.stock_date)}): ${sp(sh.units)} units in ${sh.lines} SKU×cluster lines; largest — `) +
    (sh.top_clusters || []).map((c) => `${c.cluster} ${sp(c.units)}`).join(', ') + T('. Рекомендация, не заявка.', '. A recommendation, not a shipment request.'), false);

  // 7) Cash ------------------------------------------------------------------
  const c = f.cash || {};
  if (c.as_of) {
    blank();
    P(T('7) Деньги', '7) Cash'));
    let s = c.opening_status === 'OWNER_STATED' ? T(`Касса не подтверждена выпиской: владелец указал ${sp(c.opening)} ₽ на ${dm(c.as_of)}.`, `Cash is not confirmed by a bank statement: the owner stated ${sp(c.opening)} RUB on ${dm(c.as_of)}.`)
                                                : T(`Касса ${sp(c.opening)} ₽ на ${dm(c.as_of)}.`, `Cash ${sp(c.opening)} RUB on ${dm(c.as_of)}.`);
    const nx = c.next_out;
    if (nx) {
      const need = -Number(nx.outflow_rub); const before = Number(nx.balance_before);
      s += T(` Ближайший крупный платёж ${dm(nx.day)} (${t1(need)} ${K}): по плану до него будет ~${t1(before)} ${K} — ${before >= need ? 'хватает' : 'не хватает ~' + t1(need - before) + ' ' + K}.`,
             ` Next large payment ${dm(nx.day)} (${t1(need)} ${K}): planned balance before it ~${t1(before)} ${K} — ${before >= need ? 'covered' : 'short by ~' + t1(need - before) + ' ' + K}.`);
    }
    if (c.min_30d) s += T(` Минимум за 30 дней: ${sgn(c.min_30d.balance_rub, t1)} ${K} (${dm(c.min_30d.day)}).`, ` 30-day minimum: ${sgn(c.min_30d.balance_rub, t1)} ${K} (${dm(c.min_30d.day)}).`);
    P(s + T(' Поступления от маркетплейса — оценка.', ' Marketplace payouts are estimates.'));
  }

  // Footer: data checks -------------------------------------------------------
  blank();
  const cv = f.coverage_30d || {};
  P(T(`Сверка заказов из двух API за 30 дн.: совпало ${cv.MATCH || 0}, расхождение ${cv.DIFF || 0}, без второго источника ${cv.NO_SECOND_SOURCE || 0}.`,
      `Order reconciliation of two APIs, 30 days: match ${cv.MATCH || 0}, diff ${cv.DIFF || 0}, no second source ${cv.NO_SECOND_SOURCE || 0}.`), false);
  P(T('Все рекомендации расчётные: ничего не включается и не меняется автоматически.', 'All recommendations are calculations: nothing is switched on or changed automatically.'));

  let text = L.map((x) => x[0]).join('\n');
  if (text.length > MAX) { // drop optional lines from the end, never protected ones
    for (let i = L.length - 1; i >= 0 && L.map((x) => x[0]).join('\n').length > MAX; i--) if (!L[i][1]) L.splice(i, 1);
    text = L.map((x) => x[0]).join('\n');
  }
  const parts = [];
  if (text.length <= 4096) parts.push(text);
  else { let cur = ''; for (const line of text.split('\n')) { if (cur && (cur + '\n' + line).length > 4000) { parts.push(cur); cur = line; } else cur = cur ? cur + '\n' + line : line; } if (cur) parts.push(cur); }
  return { text, parts, chars: text.length };
}

// ---- CLI ----
if (typeof module !== 'undefined' && require.main === module) {
  // CLI: node scripts/render_report.js examples/facts_example.json [ru|en] [DRY_RUN|LIVE]
  const facts = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(renderReport(facts, { lang: process.argv[3] || 'ru', mode: process.argv[4] || 'LIVE' }).text + '\n');
}
if (typeof module !== 'undefined') module.exports = { renderReport };
