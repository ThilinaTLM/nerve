# Extension follow-ups

**Status:** Draft · **Area:** extensions

## Problem

Phase 1 of the extension platform shipped ([architecture/extension-platform](../architecture/extension-platform.md)): the built-ins use only `@nervekit/extension-api`, accounts are generic, and the host names no extension. A few small gaps, decisions and unverified paths were left behind. None blocks phase 2 ([extension-platform](extension-platform/README.md)), but each is cheaper to settle now than after third-party extensions depend on the current behaviour.

## Current state and items

### Decisions

1. **Web Search extension on by default.** `web-search` has `enabledByDefault: false` (`web.fetch` is built into quick_script and always on); draft step 0005 enables it only for homes that had a search account. Recommended: default on. `search.web` and the `web_search` tool stay unavailable until an account is selected (derived availability already says why).
2. **Permission rules for extension tools (decided: operations only).** Rule exceptions with `tool: "<name>"` validate against `toolNameSchema` in contracts, which cannot see the runtime registry. Extension tools are targeted by their operation (`search.web`), never by tool name; core tools keep tool-name rules. Existing rules are unaffected: core names are unchanged, `web_search` stays a valid name, and draft step 0005 rewrites rules for the removed `jira_*`/`confluence_*` tools into operation rules. To do: document it on the Permission rules page and in [permissions](../architecture/permissions.md), and reject a tool-name exception that names an extension tool with a hint naming its operation.
3. **Account test UX.** The Test button reports `rejected`, `restricted`, `unavailable` or `unreachable`. Open: show what was checked (for Atlassian: Jira and Confluence separately), and whether to test automatically after saving an account. Recommended: test after save, keep the result line short.

### Small changes

4. **Planning rule set derives research namespaces.** `packages/tools/src/policy/rule-sets/planning.json` allows network reads in the Atlassian and Web namespaces by name, a reviewed exception in `scripts/checks/extension-naming-policy.ts`. Add a namespace declaration (for example `research: true`: read operations are safe in planning) and let the rule set use it; remove the exception.
5. **Extension icons (implemented).** Manifests name a lucide icon today, resolved through a fixed map in the app (`extension-icons.ts`) that lacks `image-plus`, so Image generation shows the generic icon. Brand icons identify an extension faster (Atlassian's official mark), and third-party extensions need the same route.
   - The manifest declares an SVG file in the extension package (`icon: "icon.svg"`), read by the host like doc topics (`docs-source.ts`, copied by `copy-extension-assets.ts`); a lucide name stays allowed for extensions without a brand mark, and unknown names fail a registry test instead of falling back silently.
   - `ExtensionMetadata.icon` becomes `{ type: "lucide", name } | { type: "svg", src }`, where `src` is a `data:image/svg+xml` URI built by the host. The extension view stays self-contained on every transport (desktop, web, remote devices) and needs no new route or cache headers; icons are a few KB.
   - The app renders extension SVGs as images (`<img>`), never inlined, so markup in a third-party file cannot run scripts or read the page; the host also rejects files over a small size limit (for example 16 KB), non-square view boxes and external references. Internal references (`url(#gradient)`) are fine: an `<img>` document has its own id space.
   - Brand icons keep their colours, so they look the same in both themes; monochrome lucide icons keep following the text colour. Both sit in the same bordered tile. When the extension is off, a lucide glyph turns muted and a brand mark is desaturated (`grayscale`), matching the muted title.
   - One coloured SVG per extension; no dark variant. The Atlassian mark (`#0052CC`→`#2684FF`) reads on both themes. Add an optional dark variant only if a vendor's guidelines require one.
   - Built-ins: Atlassian uses the official mark the user supplied (32×32 view box, about 1.1 KB, no external references) as `packages/extensions/src/atlassian/icon.svg`. Web, Diagrams and Image generation keep lucide icons (`globe`, `workflow`, `image-plus`).
6. **Settings change notice.** Accounts publish `accounts.changed`; extension settings saves publish no equivalent event. Confirm whether other clients and open views (Tools page availability, composer capabilities) refresh after a save in another window; if not, add `extensions.changed` and invalidate the extension views.
7. **Retire the older settings rows.** `SettingsItem` is the current row component ([docs/ui/settings.md](../ui/settings.md)), but `SettingsListItem` / `SettingsDisclosureItem` are still used by the Suggestions, Shortcuts and Storage pages, permission rule sets and `settings-entity-list-section.svelte` (whose doc comment also predates `SettingsItem`). Migrate them, then delete the old components and their design-lab entries.

### Extension detail view

The list and the detail are already generic: settings rows come from `settingsSchema` (sections, advanced, scopes, locks, `visibleWhen`), the account list and dialog from `accountKinds`, Contributes from `metadata.contributes` plus `availability`, and the list summary and problem from the same data. A new extension that uses the existing field types needs no UI change. Items 10–13 tighten what it shows and close the remaining gaps.

10. **Detail header in the page-header slot (implemented).** Opening an extension now swaps the page header for a breadcrumb row, then an icon tile, name and description below it, so the title moves down about 50 px and its typography changes (description `text-caption` instead of `text-ui`). Instead, keep `SettingsPageHeader`'s box and make its title the breadcrumb: `Extensions › [mark] Atlassian` in `text-title`, "Extensions" muted and the back link, the item's description in place of the page's, and the enable switch in the page-actions slot. Nothing moves vertically when a detail opens or closes; Escape and focus-on-open stay. This replaces `SettingsBreadcrumb` and the header inside `ExtensionDetail.svelte` and applies to every page with a `detail` declaration.
11. **Detail layout derived from the schema (implemented).** Today the Jira and Confluence switches in Settings repeat the `jira` and `confluence` rows in Contributes, every Contributes row ends in "· Available", helper namespaces are listed although `helper` means "not listed to the user", and there are three "Add account" buttons when no account exists. Proposed, with no contract change:
    - **Features** replaces Contributes, described as "What the agent can use in quick_script when this extension is on." Not "Capabilities": `permissions.capabilities` already names host features an extension may use. One row per non-helper namespace (mono id, summary). Direct tools and skills keep their rows and Open Tools/Skills links.
    - A boolean field moves onto its namespace row as the row's switch, with its change indicator and lock, and leaves Settings, when it is the single `enabledBy` of exactly one listed namespace, is no `enabledBy` of another listed namespace, and has no `section`, `advanced` or `visibleWhen`. Those three mean the schema author placed the field on purpose, so it stays in Settings and the namespace row shows its state instead ("Off · set in Settings", linking to the field). Namespaces that follow the extension show "With the extension".
    - Status follows the provenance rule: nothing when available, the reason in warning tone when not ("Needs an account").
    - Helper namespaces are named once, in the section footer ("Also loads helper namespaces: atlassian, storage").
    - Order: problem callout, Settings (remaining fields, Advanced), Features, Accounts. Accounts move last because they are managed rarely; the account choice stays in Settings.
    - One Add account: in the Accounts section header (and the problem callout's fix). The account select no longer carries its own ghost button; with no accounts it shows a disabled "No accounts yet".
    - Nothing is removed: every control, change indicator, reset and link of today's view keeps a place.
12. **Account and Features refinements (implemented).** After item 11 the account is chosen in a Settings dropdown and managed in a separate list below; every Features row titles itself with a monospace namespace id; the description ties Features to quick_script although extensions also contribute direct tools and skills; and account health is a word at the end of the URL line.
    - **One Account section.** An account field merges with its kind's list when it is the only account field of that kind and has no `section`, `advanced` or `visibleWhen` (the item 11 rule). Each account row has a radio in place of the brand tile (the mark is the same on every row and already in the header); the radio chooses, the row still opens Edit, and Test and Delete stay as row actions. The field's change indicator and reset sit in the section header beside Add account. The title is the field's label ("Account", "Search account") and its description the field's. Order: problem callout, Account, Settings (whatever is left; omitted when empty), Features. At project scope the radios still choose (a project can use another account); Add, Edit, Test and Delete give way to "Managed in user settings". A field that does not merge keeps its select, and the kind's list stays a separate section.
    - **Health on the name.** A status icon follows the account name: verified `circle-check` (success), restricted or couldn't check `triangle-alert` (warning), rejected `circle-x` (destructive), nothing when not checked or the kind has no test. Its tooltip names the status and when it was checked. The second line keeps only the account summary (site, email). A missing secret or a check that failed still replaces that line with the warning and its fix.
    - **Features by kind.** Description: "What the agent gets when this extension is on." One row per contribution, each led by a tile with its kind's icon, the same icon as that kind's settings page: quick_script namespace `code`, direct tool `wrench`, skill `library`. The tile's tooltip names the kind and identifier ("Quick script namespace · jira"). Titles use the regular font. Namespace rows keep the item 11 controls; a tool row shows its availability and opens the tool on the Tools page; a skill row opens the skill. Helper namespaces stay in the footer.
    - **Contract.** Namespaces gain an optional `label` (title on the Extensions page; the id when absent), like tools. Metadata `contributes.tools` becomes `{ name, label, description }[]`, so a tool row needs no second request. Built-in labels: Jira, Confluence, Web, Image generation, Diagrams.
13. **Gaps before third-party extensions.** Only these still assume the built-ins:
    - The list has one hard-coded "Built-in" section. Group by `metadata.source` once phase 3 adds installed extensions.
    - ~~`extensionFix` uses the first account kind.~~ Done: it follows the failing namespace's `requiresAccount` field.
    - The field-type set is closed by design (a type is added when a built-in needs it); a new type means contracts, `controlFor`, `displayValue` and `ExtensionFieldRow`. The account dialog has no control for `account` or `model` fields and silently drops them; registration should reject them in account kinds.
    - Extensions cannot supply their own UI. That is intended; anything beyond the schema stays a proposal for phase 3.

Wireframe: `/dev/wireframes/extension-detail-streamlined` (local, gitignored) shows the list and detail with Current and Proposed variants, the brand icon, and an "Atlassian: no account" scenario. Its `layoutDetail` is the derivation rule from item 11; the Proposed variant shows item 12.

### Verification

8. **Image generation backend.** `imagegen.generate` has never run end to end: the openai-codex backend returns HTTP 403 on dev slots. Confirm whether it is an account restriction (login without image access) or a request problem, then word the error and fix accordingly; until then the extension stays off by default.
9. **Required-field transition benchmark task.** `pitfall-transition-field` in `scripts/benchmarks/extensions/` is always skipped because the sandbox Jira project has no transition with a required field. Add one to the sandbox workflow (a site change, not code) and run the task.

### Dropped, reopen on demand

- GIF and WebP dimensions and conversion to PNG for Atlassian uploads (SVG is rejected). Reopen only if agents need them.

## Recommendation

Order: 1 (one-line default) → 8 (unknown risk) → 2 and 4 (policy shape, before third parties write rules) → 5, 6, 3 → 10, 11, 12 → 13, 7 and 9 when convenient. Surfacing extension changes to the user is phase 3 scope ([extension-platform](extension-platform/README.md#phase-3-installable-extensions)). Items 1–6 are small enough for one branch; 5, 10 and 11 are one UI branch (icon contract plus detail view); 7 is UI cleanup and can go separately.

## Open questions

None for items 5 and 10–12.
