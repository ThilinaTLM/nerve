# Settings UI patterns

Design rules for settings pages in `packages/workbench-app`. `settings-typography.test.ts` enforces the heading rules.

## Headings

Settings has three heading levels:

- Page title: `text-title` medium foreground (`SettingsPageHeader`, `pb-2` of space below).
- Section heading: `text-ui` medium foreground, optionally followed by ONE `text-caption` muted description line.
- Entity title (`EntityCard`, e.g. a profile): `text-ui` regular foreground.

Row titles are `text-ui` regular foreground and all supporting text is `text-caption` muted, so weight and colour carry the hierarchy. Headings are sentence case, never uppercase eyebrows. Longer detail goes in a `SettingsInfoHint` tooltip, not a paragraph. Use `SettingsSection` for every group of rows; an entity such as a profile gets an `EntityCard`, never a muted group heading above it.

## Navigation

`SettingsNav` takes `SettingsNavGroup[]` (optional `GroupLabel` caption: `text-caption text-muted-foreground`, no hover or icon; items `text-ui` with a lucide icon, muted until active) and a `SettingsScopeHeader` (User settings, or project name and path) separated by a rule. The active item is `bg-selected`, a persistent state that should not depend on the quiet fills. Never reuse a group title as an item name.

## Sections are surfaces

`SettingsSection` draws its body as a bordered `card` (`rounded-lg`) with the heading outside, above it; the surface, not a rule, separates sections. Pass `divided` for rows: the body becomes `divide-y divide-border` with no padding and `SettingsRow` pads itself (`min-h-12 px-3 py-2`). From the `@md/settings-page` container width rows use a fixed 14rem control column, so controls align across rows and sections; narrower panes stack.

Put controls directly in the row's `control` snippet: Select, Input with suffix, Switch; do not pair a value with a "Change" button. Nested cards read the `data-settings-surface` contract and sit flush (`SettingsList`, `SettingsEmptyState variant="card"`, the model catalog). Group related controls into few sections.

## Lists

Entity lists and catalogs (tools, skills, extensions, providers, accounts) are a single `SettingsList` (bordered `card` surface, hairline-divided rows) holding `SettingsItem` rows, never a stack of individually tinted cards. The anatomy is fixed:

- **Left:** an identity icon tile (or a custom mark such as a provider logo), then the title with badges for exceptional states only (Experimental, Default, Shadowed, a version), and one status line under it.
- **Status line:** the summary of how the item is set up, or what it does when it has no settings. A problem replaces it in warning tone, followed by its fix action, so every row keeps its height. Never write "Off" there; the switch says it.
- **Right:** change indicator and other quiet meta, icon actions (entity lists), lock, then the switch or "Always on", then a chevron when the row opens something.
- **Opening:** the whole row opens the item's detail view or dialog. Never add a per-row Configure or Edit button; the row is that button. Lists that open nothing keep the chevron slot empty so switches align.
- **Off:** the title and icon turn muted; the row stays readable and openable.

Row actions are `IconAction`s, which require a label and supply the tooltip and accessible name; keep them to actions other than opening (Test, Copy, Delete). Detail editing belongs in a dialog or detail view, not inline on the page. `SettingsListItem` remains for compact lists without identity (shortcuts, devices) and `SettingsDisclosureItem` for rows that expand in place.

## Entity cards

`EntityCard` is one card per entity: header (title, then badges, actions on the right), muted description, `EntityRow` changes divided by hairlines (muted label column, foreground value, icon actions), ghost `Button size="sm"` footer. Never put `well` behind editable rows: `well` is for recessed output.

## Provenance

Show provenance only when it differs. A setting that matches where it would otherwise come from shows nothing: no per-row source badges. One that differs (a user value that differs from the built-in default, a project value that differs from the user's, a conversation value that differs from its profile) gets `SettingsChangeIndicator` (a `bg-info` dot opening a popover, plus ↺ to reset) in the row's `badges` slot. Project pages summarise them in the page header ("N differ · Reset all"). Fixed values say who fixed them in a tooltip ("Locked by Planning"), not a disabled-looking input.

## Model choice

`ModelPicker` (`$lib/presentation/model-picker`) chooses ONE model together with its reasoning level, constrained to the levels that model supports; use it wherever a single model is chosen (settings, profile changes, tool config, composer). `ModelMultiSelect` chooses several (the model scope). They are not interchangeable.
