# Settings UI patterns

Design rules for settings pages in `packages/workbench-app`. `settings-typography.test.ts` enforces the heading rules.

## Headings

Settings has three heading levels:

- Page title: `text-title` medium foreground (`SettingsPageHeader`, `pb-2` of space below).
- Section heading: `text-ui` medium foreground, optionally followed by ONE `text-caption` muted description line.
- Entity title (`EntityCard`, e.g. a profile): `text-ui` regular foreground.

Row titles are `text-ui` regular foreground and all supporting text is `text-caption` muted, so weight and colour carry the hierarchy. Headings are sentence case, never uppercase eyebrows. Longer detail goes in a `SettingsInfoHint` tooltip, not a paragraph. Use `SettingsSection` for every group of rows; an entity such as a profile gets an `EntityCard`, never a muted group heading above it.

## Navigation

`SettingsNav` takes `SettingsNavGroup[]` (optional `GroupLabel` caption: `text-caption text-muted-foreground`, no hover or icon; items `text-ui` with a lucide icon, muted until active) and a `SettingsScopeHeader`, separated by a rule. Never reuse a group title as an item name. The active item is `bg-selected`, a persistent state that should not depend on the quiet fills.

### Scopes and what needs you

The scope header lists "Your settings" and, with an open project, the project as two `SelectRow`s; the selected one is the scope of the open tab. The project row carries a warning `Badge` with the count of project items that need the user (waiting for review, or not working), read from `configuration.attention`; warnings never count. A nav row shows the same kind of count for its page (`SettingsNavBadge`, `warning`); it takes the place of the project-differs count (`info`) on that row. The gear keeps opening user settings.

A user page whose project counterpart has content ends with an "In this project" section (`SettingsSection` + one `SettingsItem`) that opens the project page of the same id: Skills and Extensions show what the project has; Agents, Sub-Agents, Permission rules and Suggestions appear when the project has items there that need the user. The section is absent without an open project or when the project has nothing there. The bell's "Review" opens the item in the scope that holds it.

## Sections are surfaces

`SettingsSection` draws its body as a bordered `card` (`rounded-lg`) with the heading outside, above it; the surface, not a rule, separates sections. Pass `divided` for rows: the body becomes `divide-y divide-border` with no padding and `SettingsRow` pads itself (`min-h-12 px-3 py-2`). From the `@md/settings-page` container width rows use a fixed 14rem control column, so controls align across rows and sections; narrower panes stack.

Put controls directly in the row's `control` snippet: Select, Input with suffix, Switch; do not pair a value with a "Change" button. Nested cards read the `data-settings-surface` contract and sit flush (`SettingsList`, `SettingsEmptyState variant="card"`, the model catalog). Group related controls into few sections.

## Lists

Entity lists and catalogs (tools, skills, extensions, providers, accounts) are a single `SettingsList` (bordered `card` surface, hairline-divided rows) holding `SettingsItem` rows, never a stack of individually tinted cards. The anatomy is fixed:

- **Left:** an identity icon tile (or a custom mark such as a provider logo), then the title with badges for exceptional states only (Experimental, Default, Shadowed, a version), and one status line under it.
- **Selectable rows:** a list that chooses one of its items (the account an extension uses) puts a radio (`select` snippet of `SettingsItem`, inside a ui-kit `RadioGroup`) in the icon's slot. The row keeps everything else: it still opens the item, and its actions stay. `iconLabel` adds a kind tooltip to an icon tile (Features rows).
- **Status line:** the summary of how the item is set up, or what it does when it has no settings. A problem replaces it in warning tone, followed by its fix action, so every row keeps its height. Never write "Off" there; the switch says it.
- **Right:** change indicator and other quiet meta, icon actions (entity lists), lock, then the switch or "Always on", then a chevron when the row opens something.
- **Opening:** the whole row opens the item's detail view or dialog. Never add a per-row Configure or Edit button; the row is that button. Lists that open nothing keep the chevron slot empty so switches align.
- **Compact:** `compact` makes a single-line row (`min-h-10`, no status line); use it for reference lists whose rows never have a second line (shortcuts).
- **Off:** the title and icon turn muted; the row stays readable and openable.

Row actions are `IconAction`s, which require a label and supply the tooltip and accessible name; keep them to actions other than opening (Test, Copy, Delete). Detail editing belongs in a dialog or detail view, not inline on the page.

### List → inner page

Anything with more to show than a row (an extension, a permission rule set, a prompt suggestion) opens an **inner page**, never an in-place expansion: the row is a plain `SettingsItem` with a chevron and its summary on the status line. A page opts in by declaring `detail` in the registry (`settings-page-data.ts`); the shell then tracks the open item, restores the list's scroll on back, and Escape returns to the list. The page renders its own `SettingsPageHeader` with `parent` set, so the title becomes a breadcrumb (`Permission rules › Name`) in the same box as the list header, with the item's description and its page actions (an enable switch) in the actions slot; nothing moves vertically and the heading takes focus on open. The detail's body is ordinary `SettingsSection`s. A list that has nothing more to show (storage categories) opens nothing. Compact lists without identity (shortcuts, devices, activity) use `SettingsItem` without an icon.

### Project skill review

Project settings › Skills lists the project's skills with their approval: a skill that waits shows "Waiting for your review" or "Changed since you approved it" as its problem line with a Review action, and no switch. Every project skill opens an inner page (`SkillReviewPage`, `detail` item `skill`) built from `SettingsSection`, `SettingsList` and `Callout`: what the agent is told (name and description), then the files the approval covers with scripts marked, each opening in a file tab; `SKILL.md` is not inlined. The header action is Approve (Approve changes after a change) or, for an approved skill, Withdraw approval; both are `trust.decide` decisions on the digest the page showed, and if the files changed while the page was open it reloads and says so instead of approving. User-scope and built-in skills have no approval UI. Rules: [trust](../architecture/trust.md).

## Accounts

**Connections › Accounts** is the one place accounts are managed; extension pages keep only the selector that chooses which account the extension uses (a radio list) and link to this page with the search prefilled with their extension or platform name. The page is a `SettingsList` of every account of the user and, with a project open, that project's, under a `SettingsToolbar` with one `SearchInput` ("Search accounts", with an "N of M" count) and Add account. The search matches the name, kind, platform, defining extension, level (User or the project's name) and state, every word of the query.

- **Row:** the defining extension's icon, the account name, a status line (summary and level), a "Needs sign-in" badge, and a problem line with its fix action in place of the status when there is one: **Sign in** for `needs_sign_in` (kinds with an `oauth2` or extension provider), **Edit** otherwise, **Retry** when the last test failed. A state of `failed` or `unavailable` (the defining extension is off or gone, named in the line) is a problem too. Opening the row edits the account.
- **Actions:** a health icon that tests the account, a menu (Sign in again, Move to user/project level, Duplicate to a level, Clear credentials) and Delete. Moves and duplicates offer only the levels the kind allows; a project-defined kind's accounts stay in their project. Duplicating a signed-in account warns that both copies share one sign-in.
- **Adding:** Add account asks for the kind (naming the defining extension, since several can define accounts for one platform) and, with a project open, the level; then the account dialog, generated from the manifest, with the typed-in secrets, and the sign-in dialog for providers that sign in interactively.
- **Sign-in dialog:** the shared interaction panel renders what the sign-in service asks for (browser link, device code, choice, text, progress) and is the same one the Providers page uses. Only this app can start, answer or cancel a sign-in.

## Background jobs

**System › Background jobs** lists the daemon's periodic work as one `SettingsList`: each `SettingsItem` has the job's label and description, a "Running" or "Failing" badge, a problem line with the last error while it fails, and one muted line with the last run (when, and its summary) and the next run. The only action is an `IconAction` **Run now**, disabled while the job runs. Jobs have no switch; credential refresh is not optional, because turning it off only makes sign-ins expire. A job that keeps failing, and an account that needs sign-in, also reach the Activity bell as notices that link to this page or to Accounts. Design: [background jobs](../architecture/background-jobs.md).

## Entity cards

`EntityCard` is one card per entity: header (title, then badges, actions on the right), muted description, `EntityRow` changes divided by hairlines (muted label column, foreground value, icon actions), ghost `Button size="sm"` footer. Never put `well` behind editable rows: `well` is for recessed output.

## Provenance

Show provenance only when it differs. A setting that matches where it would otherwise come from shows nothing: no per-row source badges. One that differs (a user value that differs from the built-in default, a project value that differs from the user's, a conversation value that differs from its profile) gets `SettingsChangeIndicator`: a single ↺ that marks the change and resets it, with the inherited value in its tooltip ("Reset to default (Balanced)"). It goes in the row's `badges` slot, or `meta` for a `SettingsItem`. Project pages summarise them in the page header ("N differ · Reset all"). Fixed values say who fixed them in a tooltip ("Locked by Planning"), not a disabled-looking input.

## Model choice

`ModelPicker` (`$lib/presentation/model-picker`) chooses ONE model together with its reasoning level, constrained to the levels that model supports; use it wherever a single model is chosen (settings, profile changes, tool config, composer). `ModelMultiSelect` chooses several (the model scope). They are not interchangeable.
