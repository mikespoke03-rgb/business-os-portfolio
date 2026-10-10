#!/usr/bin/env python3
"""Purchase-decision scenarios on top of the cash calendar (synthetic demo).

For each variant (no purchase / core SKUs / core + extended) the script builds a daily cash curve:
  opening balance (owner-stated) + planned cash events (sample_data/cash_event.csv)
  - purchase payments (deposit at order, balance at arrival)
  + payouts from selling the new batch (from arrival + inbound days, at the recent sales velocity, paid with a lag)
and reports: units, batch cost, 30-day and 13-week minimum balance (with dates), peak extra financing vs "no purchase",
payback date (cash >= no-purchase curve for good), cash gain at the horizon, and the cost of money at several annual rates.
Nothing is ordered or paid by this script - it is a decision aid for the owner.

Usage: python3 scripts/purchase_decision.py [--order-date 2026-04-20] [--out examples/purchase_scenarios_example.csv]
"""
import argparse, csv, datetime as dt, math, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SD = os.path.join(ROOT, "sample_data")

TERMS = {"deposit_share": 0.30, "lead_days": 45, "inbound_days": 5, "payout_lag_days": 21, "net_payout_share": 0.55,
         "cover_days": 60, "horizon_days": 150}
VARIANTS = {"V0 no purchase": set(), "V1 core (A)": {"A"}, "V2 core + extended (A+B)": {"A", "B"}}
RATES = (0.24, 0.36, 0.60)


def rd(name):
    with open(os.path.join(SD, name), encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    ap = argparse.ArgumentParser()
    today = dt.date.fromisoformat(open(os.path.join(SD, "DEMO_TODAY")).read().strip())
    ap.add_argument("--order-date", default=(today + dt.timedelta(days=5)).isoformat())
    ap.add_argument("--out", default=os.path.join(ROOT, "examples", "purchase_scenarios_example.csv"))
    a = ap.parse_args()
    order = dt.date.fromisoformat(a.order_date)
    T = TERMS
    params = {r["param_key"]: float(r["param_value"]) for r in rd("param.csv")}
    opening_day = dt.date.fromisoformat(rd("cash_opening_meta.csv")[0]["as_of_date"])
    base = defaultdict(float)
    for e in rd("cash_event.csv"):
        base[dt.date.fromisoformat(e["event_date"])] += float(e["amount_rub"])
    sku = {r["offer_id"]: r for r in rd("sku.csv")}
    cost = {r["offer_id"]: float(r["cogs_ex_vat_rub"]) + float(r["customs_vat_rub"]) for r in rd("sku_cost_obs.csv")}
    # recent velocity (last 28 loaded days) and latest price per SKU
    orders = rd("order_day_sku_obs.csv")
    last = max(dt.date.fromisoformat(r["business_date"]) for r in orders)
    vel = defaultdict(float)
    for r in orders:
        if (last - dt.date.fromisoformat(r["business_date"])).days < 28:
            vel[r["offer_id"]] += (int(r["ordered_units"]) - int(r["cancelled_units"])) / 28
    price = {}
    for r in rd("seller_price_obs.csv"):
        price[r["offer_id"]] = float(r["seller_price_rub"])
    last_event = max(base)  # do not extrapolate beyond the planned cash events
    end = min(order + dt.timedelta(days=T["horizon_days"]), last_event)
    days = [opening_day + dt.timedelta(days=i) for i in range((end - opening_day).days + 1)]

    curves, summary = {}, []
    for name, classes in VARIANTS.items():
        flows = defaultdict(float, base)
        units = {o: math.ceil(vel[o] * T["cover_days"]) for o, s in sku.items() if s["abc_class"] in classes}
        batch = sum(u * cost[o] for o, u in units.items())
        arrive = order + dt.timedelta(days=T["lead_days"])
        flows[order] -= batch * T["deposit_share"]
        flows[arrive] -= batch * (1 - T["deposit_share"])
        for o, u in units.items():  # sell at velocity from arrival + inbound, payout lagged
            left, d = u, arrive + dt.timedelta(days=T["inbound_days"])
            while left > 0:
                q = min(left, vel[o])
                flows[d + dt.timedelta(days=T["payout_lag_days"])] += q * price[o] * T["net_payout_share"]
                left -= q; d += dt.timedelta(days=1)
        bal, cur = {}, params["cash_opening_rub"]
        for d in days:
            cur += flows.get(d, 0.0); bal[d] = cur
        curves[name] = bal
        w30 = [d for d in days if today <= d <= today + dt.timedelta(days=30)]
        w13 = [d for d in days if today <= d <= today + dt.timedelta(weeks=13)]
        m30 = min(w30, key=lambda d: bal[d]); m13 = min(w13, key=lambda d: bal[d])
        summary.append(dict(variant=name, units=sum(units.values()), batch_cost_rub=round(batch), order_date=order.isoformat(),
                            arrival_date=arrive.isoformat(), min_30d_rub=round(bal[m30]), min_30d_date=m30.isoformat(),
                            min_13w_rub=round(bal[m13]), min_13w_date=m13.isoformat(), balance_at_horizon_rub=round(bal[days[-1]]),
                            horizon_date=days[-1].isoformat()))
    v0 = curves["V0 no purchase"]
    for s in summary:
        c = curves[s["variant"]]
        gap = {d: max(0.0, v0[d] - c[d]) for d in days}
        s["peak_extra_financing_rub"] = round(max(gap.values()))
        s["peak_extra_financing_date"] = max(days, key=lambda d: gap[d]).isoformat() if s["peak_extra_financing_rub"] else ""
        pay = next((d for i, d in enumerate(days) if d >= order and all(c[x] >= v0[x] for x in days[i:])), None)
        s["payback_date"] = (pay.isoformat() if pay else "not within horizon") if s["batch_cost_rub"] else ""
        s["cash_gain_at_horizon_rub"] = round(c[days[-1]] - v0[days[-1]])
        for r in RATES:
            s[f"cost_of_money_{int(r * 100)}pct_rub"] = round(sum(gap.values()) * r / 365)
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(summary[0].keys()))
        w.writeheader(); w.writerows(summary)
    for s in summary:
        print(s)
    print("written", a.out)


if __name__ == "__main__":
    main()
