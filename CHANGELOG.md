# Changelog

Every development push has a new version. Patch = small fix; minor = feature; major = actual deployment. The first version is 0.0.0. Each entry describes the complete change since the previous pushed version.

## [0.1.0] - 2026-09-14

### Added

- OpenProver 1.0.1 at pinned commit `e200251b34349ab6c34548d30319abde86cb6bc6`, coordinating a planner, three parallel workers, independent reviews, and durable research state.
- A networkless, credential-free OpenProver controller that requests pooled OpenRouter calls and isolated Lean checks from the Panoptes host over concurrent JSON-RPC.
- Full Lean-source development for OpenProver with a trusted exact-target wrapper, separate verifier container, kernel replay, and the existing axiom allowlist.
- OpenProver selection and status in the dashboard, additive database migration from v0.0.0, pinned controller image, upstream license notice, and end-to-end Docker CI coverage.

### Changed

- Multiple contributor budgets can fund concurrent OpenProver calls; explicit provider HTTP rejections now release reservations as recorded zero-cost failures, while missing receipts remain uncertain and pause research.
- The classic structured-action engine remains available for simulations, backward compatibility, and controlled comparisons.

### Validation

- 33 application tests, two real Lean Docker integration tests, and one scripted OpenProver planner/worker/reviewer/Lean integration test pass on Windows.
- The project creation and OpenProver status UI has no runtime errors or horizontal overflow at 1440×1000 and 390×844.
- No paid model call, public deployment, escrow, or payout transfer was performed.

## [0.0.0] - 2026-09-14

### Added

- Local research dashboard with project creation, resource contributions, proof routes, shared notebook, and research journal.
- Three concurrent research slots per problem, deduplicated subgoals, checked conditional bridges, and final proof assembly.
- Persistent SQLite tasks and artifacts, expiring leases, stale-result fencing, restart recovery, and exact-target checks.
- Separate scripted simulation and live OpenRouter provider adapter.
- Encrypted API-key storage, operator control token, budget reservations, reported-cost settlement, and uncertain-charge handling.
- Pinned Lean 4.28.0/Std verification container, restricted structured proof steps, axiom policy, and kernel replay of submitted declarations.
- Resource-cost allocation estimate with exact cent totals and provenance records.
- Application and real Lean integration tests, Windows/Linux CI, developer documentation, MIT license, and version/push helpers.

### Scope

- Initial research preview for a trusted local operator. No public deployment is included.
- Simulation is explicitly unverified. Real Lean integration uses scripted AI fixtures; no paid-model benchmark is claimed.
- No Mathlib, arbitrary Lean code, remote contributors' workers, user accounts, escrow, or actual reward transfers.
- Allocation is based on confirmed resource cost, not a measure of mathematical credit. Uncertain cost reconciliation remains manual operator work outside the application; reservations are retained.
