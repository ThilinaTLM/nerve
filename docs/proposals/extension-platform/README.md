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
- **The user is told what an update adds.** When an extension update (installed, or a built-in changed by a Nerve release) adds operations, direct tools, network origins, capabilities or account kinds, the user sees what is new before it is used. Permission rules still apply exactly as written: a broad allow rule (`jira.*`) also allows new operations, because the user chose it; the notice makes that choice informed, it does not override it.
- Limits and attribution for agent-facing text from third parties: descriptions, rules, doc topics and errors reach the model, so they need size limits and a visible source ([agent-facing content](../../agent-facing.md)).
- Two trust tiers were sketched: sandbox-only extensions (pure JS, skills, themes; no host authority) and host extensions (trusted daemon code behind the same nested authorization).
- Trust of project-contributed extensions follows the exact-content trust of project files.
- The Extensions list has one hard-coded "Built-in" section; group by `metadata.source` once installed extensions exist.
- The field-type set stays closed and tool views stay declarative (`ToolView`, no UI code); anything beyond that is decided here.

## Open from phase 1

- **Image generation backend.** `imagegen.generate` has never run end to end: the openai-codex backend returns HTTP 403 on dev slots. Confirm whether it is an account restriction (login without image access) or a request problem, then word the error and fix accordingly; the extension stays off by default until then. Blocked on a Codex subscription with image access.
- **Reopen on demand:** GIF and WebP dimensions and conversion to PNG for Atlassian uploads (SVG is rejected).
