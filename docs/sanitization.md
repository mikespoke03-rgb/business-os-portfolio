# Sanitization notes

This repository is derived from a private project. Before publication:

* **Secrets**: no API keys, tokens, passwords, connection strings, n8n credential ids, webhook ids, instance URLs,
  Telegram chat ids, e-mails or phone numbers. Configuration is read from environment variables (`.env.example`).
* **Commercial data**: no real SKUs, product names, prices, costs, revenue, margins, suppliers, customers, legal entities,
  brand names, bank/loan figures or contract terms. All data in `sample_data/` is synthetic
  (`scripts/generate_synthetic_data.py`, fictional brand "DemoBrand"); the numbers in `examples/` are produced from it.
* **n8n workflows**: processed by `scripts/sanitize_n8n_workflow.py` – only whitelisted keys are kept; `credentials`,
  `pinData`, `staticData`, `meta`, `versionId`, `tags`, ids and `webhookId` are removed; node ids are regenerated; a
  private replacement map (not in the repo) replaced business-specific literals. Hard-coded SKU lists were replaced with
  `DEMO-…` codes; the ads campaign id with `PPO_CAMPAIGN_ID`.
* **Not included**: production database dumps, execution data, audit receipts, research workbooks with real numbers,
  and modules that could not be shown without real data (P&L, offline retail contour, per-SKU strategy cards).
* **Scan**: `scripts/scan_secrets.py` requires Gitleaks and scans the tree and all Git history with redacted findings. Missing tooling is failure. The original scanner could skip unavailable tools; its historical “clean” message is not accepted as specialized scanning. A scan is not a guarantee that all business-sensitive information was recognized, so publication requires human review.
* **Model calls (v0.3)**: owner questions go to a model only after `llm/mask.js` applies `llm/config/masking.json`
  (product names → SKU codes, costs/suppliers dropped, counterparty text redacted, cash rounded to thousands, e-mail/phone/tax id/token patterns removed).
  The grader also blocks any answer that contains a masked value. This protects the demo contour; it is not a substitute for a reviewed production PII policy.
* **Owner review before publication** (not decidable from the repository): confirm that sample SKU names/sizes (`scripts/generate_synthetic_data.py`,
  `sample_data/sku.csv`), parameters in `sample_data/param.csv` (fixed costs 380 000/month, financing 70 000/month, rates) and channel assumptions in
  the workbook do not match the real business.
