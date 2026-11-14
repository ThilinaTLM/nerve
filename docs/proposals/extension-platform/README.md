# Extension platform: isolation and installable extensions

**Status:** Draft · **Area:** extensions

Phase 1 is shipped: the built-in extensions are written against `@nervekit/extension-api`, run in-process, and the host names none of them. The contract, `ctx` security rules and naming rule are in [architecture/extension-platform](../../architecture/extension-platform.md). This proposal holds what is left.

## Phase 2: prove isolation

Run one built-in (Diagrams) inside its own QuickJS runtime, with `ctx` over `__hostCall`. The API is already async and plain-data, so this should be a runtime change, not an API change; the phase tests that claim before outsiders depend on it.

Questions to settle first:

- Streaming and binary transfer over `__hostCall` (uploads already stream from the host by handle; response bodies and artifacts are the open part).
- Performance and per-extension limits (memory, time, host calls), and which of today's in-process allowances (for example Confluence conversion without the worker's timeout) the sandbox limits replace.
- Whether `prelude` (pure sandbox-side helpers) and extension code share one runtime or each extension gets its own.

## Phase 3: installable extensions

Separate proposal when phase 2 lands. Scope:

- Packaging, install from folder, updates, `apiVersion` checks.
- Consent for declared permissions (network origins, capabilities) and the network allowlist as a user-visible grant.
- Limits and attribution for agent-facing text from third parties: descriptions, rules, doc topics and errors reach the model, so they need size limits and a visible source ([agent-facing content](../../agent-facing.md)).
- Two trust tiers were sketched: sandbox-only extensions (pure JS, skills, themes; no host authority) and host extensions (trusted daemon code behind the same nested authorization).
- Trust of project-contributed extensions follows the exact-content trust of project files.

## Open items

- **Permission exceptions naming extension tools.** Rule exceptions with `tool: "<name>"` validate against core tool names only, because contracts cannot see the runtime registry; extension tools are matched through their `quick_script` operation (`web.search`). Decide how contracts learn extension tool names, or keep operations as the only route.
- **Account test hook UX.** The Settings "Test" button words the four failure reasons; whether it should also show what was checked, or run automatically after saving, is open.
- **Planning rule set names built-in namespaces.** `planning.json` allows network reads in the Atlassian and web namespaces by name, a reviewed exception to the naming rule. A namespace flag such as `research: true` would let the rule set derive it.
- **Dropped:** GIF and WebP dimensions and conversion for Atlassian uploads (SVG is rejected). Reopen only if agents need them.
- **Unverified:** whether the image generation backend's HTTP 403 is an account restriction or a request problem; confirm before wording a fix for it.
