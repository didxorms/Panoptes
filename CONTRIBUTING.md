# Contributing to Panoptes

Contributions to the platform are welcome. Within a research run, humans provide resources and configuration; the AI workers perform the mathematical work.

## Work locally

Use Node 22.13 or newer and install the lockfile with `npm ci --ignore-scripts`. Create a feature branch from the latest reviewed `main`.

Before committing:

```sh
npm run format
npm run check
npm run format:check
npm test
```

Changes to proof generation, imports, artifact acceptance, route integration, OpenProver RPC, or the verifier also require the [real Docker integration tests](README.md#development-and-validation). Keep exact-target, failed-candidate, cost-receipt, and simulation-boundary checks. Do not add real provider keys or paid API calls to tests.

Use readable modules and meaningful tests for invariants. The server's live proof path must keep its sandbox. An AI result cannot mark itself verified, change the original target, or select the environment. A useful counterexample search is not a formal disproof until a negation proof passes verification.

## One version per development push

The repository starts at `v0.0.0`. Every later push must advance from the latest remotely published version:

- `patch`: a fix; `0.1.0 → 0.1.1`.
- `minor`: a feature; `0.1.1 → 0.2.0`.
- `major`: an actual deployment; `0.2.0 → 1.0.0`.

Higher-component changes reset lower components to zero. This policy is intentionally different from standard SemVer's breaking-change rule. No helper automatically deploys the application.

```sh
npm run version:next -- minor "Add a new research capability."
npm run format
npm run check
npm run format:check
npm test
git add .
git commit -m "feat: add research capability v0.1.0"
npm run release:push
```

`version:next` updates `VERSION`, `package.json`, `package-lock.json`, and `CHANGELOG.md`. Expand the new changelog entry with relevant behavior and validation limits. `release:push` checks the latest remote tags, rejects reused/skipped versions, creates an annotated tag, and atomically pushes the feature branch and tag. It refuses `main`/`master`, dirty worktrees, and a local tag pointing elsewhere. It does not force-push or create a PR.

If a network failure prevents the atomic push, retry the same commit/version after confirming the remote was unchanged. If the push succeeded, the next correction requires another version. If two contributors prepare the same version, the later push must rebase/update its version to follow the latest remote tag.

For the **first push into an empty repository only**, `npm run release:push -- --bootstrap` additionally publishes the minimal `main` baseline so the initial feature branch has a PR base. `main` must already be an ancestor of the feature branch. Subsequent work uses ordinary `release:push`.

Create the PR yourself after pushing. Lead its description with the resulting behavior, include the version, relevant tests, and material limitations. PR merges promote an already-versioned change; do not add an unrelated version bump merely for merging that same change.

## Development boundaries

`docs/RESEARCH_ENGINE.md` describes the broader design. `docs/ARCHITECTURE.md` describes what is implemented. Update both when a design decision changes, and keep the README honest about supported mathematics and actual model evaluation.

Use `.panoptes/` for local data and downloaded toolchains; it is ignored by Git. Never commit a database, operator token, master key, provider key, or real research transcript that contains private information.
