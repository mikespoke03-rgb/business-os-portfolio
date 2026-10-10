#!/usr/bin/env python3
"""Cross-platform local checks. --sql requires a preloaded disposable Postgres."""
import argparse
import ast
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
# Marketplace methods that change promotions, prices or stock. Collectors must stay read-only (PRD 002, AC6).
WRITE_ENDPOINTS = ('/actions/products/activate', '/actions/products/deactivate', '/product/import/prices',
                   '/products/stocks', '/product/import', '/product/update')

def run(*args): subprocess.run(args, cwd=ROOT, check=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sql', action='store_true')
    args = parser.parse_args()
    for folder in ('scripts', 'tests'):
        for file in sorted((ROOT / folder).glob('*.py')):
            ast.parse(file.read_text(encoding='utf-8'), filename=str(file.relative_to(ROOT)))
    for folder in ('scripts', 'llm', 'site'):
        for file in sorted((ROOT / folder).glob('*.js')): run('node', '--check', str(file))
    for file in sorted((ROOT / 'workflows').glob('*.json')):
        workflow = json.loads(file.read_text(encoding='utf-8'))
        if workflow.get('active') is not False:
            raise ValueError(f'Export must be inactive: {file.name}')
        if any(k in workflow for k in ('pinData', 'staticData')):
            raise ValueError(f'Execution data is forbidden: {file.name}')
        for node in workflow['nodes']:
            if node.get('credentials'): raise ValueError(f'Live credentials are forbidden: {file.name}')
        text = file.read_text(encoding='utf-8')
        hits = [e for e in WRITE_ENDPOINTS if e in text]
        if hits: raise ValueError(f'Marketplace write endpoint in {file.name}: {hits}')
    run('node', '--test', *[str(f.relative_to(ROOT)) for f in sorted((ROOT / 'tests').glob('*.test.js'))])
    run('node', 'llm/eval.js')                    # owner Q&A eval gate on recorded answers, no API key
    run(sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_tooling.py')
    run(sys.executable, 'scripts/inline_renderer_into_workflow.py', '--check')
    if args.sql: run(sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_sql.py')
    print('CHECK_PASS' + (' including PostgreSQL integration' if args.sql else ' (SQL suite not requested)'))

if __name__ == '__main__': main()
