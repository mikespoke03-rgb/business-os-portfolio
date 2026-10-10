#!/usr/bin/env python3
"""Restore an n8n workflow from a backup made by n8n_backup.py.

Safety rules (from the production version):
  * the backup file must match its SHA-256 in SHA256SUMS, otherwise nothing is done;
  * dry run by default - prints what would change; pass --apply to PUT;
  * if nodes/connections already equal the backup, only the active state is restored;
  * after PUT the workflow is read back and the result is printed (active, node count, schedule).
Usage: python3 scripts/n8n_rollback.py backups/<ts>/<workflow_id>.json [--apply]"""
import argparse, hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n8n_client import n8n


def verify(path):
    sums = os.path.join(os.path.dirname(path), "SHA256SUMS")
    want = {l.split()[1]: l.split()[0] for l in open(sums) if l.strip()}
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if want.get(os.path.basename(path)) != got:
        sys.exit(f"SHA-256 mismatch for {path}: refusing to restore")
    return got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("backup"); ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    h = verify(a.backup)
    b = json.load(open(a.backup, encoding="utf-8"))
    wid = b["id"]
    s, cur = n8n("GET", f"/workflows/{wid}", note="ROLLBACK pre-read")
    if s != 200:
        sys.exit(f"GET {wid} -> HTTP {s}")
    same = cur["nodes"] == b["nodes"] and cur["connections"] == b["connections"]
    print(f"backup sha256 {h[:16]}; live equals backup: {same}; live active {cur.get('active')} / backup active {b.get('active')}")
    if not a.apply:
        print("dry run - nothing changed (use --apply)"); return
    if not same:
        body = {k: b[k] for k in ("name", "nodes", "connections", "settings")}
        s, j = n8n("PUT", f"/workflows/{wid}", body, note="ROLLBACK PUT")
        print("PUT", s, "" if s == 200 else str(j)[:300])
    if b.get("active") and not cur.get("active") or (not same and b.get("active")):
        n8n("POST", f"/workflows/{wid}/activate", note="ROLLBACK activate")
    s, w = n8n("GET", f"/workflows/{wid}", note="ROLLBACK readback")
    sched = [n["parameters"].get("rule") for n in w["nodes"] if n["type"].endswith("scheduleTrigger")]
    print("readback: active", w.get("active"), "nodes", len(w["nodes"]), "schedule", sched,
          "equals backup", w["nodes"] == b["nodes"] and w["connections"] == b["connections"])


if __name__ == "__main__":
    main()
