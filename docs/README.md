# Repository documentation

Root `docs/` is for maintainers working across package boundaries. Public product and developer documentation lives in [`packages/website/src/content/docs/`](../packages/website/src/content/docs/) and is published at [nerve.tlmtech.dev](https://nerve.tlmtech.dev).

## Current architecture

- [Codebase architecture](architecture/codebase.md) — package ownership, dependencies, naming, and runtime composition boundaries.
- [Storage architecture](architecture/storage.md) — `NERVE_HOME`, SQLite, managed files, capability and permission files, in-memory state.
- [Storage migrations](architecture/migrations.md) — how a home is upgraded between releases.
- [Conversation core](architecture/conversation-core/README.md) — conversation as the portable agent core: data model, event tree, tool-call lifecycle, input queue, channels and legacy import.
- [Permissions](architecture/permissions.md) — permission rule sets, overlays and the evaluator.
- [Tool-result projection](architecture/tool-result-projection.md) — complete result, agent projection and user projection: purpose, storage and transfer.

## Maintainer runbooks

- [Performance diagnostics](runbooks/performance-diagnostics.md) — analyze source-desktop performance samples.
- [Release](runbooks/release.md) — validate, tag, package, and publish a release.

## Where documentation belongs

| Content                                                                     | Canonical location                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Public behavior, guides, operations, protocol, and developer reference      | [`packages/website/src/content/docs/`](../packages/website/src/content/docs/) |
| Cross-package architecture, its design rationale, and maintainer procedures | Root `docs/`                                                                  |
| Designs not yet implemented                                                 | `docs/proposals/` (create when needed)                                        |
| Package ownership and local development rules                               | Package `README.md` and `AGENTS.md` files                                     |
| Repository contribution and security policy                                 | [`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`SECURITY.md`](../SECURITY.md)   |
| Schemas, catalogs, limits, and changing behavior                            | Owning contracts, implementation, and tests                                   |

Do not copy changing schemas or catalogs into prose. Link the owning symbols and describe only stable boundaries or rationale. Superseded proposals are removed from the active tree; Git history is the archive.
