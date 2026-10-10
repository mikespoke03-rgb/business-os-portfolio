#!/usr/bin/env python3
"""Generate a fully synthetic dataset for the Business OS demo.

Nothing here comes from a real business: the brand ("DemoBrand"), SKUs, prices, costs,
volumes, clusters, campaigns and cash events are produced by a seeded random generator.
Gaps are injected on purpose so the demo shows how the system labels stale / missing data:
  * orders by SKU (analytics source) are loaded only up to D-2 (yesterday's load "did not run");
  * the pay-per-order ads report is missing for D-1 (only the expense line exists);
  * finance accruals (realised) lag three days;
  * two days have fewer FBO postings than the analytics source (coverage DIFF);
  * the first two weeks of postings have no second source (NO_SECOND_SOURCE).

Usage: python3 scripts/generate_synthetic_data.py [--seed 42] [--today 2026-04-15] [--out sample_data]
"""
import argparse, csv, datetime as dt, hashlib, math, os, random

CLUSTERS = [  # (name, share of buyers) - generic macro-regions, synthetic shares
    ("Moscow", 0.34), ("Saint Petersburg", 0.12), ("Volga", 0.11), ("South", 0.10),
    ("Ural", 0.09), ("Siberia", 0.08), ("Central", 0.09), ("Far East", 0.03), ("Kazakhstan", 0.04)]
WAREHOUSE = {c: f"WH-{i+1:02d}" for i, (c, _) in enumerate(CLUSTERS)}
PRODUCTS = [  # (category_en, category_ru, size)
    ("Hydrating serum", "Увлажняющая сыворотка", "30 ml"), ("Vitamin C serum", "Сыворотка с витамином C", "30 ml"),
    ("Gentle foam cleanser", "Пенка для умывания", "150 ml"), ("Cleansing oil", "Гидрофильное масло", "200 ml"),
    ("Soothing toner", "Успокаивающий тонер", "200 ml"), ("Exfoliating toner", "Отшелушивающий тонер", "150 ml"),
    ("Eye cream", "Крем для век", "20 ml"), ("Night cream", "Ночной крем", "50 ml"), ("Day cream SPF30", "Дневной крем SPF30", "50 ml"),
    ("Sheet mask x5", "Тканевые маски x5", "5 pcs"), ("Clay mask", "Глиняная маска", "100 ml"), ("Lip balm", "Бальзам для губ", "10 ml"),
    ("Hand cream", "Крем для рук", "75 ml"), ("Body lotion", "Лосьон для тела", "250 ml"), ("Sun stick SPF50", "Солнцезащитный стик SPF50", "18 g"),
    ("Ampoule set", "Набор ампул", "4x10 ml"), ("Peeling gel", "Пилинг-гель", "120 ml"), ("Micellar water", "Мицеллярная вода", "300 ml"),
    ("Essence", "Эссенция", "100 ml"), ("Barrier cream", "Барьерный крем", "60 ml"), ("Spot patch x24", "Точечные патчи x24", "24 pcs"),
    ("Hair mist", "Спрей для волос", "100 ml"), ("Shampoo", "Шампунь", "300 ml"), ("Travel kit", "Дорожный набор", "4 pcs")]


def d2s(d):
    return d.isoformat()


def ts(d, hh, mm, rnd):
    """MSK wall-clock -> UTC ISO timestamp with a few random seconds."""
    t = dt.datetime.combine(d, dt.time(hh, mm, rnd.randint(0, 59))) - dt.timedelta(hours=3)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def write(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"{os.path.basename(path):34s} {len(rows):7d} rows")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--today", default="2026-04-15", help="demo 'today' (MSK); the report is rendered for this date")
    ap.add_argument("--days", type=int, default=100)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sample_data"))
    args = ap.parse_args()
    rnd = random.Random(args.seed)
    today = dt.date.fromisoformat(args.today)
    start = today - dt.timedelta(days=args.days)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    # ---------- SKU master + costs ----------
    skus = []
    for i, (en, ru, size) in enumerate(PRODUCTS, start=1):
        price = rnd.randrange(590, 2990, 10)
        abc = "A" if i <= 6 else ("B" if i <= 14 else "C")
        skus.append(dict(offer_id=f"DEMO-{i:03d}", sku=900000000 + i * 7919, name_en=f"{en} {size}", name_ru=f"{ru} {size}",
                         abc=abc, price=price, cogs=round(price * rnd.uniform(0.15, 0.28), 2),
                         lam={"A": rnd.uniform(3.0, 6.0), "B": rnd.uniform(1.0, 2.5), "C": rnd.uniform(0.15, 0.8)}[abc]))
    for s in skus:
        s["customs_vat"] = round(s["cogs"] * 0.16, 2)
    write(f"{out}/sku.csv", ["offer_id", "sku", "short_name_en", "short_name_ru", "abc_class"],
          [[s["offer_id"], s["sku"], s["name_en"], s["name_ru"], s["abc"]] for s in skus])
    write(f"{out}/sku_cost_obs.csv", ["offer_id", "cogs_ex_vat_rub", "customs_vat_rub", "valid_from", "captured_at", "source"],
          [[s["offer_id"], s["cogs"], s["customs_vat"], d2s(start), ts(start, 10, 0, rnd), "synthetic"] for s in skus])

    days = [start + dt.timedelta(days=i) for i in range((today - start).days)]  # start..today-1

    # ---------- seller price snapshots (08:48 daily, incl. today) ----------
    price_rows, cur_price = [], {s["offer_id"]: s["price"] for s in skus}
    promo_skus = set(rnd.sample([s["offer_id"] for s in skus], 14))
    price_hist = {}
    for d in days + [today]:
        if rnd.random() < 0.12:  # occasional repricing
            for s in rnd.sample(skus, rnd.randint(2, 6)):
                step = rnd.choice([-1, 1]) * rnd.randrange(50, 400, 10)
                cur_price[s["offer_id"]] = max(390, cur_price[s["offer_id"]] + step)
        cap = ts(d, 8, 48, rnd)
        for s in skus:
            p = cur_price[s["offer_id"]]
            mp = round(p * rnd.uniform(0.82, 0.93)) if s["offer_id"] in promo_skus else p
            price_hist[(d, s["offer_id"])] = p
            price_rows.append([d2s(d), s["offer_id"], s["sku"], p, mp, round(p * 1.6), cap, f"PRICE-{d:%Y%m%d}"])
    write(f"{out}/seller_price_obs.csv", ["business_date", "offer_id", "product_id", "seller_price_rub", "marketing_seller_price_rub",
                                          "old_price_rub", "captured_at", "run_id"], price_rows)

    # ---------- orders: analytics source (SKU x day) + FBO postings (lines with clusters) ----------
    order_rows, posting_rows, realised = [], [], {}
    analytics_from = start + dt.timedelta(days=14)          # NO_SECOND_SOURCE before this date
    analytics_to = today - dt.timedelta(days=2)             # orders loader "missed" yesterday
    diff_days = {today - dt.timedelta(days=30), today - dt.timedelta(days=12)}
    pn = 10_000_000
    for d in days:
        wk = 1.15 if d.weekday() in (0, 1) else (0.85 if d.weekday() == 5 else 1.0)
        trend = 1 + 0.004 * (d - start).days
        for s in skus:
            lam = s["lam"] * wk * trend * (1.25 if s["offer_id"] in promo_skus else 1.0)
            u = sum(1 for _ in range(30) if rnd.random() < lam / 30)
            if not u:
                continue
            canc = sum(1 for _ in range(u) if rnd.random() < 0.05)
            pr = price_hist[(d, s["offer_id"])]
            rev = round(u * pr * rnd.uniform(0.88, 0.97), 2)
            if analytics_from <= d <= analytics_to:
                order_rows.append([d2s(d), s["offer_id"], s["sku"], u, canc, rev, ts(d + dt.timedelta(days=1), 5, 30, rnd), f"ORD-{d:%Y%m%d}"])
            units_left = u
            skip = d in diff_days and rnd.random() < 0.5    # lines that never became FBO postings
            while units_left > 0:
                q = 1 if units_left == 1 or rnd.random() < 0.8 else 2
                units_left -= q
                if skip:
                    continue
                pn += rnd.randint(1, 40)
                to_c = rnd.choices([c for c, _ in CLUSTERS], [w for _, w in CLUSTERS])[0]
                from_c = to_c if rnd.random() < 0.72 else "Moscow"
                status = "cancelled" if canc > 0 and rnd.random() < 0.5 else ("delivered" if (today - d).days > 7 else "delivering")
                if status == "cancelled":
                    canc -= 1
                line = [f"{pn}-0001-1", 1, ts(d, rnd.randint(8, 23), rnd.randint(0, 59), rnd), d2s(d), s["offer_id"], s["sku"], q,
                        round(pr * rnd.uniform(0.88, 0.97), 2), status, from_c, to_c, WAREHOUSE[from_c]]
                line.append(hashlib.sha256("|".join(map(str, line)).encode()).hexdigest())
                line += [ts(min(d + dt.timedelta(days=1), today), 7, 15, rnd), f"CL-{d:%Y%m%d}"]
                posting_rows.append(line)
            # realised (accruals) for delivered units, lagging
            r = realised.setdefault(d + dt.timedelta(days=rnd.choice([3, 4, 5])), [0, 0.0, 0.0])
            sold = max(0, round(u * 0.8))
            r[0] += sold
            r[1] += sold * pr * 0.92
            r[2] += sold * pr * 0.92 * rnd.uniform(0.40, 0.46) + sold * 85
    write(f"{out}/order_day_sku_obs.csv", ["business_date", "offer_id", "sku", "ordered_units", "cancelled_units", "order_revenue_rub",
                                           "captured_at", "run_id"], order_rows)
    write(f"{out}/fbo_posting_line_obs.csv", ["posting_number", "line_ordinal", "created_at_utc", "order_date_msk", "offer_id", "sku", "quantity",
                                              "price_rub", "status", "cluster_from", "cluster_to", "warehouse_name", "row_sha256", "captured_at", "run_id"],
          posting_rows)
    real_rows = [[d2s(d), v[0], round(v[1], 2), round(-v[2], 2), ts(d + dt.timedelta(days=1), 6, 10, rnd), f"FIN-{d:%Y%m%d}"]
                 for d, v in sorted(realised.items()) if d <= today - dt.timedelta(days=3) and d >= start]
    write(f"{out}/realization_day_obs.csv", ["accrual_date", "sold_units", "sales_rub", "marketplace_charges_rub", "captured_at", "run_id"], real_rows)

    # ---------- FBO stock by cluster (07:15 daily incl. today) ----------
    stock_rows = []
    for d in [today - dt.timedelta(days=i) for i in range(6, -1, -1)]:
        for s in skus:
            base = {"A": 260, "B": 80, "C": 25}[s["abc"]]
            zero = rnd.random() < (0.12 if s["abc"] != "A" else 0.05)
            for c, w in CLUSTERS:
                if c in ("Far East", "Kazakhstan") and rnd.random() < 0.6:
                    continue
                q = 0 if zero else max(0, int(rnd.gauss(base * w * 1.4, base * w * 0.6)))
                stock_rows.append([d2s(d), s["offer_id"], s["sku"], c, WAREHOUSE[c], q, ts(d, 7, 15, rnd), f"STK-{d:%Y%m%d}"])
    write(f"{out}/fbo_stock_obs.csv", ["business_date", "offer_id", "sku", "cluster_name", "warehouse_name", "free_to_sell",
                                       "captured_at", "run_id"], stock_rows)

    # ---------- ads: CPC campaigns (D05-like daily payload), PPO report, expense ledger ----------
    camps = [("CPC-1001", "Search boost - serums", "DEMO-001"), ("CPC-1002", "Search boost - cleansers", "DEMO-003"),
             ("CPC-1003", "Catalog - new arrivals", None)]
    cpc_rows, ppo_rows, exp_rows = [], [], []
    for d in days:
        for cid, title, off in camps:
            if cid == "CPC-1003" and d < today - dt.timedelta(days=40):
                continue
            imp = int(rnd.gauss(5200, 900)) if cid != "CPC-1003" else int(rnd.gauss(2500, 600))
            clk = int(imp * rnd.uniform(0.012, 0.035))
            cpc = rnd.uniform(9, 22)
            spend = round(clk * cpc, 2)
            ords = sum(1 for _ in range(clk) if rnd.random() < 0.06)
            cpc_rows.append([d2s(d), cid, title, off or "", spend, imp, clk, int(clk * 0.22), ords,
                             round(ords * rnd.uniform(900, 1900), 2), ts(d + dt.timedelta(days=1), 5, 30, rnd)])
            exp_rows.append([d2s(d), cid, round(spend + rnd.choice([0, 0, 0, 0.5, -1.2]), 2), ts(d + dt.timedelta(days=1), 6, 5, rnd)])
        ppo_orders = rnd.randint(4, 14)
        ppo_rev = round(ppo_orders * rnd.uniform(900, 1700), 2)
        ppo_spend = round(ppo_rev * 0.05, 2)
        exp_rows.append([d2s(d), "PPO-ALL", ppo_spend, ts(d + dt.timedelta(days=1), 6, 5, rnd)])
        if d < today - dt.timedelta(days=1):  # PPO report missing for yesterday
            ppo_rows.append([d2s(d), ppo_spend, ppo_orders, ppo_rev, ts(d + dt.timedelta(days=1), 6, 20, rnd)])
    write(f"{out}/ads_cpc_campaign_day_obs.csv", ["stat_day", "campaign_id", "campaign_title", "offer_id", "spend_rub", "impressions", "clicks",
                                                  "cart_adds", "orders", "order_revenue_rub", "captured_at"], cpc_rows)
    write(f"{out}/ads_ppo_day_obs.csv", ["stat_day", "spend_rub", "orders", "order_revenue_rub", "captured_at"], ppo_rows)
    write(f"{out}/ads_expense_obs.csv", ["provider_day", "campaign_id", "expense_rub", "captured_at"], exp_rows)

    # ---------- promo actions (read-only snapshot of today's 08:40 run) ----------
    run_id, cap = f"PROMO-{today:%Y%m%d}", ts(today, 8, 41, rnd)
    actions = [("A-501", "Spring sale", "DISCOUNT", today - dt.timedelta(days=3), today + dt.timedelta(days=11)),
               ("A-502", "Elastic boosting", "BOOSTING", today - dt.timedelta(days=20), today + dt.timedelta(days=40)),
               ("A-503", "Weekend flash sale", "DISCOUNT", today + dt.timedelta(days=2), today + dt.timedelta(days=4))]
    write(f"{out}/promo_action_obs.csv", ["run_id", "action_id", "title", "action_type", "date_start", "date_end", "captured_at"],
          [[run_id, a, t, ty, d2s(f), d2s(e), cap] for a, t, ty, f, e in actions])
    prow = []
    for a, *_ in actions:
        for s in rnd.sample(skus, rnd.randint(6, 11)):
            p = cur_price[s["offer_id"]]
            src = rnd.choices(["PRODUCTS", "CANDIDATES", "AUTOADD"], [0.4, 0.45, 0.15])[0]
            disc = rnd.uniform(0.08, 0.45)
            prow.append([run_id, a, s["offer_id"], src, round(p * (1 - disc)), round(p * (1 - disc * 0.7)),
                         rnd.choice(["", 5, 10, 20]), d2s(today + dt.timedelta(days=1)) if src == "AUTOADD" else "", cap])
    write(f"{out}/promo_action_product_obs.csv", ["run_id", "action_id", "offer_id", "source", "action_price_rub", "max_action_price_rub",
                                                  "min_stock", "auto_add_date", "captured_at"], prow)

    # ---------- cash events (planned/confirmed), next ~120 days ----------
    ce = []
    for i in range(0, 120):
        d = today + dt.timedelta(days=i)
        if d.weekday() == 2:
            ce.append([d2s(d), "IN", "Marketplace payout", round(rnd.uniform(90_000, 160_000), -2), "ESTIMATE", "payout model"])
        if d.day == 5:
            ce.append([d2s(d), "OUT", "Payroll and contractors", -95_000, "PLANNED", "budget"])
            ce.append([d2s(d), "OUT", "Warehouse rent and software", -38_000, "PLANNED", "budget"])
        if d.day == 20:
            ce.append([d2s(d), "OUT", "Loan interest", -70_000, "CONFIRMED", "loan schedule"])
        if d.day == 25 and d.month in (4, 7):
            ce.append([d2s(d), "OUT", "Quarterly VAT", -round(rnd.uniform(60_000, 90_000), -2), "ESTIMATE", "tax model"])
        if d.day == 12 and i > 10:
            ce.append([d2s(d), "IN", "Retail chain payment", round(rnd.uniform(40_000, 120_000), -2), "ESTIMATE", "invoices + payment terms"])
    write(f"{out}/cash_event.csv", ["event_date", "direction", "label", "amount_rub", "status", "source"], ce)

    # ---------- parameters (all synthetic, illustrative) ----------
    params = [
        ("commission_pct", 0.28, "ESTIMATE", "marketplace fee rate used for the order model"),
        ("acquiring_pct", 0.015, "ESTIMATE", "payment processing"),
        ("logistics_rub_per_unit", 95, "ESTIMATE", "average FBO logistics per unit"),
        ("ppo_pct", 0.05, "OWNER_ACCEPTED", "pay-per-order ads rate on attributed sales"),
        ("vat_rate", 0.22, "OWNER_ACCEPTED", "VAT rate"),
        ("vat_base_share", 0.50, "ESTIMATE", "share of the seller price treated as VAT base in the model"),
        ("buyout_rate", 0.80, "ESTIMATE", "share of ordered units that end up bought"),
        ("fixed_costs_month_rub", 380_000, "OWNER_ACCEPTED", "fixed operating costs per month"),
        ("financing_cost_month_rub", 70_000, "OWNER_ACCEPTED", "interest per month (outside the P&L but inside break-even)"),
        ("promo_min_margin_pct", 15, "OWNER_ACCEPTED", "below this margin at the promo price -> DONT"),
        ("promo_target_margin_pct", 25, "OWNER_ACCEPTED", "between min and target -> OWNER_DECIDES"),
        ("promo_max_required_uplift_pct", 30, "OWNER_ACCEPTED", "required sales uplift above this -> OWNER_DECIDES"),
        ("cover_days_target", 45, "OWNER_ACCEPTED", "stock cover to plan shipments for"),
        ("order_share_window_days", 30, "OWNER_ACCEPTED", "window for cluster demand share"),
        ("sku_share_min_units_90d", 20, "OWNER_ACCEPTED", "min units for SKU-specific cluster share"),
        ("orders_max_staleness_days", 2, "OWNER_ACCEPTED", "older orders -> cluster share not trusted"),
        ("critical_stock_units", 5, "OWNER_ACCEPTED", "A/B SKUs at or below this are listed in the report"),
        ("cash_opening_rub", 40_000, "OWNER_STATED", "bank balance stated by the owner (not a bank statement)"),
        ("report_live_send_enabled", 0, "DRAFT", "1 + OWNER_ACCEPTED is required for a live Telegram send"),
    ]
    write(f"{out}/param.csv", ["param_key", "param_value", "status", "note", "set_at"],
          [[k, v, s, n, ts(start, 9, 0, rnd)] for k, v, s, n in params])
    write(f"{out}/cash_opening_meta.csv", ["as_of_date"], [[d2s(today - dt.timedelta(days=3))]])

    # ---------- load-run ledger (coverage-based load verification) ----------
    lr = []
    for d in days[-14:] + [today]:
        for src, hh in (("orders_by_sku", 5), ("fbo_postings", 7), ("fbo_stock", 7), ("seller_prices", 8), ("ads_cpc", 5), ("ads_ppo", 6)):
            if src == "orders_by_sku" and d == today:
                lr.append([f"{src}-{d:%Y%m%d}", src, d2s(d - dt.timedelta(days=1)), ts(d, hh, 30, rnd), "FAILED", 0, 0, "", "HTTP 429 after 4 retries"])
                continue
            n = rnd.randint(20, 400)
            lr.append([f"{src}-{d:%Y%m%d}", src, d2s(d - dt.timedelta(days=1)), ts(d, hh, 30, rnd), "COMPLETED", n, n,
                       hashlib.sha256(f"{src}{d}{n}".encode()).hexdigest(), ""])
    write(f"{out}/load_run.csv", ["run_id", "source", "business_date", "finished_at", "status", "rows_parsed", "rows_landed",
                                  "response_sha256", "error"], lr)
    with open(f"{out}/DEMO_TODAY", "w", newline="\n") as f:   # LF on every OS (.gitattributes eol=lf)
        f.write(args.today + "\n")


if __name__ == "__main__":
    main()
