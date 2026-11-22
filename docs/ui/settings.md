# Settings UI patterns

Design rules for settings pages in `packages/workbench-app`. `settings-typography.test.ts` enforces the heading rules.

## Headings

Settings has three heading levels:

- Page title: `text-title` medium foreground (`SettingsPageHeader`, `pb-2` of space below).
- Section heading: `text-ui` medium foreground, optionally followed by ONE `text-caption` muted description line.
- Entity title (`EntityCard`, e.g. a profile): `text-ui` regular foreground.

Row titles are `text-ui` regular foreground and all supporting text is `text-caption` muted, so weight and colour carry the hierarchy. Headings are sentence case, never uppercase eyebrows. Longer detail goes in a `SettingsInfoHint` tooltip, not a paragraph. Use `SettingsSection` for every group of rows; an entity such as a profile gets an `EntityCard`, never a muted group heading above it.

## Navigation

`SettingsNav` takes `SettingsNavGroup[]` (optional `GroupLabel` caption: `text-caption text-muted-foreground`, no hover or icon; items `text-ui` with a lucide icon, muted until active). Never reuse a group title as an item name. The active item is `bg-selected`, a persistent state that should not depend on the quiet fills. The sidebar has no right padding: the nav pads its own content so the thin scrollbar sits flush with the panel's edge. Groups never collapse (collapsing hides destinations).

### One tab, and what needs you

Settings is one tab kind. The open project is the active workspace project: it adds a column on layered pages and a nav group named after it; without one the surface is User only. Opening a project's settings (`openProjectSettingsPane`) selects that project and opens or focuses the settings tab; a tab restored from the old per-project kind becomes the settings tab. A nav row shows a count of its page's items that need the user (waiting for review, or not working; User and project together, read from `configuration.attention`; warnings never count) as a `SettingsNavBadge` (`warning`, a 16px solid circle). The gear opens the same tab. The bell's "Review" opens the item on the page that holds it.

## Layers and origin groups

The unified settings surface has two layers: **User** (every project) and the open project (named after it). An absent value inherits; nothing shows a "follows" state except tooltips. Primitives live in `$lib/presentation/settings`:

- **`OriginGroup`:** a list group with a caption (origin icon, name, count). Order groups Project (`briefcase-business`), User (`circle-user`), other sources (Agent Browser `globe`, extensions `blocks`), Built-in (`package`). The origin explanation is a hover tooltip on the caption, never an ⓘ icon. An empty group is hidden unless `emptyText` is given, which is for groups the user can add to (with the add action). Column labels sit at the right of the caption when `layers` is on.
- **`ColumnLabels` / `SplitColumns`:** "User" and the project name, each with a hover tooltip. Project-only groups hide the User label but keep its width. Without a project there is one column and no label of a project. `ColumnLabels` is the **header row of the list's own card**: pass `columns` to `SettingsList` (`OriginGroup` does), never render it floating above or beside a card.
- **`LayerSwitches`:** two switches per row, User then project, emitting `onChange(layer, value)`; callers apply the semantics (a project value equal to User's means follow again). Project-defined items have no User switch: the slot stays empty at the same width, no dash. `pending` hides the switches; `locked` (project file not trusted) shows a locked project switch with User's value. Switches never get a ↺.
- **Table alignment (`LayerCells`):** layered lists read as tables. Every layer column is one fixed, equal-width cell (`w-24`) and BOTH its label and its control (switch, radio, lock) are centered in it, so they line up exactly; the trailing chevron/actions column keeps its width in the header row too. `ColumnLabels`, `LayerSwitches` and radio cells all render through `LayerCells`, so the widths are the same in every group and on every table of a page. A lock sits beside the locked switch and never shifts it. A radio table (extension accounts) uses the same cells.
- **Title rows stay simple (`LayerEnabledTable`):** a detail page's title row holds at most ONE simple action (New profile, Reload, a single enable switch without a project). Anything more goes in a row below the description: the User/project enable switches become an "Enabled" (or "Available") one-row table with the same column header and cell widths as the lists below (extension, sub-agent launch and suggestion pages); icon actions (Duplicate, Open file, Review trust, Revert, Delete) become a row of small outline `Button`s with icon and label.
- **`LayerRow` + `SplitColumns`:** value settings with wide controls: label and description full width, then the User and project controls in two equal halves under a `SplitColumns` header. Without a project the row is the single-control row. The ↺ (`reset`) belongs to value cells only.
- **Empty columns:** a layer that does not exist or does not apply leaves its cell empty (or a muted `projectNote`), so columns stay aligned.
- **`LevelMenu`:** an action that targets a layer. A plain button without a project; a User / project-name dropdown with one.
- **`TipBadge`, `HoverTip`:** a badge or small target that explains itself on hover.

Page actions (New …, Reload) go in the page header right of the title through the shell's `pageActions` snippet, as small outline buttons with icon and label. Lists with more than 12 items get a search field. Nav count badges are small solid warning circles (16px, `SettingsNav`).

## Profiles, suggestions and rule sets

- **Agents / Sub-Agents:** list → detail. Groups Project → User → Built-in; a row shows a summary of the profile's changes ("Permissions Read only · Plan review On · 1 more change", or "Uses your defaults"), badges (Both, Replaces built-in, Replaced by the project copy), Duplicate, and, on Sub-Agents only, the launch `LayerSwitches` (`subagents.<name>.enabled`). A project profile waits for review as a problem line with **Review**. **New profile** is a header `LevelMenu` that creates and opens the profile.
- **Profile detail:** a Profile section (label, read-only ID, when to use, used as), then Changes. Changes start empty; **Add a change** offers every setting grouped Basics / Tools / Skills and only what is added is stored. A change row shows its value as the status line, a Required / Recommended `TipBadge`, a lock that switches the mode, and remove; the row opens its editor. Built-in profiles are read-only with **Customize** (`LevelMenu`), which saves a copy with the same ID that replaces them. Sub-Agents put the launch switches in the header under the column labels.
- **Suggestions:** Project → User → Built-in groups with `LayerSwitches` per layer (a project-defined suggestion has no User switch), a JavaScript badge (No JS / Allowed / Unset / Denied) with a tooltip, and a "waits for your review" problem line that hides the switches. The project's enablement file (`.nerve/config/prompt-suggestions.json`) is trusted by exact content like the other project settings files: while untrusted it is ignored, the project column is locked under the untrusted callout, and it is reviewed on the Trust page; edits made in the app keep it trusted. **New suggestion** is a header `LevelMenu`.
- **Permission rules:** User and Built-in groups without switches (rule sets are chosen in General). The Default badge says where to change it; project overlays are a count in the row's summary.

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

Accounts are added, edited and chosen on the page of the extension that uses them; **Connections › Accounts** is only an index of them. Never link from an extension page to the index to manage accounts.

- **Extension page:** the account section lists the accounts of the extension's kind with a radio that chooses the one the extension uses. With a project open each row has two radio slots under `ColumnLabels`, User and the project: the project follows User until it picks another account, and picking User's account again clears the override (no ↺ on radios). Project accounts have no User radio. The header has an outline **Add account** button (Plus icon), repeated as the action of the empty state. Opening a row edits the account; a problem line offers **Sign in** (`needs_sign_in`, kinds with a provider) or **Retry** (last test failed), otherwise **Edit**.
- **Adding:** the dialog is generated from the kind's manifest, with the typed-in secrets. With a project open it asks "Available to": User or "Only <project>"; an extension defined by the project can only add project accounts, so the level is pinned. A kind that signs in submits as **Add and sign in** (otherwise **Add**) and the same dialog then shows the sign-in interaction (`AccountSignInPanel`, the shared interaction panel also used by the Providers page) and closes when it succeeds. Only this app can start, answer or cancel a sign-in.
- **Accounts page:** an index, no Add account. Accounts sit in `OriginGroup`s (`layers={false}`): the open project first, then User. A row shows the account name, the extension and a detail summary, a problem line with its **Sign in** or **Retry** action, a health icon that tests the account, a menu (Sign in again, Move to user/project level, Duplicate to a level, Clear credentials) and Delete. Moves and duplicates offer only the levels the kind allows; a project-defined kind's accounts stay in their project. Duplicating a signed-in account warns that both copies share one sign-in. Opening a row navigates to the owning extension's page. The search ("N of M") appears from 12 accounts and matches the name, kind, platform, defining extension, level and state. The empty state reads "No accounts" / "Add an account from the page of the extension that uses it."

## Background jobs

**System › Background jobs** lists the daemon's periodic work as one `SettingsList`: each `SettingsItem` has the job's label and description, a "Running" or "Failing" badge, a problem line with the last error while it fails, and one muted line with the last run (when, and its summary) and the next run. The only action is an `IconAction` **Run now**, disabled while the job runs. Jobs have no switch; credential refresh is not optional, because turning it off only makes sign-ins expire. A job that keeps failing, and an account that needs sign-in, also reach the Activity bell as notices that link to this page or to Accounts. Design: [background jobs](../architecture/background-jobs.md).

## Entity cards

`EntityCard` is one card per entity: header (title, then badges, actions on the right), muted description, `EntityRow` changes divided by hairlines (muted label column, foreground value, icon actions), ghost `Button size="sm"` footer. Never put `well` behind editable rows: `well` is for recessed output.

## Provenance

Show provenance only when it differs. A setting that matches where it would otherwise come from shows nothing: no per-row source badges. One that differs (a user value that differs from the built-in default, a project value that differs from the user's, a conversation value that differs from its profile) gets `SettingsChangeIndicator`: a single ↺ that marks the change and resets it, with the inherited value in its tooltip ("Reset to default (Balanced)"). It goes in the row's `badges` slot, or `meta` for a `SettingsItem`. Layered pages with a project open summarise them in the page header ("N differ · Reset all"): the count is of items whose effective project value differs from User's, so a stored value equal to User's does not count. While the page's project file is untrusted its column is locked and the summary is hidden. Fixed values say who fixed them in a tooltip ("Locked by Planning"), not a disabled-looking input.

## Model choice

`ModelPicker` (`$lib/presentation/model-picker`) chooses ONE model together with its reasoning level, constrained to the levels that model supports; use it wherever a single model is chosen (settings, profile changes, tool config, composer). `ModelMultiSelect` chooses several (the model scope). They are not interchangeable.
