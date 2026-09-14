# Changelog

Every development push has a new version. Patch = small fix; minor = feature; major = actual deployment. The first version is 0.0.0. Each entry describes the complete change since the previous pushed version.

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
