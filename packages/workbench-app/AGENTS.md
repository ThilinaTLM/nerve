# Web styling conventions (`packages/workbench-app`)

Inherits the root `AGENTS.md`. These rules govern all CSS/Tailwind in this package. `$lib/presentation` owns only cross-feature, stateless product UI and may depend only on presentation-local modules, `@nervekit/contracts`, and `@nervekit/ui-kit`; it must not import `$lib/app`, `$lib/application`, `$lib/features`, `$lib/domain`, or `$lib/platform`. Feature-specific Git and task presentation is owned by those feature slices. App state, protocol calls, polling, navigation, notifications, and clipboard effects stay outside the presentation directory.

Application `*Host` components are state/effect adapters around canonical feature `*View` or rendered `*Panel` components. `*Shell` is reserved for genuinely generic layout structure, and `*Pane` names a bounded subregion. Concrete feature registration and all cross-feature UI wiring belong in `$lib/app/composition`; `application/workspace` must use its registered readonly feature ports and named commands, never concrete feature workspace/state/adapters modules. Generic shell modules must consume public feature APIs or registered descriptors rather than private feature modules. A feature must never import another feature, including its public barrel. Do not recreate presentation markup in app or feature hosts.

## Two authoring tiers

- **Tier 1 (default): Tailwind token utilities in markup** for layout, spacing,
  typography, color, borders, radius, and shadow. Use theme tokens only
  (`text-muted-foreground`, `bg-card`, `border`, `rounded-md`, `text-xs`, …) plus
  `success`/`warning`/`info`. `destructive` is the readable text/tint red;
  opaque destructive fills use `destructive-solid` /
  `destructive-solid-foreground`. No hard-coded colors, font sizes, spacing, or
  one-off visual constants.
- **Surfaces are a five-step ladder**, deepest to highest: `well` (recessed
  output — terminal, logs, tool results, code blocks), `panel` (movable panel and
  shell chrome), `background` (workspace), `card` (raised content), `popover`
  (floating layers). `well` and `panel` are Nerve-specific and pair with the
  global `foreground` / `muted-foreground`; they deliberately have no foreground
  tokens of their own. Never reach for a surface to get a shade you like — pick
  the one that matches the role.
- **Themes own colour only.** Radius, elevation strength and shadow recipes
  are global; a theme block sets colours and nothing else, and the
  `card`/`popover`/`accent` foregrounds and the syntax diff/link roles are
  aliases of `foreground` and the status tokens. A component that looks right in
  one theme must look right in all of them.
- **No `dark:` utilities** (enforced by the style-policy check in `ui-kit` and
  `workbench-app`). Mode differences live in token values so previews and
  portalled content resolve them correctly. Use `bg-input-background` for
  field fills (transparent in light, a faint lift in dark) and one
  `aria-invalid` ring/border alpha that works in both modes.
- **Neutral hover is `hover:bg-hover`** (`--hover`, a translucent foreground
  overlay that works on any surface). Do not hand-roll opacity recipes such as
  `hover:bg-accent/50` or `hover:bg-muted/60`; keep opaque `accent`/`muted`
  fills for resting or pressed states, and semantic tints (`destructive/…`)
  where the meaning is not neutral.
- **Quiet fills** (`muted`, `accent`) are meant to sit beyond the surface
  ladder on the foreground side so they stay visible on every surface (dark:
  `popover < muted < accent`; light: `accent < muted < well`). Those values
  land with the Nerve refresh; until then do not rely on them being lighter or
  darker than a given surface in dark mode, and prefer `bg-hover` or
  `bg-selected` for interaction states.
- **Status colour has one vocabulary**: `neutral`, `accent`, `info`, `success`,
  `warning`, `destructive` (`StatusTone` in `@nervekit/ui-kit/display/status`).
  `StatusDot`, `Badge`, `ProgressRing`, `PanelRow`, `PanelBanner`, and the
  status helpers all speak it, so a tone computed once can drive any of them.
  Never invent a parallel set of tone names (`good`/`warn`/`danger`/`error`/
  `muted`/`default` are all spellings of tones that already exist). Domain
  vocabularies that are genuinely not status — diff line kinds, notification
  sounds — stay separate.
- **Settings has three heading levels.** Page title `text-lg` semibold
  foreground (`SettingsPageHeader`, `pb-2` of space below); section heading
  `text-sm` semibold foreground, optionally followed by ONE `text-xs` muted
  description line; entity title (`EntityCard`, e.g. a profile) `text-sm`
  medium foreground. Row titles are `text-sm` regular foreground and all
  supporting text is `text-xs` muted, so weight and colour carry the
  hierarchy. Headings are sentence case, never uppercase eyebrows. Longer
  detail goes in a `SettingsInfoHint` tooltip, not a paragraph. Use
  `SettingsSection` for every group of rows (the muted `SettingsGroup` heading
  is legacy); an entity such as a profile gets an `EntityCard`, never a muted
  group heading above it. `settings-typography.test.ts` enforces this.
- **Settings navigation is grouped.** `SettingsNav` takes `SettingsNavGroup[]`
  (optional quiet caption `text-xs font-medium text-muted-foreground`, no hover
  or icon; items `text-sm` with a lucide icon, muted until active) and a
  `SettingsScopeHeader` (User settings, or project name and path) separated by a
  rule. The active item is `bg-selected font-medium`, a persistent state
  that should not depend on the quiet fills. Never reuse a group title as
  an item name.
- **Settings sections are surfaces.** `SettingsSection` draws its body as a
  bordered `card` (`rounded-lg`) with the heading outside, above it; the
  surface, not a rule, separates sections. Pass `divided` for rows: the body
  becomes `divide-y divide-border` with no padding and `SettingsRow` pads itself
  (`min-h-12 px-3 py-2`) with a fixed 14rem control column, so controls align
  across rows and sections (rows stack on narrow panes). Put controls directly
  in the row's `control` snippet: Select, Input with suffix, Switch; do not
  pair a value with a "Change" button. Nested cards read the
  `data-settings-surface` contract and sit flush (`SettingsList`,
  `SettingsEmptyState variant="card"`, the model catalog). Group related
  controls into few sections.
- **Show provenance only when it differs.** A setting that matches where it
  would otherwise come from shows nothing: no per-row source badges. One that
  differs (a user value that differs from the built-in default, a project value
  that differs from the user's, a conversation value that differs from its
  profile) gets `SettingsChangeIndicator` (a `bg-info` dot opening a popover,
  plus ↺ to reset) in the row's `badges` slot. Project pages summarise them in
  the page header ("N differ · Reset all"). Fixed values say who
  fixed them in a tooltip ("Locked by Planning"), not a disabled-looking input.
- **Entity cards.** `EntityCard` is one card per entity: header (title, then
  badges, actions on the right), muted description, `EntityRow` changes divided
  by hairlines (muted label column, foreground value, icon actions), ghost
  `Button size="sm"` footer. Never put `well` behind editable rows: `well` is
  for recessed output.
- **Model choice has two components.** `ModelPicker`
  (`$lib/presentation/model-picker`) chooses ONE model together with its
  reasoning level, constrained to the levels that model supports; use it
  wherever a single model is chosen (settings, profile changes, tool config,
  composer). `ModelMultiSelect` chooses several (the model scope). They are
  not interchangeable.
- **Monospace is only for code, logs and paths.** Tool, skill and setting
  names, counts and other metadata use the sans face.
- **Settings uses one set of list patterns.** Entity lists are a single
  `SettingsList` (bordered `card` surface, hairline-divided rows) holding
  `SettingsListItem` rows, never a stack of individually tinted cards. A row's
  hierarchy is fixed and all of it sits on the left: `title` (primary),
  `detail` (inline secondary), `status` (badges), `description` (its own line).
  The right column holds icon actions and nothing else, always visible. Row
  actions are `IconAction`s, which require a label and supply the tooltip and
  accessible name; detail editing belongs in a dialog, not inline on the page.
- **Action labels never end in an ellipsis.** Menu items, buttons, and titles
  read `Edit`, `Review`, `Delete profile` — not `Edit…`. Reserve `…` for
  in-progress status text such as `Saving…` and for placeholders.
- **File-type icons are deliberately outside the token system.** The Material
  Icon Theme sprite in `$lib/features/filesystem/views` keeps its own multi-hued
  palette so file types stay recognizable; do not recolour it with theme tokens.
- **Controls share a compact desktop scale of two heights** — the theme tokens
  `--spacing-control` (28px) and `--spacing-control-sm` (24px), raised under
  `@media (pointer: coarse)` (36 / 32px), so touch sizing needs no per-component
  rules. Button is exactly `default` / `sm` / `icon` / `icon-sm`; ToggleGroup is
  `chip` or `outline` × `default` / `sm`; IconAction is one size (24px). Fields
  (Input, Textarea, Select, SearchInput, SelectField) are one 28px height with no
  size prop; Switch, Checkbox, and Radio have one size; Tabs are underline-only.
  Pick from these; never add a size level, and never patch a control's height or
  padding through `class`. If a size feels wrong, fix the core component in
  `ui-kit` (`control-scale.test.ts` enforces this).
- **Tier 2 (escape hatch): a scoped `<style>` block in the component** — allowed
  ONLY for things utilities cannot express (see the list below). Use theme tokens
  inside it too.

A component should not carry a `<style>` block of plain layout/typography CSS
that maps cleanly to utilities. Convert it to Tier 1.

### Allowed escape-hatch list (Tier 2)

1. `@keyframes` / `animation` — but the keyframe itself must live in
   `packages/ui-kit/src/styles/animation.css` (never define `@keyframes` in a
   component).
2. `::-webkit-scrollbar*` / `scrollbar-*` theming.
3. Styling **rendered HTML** you don't author per-element: markdown
   (`Markdown.svelte`), shiki syntax highlighting (`var(--shiki-light/dark)`),
   code blocks, file/line viewers.
4. Pseudo-elements / generated content: `::before`/`::after`, CSS counters
   (line numbers), accent bars.
5. Styling **bits-ui / shadcn primitive internals** that render their own DOM and
   only accept a `class`/`triggerClass`/`viewportClass` prop on a wrapper
   (Dialog overlay/content, Popover content/arrow, Switch root/thumb via
   `[data-state]`, ContextMenu/Tooltip portals).
6. `[data-state]` / `[data-tone]` / `[data-*]` styling that reassigns custom
   properties.
7. Platform CSS (`-webkit-app-region: drag/no-drag`).
8. Two-color `color-mix()` **blends** (e.g.
   `color-mix(in oklab, var(--primary) 40%, var(--border))`). A mix with
   `transparent` is just opacity — in markup always prefer the Tailwind opacity
   modifier (`bg-primary/40`, `border-border/60`) instead.
9. Virtualizer / measured-layout internals: the viewport, spacer, and
   absolutely positioned rows generated by
   `packages/ui-kit/src/lib/components/composites/virtual-list/virtual-scroller.svelte`.

`ExploreToolView.svelte` and `SubagentTranscriptDialog.svelte` (both under
`src/lib/presentation/tools/components/tool-call/`) are the worked examples of a
compliant component: no `<style>` block at all, token utilities only, semantic
status colors returned from a TypeScript helper (`statusTextClass`), and
primitive layout passed to `VirtualScroller` via `viewportClass` instead of
`:global()`.

## Transcript notices

System events in a conversation timeline (background tasks, run retries and
failures, compaction, branch summaries, subagent updates, and anything added
later) are **notices**. A notice is a
process the reader cares about, exactly like a tool call, so it renders through
the same card: `$lib/presentation/cards` owns `CardShell`, `CardHeader`,
`CardFooter`, `StatusGlyph`, `MetaChip` and `LifecycleFrame`, and both tool
calls and notices compose them. A pure mapper in
`$lib/presentation/transcript/notice` turns the payload into a
`TranscriptNoticeModel` (`kind`, `tone`, `glyph`, `busy`, `badge`, `arg`,
`statusLabel`, `summary`, `error`, `chips`, `action`); `NoticeCard.svelte` binds
it to `CardShell`. Adding a notice kind is a mapper, a thin card and one
`TranscriptRow` branch — never a new look.

- **Same anatomy as a tool call.** No border box, no tinted surface: 14px
  tone-coloured glyph, mono event name in the tool-name slot, muted argument,
  recessed `well` body, chips plus a right-aligned footer pill.
- **The glyph is the only difference.** Tool calls own the circled
  check/x/alert family; notices own the bell family (`bell` for terminal
  events, `bell-ring` for ready/recovered, `bell-dot` when something needs
  attention) plus `layers` for compaction, `git-branch` for branch summaries,
  `users` for subagent updates, `info` for generic system events, and a spinner
  while in flight.
- **Snake-case mono event name, not a sentence.** `task_completed`,
  `run_retrying`, `compacted` — they sit in the same column as tool names. The
  muted argument carries the most useful compact input or context: a one-line
  task command, compaction reason, or failure summary. Task notices follow bash
  projection rules: multiline commands move to a command body and selected
  recent/relevant output renders in a separate recessed output body.
- **Chips, not badges.** Extra facts (`exit 0`, `signal SIGTERM`, `retry 2/5`,
  token counts) use the shared `MetaChip` family. A chip must add information:
  never restate the event name.
- **Actions stay in the footer.** Passive actions such as `Open task` and
  `View details` use the shared `cardActions` pills. A recovery-critical
  `Continue` action uses the shared primary footer-action slot and official
  `Button`; it does not move into the header or body. Anything richer belongs
  in a panel or dialog.
- **A card's glyph must tell the truth.** A bash call promoted into a
  background task is `completed` for the agent but unfinished for the reader,
  so it drops the green check for the warning-toned `pending` clock, keeps its
  result body, and gains an `Open task` pill. Running tool calls lead their
  footer with a live elapsed chip once they pass two seconds.

## Panel views

Dock panel content (Conversations, Git, Context, Notes, Tasks) must be built from
the `$lib/presentation/panels` primitives — `PanelView`, `PanelHeader`,
`PanelToolbar`, `PanelToolbarButton`, `PanelSectionHeader`, `PanelList`,
`PanelRow`, `PanelTree`, `PanelBanner`, `PanelEmpty`.

- A panel view's root is `PanelView`. It owns the height, the sticky toolbar,
  and the banner slot; its content owns the one scroll region (a `ScrollArea`,
  `VirtualList`, or `PanelTree virtualized`). Views must not manage their own
  `h-full`/`overflow`/padding frame or add a second scroll container.
- Views are movable between the left, right, and bottom docks, so a view may not
  assume its width, orientation, or which dock hosts it. Use the container width
  (not the dock id) when adapting layout.
- Every panel starts with one static `PanelHeader` (title, optional count,
  trailing icon actions) rendered in `PanelView`'s pinned `banner` slot.
- Panels stay simple and consistent: no sub-tab toolbars, no panel search
  inputs, and no collapsible sections. Group content with static
  `PanelSectionHeader` headings that are always expanded.
- Sections are flat: no bordered cards, no radius, no nested panels.

## Global CSS lives only in `src/styles/`

Shared theme tokens, base resets, animations, and cross-app component partials
live in `@nervekit/ui-kit` (`packages/ui-kit/src/styles/`, entry `app.css`).
This package only layers app-specific globals on top:

```
src/styles/
  app.css          # ENTRY (imported once by main.ts). Imports
                   #   @nervekit/ui-kit/styles/app.css (theme/base/animation/
                   #   shared partials), then ./components.css, then Tailwind
                   #   the local workbench app source tree.
  components.css   # aggregates app-specific components/* partials
  components/      # workbench-app-only cross-component contracts
                   #   (composer.css, panel.css, shell.css)
```

- Design tokens (`:root`/`.dark` + `@theme inline`; derived tokens such as
  `--hover`, `--input-background` and `--chrome-track` are declared on
  `:root, [data-theme-preview]` so previews re-resolve them) live ONLY in
  `packages/ui-kit/src/styles/theme.css`; never redefine them here.
- Keyframes belong in `packages/ui-kit/src/styles/animation.css` (never in a
  component).
- **Never `import "./x.css"` from a component.** The only stylesheet import in
  the app is `src/styles/app.css` in `main.ts`.
- A class may be global only if it is **(a)** consumed by two or more components
  **AND (b)** a deliberate cross-component contract, not an incidental name
  match. Everything else belongs to the component that renders it. The partial
  allowlist in `scripts/checks/style-policy.mjs` is authoritative: adding a partial
  requires editing the guard, which forces the "is this really shared?"
  conversation into code review.
- A class name defined in another component's scoped `<style>` does **nothing**
  when copied into a different component — Svelte scoping only matches elements
  authored in the component that owns the rule. The only ways to share styling
  are a utility string, a `class`/`triggerClass`/`viewportClass` prop on the
  child, or an allowlisted global partial. `check:boundaries` fails on inert
  copied class names.
- `composer.css` and ui-kit's `popover.css` are layered (`@layer components`) so
  a consumer's own utilities always win. `dialog.css` and `terminal-output.css`
  are intentionally **unlayered** so they can override shadcn utility classes via
  `[data-slot]` selectors; that precedence is load-bearing for every dialog, so
  do not layer them. Prefer layering for new partials.
- Removed partials that must not come back: ui-kit's `app-helpers.css` and
  `tooltips.css`, and workbench's `settings.css`, `directory-picker.css`,
  `editor-tabs.css`, `history-graph.css`, and `popovers.css`. Their rules now
  live in the components that render them.

## `:global()` policy

- Avoid `:global()`. Prefer passing Tailwind classes through the child's
  `class` / `triggerClass` / `viewportClass` props (shadcn-svelte merges via
  `cn()`): `<StatusDot class="mr-1.5" />`, `<Icon class="size-4 text-muted-foreground" />`,
  `<ScrollArea class="…" viewportClass="…" />`.
- `:global()` is acceptable only for escape-hatch reasons 3, 5, and 9 above
  (rendered HTML, bits-ui primitive internals reachable only via a wrapper
  class, virtualizer internals). Keep it scoped under a local class
  (`.foo :global(svg)`); `check:boundaries` fails on a bare app-wide
  `:global(.thing)`.
- The one sanctioned bare `:global()` is a portalled dialog shell, which has no
  ancestor inside the component. Anchor it on the shell's own class so it stays
  ahead of the shared defaults:
  `:global(.dialog-content.project-picker-dialog) { … }`.
- When a wrapper component sets **default** styles on a bits-ui/shadcn primitive
  it owns, put them in a layered partial (`@layer components`, see
  `packages/ui-kit/src/styles/components/popover.css`) rather than in the
  component's `<style>`. Layered defaults always lose to a consumer's Tailwind
  utilities, which is what `triggerClass`/`class` props are for.

## Startup loading policy

- Composer-critical startup resources are settings, models, auth metadata, workspace hydration, and restoration of the active conversation.
- New mount or project-restoration effects must not initiate network or filesystem work before `workbenchStartupState.progressiveActive` unless the work is explicitly added to the orchestrator's reviewed critical lane.
- Restored inactive tabs are metadata-only during startup. A restored active conversation is critical; non-conversation active-tab loaders are progressive.
- Background features should also honor panel visibility or explicit demand wherever possible.
- Startup ordering tests use deferred dependencies and phase events, never timing thresholds.

## Misc

- Create planning wireframes as local, mock-only Svelte components in the gitignored `src/lib/app/design-lab/wireframes/` directory using shared UI components and styles; kebab-case filenames are automatically discoverable at `/dev/wireframes/<name>` during development, so prefer this over standalone HTML files. This temporary directory is excluded from formatting, linting, type checking, test discovery and coverage; tracked design-lab infrastructure remains validated. Do not statically import local wireframes into product code (TypeScript follows imports even from excluded directories).

- Icons: `@lucide/svelte`, sized/colored via `class` on the icon. Loading
  spinners use the shared `Spinner` component
  (`@nervekit/ui-kit/components/ui/spinner`), not ad-hoc spinning loader icons.
- Monospace (`font-mono`) is for code, logs, and paths only.
- Validate with `pnpm check`; verify visuals (light + dark) with the
  `agent-browser` skill.
- Guardrails (should stay clean): no `import "*.css"` outside `styles/app.css`;
  no `@keyframes` in `*.svelte`; `:global(` only in the documented cases.
