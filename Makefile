# Requires: Python 3.10+, Node 18+, a throw-away Postgres database in DATABASE_URL (only for demo-local / sql targets).
.PHONY: report test npm-test eval site demo data scan
report:          ## render the morning report from committed synthetic facts (no database, no Docker)
	node scripts/render_report.js examples/facts_example.json ru DRY_RUN
npm-test:        ## Node tests: renderer, owner Q&A masking/grader/gate, promo buttons + recorded-answer eval
	npm test
eval:            ## owner Q&A eval gate on committed answers (no API key)
	node llm/eval.js
site:            ## build the static demo site into site/dist/
	node site/build.js
test:            ## all checks without a database
	python3 scripts/check.py
demo:            ## full pipeline on synthetic data in Docker
	docker compose up --build --abort-on-container-exit --exit-code-from demo
data:            ## regenerate synthetic CSVs only
	python3 scripts/generate_synthetic_data.py
scan:            ## secrets scan (requires Gitleaks)
	python3 scripts/scan_secrets.py
