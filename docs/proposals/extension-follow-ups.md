# Extension follow-ups

**Status:** Draft · **Area:** extensions

## Problem

Phase 1 of the extension platform shipped ([architecture/extension-platform](../architecture/extension-platform.md)): the built-ins use only `@nervekit/extension-api`, accounts are generic, and the host names no extension. A few small gaps, decisions and unverified paths were left behind. None blocks phase 2 ([extension-platform](extension-platform/README.md)), but each is cheaper to settle now than after third-party extensions depend on the current behaviour.

## Current state and items

### Decisions

1. **Web extension on by default.** `web` has `enabledByDefault: false`. `web.fetch` needs no account and the direct `web_fetch` tool is already on; draft step 0005 enables Web only for homes that had a search account. Recommended: default on. `web.search` and the `web_search` tool stay unavailable until an account is selected (derived availability already says why).
2. **Permission exceptions naming extension tools.** Rule exceptions with `tool: "<name>"` validate against `toolNameSchema` in contracts, which cannot see the runtime registry. `web_search` works only because the name is still a capability name; a new extension tool can be matched only through its operation (`web.search`).
   - Option A: operations are the only route for extension tools; document it and reject tool-name exceptions for them with a hint.
   - Option B: contracts accept any well-formed tool name, and the server validates against the registry when it loads rules (an unknown name becomes a diagnostic, not a parse failure).
   - Recommended: A now (no schema change); B if users ask to write rules by tool name.
3. **Account test UX.** The Test button reports `rejected`, `restricted`, `unavailable` or `unreachable`. Open: show what was checked (for Atlassian: Jira and Confluence separately), and whether to test automatically after saving an account. Recommended: test after save, keep the result line short.

### Small changes

4. **Planning rule set derives research namespaces.** `packages/tools/src/policy/rule-sets/planning.json` allows network reads in the Atlassian and Web namespaces by name, a reviewed exception in `scripts/checks/extension-naming-policy.ts`. Add a namespace declaration (for example `research: true`: read operations are safe in planning) and let the rule set use it; remove the exception.
5. **Extension icons.** Manifests name a lucide icon, but the app resolves names through a fixed map (`extension-icons.ts`) that lacks `image-plus`, so Image generation shows the generic icon. Either load lucide icons by name or validate manifest icon names against the map at registry build, so a typo fails a test instead of falling back silently. Third-party extensions will need the general answer.
6. **Settings change notice.** Accounts publish `accounts.changed`; extension settings saves publish no equivalent event. Confirm whether other clients and open views (Tools page availability, composer capabilities) refresh after a save in another window; if not, add `extensions.changed` and invalidate the extension views.
7. **Retire the older settings rows.** `SettingsItem` is the current row component ([docs/ui/settings.md](../ui/settings.md)), but `SettingsListItem` / `SettingsDisclosureItem` are still used by the Suggestions, Shortcuts and Storage pages, permission rule sets and `settings-entity-list-section.svelte` (whose doc comment also predates `SettingsItem`). Migrate them, then delete the old components and their design-lab entries.

### Verification

8. **Image generation backend.** `imagegen.generate` has never run end to end: the openai-codex backend returns HTTP 403 on dev slots. Confirm whether it is an account restriction (login without image access) or a request problem, then word the error and fix accordingly; until then the extension stays off by default.
9. **Required-field transition benchmark task.** `pitfall-transition-field` in `scripts/benchmarks/extensions/` is always skipped because the sandbox Jira project has no transition with a required field. Add one to the sandbox workflow (a site change, not code) and run the task.

### Dropped, reopen on demand

- GIF and WebP dimensions and conversion to PNG for Atlassian uploads (SVG is rejected). Reopen only if agents need them.

## Recommendation

Order: 1 (one-line default) → 8 (unknown risk) → 2 and 4 (policy shape, before third parties write rules) → 5, 6, 3 → 7 and 9 when convenient. Items 1–6 are small enough for one branch; 7 is UI cleanup and can go separately.

## Open questions

- Item 2: is matching extension tools only by operation acceptable to users who already write tool-name rules for core tools?
- Item 5: should extensions be able to ship their own icon (SVG asset) instead of naming a lucide icon?
