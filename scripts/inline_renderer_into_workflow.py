#!/usr/bin/env python3
"""Generate the shared Code node, or --check it without writing anything."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
WF = ROOT / 'workflows/daily_report_0900.json'

def expected_code():
    renderer = (ROOT / 'scripts/render_report.js').read_text(encoding='utf-8').split('// ---- CLI ----')[0]
    glue = (ROOT / 'scripts/n8n_report_glue.js').read_text(encoding='utf-8')
    return ('// GENERATED from scripts/render_report.js + scripts/n8n_report_glue.js - edit those files, then re-run\n'
            '// python3 scripts/inline_renderer_into_workflow.py\n' + renderer.rstrip() + '\n\n' + glue)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--workflow', type=Path, default=WF)
    args = parser.parse_args()
    workflow = json.loads(args.workflow.read_text(encoding='utf-8'))
    nodes = [n for n in workflow['nodes'] if n['name'] == 'Build Report Message']
    if len(nodes) != 1:
        sys.exit('WORKFLOW_SYNC_FAILED: expected exactly one renderer node')
    expected = expected_code()
    if args.check:
        if nodes[0]['parameters']['jsCode'] != expected:
            sys.exit('WORKFLOW_SYNC_FAILED: regenerate the export before committing')
        print('WORKFLOW_SYNC_PASS (read-only)')
    else:
        nodes[0]['parameters']['jsCode'] = expected
        args.workflow.write_bytes((json.dumps(workflow, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))   # LF on every OS
        print('Workflow renderer regenerated')

if __name__ == '__main__': main()
