"""Minimal n8n public-API client with an action log (every call is appended to receipts/N8N_ACTIONS.jsonl).
Configuration via environment: N8N_BASE_URL (e.g. https://<your-instance>/api/v1) and N8N_API_KEY."""
import datetime as dt, json, os, urllib.error, urllib.request

LOG_DIR = os.environ.get("RECEIPTS_DIR", "receipts")


def n8n(method, path, body=None, note=""):
    base, key = os.environ["N8N_BASE_URL"].rstrip("/"), os.environ["N8N_API_KEY"]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"X-N8N-API-KEY": key, "Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(os.path.join(LOG_DIR, "N8N_ACTIONS.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "method": method,
                            "path": path.split("?")[0], "http_status": status, "note": note}) + "\n")
    try:
        return status, json.loads(raw or b"{}")
    except ValueError:
        return status, {"raw": raw[:500].decode(errors="replace")}
