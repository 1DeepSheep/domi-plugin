# Changelog

## 7.0.20 — 2026-10-29

- Detect repeated financing announcements with angel, seed and first-round labels while preserving Pre modifiers and every plus sign as distinct round identities.
- Flag same-article financing reports with the same explicit headline subject even when company fields differ. Keep different subjects, rounds and collection pages separate; unknown rounds across different articles still require review.

## 7.0.18 — 2026-10-22

- Persist read status, follow-up decisions and freeform notes for underwater sourcing candidates, including a bounded history of user edits. Daily discovery preserves these decisions.
- Search existing project/person records and confirm the same entity without merging or deleting library records. Preserve manual identity decisions while retaining archive receipt checks for actual writes.

## 7.0.17 — 2026-10-21

- Add persistent underwater project and founder sourcing with a daily schedule, exclusive run leases, bounded retries, source coverage, and verified project/person intake receipts.
- Accept natural-language interests alongside structured directions, labs, companies, and people. Preserve user-defined scope, paused sources, exclusions, and discovery provenance across runs.
- Record possible contact paths and comparisons with existing library projects. Validate library IDs, owned-document quotations, cited web sources, and fresh per-run checks; distinguish pending analysis from searches that found no match.
- Include sourcing behavioral and repository integration tests in pull-request and release validation. The client controls scheduling; upgrading the plugin alone does not enable a daily task or change a user's library.
