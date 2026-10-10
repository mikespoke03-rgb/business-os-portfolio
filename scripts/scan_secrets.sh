#!/usr/bin/env bash
# Compatibility entrypoint. Python + mandatory Gitleaks, no silent skips.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 scripts/scan_secrets.py "$@"
