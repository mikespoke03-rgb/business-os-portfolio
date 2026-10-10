# Portfolio v0.4 verification

Date: 2026-10-10 (Moscow). Scope: local synthetic reconstruction. No publication, no push. Earlier records: [v0.3](verification-v03.md), [v0.2](verification-v02.md).

## Step 1: Grok Bot answers

| Item | Result |
|---|---|
| Prompts | 15 files `llm/eval/grok_bot/prompts/qNN.json`, built by `buildMessages()` from masked facts; a test checks they equal what the module builds and contain no masked values |
| Answers | `llm/eval/cassettes/grok_bot.json`, `source: GROK_BOT`, recorded 2026-10-10T15:29:41+03:00, "recorded via Grok Bot desktop assistant; not an API call". All 15 written before grading; not edited afterwards |
| Gate | 15/15 PASS on the first run (q01–q15). No failures, so no grader change was needed |
| Caveat | The same Grok Bot session authored the questions and the v0.3 hand-written fixtures, so the answers are not blind |
| Hand-written fixtures | Moved to `llm/eval/fixtures/hand_written.json`; used only as positive grader tests. 9 bad-answer fixtures remain negative tests |
| Loader | `loadCassette` accepts `GROK_BOT`, `LIVE`, `HAND_WRITTEN_FIXTURE` with required fields; rejects unknown sources (tested) |

## Step 2: hosted model endpoint (dropped in v0.5)

A hosted model endpoint path was tried: completions needed a billing change, so no live run happened. In v0.5 the owner dropped this path entirely; the client, its docs and the test-only credential were removed or revoked. See [v0.5](verification-v05.md).

## Checks

| Check | Result |
|---|---|
| Node tests (`npm test`) | PASS, 58 tests |
| Eval (`node llm/eval.js`, GROK_BOT) | PASS, 15/15 |
| `python scripts/check.py --sql` (Python tooling 7, PostgreSQL 12 on a UTC server) | PASS |
| `run_demo.py --no-generate` + `git diff --exit-code -- examples/` (temporary git repo) | PASS |
| Gitleaks 8.30.1, working tree + history of a temporary git repo | PASS |
| GitHub Actions / Pages | NOT RUN (not published) |
