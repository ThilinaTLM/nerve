# Extension follow-ups

**Status:** Draft · **Area:** extensions

## Problem

Phase 1 of the extension platform shipped ([architecture/extension-platform](../architecture/extension-platform.md)): the built-ins use only `@nervekit/extension-api`, accounts are generic, and the host names no extension. A few small gaps, decisions and unverified paths were left behind. None blocks phase 2 ([extension-platform](extension-platform/README.md)), but each is cheaper to settle now than after third-party extensions depend on the current behaviour.

## Current state and items

### Decisions

1. **Web extension on by default.** `web` has `enabledByDefault: false`. `web.fetch` needs no account and the direct `web_fetch` tool is already on; draft step 0005 enables Web only for homes that had a search account. Recommended: default on. `web.search` and the `web_search` tool stay unavailable until an account is selected (derived availability already says why).
2. **Permission rules for extension tools (decided: operations only).** Rule exceptions with `tool: "<name>"` validate against `toolNameSchema` in contracts, which cannot see the runtime registry. Extension tools are targeted by their operation (`web.search`), never by tool name; core tools keep tool-name rules. Existing rules are unaffected: core names are unchanged, `web_search` stays a valid name, and draft step 0005 rewrites rules for the removed `jira_*`/`confluence_*` tools into operation rules. To do: document it on the Permission rules page and in [permissions](../architecture/permissions.md), and reject a tool-name exception that names an extension tool with a hint naming its operation.
3. **Account test UX.** The Test button reports `rejected`, `restricted`, `unavailable` or `unreachable`. Open: show what was checked (for Atlassian: Jira and Confluence separately), and whether to test automatically after saving an account. Recommended: test after save, keep the result line short.

### Small changes

4. **Planning rule set derives research namespaces.** `packages/tools/src/policy/rule-sets/planning.json` allows network reads in the Atlassian and Web namespaces by name, a reviewed exception in `scripts/checks/extension-naming-policy.ts`. Add a namespace declaration (for example `research: true`: read operations are safe in planning) and let the rule set use it; remove the exception.
5. **Extension icons (decided: extensions ship their own icon).** Manifests name a lucide icon today, resolved through a fixed map in the app (`extension-icons.ts`) that lacks `image-plus`, so Image generation shows the generic icon. Brand icons identify an extension faster (Atlassian's official mark), and third-party extensions need the same route.
   - The manifest declares an SVG file in the extension package (`icon: "icon.svg"`), read by the host like doc topics and served to the app; a lucide name stays allowed for extensions without a brand mark, and unknown names fail a registry test instead of falling back silently.
   - The app renders extension SVGs as images (`<img>`), never inlined, so markup in a third-party file cannot run scripts or read the page; the host also rejects files over a small size limit (for example 16 KB), non-square view boxes and external references.
   - Brand icons keep their colours, so they look the same in both themes; monochrome lucide icons keep following the text colour.
   - Built-ins: Atlassian uses the official Atlassian mark (SVG, 32×32 view box); follow the vendor's brand guidelines for any official logo. Web, Diagrams and Image generation keep lucide icons (`globe`, `workflow`, `image-plus`).
6. **Settings change notice.** Accounts publish `accounts.changed`; extension settings saves publish no equivalent event. Confirm whether other clients and open views (Tools page availability, composer capabilities) refresh after a save in another window; if not, add `extensions.changed` and invalidate the extension views.
7. **Retire the older settings rows.** `SettingsItem` is the current row component ([docs/ui/settings.md](../ui/settings.md)), but `SettingsListItem` / `SettingsDisclosureItem` are still used by the Suggestions, Shortcuts and Storage pages, permission rule sets and `settings-entity-list-section.svelte` (whose doc comment also predates `SettingsItem`). Migrate them, then delete the old components and their design-lab entries.

### Verification

8. **Image generation backend.** `imagegen.generate` has never run end to end: the openai-codex backend returns HTTP 403 on dev slots. Confirm whether it is an account restriction (login without image access) or a request problem, then word the error and fix accordingly; until then the extension stays off by default.
9. **Required-field transition benchmark task.** `pitfall-transition-field` in `scripts/benchmarks/extensions/` is always skipped because the sandbox Jira project has no transition with a required field. Add one to the sandbox workflow (a site change, not code) and run the task.

### Dropped, reopen on demand

- GIF and WebP dimensions and conversion to PNG for Atlassian uploads (SVG is rejected). Reopen only if agents need them.

## Recommendation

Order: 1 (one-line default) → 8 (unknown risk) → 2 and 4 (policy shape, before third parties write rules) → 5, 6, 3 → 7 and 9 when convenient. Surfacing extension changes to the user is phase 3 scope ([extension-platform](extension-platform/README.md#phase-3-installable-extensions)). Items 1–6 are small enough for one branch; 7 is UI cleanup and can go separately.

## Open questions

- Item 5: should a brand icon offer a separate dark-theme variant, or is one coloured SVG always enough?
