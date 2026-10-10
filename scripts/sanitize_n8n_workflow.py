#!/usr/bin/env python3
"""Strip an n8n workflow export down to publishable node logic.

Removes: credentials blocks (ids and names), pinData, staticData, execution/version metadata, instance/project ids,
tags, sharing info, webhookIds, node ids (regenerated deterministically), Telegram chat ids, n8n instance URLs,
connection strings, bot tokens and e-mails found in any string. Optional --map adds project-specific regex
replacements (keep that file OUTSIDE the repository - it necessarily contains the real values it replaces).

Usage: python3 scripts/sanitize_n8n_workflow.py in.json out.json [--map private_replacements.json] [--name "New name"]
"""
import argparse, json, re, sys, uuid

TOP_KEEP = ("name", "nodes", "connections", "settings")
SETTINGS_KEEP = ("executionOrder", "timezone", "executionTimeout", "saveManualExecutions")
NODE_KEEP = ("parameters", "name", "type", "typeVersion", "position", "onError", "alwaysOutputData", "retryOnFail",
             "maxTries", "waitBetweenTries", "executeOnce", "notes", "notesInFlow", "disabled")
NS = uuid.UUID("6f1d3c0e-0000-4000-8000-000000000000")
BUILTIN = [  # (regex, replacement) applied to every string value
    (r"https?://[a-z0-9-]+\.app\.n8n\.cloud[^\s\"'`]*", "{{N8N_BASE_URL}}"),
    (r"https?://[^\s\"'`]*/webhook(-test)?/[^\s\"'`]*", "{{N8N_WEBHOOK_URL}}"),
    (r"postgres(ql)?://[^\s\"'`]+", "{{DATABASE_URL}}"),
    (r"\b[0-9]{8,10}:[A-Za-z0-9_-]{35}\b", "{{TELEGRAM_BOT_TOKEN}}"),
    (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "{{EMAIL}}"),
    (r"ep-[a-z]+-[a-z]+-[a-z0-9]+(-pooler)?\.[a-z0-9.-]*neon\.tech", "{{NEON_HOST}}"),
]


def scrub(v, rules, stats):
    if isinstance(v, str):
        for rx, rep in rules:
            v2, n = re.subn(rx, rep, v)
            if n:
                key = "replaced -> " + (rep if len(rep) <= 40 else rep[:37] + "...")
                stats[key] = stats.get(key, 0) + n
                v = v2
        return v
    if isinstance(v, list):
        return [scrub(x, rules, stats) for x in v]
    if isinstance(v, dict):
        return {k: scrub(x, rules, stats) for k, x in v.items()}
    return v


def regen_condition_ids(v, wf):
    if isinstance(v, dict):
        out = {}
        for k, x in v.items():
            if k == "id" and isinstance(x, str) and re.fullmatch(r"[0-9a-f-]{36}", x):
                x = str(uuid.uuid5(NS, wf + ":" + x))
            out[k] = regen_condition_ids(x, wf)
        return out
    if isinstance(v, list):
        return [regen_condition_ids(x, wf) for x in v]
    return v


def sanitize(w, rules, new_name=None):
    stats = {}
    if "nodes" not in w and isinstance(w.get("data"), dict):
        w = w["data"]
    out = {k: w[k] for k in TOP_KEEP if k in w}
    if new_name:
        out["name"] = new_name
    out["settings"] = {k: v for k, v in (w.get("settings") or {}).items() if k in SETTINGS_KEEP}
    nodes = []
    for n in w["nodes"]:
        m = {k: n[k] for k in NODE_KEEP if k in n}
        if n.get("credentials"):
            kinds = ", ".join(sorted(n["credentials"].keys()))
            hint = f"Credential required: {kinds} (attach your own after import)"
            m["notes"] = (m.get("notes", "") + "\n" + hint).strip()
            stats["credentials blocks removed"] = stats.get("credentials blocks removed", 0) + 1
        if n.get("webhookId"):
            stats["webhookIds removed"] = stats.get("webhookIds removed", 0) + 1
        if n["type"].endswith(".telegram") and "chatId" in m.get("parameters", {}):
            m["parameters"]["chatId"] = "={{ $env.TELEGRAM_CHAT_ID }}"
            stats["telegram chatId replaced"] = stats.get("telegram chatId replaced", 0) + 1
        m["id"] = str(uuid.uuid5(NS, out["name"] + ":" + n["name"]))
        nodes.append(m)
    out["nodes"] = regen_condition_ids(nodes, out["name"])
    out = scrub(out, rules, stats)
    for k in ("id", "pinData", "staticData", "meta", "versionId", "activeVersionId", "activeVersion", "shared", "tags",
              "createdAt", "updatedAt", "triggerCount", "versionCounter", "sourceWorkflowId", "isArchived", "description"):
        if k in w:
            stats[f"top-level '{k}' dropped"] = 1
    out["active"] = False
    return out, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--map", help="JSON list of {pattern, replace}")
    ap.add_argument("--name")
    a = ap.parse_args()
    rules = list(BUILTIN)
    if a.map:
        rules = [(r["pattern"], r["replace"]) for r in json.load(open(a.map, encoding="utf-8"))] + rules
    w = json.load(open(a.src, encoding="utf-8"))
    out, stats = sanitize(w, rules, a.name)
    with open(a.dst, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{a.dst}: {len(out['nodes'])} nodes;", "; ".join(f"{k}: {v}" for k, v in sorted(stats.items())), file=sys.stderr)


if __name__ == "__main__":
    main()
