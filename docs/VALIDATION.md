# Validation record

Version: **v0.1.0**

Date: **2026-09-14**

## Application

Validated on Windows with Node **22.20.0**:

- 33 application tests pass. They cover classic proof assembly, OpenProver result promotion, exact-target checks, trust boundaries, schema migration, task recovery, budget concurrency, confirmed/failed/uncertain receipts, allocation arithmetic, API controls, encrypted keys, and version updates.
- Version, changelog, and lockfile consistency; JavaScript syntax and formatting checks.
- The scripted command-line simulation still completes without a key, real proof claim, or payout claim.

## Real Lean

The `panoptes-lean:4.28.0` image was built locally from the checksum-pinned Linux amd64 Lean release. Two Docker integration tests pass:

- A true commutativity proof compiles and replays; an attempted proof of `False` using `True.intro` is rejected.
- Scripted model fixtures drive the classic live route, separate lemma proofs, dependency reuse, and final verification of the original target.

The raw-source verifier was also exercised through OpenProver. It compiles an untrusted `Candidate.lean`, imports it from a trusted `Final.lean`, reconnects `panoptes_target` to the immutable stored target, replays `Final` with `leanchecker`, and checks the resulting axiom report.

## OpenProver

The local image uses OpenProver **1.0.1** at commit `e200251b34349ab6c34548d30319abde86cb6bc6` and a digest-pinned Python base image. The final runtime image contains the required upstream Python source without Git, MCP, provider SDKs, or provider credentials.

One end-to-end Docker fixture passes with no paid API call. Scripted model responses drive:

- one planner splitting the target into three tasks;
- three parallel OpenProver workers;
- three independent AI verifier calls;
- durable repository items for informal and Lean proofs;
- concurrent Panoptes budget reservation and receipt settlement over JSON-RPC;
- two isolated Lean checks and final exact-target promotion.

The final integration completed in about 7.5 seconds with the minimal runtime image.

## Browser

Exercised the actual v0.1.0 local HTTP server in headless Microsoft Edge at desktop **1440 × 1000** and mobile **390 × 844** sizes:

- Unlocked local controls and opened the new-research dialog.
- Confirmed OpenProver is the default engine.
- Created a live draft and confirmed its OpenProver badge and planner/three-worker explanation.
- No browser runtime exceptions or horizontal page overflow occurred.

## Not evaluated

No real provider key or paid model call was used. These checks do not measure difficult-problem solve rate, collaboration's advantage over an equal-budget single-agent baseline, public multi-tenant security, or reward fairness. There is no deployment, escrow, or payment test because those features are not implemented.
