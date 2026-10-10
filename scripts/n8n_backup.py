#!/usr/bin/env python3
"""Read-only backup of n8n workflows before any change, with a SHA-256 receipt.

Usage: python3 scripts/n8n_backup.py <workflow_id> [<workflow_id> ...] [--dir backups]
Writes backups/<ts>/<id>.json, SHA256SUMS and RECEIPT.md (who/when/active/versionId/node count).
Backups contain credential *references* of your instance - keep them out of git (see .gitignore)."""
import argparse, datetime as dt, hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n8n_client import n8n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="+"); ap.add_argument("--dir", default="backups")
    a = ap.parse_args()
    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    out = os.path.join(a.dir, ts); os.makedirs(out, exist_ok=True)
    sums, receipt = [], [f"# Backup {ts}", "", "| workflow | active | versionId | nodes | sha256 |", "|---|---|---|---|---|"]
    for wid in a.ids:
        s, w = n8n("GET", f"/workflows/{wid}", note="BACKUP")
        if s != 200:
            sys.exit(f"GET {wid} -> HTTP {s}: {str(w)[:300]}")
        raw = json.dumps(w, ensure_ascii=False, indent=1).encode()
        p = os.path.join(out, f"{wid}.json"); open(p, "wb").write(raw)
        h = hashlib.sha256(raw).hexdigest(); sums.append(f"{h}  {wid}.json")
        receipt.append(f"| {w.get('name')} | {w.get('active')} | {str(w.get('versionId'))[:8]} | {len(w.get('nodes', []))} | {h[:16]} |")
    open(os.path.join(out, "SHA256SUMS"), "w").write("\n".join(sums) + "\n")
    open(os.path.join(out, "RECEIPT.md"), "w").write("\n".join(receipt) + "\n")
    print("backup written to", out)


if __name__ == "__main__":
    main()
