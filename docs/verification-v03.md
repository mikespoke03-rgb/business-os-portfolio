# Portfolio v0.3 verification

Date: 2026-10-10. Scope: local synthetic reconstruction on a Linux box. No publication, no push, no production calls. The v0.2 record is kept in [verification-v02.md](verification-v02.md).

## Evidence

| Check | Result | Boundary |
|---|---|---|
| Node tests (`npm test`, `node --test`): renderer 21, Q&A masking 7, grader + bad answers 15, LLM client 5, promo buttons 5 | PASS, 53 tests | Fake `fetch`; no model, Telegram or n8n calls |
| Owner Q&A eval on committed answers (`node llm/eval.js`) | PASS, 15/15 | Answers are **hand-written fixtures**, not model outputs |
| Grader rejects 9 deliberately bad answers, each by the expected check | PASS | Part of the 53 Node tests |
| Python tooling tests | PASS, 7 tests | Isolated fixtures |
| PostgreSQL business-rule tests, incl. new export-in-UTC-session test | PASS, 12 tests | PostgreSQL 17.11, server `timezone = 'UTC'` (as Neon / the postgres image), disposable DB |
| `run_demo.py --no-generate` then `git diff --exit-code -- examples/` (new CI step), in a temporary git repo | PASS, examples byte-identical | Same step on the v0.2 tree with a UTC server fails: report times shift by 3 hours, xlsx changes |
| Docker build + container demo (Python 3.12, Node 22, PostgreSQL 16 image) | PASS, `DEMO_COMPLETE`; all 5 outputs byte-identical to `examples/` | On this box container-to-container networking does not work even for two plain postgres containers, so the demo service shared the DB container's network namespace via a local override file (`network_mode: service:demo-db`, `DATABASE_URL` host `localhost`). The committed `compose.yaml` network path was not exercised here |
| Gitleaks 8.30.1 (checksum verified), working tree + full history of a temporary git repo | PASS | No guarantee of commercial-data anonymization; human review still required |
| Static site build + headless Chrome screenshot | PASS | Local file; GitHub Pages deployment not run |
| GitHub Actions (`ci.yml`, `pages.yml`) | NOT RUN | Not published. Workflows parsed as YAML; steps were executed locally one by one |
| Live LLM run | NOT RUN | No API key on this machine (the live mode was removed in v0.5: the AI layer is Grok Bot only) |

## Defect fixed in v0.3

`analytics.v_report_facts` serialises `timestamptz` in the session time zone, and the renderer cut the time out of the string. With a UTC database (Docker, CI, Neon default) the report said "snapshot 15.04 05:48" instead of 08:48. Local runs did not catch it because the local server was in Moscow time. Fix: `scripts/export_report_facts.py` pins `TimeZone = Europe/Moscow` for the session; `scripts/render_report.js` converts any offset to Moscow time (Intl with a fixed UTC+3 fallback). The n8n query is unchanged; the inlined renderer makes it robust there too. Regression tests: export in a UTC session (SQL), UTC offsets and a near-midnight timestamp (Node); both Node tests fail on the v0.2 renderer.

## Remaining limits

Hand-written Q&A answers prove the grader and the format, not a model. The grader checks grounding, not usefulness. Tasks 003–004 of PRD 002 are planned, not built. The real-system evidence (scale, effect, incidents) was left as placeholders for the owner (filled in v0.5–v0.5.1).
