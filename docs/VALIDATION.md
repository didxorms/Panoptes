# Initial validation record

Version: **v0.0.0**

Date: **2026-09-14**

## Application

Validated on Windows with Node **22.20.0**:

- Application test suite: 28 passing tests covering shared proof assembly, trust boundaries, circular routes, refutations, crash recovery, lease fencing, cancellation, budget reservations, settlement, uncertain costs, allocation arithmetic, API control, key handling, provider receipts, and version updates.
- Version, changelog, and lockfile consistency; JavaScript syntax and formatting checks.
- Scripted command-line simulation completes with three goals, one shared route, six simulated artifacts, and no real proof or payout claim.

## Real Lean

Validated with the official Lean **4.28.0** Windows toolchain, downloaded from its [release](https://github.com/leanprover/lean4/releases/tag/v4.28.0). The Windows archive's SHA-256 was checked before extraction:

```text
675c255b8b7c5449aa4bd09dee818b93d03a00eba7544a23733b2771c32ca9c8
```

Two integration tests pass:

- A true commutativity proof compiles and replays; an attempted proof of `False` using `True.intro` is rejected.
- Scripted model fixtures drive live-mode route creation, separate lemma proofs, dependency reuse, and final verification of the original target. All resulting evidence is checked by Lean and `leanchecker`.

The local integration harness uses native trusted fixtures. Docker is not installed on this development machine. The GitHub CI Lean job builds the Linux verifier image and repeats the integration suite inside its constrained container; local native success alone does not establish that the container path works.

## Browser

Exercised the actual local HTTP server in headless Microsoft Edge at desktop **1440 × 1100** and mobile **390 × 844** sizes:

- Local control-token dialog and authenticated simulation launch.
- Completion with two shared subgoals, three displayed worker slots, and six notebook artifacts.
- Live-project creation and the contribution form, without submitting a provider key.
- No browser runtime exceptions or horizontal page overflow in those flows.

Screenshots were visually inspected. The README screenshot contains only the bundled, explicitly labeled simulation.

## Not evaluated

No real provider key was supplied and no paid AI call was made. These checks do not measure model reasoning ability, hard-problem success, collaboration's advantage over an equal-budget single-agent baseline, public multi-tenant security, or reward fairness. There is no deployment, escrow, or payment test because those features are not implemented.
