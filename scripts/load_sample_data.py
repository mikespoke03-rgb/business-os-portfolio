#!/usr/bin/env python3
"""Create the demo schema in an EMPTY Postgres database and load sample_data/*.csv.

Usage: set DATABASE_URL for local bos_portfolio_demo, then run this script [--reset].
--reset drops the raw/ops/analytics schemas first (only use on a throw-away demo database).
"""
import argparse, glob, os, sys
import psycopg2
from demo_safety import validate_demo_database

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLES = [  # (csv file, target table) - load order respects foreign keys
    ("sku.csv", "raw.sku"), ("sku_cost_obs.csv", "raw.sku_cost_obs"), ("order_day_sku_obs.csv", "raw.order_day_sku_obs"),
    ("fbo_posting_line_obs.csv", "raw.fbo_posting_line_obs"), ("realization_day_obs.csv", "raw.realization_day_obs"),
    ("seller_price_obs.csv", "raw.seller_price_obs"), ("fbo_stock_obs.csv", "raw.fbo_stock_obs"),
    ("ads_cpc_campaign_day_obs.csv", "raw.ads_cpc_campaign_day_obs"), ("ads_ppo_day_obs.csv", "raw.ads_ppo_day_obs"),
    ("ads_expense_obs.csv", "raw.ads_expense_obs"), ("promo_action_obs.csv", "raw.promo_action_obs"),
    ("promo_action_product_obs.csv", "raw.promo_action_product_obs"), ("cash_event.csv", "raw.cash_event"),
    ("param.csv", "ops.param"), ("cash_opening_meta.csv", "ops.cash_opening_meta"), ("load_run.csv", "ops.load_run")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true")
    a = ap.parse_args()
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL is not set (see .env.example)")
    try:
        validate_demo_database(dsn)
    except ValueError as error:
        sys.exit(str(error))
    con = psycopg2.connect(dsn, connect_timeout=5)
    con.autocommit = False
    cur = con.cursor()
    if a.reset:
        cur.execute("DROP SCHEMA IF EXISTS analytics, ops, raw, landing CASCADE")
    for f in sorted(glob.glob(os.path.join(ROOT, "sql", "[0-8]*.sql"))):
        cur.execute(open(f, encoding="utf-8").read())
        print("applied", os.path.basename(f))
    for fn, table in TABLES:
        with open(os.path.join(ROOT, "sample_data", fn), encoding="utf-8") as fh:
            header = fh.readline().strip()
            fh.seek(0)
            cur.copy_expert(f"COPY {table} ({header}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')", fh)
        cur.execute(f"SELECT count(*) FROM {table}")
        print(f"loaded {table:32s} {cur.fetchone()[0]:7d}")
    con.commit()
    con.close()


if __name__ == "__main__":
    main()
