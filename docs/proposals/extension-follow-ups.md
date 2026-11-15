# Extension follow-ups

**Status:** Draft · **Area:** extensions

## Problem

Phase 1 of the extension platform shipped ([architecture/extension-platform](../architecture/extension-platform.md)): the built-ins use only `@nervekit/extension-api`, accounts are generic, and the host names no extension. The extension icons, the detail header, the schema-derived detail layout and the account and Features refinements have since landed too. A few small gaps, decisions and unverified paths remain. None blocks phase 2 ([extension-platform](extension-platform/README.md)), but each is cheaper to settle now than after third-party extensions depend on the current behaviour.

## Items

### Decisions

1. ~~**Web Search extension on by default.**~~ Decided: stays off by default. It needs a third-party search account, so the user configures one and then enables the extension (migration step 0005 already enables it for homes that had a search account).
2. **Permission rules for extension tools (decided: operations only; implemented).** Extension tools are targeted by their operation (`search.web`), never by tool name; core tools keep tool-name rules. Exceptions already accept only core tool names (`tool: toolNameSchema` in `permissionExceptionSchema`), so an exception naming `web_search` or `explain_image` is rejected, but with a generic "invalid" error. Contracts cannot see the runtime registry, so the hint is static. Decided: the rejection says that the name is not a core tool and that extension tools are targeted by operation (`tool: "quick_script"`, the operation as the rule, for example `search.web`); the website's Permission rules page documents the same ([permissions](../architecture/permissions.md) already does).
3. ~~**Account test result when everything passes.**~~ Dropped: saving an account tests it, failures name the product ("Jira: …"), and the health icon's tooltip is enough for a pass.

### Small changes

4. **Planning rule set allows external reads by risk (implemented).** `packages/tools/src/policy/rule-sets/planning.json` allows network reads in the `web`, `jira` and `confluence` tool groups by name, a reviewed exception in `scripts/checks/extension-naming-policy.ts`. The names exist only to keep out `diagram.render` and `imagegen.generate`, which are also labelled `network`. Risk already separates the rest: Atlassian reads are `network`, writes `external_write`, deletes `destructive`; local reads are allowed by `read`. Decided:
   - Rename the `network` risk to `external_read` everywhere: extension `Risk`, the rule-set category (`StaticToolRisk`, `baseRisks`) and the call's effective risk (`ToolRisk`, stored as `supervision.effectiveRisk`). It always meant a read outside the machine, but the name reads as either. Risks are named by where the effect lands, not by transport: `read` / `external_read`, `workspace_write` / `external_write`. Extend the unreleased migration step 0005 to rewrite user and project rule sets and the stored values.
   - Relabel `imagegen.generate` as `external_write`: it spends credit and creates something on an external service. `diagram.render` stays an external read (it sends diagram source to Kroki, like a search query).
   - Implemented: migration 0005 rewrites rules and rule sets (user, conversation, project); recorded `supervision.effectiveRisk` is stored in SQLite events and tool calls, so `supervisionSchema` reads a legacy `network` as `external_read` instead of rewriting rows.
   - The planning rule becomes `baseRisks: ["external_read"]` with no tool groups (web search and fetch, Atlassian reads, diagram rendering); remove the naming exception.
5. **Extension settings change notice (implemented).** Accounts publish `accounts.changed`; extension settings saves publish nothing to clients. The server already observes every scope change (`ExtensionSettingsService.subscribe`), but the Extensions page reloads only on `settings.updated` and account events, and the Tools page extension state listens to none, so another window stays stale after a save. Decided: publish `extensions.changed` (scope) from that subscription, like `accounts.changed`, and reload the extension views (Extensions page, Tools page, composer extension state) on it.
6. **Retire the older settings rows (implemented).** `SettingsItem` is the current row component ([docs/ui/settings.md](../ui/settings.md)), but `SettingsListItem` / `SettingsDisclosureItem` are still used by the Suggestions, Shortcuts, Storage and Devices pages, `PermissionRuleSetItem`, and `settings-entity-list-section.svelte` (whose doc comment also predates `SettingsItem`). Migrate them to the row style the Extensions and Tools pages use, then delete the old components and their design-lab entries. Decided: same branch as the other items.
7. **Reject unsupported fields in account kinds (implemented).** The account dialog has no control for `account` or `model` fields and silently drops them, and `accountKindSchema` accepts them. Decided: `accountKindSchema` rejects them, so registration fails.

### Verification

8. **Image generation backend.** `imagegen.generate` has never run end to end: the openai-codex backend returns HTTP 403 on dev slots. Confirm whether it is an account restriction (login without image access) or a request problem, then word the error and fix accordingly; until then the extension stays off by default. Blocked: we have no Codex subscription with image access to test with; reopen when one is available.
9. **Required-field transition benchmark task.** `pitfall-transition-field` in `scripts/benchmarks/extensions/` is always skipped because the sandbox Jira project has no transition with a required field. SCRUM is team-managed, and team-managed workflows cannot require fields on a transition (no transition screens). Done on the site: company-managed project `BENCHCM` with the classic default workflow, where "Resolve Issue" and "Close Issue" require Resolution (checked with a probe issue); the account is in its Administrators role, so cleanup can delete issues. The benchmark README names the project. To do: run the task with `--jira-project BENCHCM --tasks pitfall-transition-field`.

### Deferred to phase 3

- The Extensions list has one hard-coded "Built-in" section. Group by `metadata.source` once installed extensions exist.
- The field-type set is closed by design (a type is added when a built-in needs it; a new type means contracts, `controlFor`, `displayValue` and `ExtensionFieldRow`), and extensions supply declarative tool views only (`ToolView`), no UI code. Anything beyond that is phase 3 scope.

### Dropped, reopen on demand

- GIF and WebP dimensions and conversion to PNG for Atlassian uploads (SVG is rejected). Reopen only if agents need them.

## Recommendation

One branch: 2 and 4 (policy shape, before third parties write rules), 5, 7 and 6. Then 9 against the sandbox site. 8 waits for a subscription. Surfacing extension changes to the user is phase 3 scope ([extension-platform](extension-platform/README.md#phase-3-installable-extensions)).

## Open questions

None; every remaining item has a decision.
