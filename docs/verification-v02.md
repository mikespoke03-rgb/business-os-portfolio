# Portfolio v0.2 verification

Date: 2026-10-10. Scope: local synthetic reconstruction. No publication or production changes.

## Evidence

| Check | Result | Boundary |
|---|---|---|
| JavaScript renderer and exported live-send predicate | PASS, 19 tests | No Telegram or n8n runtime |
| Python targeting, Unicode output, missing scanner and export drift | PASS, 7 tests | Isolated fixtures; no external database calls |
| Business-rule integration against PostgreSQL 16.15 | PASS, 11 tests | Local disposable database; test transactions rolled back |
| Full loader → facts → RU/EN report → purchase CSV → XLSX → sync check | PASS | `run_demo.py --no-generate`, synthetic data only |
| Renderer/export synchronization | PASS | Read-only `--check` |
| Python/JS syntax, inactive credential-free exports | PASS | `scripts/check.py --sql` |
| Gitleaks 8.30.1 working tree and all Git history | PASS | Download checksum verified; findings redacted; no guarantee of commercial-data anonymization |
| Docker Compose configuration | PASS | `docker compose config --quiet`, not a container execution |
| Docker build and container smoke | NOT VERIFIED | Docker Desktop failed during its own startup; no factory reset or repair |
| GitHub Actions execution | NOT RUN | Workflow defined, not published or remotely executed |
| Real API completeness, n8n execution and confirmed delivery | OUT OF SCOPE | No live system certification |

Node and Python test counts are actual test cases. The SQL suite executes the real views, triggers and the claim query extracted from the exported workflow. Expectations include a hand-calculated 116.33 contribution and 1163.3% daily coverage under synthetic parameters. It does not validate tax law or business profitability.

## Failures observed before fixes

- Null contribution was printed as zero margin and zero daily coverage.
- A day with only some SKU costs could yield partial numeric contribution.
- An absent advertising expense could become zero after-ad spend.
- Monthly sums and the report could conceal unknown included days.
- Loaded accruals without computable contribution could be called “not loaded”.
- On this Windows environment, default subprocess decoding corrupted the Russian example; UTF-8 is now explicit.

Regression tests reproduced these cases and passed after the local fixes. Real zero remains zero.

## Independent review

A separate read-only review found four important issues: inherited libpq routing, null advertising/month rendering, loaded-vs-computable accruals and partial SQL monthly gap. Added regression cases and fixed these in the local reconstruction.

Final scoped re-review found no remaining blockers in those four fixes. The reviewer independently reran 19 Node tests, 7 tooling tests and the read-only renderer/export sync check; all passed. The reviewer inspected the SQL fixes and 11 integration cases but did not rerun PostgreSQL. The primary verification run executed all 37 cases and the full synthetic pipeline. This is a scoped review, not certification of the whole system.

## Remaining limits

The report's model assumptions are not accepted accounting policies. Latest observations are not proof of complete collection. A CLAIM is not a Telegram message-id receipt; future reconciliation remains outside this demo. The public reconstruction does not measure private system uptime or ROI.

The observed local runtimes were Python 3.14.7, Node 24.19.0 and PostgreSQL 16.15. The CI definition targets Python 3.12, Node 22 and PostgreSQL 16; the actual hosted/container combinations still require their own run. There is no CI badge claiming success.
