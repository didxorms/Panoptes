# Security and trust boundaries

Panoptes v0.0.0 is for a **trusted local operator**, with the server bound to `127.0.0.1` by default. Do not expose this preview as a public service. There are no user accounts, per-user permissions, global admission limits, or production reverse-proxy configuration.

## Control and secrets

Read-only APIs expose research statements, artifacts, contributor names, usage, and research events. All mutations require the operator's bearer token. Browser mutations must also come from the same host/port. The token is generated locally and saved in `.panoptes/admin.token`; the dashboard keeps it in the current tab's session storage.

Provider keys are encrypted with AES-256-GCM and a random nonce. The master key is loaded from `PANOPTES_MASTER_KEY` or saved at `.panoptes/master.key`. This protects a copied database only when the master key is kept separately from that copy. The local operator controls both and can decrypt keys. POSIX file modes do not configure Windows ACLs; secure the data directory using the host OS. Encryption does not protect against a compromised host or browser.

The API does not accept arbitrary provider URLs. Model calls go to the fixed OpenRouter endpoint. Keys are excluded from model prompts, public funding records, task contexts, and application events. Do not put secrets into research titles, descriptions, notes, or model output.

Back up a stopped instance's database together with its corresponding master key. Losing the master key makes encrypted provider keys unusable. A provider key with a separate spending cap limits the billing impact of a compromised operator token or application failure.

## Verifier boundary

The HTTP live path always launches the Docker verifier. Model output is parsed into a restricted JSON proof structure, then rendered into a generated module with a fixed import and target. Users cannot upload arbitrary `.olean` files, add new imports, declare axioms, or run arbitrary shell commands through this interface. Automatic implicit binders are disabled.

The container has no network, a read-only root filesystem, dropped capabilities, no privilege escalation, an unprivileged user, CPU/memory/process limits, and a limited temporary workspace. The host kills timed-out verification clients and removes their named containers. Run Docker under an account whose privileges you understand; this is a development isolation boundary, not a completed hostile multi-tenant security design.

Accepted evidence requires successful compilation, a separate `leanchecker Candidate` replay, and an axiom report restricted to `propext`, `Classical.choice`, and `Quot.sound`. The replay checks submitted declarations against the pinned, trusted `Std` imports; it does not replay all library declarations from scratch. Both compiler and checker use Lean's kernel. Trust also includes the image build, official toolchain, stored artifacts, and the mathematical meaning of the formal target. See [Lean's proof-validation documentation](https://lean-lang.org/doc/reference/latest/ValidatingProofs/) and the [built-in checker's documentation](https://github.com/leanprover/lean4checker).

`PANOPTES_LEAN_BIN` is used only by the integration test file for trusted generated fixtures. The server does not expose or use this local-process bypass. Simulation never starts Lean and cannot supply verified evidence to a live problem.

## Accounting and rewards

Reservations prevent two tasks from reserving the same available budget. They are estimates; provider pricing or metering can exceed them. Confirmed costs are recorded even when output is invalid or a task has been stopped. An unknown outcome holds its reservation and pauses the problem. An over-reservation charge is recorded in full and also pauses further scheduling.

This preview has no automatic reconciliation endpoint, escrow, payment transfer, anti-fraud scoring, or guarantee of fair mathematical-credit allocation. The allocation API is an estimate over confirmed resource cost. Never use it as an automatic payment authorization.

## Reporting

Report reproducible non-sensitive bugs through the repository's issues. Do not post real tokens, provider keys, or private databases. For a vulnerability containing sensitive details, use GitHub's private vulnerability reporting if it is enabled; otherwise ask the maintainer for a private channel before sharing exploit details or credentials.
