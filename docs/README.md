# Repository documentation

Root `docs/` is for maintainers working across package boundaries. Public product and developer documentation lives in [`packages/website/src/content/docs/`](../packages/website/src/content/docs/) and is published at [nerve.tlmtech.dev](https://nerve.tlmtech.dev).

## Current architecture

Start with the codebase overview, then the conversation core.

**Platform**

- [Codebase architecture](architecture/codebase.md) — packages, layers and allowed dependencies.
- [Startup and reconnection](architecture/startup.md) — daemon early bind, shell supervision, storage failure handoff and client reconnect.
- [Storage architecture](architecture/storage.md) — `NERVE_HOME` areas, SQLite versus files versus memory, restart behavior and settings health.
- [Storage migrations](architecture/migrations.md) — home upgrades, damage isolation, rollback and how to add a step.
- [Scoped configuration](architecture/configuration.md) — user/project/conversation scopes, save guarantees and when changes take effect.

**Conversations and agents**

- [Conversation core](architecture/conversation-core/README.md) — the portable agent core: data model, events and context, tool-call lifecycle, input queue, delegation, async bash and channels.
- [Agent profiles and delegation](architecture/conversation-core/delegation.md) — profile catalog and precedence, lead lifecycle, child configuration and sub-agent lifecycle.
- [Permissions](architecture/permissions.md) — rule sets, overlays, guardrails and tool-call authorization.
- [System prompt and tool descriptions](architecture/system-prompt.md) — prompt assembly and tool-writing rules.
- [Tool-result projection](architecture/tool-result-projection.md) — complete payload, agent projection and user projection.
- [Conversation state and attention](architecture/conversation-state-and-attention.md) — composer and drafts, execution status, summary activity and notifications.
- [Conversation discovery](architecture/conversation-discovery.md) — local and AI titles, PR/issue references, list sections, stable ordering and smart search.

**Workbench**

- [Launch catalog](architecture/launch-definitions.md) — saved project commands, folders, safe shared editing and client cache.

## Maintainer runbooks

- [Performance diagnostics](runbooks/performance-diagnostics.md) — analyze source-desktop performance samples.
- [Release](runbooks/release.md) — validate, tag, package, and publish a release.

## Where documentation belongs

| Content                                                                     | Canonical location                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Public behavior, guides, operations, protocol, and developer reference      | [`packages/website/src/content/docs/`](../packages/website/src/content/docs/) |
| Cross-package architecture, its design rationale, and maintainer procedures | Root `docs/`                                                                  |
| Designs not yet implemented                                                 | `docs/proposals/` (create when needed; delete when implemented)               |
| Package ownership and local development rules                               | Package `README.md` and `AGENTS.md` files                                     |
| Repository contribution and security policy                                 | [`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`SECURITY.md`](../SECURITY.md)   |
| Schemas, catalogs, limits, and changing behavior                            | Owning contracts, implementation, and tests                                   |

Do not copy changing schemas or catalogs into prose. Link the owning symbols and describe only stable boundaries or rationale. Superseded proposals are removed from the active tree; Git history is the archive.
