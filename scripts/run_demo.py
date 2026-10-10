#!/usr/bin/env python3
"""End-to-end demo on synthetic data:
  1) (re)generate sample_data/*.csv           3) export analytics.v_report_facts -> examples/facts_example.json
  2) create schema + load into DATABASE_URL    4) render the 09:00 report (RU + EN) -> examples/report_example*.txt
  5) purchase scenarios CSV                    6) unit-economics workbook
Usage: DATABASE_URL=postgresql://... python3 scripts/run_demo.py [--no-generate]
The database must be a throw-away one: the loader drops and recreates the raw/ops/analytics schemas."""
import argparse, os, subprocess, sys
from demo_safety import validate_demo_database

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(*cmd):
    print("$", " ".join(cmd), flush=True); subprocess.run(cmd, cwd=ROOT, check=True)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--no-generate", action="store_true"); a = ap.parse_args()
    if not os.environ.get("DATABASE_URL"):
        sys.exit("DATABASE_URL is not set (see .env.example)")
    try:
        validate_demo_database(os.environ['DATABASE_URL'])
    except ValueError as error:
        sys.exit(str(error))
    py = sys.executable
    if not a.no_generate:
        run(py, "scripts/generate_synthetic_data.py")
    run(py, "scripts/load_sample_data.py", "--reset")
    run(py, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_sql.py')
    run(py, "scripts/export_report_facts.py")
    for lang, fn in (("ru", "report_example.txt"), ("en", "report_example_en.txt")):
        out = subprocess.run(["node", "scripts/render_report.js", "examples/facts_example.json", lang, "DRY_RUN"],
                             cwd=ROOT, check=True, capture_output=True, text=True, encoding='utf-8').stdout
        open(os.path.join(ROOT, "examples", fn), "w", encoding="utf-8", newline="\n").write(out)
        print(f"rendered examples/{fn} ({len(out)} chars)", flush=True)
    run(py, "scripts/purchase_decision.py")
    run(py, "scripts/build_unit_economics_xlsx.py")
    run(py, "scripts/inline_renderer_into_workflow.py", '--check')


if __name__ == "__main__":
    main()
