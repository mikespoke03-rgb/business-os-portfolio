# Changelog

## 0.5.1 (local portfolio update, 2026-10-10)

- Answer gate: per-claim binding of each number to its own citation, sign-aware matching, metric-term check, read-only action-claim check, and the question passed into the gate (action requests and forecasts must be refused). 14 adversarial answers that v0.5 accepted are now blocked; recorded Grok Bot answers unchanged, 15/15 after fixing three grader false positives. `docs/llm-eval.md` states what the gate does and does not guarantee.
- PRD 002 AC4: idempotency key = Telegram delivery event; a new tap is a new decision version ordered by `update_id`; last tap wins (agree → decline → agree no longer loses the third tap).
- Build hours: «Учёт трудозатрат не вёлся»; leftover API-client wording removed.
- Line endings: `.gitattributes` with LF and binary rules, Python writers pin `newline`, a tooling test guards it.

## 0.5 (local portfolio update, 2026-10-10)

- AI layer is only Grok Bot (the owner's desktop assistant connected to Neon and n8n). Removed the model API client, the live-recording mode, the `LIVE` cassette source, the hosted-endpoint preset, its `.env.example` entries and docs; the test-only endpoint credential was revoked.
- `llm/answer.js`: `buildPrompt()` (masked facts → prompt for Grok Bot) and `gateAnswer()`, plus a CLI (`prompt` / `check`). Eval verifies the recorded Grok Bot answers (15/15).
- Case study and README filled with real-system facts in counts and relative terms (scale, before/after, decisions, two incidents); PRD 002 gets a hypothesis target.

## 0.4 (local portfolio update, 2026-10-10)

- Eval answers recorded via the Grok Bot desktop assistant (`source: GROK_BOT`, not an API call) from the exact module prompts with masked facts; 15/15 pass on the first run. CI eval uses them.
- Cassette loader with source types `GROK_BOT`, `LIVE`, `HAND_WRITTEN_FIXTURE`; hand-written answers moved to grader fixtures; saved prompts are checked against the module.
- A hosted model endpoint path was tried and then dropped by the owner in 0.5 (no live run happened).

## 0.3 (local portfolio update, 2026-10-10)

- Fixed report times shifting by 3 hours on UTC databases (exporter pins Europe/Moscow, renderer converts offsets); added UTC regression tests and a CI step that fails if the demo changes committed `examples/`.
- Made the unit-economics workbook byte-reproducible; demo output is flushed in order; `DEMO_TODAY` always LF.
- Added owner Q&A over report facts: masking config, a model client (removed in 0.5), deterministic grader, 15-question eval with recorded (hand-written) answers and 9 bad-answer fixtures; `package.json` with `npm test`.
- Added `CLAUDE.md` (imports `AGENTS.md`), PRD 002 with tasks 002–004 and the implemented button contract (task 002).
- `check.py` now runs all Node tests, the eval gate and rejects marketplace write endpoints in workflow exports.
- Static demo site generated from demo outputs and a GitHub Pages workflow.
- README starts in Russian with a quick start; case study rewritten in Russian with an AI-architecture section and placeholders for owner facts (filled in 0.5–0.5.1); channel names in README and workbook made generic.

## 0.2 (local portfolio update, 2026-10-10)

- Added Codex AGENTS.md, task brief and a case study separating author and agent roles.
- Added renderer/live eligibility, tooling and PostgreSQL business-rule regressions.
- Added Docker Compose demo and GitHub Actions, including required secret scanning.
- Added read-only renderer/export drift detection and restricted demo database targets.
- Fixed null contribution presentation and oversize delivery without dropping caveats.
- Replaced silent scanner-tool skips with a mandatory Gitleaks gate.

This records current work, not invented private Git history. Publication and remote CI results are separate steps.
