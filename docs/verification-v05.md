# Portfolio v0.5 verification

Date: 2026-10-10 (Moscow). Scope: local synthetic reconstruction. No publication, no push. Earlier records: [v0.4](verification-v04.md), [v0.3](verification-v03.md), [v0.2](verification-v02.md).

## AI layer: Grok Bot only

| Item | Result |
|---|---|
| Decision | The owner's AI interface is the Grok Bot desktop assistant connected to Neon and n8n. There is no model API client in the system |
| Removed | The model API client, the live-recording mode and its npm script, the `LIVE` cassette source and its folder, the hosted-endpoint preset, its `.env.example` entries and docs, client tests |
| Test-only endpoint credential | Revoked in Neon (confirmed by `revoked_at` in the credential list); the box-local env file was deleted. It was never in the repository |
| Kept | `llm/answer.js`: `buildPrompt()` (masked facts → prompt for Grok Bot), `gateAnswer()` and a CLI (`prompt`, `check`); the eval replays the recorded Grok Bot answers. The loader rejects API-recorded (`LIVE`) cassettes (tested) |

## Real-system facts in the case study

The case study and README now contain facts from the owner's running system, in counts, dates and relative terms only (no brand, SKU names, suppliers or absolute money). Sources were read without changes: the project's decision log, run receipts and analysis packs. Time saved (~4 working hours a day) is the owner's estimate. Build hours were never tracked (v0.5.1 states this instead of a placeholder). The PRD 002 target is a hypothesis, labelled as such.

## Checks

| Check | Result |
|---|---|
| Node tests (`npm test`) | PASS, 54 tests (client tests replaced by prompt/gate tests) |
| Eval (`node llm/eval.js`, GROK_BOT) | PASS, 15/15 |
| `python scripts/check.py --sql` (Python tooling 7, PostgreSQL 12 on a UTC server) | PASS |
| `run_demo.py --no-generate`, `examples/` compared with v0.4 | PASS, identical |
| Gitleaks 8.30.1, working tree + history of a temporary git repo | PASS |
| GitHub Actions / Pages | NOT RUN (not published) |
