# Purchase decision

**Goal.** Compare purchase variants by what they do to cash, not only to margin: minimum balance, extra financing needed and when it pays back.

**Inputs.** Owner-stated opening balance and planned cash events (`sample_data/cash_event.csv`), SKU classes and sales velocity, unit cost, payment terms (deposit share, lead time, inbound days, payout lag, net payout share), cover days.

**Logic** (`scripts/purchase_decision.py`): for V0 (no purchase), V1 (core A SKUs) and V2 (A + B) build a daily cash curve: opening + planned events − deposit at order − balance at arrival + payouts from selling the new batch (after inbound days, at the recent velocity, with the payout lag). Report units, batch cost, 30-day and 13-week minimum balance with dates, peak extra financing vs V0, payback date, cash gain at the horizon and the cost of money at 24 / 36 / 60 % a year. The horizon is capped at the last planned cash event.

**Output.** `examples/purchase_scenarios_example.csv`.

**Limits.** Decision aid only; constant velocity, no stock-outs or price changes modelled; terms are synthetic.
