#!/usr/bin/env python3
"""Mandatory Gitleaks scan. Missing tools and scan errors never mean clean."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-history', action='store_true', help='For archives only; not a publication gate')
    args = parser.parse_args()
    executable = os.environ.get('GITLEAKS') or shutil.which('gitleaks')
    if not executable or not Path(executable).is_file():
        sys.exit('SECRET_SCAN_NOT_RUN: install Gitleaks; absence is not a clean result')
    history = subprocess.run(['git', 'rev-parse', '--is-inside-work-tree'], cwd=ROOT, capture_output=True)
    if not args.no_history and history.returncode:
        sys.exit('SECRET_SCAN_NOT_RUN: Git history is required for the publication gate')
    for mode in (('dir',) if args.no_history else ('dir', 'git')):
        command = [executable, mode, '.', '--no-banner', '--redact=100', '--log-level', 'error']
        if mode == 'git': command += ['--log-opts=--all']
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        if result.returncode:
            # Do not echo findings, source lines or external tool diagnostics into a chat/log.
            sys.exit(f'SECRET_SCAN_FAILED: {mode}, exit {result.returncode}; investigate locally with redaction')
    print('SECRET_SCAN_PASS: working tree' + (' only; history not checked' if args.no_history else ' and full Git history'))

if __name__ == '__main__': main()
