# Cash calendar

**Goal.** A 120-day running balance so the report can warn about the next big payment and the 30-day minimum.

**Inputs.** Opening balance with its status (`OWNER_STATED` – not a bank statement) and date, planned / estimated cash events.

**Logic** (`sql/16_views_cash_calendar.sql`): balance = opening + cumulative inflows and outflows; each day lists its events and whether any of them is an `ESTIMATE`.

**Outputs.** Cash section of the daily report (next outflow, 30-day minimum) and the input to `purchase_decision.py`.

**Limits.** Only as good as the event list; if the opening balance is wrong by X, the whole curve is shifted by X – the report says so.
