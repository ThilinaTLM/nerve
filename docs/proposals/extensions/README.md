# Extensions

> **Status:** Draft. How `quick_script` works today: [architecture/code-mode.md](../../architecture/code-mode.md).

## Summary

An **extension** is a unit of capability with its own settings. It contributes things to Nerve: `quick_script` SDK namespaces first, and later direct tools, skills, MCP servers, themes and more. Built-in extensions (Atlassian, Web, Image generation, Diagrams) come first, then installable extensions.

**MCP servers are a separate resource**, like skills and prompt suggestions. A user or project configures them on their own Settings → MCP servers page, and an extension may bundle some. Their tools reach the agent as `quick_script` namespaces too.

Integration-style direct tools (Jira, Confluence, diagram export, image generation) are removed, and their capabilities are reached only through `quick_script` namespaces. The tool description becomes a short namespace index, and the agent pulls detail on demand with `sdk.*` calls inside the sandbox. Settings → Integrations becomes **Settings → Extensions**: one page, at user and project scope, where each extension is enabled and configured from a settings schema it declares.

| File                             | Covers                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| [extensions.md](extensions.md)   | Extension manifest, contributions, built-in extensions, docs layout, package, installable tiers |
| [settings.md](settings.md)       | Settings schema, storage (client or agent configuration), layering, accounts, migration         |
| [ui.md](ui.md)                   | Extensions, MCP servers and Tools pages; wireframe                                              |
| [discovery.md](discovery.md)     | `sdk.*` API, large namespaces and output budgets, tool description                              |
| [permissions.md](permissions.md) | Operation-level rules replacing direct-tool authorization                                       |
| [mcp.md](mcp.md)                 | MCP servers: sources, settings, `quick_script` namespaces                                       |

## Problem

- **Every request pays for every schema.** The 17 `jira_*`, 11 `confluence_*`, `generate_image` and `kroki_export` definitions are sent on each turn whether the task needs them or not. MCP would add tens or hundreds more.
- **The `quick_script` guide is static while the capability set is not.** `SKILL.md` and `references/*` describe Jira, Confluence and web for every conversation. Only the tool description ([`description.ts`](../../../packages/tools/src/execution/quick-script/description.ts)) follows settings, so the two can disagree.
- **The upfront reading cost is high.** "Read the guide before first use" walks description → `SKILL.md` → `.d.ts` → workflow file, about 2–6k tokens, before a simple `XLSX` read.
- **Adding a capability touches many places:** description fragments, `activeQuickScriptIntegrations` in [`scoped-turn-resources.ts`](../../../packages/workbench-server/src/core-host/scoped-turn-resources.ts), the guide, the broker's `brokerable()` list, `toolRows` and the Tools and Integrations pages. Nothing outside the repository can add one.
- **Settings follow tools, not capabilities.** The same Atlassian account is picked in `tools.jira`, `tools.confluence` and `tools.quick_script.settings`. The Integrations page is user-only, so a project cannot pin its site.
- **`packages/skills` mixes two kinds of content.** `builtin/` holds catalog skills; `guides/` holds tool manuals that are not in the catalog but use the same `{{skill:…}}` placeholder and `SKILL.md` format.

## Current state

- **Single source for SDK methods:** each method is declared once in a method table ([`sdk-types.ts`](../../../packages/tools/src/execution/quick-script/sdk-types.ts)). The prelude, scanner, dispatch and generated `references/*.d.ts` all read these tables.
- **Errors already teach:** a misspelled method lists the valid names, an unknown option lists the valid options, and an unavailable integration names the setting to fix.
- **Nested authorization maps each SDK call to a direct tool** ([permissions](../../architecture/code-mode.md#permissions)). Removing direct tools removes those identities; see [permissions.md](permissions.md).
- **Agent settings already resolve in four layers** (built-in defaults → user → project → conversation, plus agent profiles) ([configuration](../../architecture/configuration.md)). Extension settings reuse this.

## Goals

1. **Constant-size tool surface.** Adding a namespace adds about one line to the `quick_script` description, never a schema.
2. **One contract for built-in and installed extensions**, and one namespace mechanism shared with MCP servers. An extension provides its own metadata, settings schema and docs, and nothing else in the system needs to change.
3. **Generic settings UI.** The Extensions page renders any extension from its settings schema.
4. **Docs live with the extension** and are disclosed on demand, filtered to what is available.
5. **Policy granularity does not regress** when the direct tools go.

**Non-goals:** extension packaging, distribution, signing and installation UX (a later proposal; this one fixes the contract and settings), and moving general-purpose tools (`read`, `write`, `edit`, `bash`, `python_exec`, `web_fetch`, `web_search`) into the sandbox only. Those stay direct because agents use them outside integration work.

## Design

```mermaid
flowchart TD
  subgraph Extensions
    B[Built-in: Atlassian, Web, Image generation, Diagrams]
    I[Installed, later]
  end
  B & I --> REG[Extension registry]
  M[MCP servers: user, project, bundled] --> QS
  SET[Extension settings: defaults → user → project → conversation] --> REG
  REG --> QS[quick_script namespaces]
  REG --> T[Direct tools, e.g. web_fetch]
  REG --> SK[Skills, themes, later]
  QS --> DESC[Tool description: namespace index]
  QS --> DISC["sdk.list / describe / search / docs"]
  QS --> POL[Permission operations and risk]
  REG --> UI[Extensions page, generated from settings schemas]
```

## Decisions

- **"Extension" is the unit.** It names the page, the manifest and the registry. "Provider" stays reserved for model providers (Settings → Providers).
- **Jira and Confluence are one Atlassian extension**, with one account picker and a switch per product.
- **Extensions declare a settings schema** that is stored either in agent configuration (layered like other agent settings) or on the client, and the UI is generated from it ([settings.md](settings.md)).
- **Settings → Integrations becomes Settings → Extensions**, at user and project scope, with a detail view per extension. **MCP servers** get their own page next to Skills ([ui.md](ui.md)). The conversation layer exists in the backend but is not exposed in the UI.
- **Discovery happens in the sandbox** through `sdk.*`, not through a guide rendered per settings combination ([options](#options-considered)).
- **`packages/skills` holds only catalog skills.** `guides/` is deleted; extension docs live with their code ([extensions.md](extensions.md#docs-layout)).
- **Quick-script moves to a new `@nervekit/quick-script` package** ([extensions.md](extensions.md#package)).
- **Image generation is the `imagegen` namespace**, named for the capability so it can support several backends.
- **`web_fetch` and `web_search` stay as direct tools**, contributed by the Web extension, and `web.fetch` and `web.search` stay in the SDK. Both routes authorize the same way.
- **MCP servers are their own resource with their own page**, not extensions. Extensions may bundle servers ([mcp.md](mcp.md)).
- **Unannotated MCP tools default to destructive.** Annotations lower risk only on servers the user trusts ([mcp.md](mcp.md)).
- **Large namespaces:** discovery bounds itself, summarises, spills the full text to an artifact the agent can read or grep, and pages `search` results ([discovery.md](discovery.md#large-namespaces)).

## Migration

1. **Registry, discovery and built-in extensions.** Introduce the manifest and registry in `packages/tools`. Wrap existing namespaces as built-in extensions, add `sdk.*`, and build the `quick_script` description and prelude from the registry. Docs move next to their extensions. `SKILL.md` is removed and its rules move into the description. Measure before and after.
2. **Package split.** Move quick-script code to `@nervekit/quick-script` and delete `packages/skills/src/guides/quick-script`.
3. **Extension settings and the Extensions page.** Add the `extensions` settings key and the settings schema renderer. Switch availability and `web_search` to the new settings, replace the Integrations page, and trim the Tools page ([ui.md](ui.md)).
4. **Operation-level rules.** Add the rule contract change and the broker rewrite, and migrate built-in rule sets. This is a prerequisite for step 5.
5. **Direct-tool removal.** Confirm parity (a typed method or a raw recipe for every direct-tool capability), and run the benchmark. Then add `imagegen`, remove `jira_*`, `confluence_*`, `kroki_export`, `generate_image`, `guides/jira` and `guides/confluence` and their presentation code, and migrate rules and settings.
6. **MCP servers**: catalog, MCP servers page, `mcp.<server>` namespaces.
7. **Installable extensions**, with their own proposal.

Rule and setting changes from steps 3–5 go into the release's single home migration step, and into project configuration version chains for project files.

## Measurement

A fixed task set against the test Atlassian site, each with a written success check: single lookups; cross-call joins; bulk updates with approvals; Excel to a Confluence page with a diagram; edits with known pitfalls (custom field by name, required transition field, stale page version). Five runs per model family (Claude, GPT). Run it before step 1 and again before step 5, where it compares `quick_script` alone with the direct tools alone.

Report:

- success rate and turns per task
- tool-definition tokens per request and total tokens
- tokens read before the first successful SDK call
- failed calls caused by wrong arguments or unknown methods
- calls into unavailable namespaces
- approvals

Step 1 proceeds when success and turns hold steady while upfront tokens drop. Step 5 proceeds unless the direct tools win clearly on a model family.

## Options considered

1. **Static guide, only the description changes with settings (today).** Simplest, but the guide drifts from the active set, and MCP and extensions cannot contribute to it.
2. **A guide rendered for each settings combination,** written to a hashed folder for the Read tool. The docs are filtered, but generated files have to be managed, MCP tool lists are dynamic, and file paths leak into the prompt.
3. **Discovery calls in the sandbox (chosen).** One mechanism for every extension, docs filtered at read time, and a stable description. The cost is one extra tool call before unfamiliar work, which the measurement checks.

## Open questions

- **Discovery budget size:** about 12 KB is a starting point; tune it with the measurement, especially on large MCP servers.
- **Further built-in extensions:** GitHub/GitLab (PR-sync credentials exist), or left to MCP?
- **Detail view routing:** a nested settings route (`extensions/atlassian`) is a new pattern for the settings registry ([ui.md](ui.md#open-questions)).
