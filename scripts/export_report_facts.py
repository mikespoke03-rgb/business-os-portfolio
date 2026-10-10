#!/usr/bin/env python3
"""Read analytics.v_report_facts (one jsonb row) and write it to a JSON file.

Usage: DATABASE_URL=... python3 scripts/export_report_facts.py [--today 2026-04-15] [--out examples/facts_example.json]
--today pins analytics.today_msk() for a reproducible demo (defaults to sample_data/DEMO_TODAY).
"""
import argparse, json, os
import psycopg2
from demo_safety import validate_demo_database

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


BUSINESS_TZ = 'Europe/Moscow'


def read_facts(con, today):
    """Return analytics.v_report_facts.j with timestamps rendered in business time.

    timestamptz values are serialised in the *session* time zone. Neon and the postgres Docker image default to UTC,
    so the session is pinned here instead of relying on server or client defaults."""
    with con.cursor() as cur:
        cur.execute("SELECT set_config('TimeZone', %s, false)", (BUSINESS_TZ,))
        cur.execute("SELECT set_config('bos.today', %s, false)", (today,))
        cur.execute("SELECT j FROM analytics.v_report_facts")
        return cur.fetchone()[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=open(os.path.join(ROOT, "sample_data", "DEMO_TODAY")).read().strip())
    ap.add_argument("--out", default=os.path.join(ROOT, "examples", "facts_example.json"))
    a = ap.parse_args()
    dsn = validate_demo_database(os.environ.get('DATABASE_URL', ''))
    con = psycopg2.connect(dsn, connect_timeout=5)
    try:
        j = read_facts(con, a.today)
    finally:
        con.close()
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:   # LF on every OS
        json.dump(j, f, ensure_ascii=False, indent=1, default=str)
    print("facts written to", a.out)


if __name__ == "__main__":
    main()
