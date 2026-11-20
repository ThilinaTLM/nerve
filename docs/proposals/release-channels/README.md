# Release channels

**Status:** Draft · **Area:** release

Every release goes to a **staging** channel first. A maintainer later **promotes** a staging version to **stable** once it has had time to show bugs. Releases are cut, tested, published and promoted by GitHub workflows, and nothing is tagged until it has passed the full test suite.

```text
Stable    0.41.0 ───────────────────────────────────────▶ 0.42.3
                 ╲                                          ▲
Staging           0.42.0 ──▶ 0.42.1 ──▶ 0.42.3 ─────────────┘ promote
```

Current procedure: [release runbook](../../runbooks/release.md), [`release.yml`](../../../.github/workflows/release.yml), [`tag-release.ts`](../../../scripts/release/tag-release.ts).

## Problem

- **Every release reaches every user at once.** A tag publishes to npm `latest`, so `npx @nervekit/desktop@latest` picks it up straight away. There is no period in which early users can find bugs before everyone else gets them.
- **Tags come before tests.** `pnpm release:tag` pushes the bump commit and the tag together. The release workflow then waits for CI and runs the package smokes. If those fail, the tag already exists and the version number is used up.
- **Releasing needs a local machine.** It needs a clean `main`, a signing key and the script, and the push is irreversible.
- **The website is deployed with every tag.** The docs therefore describe whatever was tagged last, not what `@latest` installs.

## Decisions

Settled with the project owner.

| Topic           | Decision                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version numbers | Plain SemVer for every release (`0.42.1`). No `-rc`/`-beta` suffixes. A staging version becomes stable unchanged.                                                   |
| Channels        | Two npm dist-tags: `latest` (stable) and `next` (staging). `next` is the npm convention and is already used by `release.yml`.                                       |
| Promotion       | Moves the `latest` dist-tag to an already published version. Nothing is rebuilt, so stable users run the exact bytes staging users tested.                          |
| Test before tag | The bump commit is tested in full (CI and release smokes on Linux, Windows and macOS) before `main` moves and before the tag exists.                                |
| Build once      | The tarballs built and tested at cut time are the ones published. Publishing does not rebuild.                                                                      |
| Branching       | Trunk-based. Every release is cut from `main`. Stable fixes go forward through `main` as a new staging version and are promoted. There are no maintenance branches. |
| Tag creation    | Tags are created only by the Cut workflow. The local `pnpm release:tag` is removed.                                                                                 |
| Website         | Deployed by its own workflow, separate from publishing.                                                                                                             |

## Workflows

```mermaid
flowchart LR
  C["Release: Cut<br/>version, dry_run"] -->|"tag + draft release<br/>with tarballs"| P["Release: Publish<br/>tag, channel"]
  P -->|"npm next<br/>(or latest)"| S[(npm)]
  R["Release: Promote<br/>version"] -->|"dist-tag latest"| S
  R --> W["Website: Deploy<br/>ref"]
```

| File                  | Name             | Trigger                                                         | Does                                                                                                        |
| --------------------- | ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `release-cut.yml`     | Release: Cut     | manual: `version`, `dry_run`                                    | Bump commit, full tests, packaging, then fast-forward `main`, tag, draft GitHub release                     |
| `release-publish.yml` | Release: Publish | manual, run from a tag: `channel` (`staging` default, `stable`) | Publishes the draft release's tarballs to npm and publishes the GitHub release                              |
| `release-promote.yml` | Release: Promote | manual: `version`                                               | Moves `latest` to `version` for all seven packages, marks the GitHub release as latest, deploys the website |
| `website-deploy.yml`  | Website: Deploy  | manual: `ref`; called by Promote                                | Builds the website from `ref` and deploys GitHub Pages                                                      |
| `ci.yml`              | CI               | pull requests, `main` pushes, **called by Cut**                 | Unchanged jobs; checks out the ref it is given                                                              |

`release.yml` is removed. Its release-specific jobs (native prebuilds, package build and smokes) move into `release-cut.yml`, and its `require-ci` polling job is no longer needed.

### Release: Cut

1. **Prepare** (Ubuntu). Read `main` HEAD as the base. Check that `version` is canonical SemVer, is greater than the current version, and that tag `v<version>` does not exist. Run the bump (the logic that `tag-release.ts` has today, moved to `scripts/release/prepare-release.ts`): workspace manifests, `Cargo.toml`/`Cargo.lock`, Discover news stamping, draft migration release, `pnpm migrations:check`.
2. **Commit.** Create branch `release/v<version>` at the base. Commit the changed files to it with the GraphQL `createCommitOnBranch` mutation. GitHub signs commits it creates through the API, which satisfies the `main` ruleset's signature rule without a signing key in CI.
3. **Test** the release commit, in parallel:
   - `ci.yml` through `workflow_call` with `ref` set to the commit. Called from a non-pull-request event, its impact step already selects full coverage.
   - Native prebuilds for the six targets, then build, smoke and pack on Ubuntu, and the package smokes on Windows and macOS (today's `release.yml` jobs).
4. **Finalize**, only if everything passed and `dry_run` is false:
   - Fast-forward `main` to the release commit (`PATCH refs/heads/main`, `force: false`). If `main` moved during the run, this fails. Rerun the workflow; the tag must always point at the commit that was tested.
   - Create the annotated tag `v<version>`.
   - Create a **draft** GitHub release for the tag. Attach the seven tarballs and a `SHA256SUMS` file.
5. **Clean up.** Delete `release/v<version>` whether the run passed, failed or was a dry run.

All of this works with `GITHUB_TOKEN`. Its pushes do not start other workflows, and nothing here needs them to: CI is called directly, and publishing is a separate manual step. The cost is that the fast-forwarded `main` commit gets no `push` CI run of its own. It has already passed the same jobs.

### Release: Publish

Run from the tag (the GitHub "Use workflow from" selector).

1. Refuse unless the ref is a `v*` tag with a draft GitHub release holding seven tarballs and a `SHA256SUMS` that match. Only Cut creates such drafts, so a hand-made tag cannot be published.
2. Check that each tarball's name and version match the tag.
3. `npm publish --provenance --access public --tag <next|latest>` for the six platform packages, then `@nervekit/desktop`. Versions already published are skipped, so a partial failure can be rerun.
4. Publish the GitHub release: marked as a pre-release for `staging`, and as the latest release for `stable`.

`channel: stable` is for urgent fixes that cannot wait for staging. Normal releases go to `staging`.

### Release: Promote

1. Check that `version` is published with all seven packages, is currently on `next` or older, and is greater than the current `latest`. A `rollback` input allows moving `latest` back to an older version deliberately.
2. `npm dist-tag add <pkg>@<version> latest` for the seven packages, platform packages first.
3. Edit the GitHub release: not a pre-release, marked latest. Regenerate its notes from the previous **stable** tag, so stable notes cover every staging version they include.
4. Call `website-deploy.yml` with `ref: v<version>`.

`next` is left in place; it keeps pointing at the newest staging version.

### npm trusted publishing

Trusted publishers are bound to a workflow filename, so each of the seven packages needs its configuration updated on npmjs.com:

- `release-publish.yml` with **npm publish** allowed.
- `release-promote.yml` with **npm dist-tag** allowed only. OIDC dist-tag operations need npm CLI 11.21.0 or later ([npm docs](https://docs.npmjs.com/trusted-publishers#managing-dist-tags-with-trusted-publishing)).

No npm token is stored.

## Consequences

### Installing

| Who                | Command                                    |
| ------------------ | ------------------------------------------ |
| Everyone           | `npx @nervekit/desktop@latest` (unchanged) |
| Staging users      | `npx @nervekit/desktop@next`               |
| A specific version | `npx @nervekit/desktop@0.42.1`             |

`npm view @nervekit/desktop dist-tags` shows what each channel points at. Because staging versions are plain SemVer, a range such as `^0.42.0` matches them. That does not affect `npx` users, who install by tag. It matters for the extension packages (below).

### Storage migrations

Each staging version is a real release: Cut marks draft migration steps released, as `tag-release.ts` does today. The rule "all unreleased data changes since the latest release belong in one migration step" then applies per staging version. A bug in a step that staging users have already applied is fixed by a new step.

Promotion is safe: stable users moving from `0.41.0` to `0.42.3` apply the same steps in the same order as staging users did.

**Going back from staging is not supported.** A home that a staging version migrated cannot be opened by an older stable version: the ledger rejects applied step IDs it does not know ([`ledger.ts`](../../../packages/workbench-server/src/infrastructure/migrations/framework/ledger.ts)). The staging install docs must say so and recommend a separate `NERVE_HOME` for trying staging next to stable.

### Discover news

Announcements are stamped with the staging version they shipped in. Stable users who jump from `0.41.0` to `0.42.3` should see every announcement from `0.42.0` to `0.42.3`. [`policy.ts`](../../../packages/workbench-app/src/lib/app/discover/policy.ts) must be checked to confirm it selects by version range rather than by exact version.

### Fixes while staging is ahead

If stable is `0.41.0`, staging is `0.42.1` and stable has an urgent bug, fix it on `main`, cut `0.42.2`, and promote it (or publish it with `channel: stable`). There is no `0.41.1`: a maintenance branch would need its own migration ordering and is not worth it at this release pace. If `main` contains work that is not ready, finish or revert it first.

### Extension packages

`@nervekit/extension-api`, `ui-kit` and `extension-sdk` carry Nerve's version and are published by hand after a release. An extension built against a staging SDK may require a host that stable users do not have yet. They should follow the same channels: publish to `next` with the staging release and move to `latest` on promotion. See open questions.

## Documentation changes

- [Release runbook](../../runbooks/release.md): rewritten around Cut, Publish, Promote and Deploy. The local commands remain for validating a release candidate, not for tagging.
- [`scripts/README.md`](../../../scripts/README.md): `release:tag` removed, `prepare-release.ts` added.
- Website: a short "Staging channel" section in [install](../../../packages/website/src/content/docs/start/install.md), with the one-way migration warning.
- `AGENTS.md`: "the root `package.json` version is the latest release" still holds; every staging version counts as a release.

## Implementation order

1. Move the bump logic from `tag-release.ts` to `prepare-release.ts` and cover it with the existing release tests.
2. Make `ci.yml` callable with a `ref` input and pass it to every checkout.
3. Add `release-cut.yml` and test it with `dry_run` on a branch.
4. Add `release-publish.yml`, `release-promote.yml` and `website-deploy.yml`. Update the trusted publishers on npmjs.com before the first publish.
5. Remove `release.yml`, `tag-release.ts` and the `release:tag` script. Update the documentation.
6. First release through the new path: cut to staging, publish, promote.

## Open questions

1. **Extension packages.** Should Publish and Promote take over `extension-api`, `ui-kit` and `extension-sdk`, so that they follow the channels automatically? That would require trusted publishers for them as well.
2. **Tag protection.** Should a tag ruleset restrict creating `v*` tags? Publish already refuses tags without a Cut-made draft release. A ruleset would also need a bypass for the workflow's token.
3. **Promotion criteria.** Is promotion purely the maintainer's judgment, or should there be a minimum time on staging?
