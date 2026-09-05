# Repository documentation

Root `docs/` is for maintainers working across package boundaries. Public product and developer documentation lives in [`packages/website/src/content/docs/`](../packages/website/src/content/docs/) and is published at [nerve.tlmtech.dev](https://nerve.tlmtech.dev).

## Current architecture

- [Codebase architecture](architecture/codebase.md) — package ownership, dependencies, naming, and runtime composition boundaries.
- [Storage architecture](architecture/storage.md) — implemented `NERVE_HOME`, canonical SQLite, file ownership, journal, and migration boundaries.

## Accepted decisions

- [Tool-result projection](decisions/tool-result-projection.md) — why complete results, agent projections, and transcript previews are separate.

## Active proposals

- [Permission rule sets](proposals/permission-rule-sets.md) — implemented permission architecture and rule-set-scoped overlay model.

## Maintainer runbooks

- [Performance diagnostics](runbooks/performance-diagnostics.md) — analyze source-desktop performance samples.
- [Release](runbooks/release.md) — validate, tag, package, and publish a release.

## Where documentation belongs

| Content                                                                | Canonical location                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Public behavior, guides, operations, protocol, and developer reference | [`packages/website/src/content/docs/`](../packages/website/src/content/docs/) |
| Cross-package implemented architecture and maintainer procedures       | Root `docs/`                                                                  |
| Accepted cross-package design rationale                                | `docs/decisions/`                                                             |
| Active but unimplemented target designs                                | `docs/proposals/`                                                             |
| Package ownership and local development rules                          | Package `README.md` and `AGENTS.md` files                                     |
| Repository contribution and security policy                            | [`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`SECURITY.md`](../SECURITY.md)   |
| Schemas, catalogs, limits, and changing behavior                       | Owning contracts, implementation, and tests                                   |

Do not copy changing schemas or catalogs into prose. Link the owning symbols and describe only stable boundaries or rationale. Superseded proposals are removed from the active tree; Git history is the archive.
