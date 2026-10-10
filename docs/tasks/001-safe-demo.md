# Task 001: safe demo and regression gates

Status: implemented locally in portfolio v0.2; publication not authorized.

## Owner result and scope

A reviewer can run a daily report and inspect its business rules without receiving credentials or commercial data. Changes cover the synthetic Docker demo, tests, CI, documentation and demonstrated regressions. No production calls, imports, sends or deployment.

## Acceptance

- Missing contribution is not zero margin or 0% coverage.
- Stale orders name both expected and last loaded day.
- Live eligibility requires accepted owner flag and scheduled trigger; oversized/internal-error text is blocked.
- Exported claim SQL refuses a second daily claim.
- Actual PostgreSQL tests cover latest observations, missing values, append-only and facts.
- Demo refuses an external/wrongly named database before generation/reset/connection.
- Export drift fails a read-only check; missing scanner tooling fails closed.
- CI defines clean Postgres and Docker runs, without claiming remote success before execution.

## Work record

The first test reproduced missing contribution → zero margin/coverage. Validator tests failed before the protection existed. Implemented the fixes, regenerated the export and reran checks. Exact results and environment gaps are in `docs/verification-v02.md`.

## Deferred

Actual API responses, n8n execution mechanics, message-id receipts, accounting policy, SKU-level completeness and production cutover. Synthetic success does not accept these.
