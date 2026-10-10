# Design principles

1. **Append-only snapshots.** Raw tables are never updated. Corrections are new observations; views pick the latest one.
   This makes every number in a report reproducible ("what did we know at 09:00 that day?").
2. **Freshness labels instead of silent gaps.** Each source has an expected day (today or yesterday). The report prints the
   date of the data it uses and `STALE` / `NO_DATA` with the last loader error. `NULL` is never rendered as `0`.
3. **No automatic actions.** Promo, shipment and purchase outputs are recommendations with a reason
   (`ENTER` / `DONT` / `OWNER_DECIDES`). Nothing joins a promo, changes a price or sends a shipment.
   Even sending the report needs an explicit owner-accepted flag.
4. **Coverage-based load verification.** A run is not "green" because the HTTP call returned 200: parsed rows must equal
   landed rows (read back by run id), and units from two independent APIs (postings vs analytics) are compared per day
   (`MATCH` / `DIFF` / `NO_SECOND_SOURCE`).
5. **Parameters have provenance.** Every constant is a row in `ops.param` with a status; estimates are labelled as such
   in the outputs.
6. **Two margins, never added.** The order-model margin (ordered today, model fees) and the realised margin (actual accruals)
   are shown side by side.
7. **Rollback before change.** Backups with `SHA256SUMS`, rollback scripts that verify hashes and run dry by default.
8. **Idempotent delivery.** One delivery per day per report key, enforced by a unique index, so a retry cannot double-send.
