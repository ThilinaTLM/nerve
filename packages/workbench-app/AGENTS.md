# Web styling conventions (`packages/workbench-app`)

Inherits the root `AGENTS.md`. These rules govern all CSS/Tailwind in this package. `$lib/presentation` owns product presentation and may depend only on presentation-local modules, `@nervekit/contracts`, and `@nervekit/ui-kit`; it must not import `$lib/app`, `$lib/features`, or `$lib/core`. Git and task utility wrappers remain thin adapters around canonical presentation hosts; app state, protocol calls, polling, navigation, notifications, and clipboard effects stay outside the presentation directory.

Application `*Shell` components are state/effect adapters around canonical `*Pane` components from `$lib/presentation`. Do not recreate presentation markup in app or feature adapters.

## Two authoring tiers

- **Tier 1 (default): Tailwind token utilities in markup** for layout, spacing,
  typography, color, borders, radius, and shadow. Use theme tokens only
  (`text-muted-foreground`, `bg-card`, `border`, `rounded-md`, `text-xs`, …) plus
  `success`/`warning`/`info`. `destructive` is the readable text/tint red;
  opaque destructive fills use `destructive-solid` /
  `destructive-solid-foreground`. No hard-coded colors, font sizes, spacing, or
  one-off visual constants.
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
   `transparent` is just opacity — prefer the Tailwind opacity modifier
   (`bg-primary/40`, `border-border/60`) instead.

## Panel views

Dock panel content (Conversations, Git, Context, Notes, Tasks) must be built from
the `$lib/presentation/panel` primitives — `PanelView`, `PanelHeader`,
`PanelToolbar`, `PanelToolbarButton`, `PanelSectionHeader`, `PanelList`,
`PanelRow`, `PanelTree`, `PanelPropertyRow`, `PanelBanner`, `PanelEmpty`.

- A panel view's root is `PanelView`. It owns the height, the single scroll
  region, the sticky toolbar, and the banner slot; views must not manage their
  own `h-full`/`overflow`/padding frame or add a second scroll container.
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
  components/      # workbench-app-only cross-component classes
                   #   (settings, directory-picker)
```

- Design tokens (`:root`/`.dark` + `@theme inline`) live ONLY in
  `packages/ui-kit/src/styles/theme.css`; never redefine them here.
- Keyframes belong in `packages/ui-kit/src/styles/animation.css` (never in a
  component).
- **Never `import "./x.css"` from a component.** The only stylesheet import in
  the app is `src/styles/app.css` in `main.ts`.
- A class used across **multiple components** (e.g. passed to a child via
  `triggerClass`, or shared by sibling components) belongs in a
  `src/styles/components/*` partial (or ui-kit's if shared across apps), not in
  a component `<style>`.
- ui-kit's `app-helpers.css` is layered (`@layer components`) so utilities win.
  The other partials are intentionally **unlayered** so they can override shadcn
  utility classes via `[data-slot]` selectors — keep new shared partials
  unlayered too.

## `:global()` policy

- Avoid `:global()`. Prefer passing Tailwind classes through the child's
  `class` / `triggerClass` / `viewportClass` props (shadcn-svelte merges via
  `cn()`): `<StatusDot class="mr-1.5" />`, `<Icon class="size-4 text-muted-foreground" />`,
  `<ScrollArea class="…" viewportClass="…" />`.
- `:global()` is acceptable only for escape-hatch reasons 3 and 5 above
  (rendered HTML, bits-ui primitive internals reachable only via a wrapper
  class). Keep it scoped under a local class (`.foo :global(svg)`), never a bare
  app-wide `:global(.thing)` — cross-component classes go to `src/styles/components/`.
- When a wrapper component sets **default** styles on a bits-ui/shadcn primitive
  it owns (e.g. `popover-panel`'s `.popover-trigger`), wrap the selector in
  `:where()` so the defaults stay at zero specificity and any consumer
  `triggerClass`/`class` (e.g. `.composer-tab`) always wins regardless of CSS
  bundle order: `:global(:where(.popover-trigger)) { … }`.

## Startup loading policy

- Composer-critical startup resources are settings, models, auth metadata, workspace hydration, and restoration of the active conversation.
- New mount or project-restoration effects must not initiate network or filesystem work before `workbenchStartupState.progressiveActive` unless the work is explicitly added to the orchestrator's reviewed critical lane.
- Restored inactive tabs are metadata-only during startup. A restored active conversation is critical; non-conversation active-tab loaders are progressive.
- Background features should also honor panel visibility or explicit demand wherever possible.
- Startup ordering tests use deferred dependencies and phase events, never timing thresholds.

## Misc

- Icons: `@lucide/svelte`, sized/colored via `class` on the icon. Loading
  spinners use the shared `Spinner` component
  (`@nervekit/ui-kit/components/ui/spinner`), not ad-hoc spinning loader icons.
- Monospace (`font-mono`) is for code, logs, and paths only.
- Validate with `pnpm check`; verify visuals (light + dark) with the
  `agent-browser` skill.
- Guardrails (should stay clean): no `import "*.css"` outside `styles/app.css`;
  no `@keyframes` in `*.svelte`; `:global(` only in the documented cases.
