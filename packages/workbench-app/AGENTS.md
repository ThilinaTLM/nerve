# Web styling conventions (`packages/workbench-app`)

Inherits the root `AGENTS.md`. These rules govern all CSS/Tailwind in this package. Git and task utility wrappers must remain thin adapters around the canonical feature hosts in `@nervekit/workbench-ui`; app state, protocol calls, polling, navigation, notifications, and clipboard effects stay here.

Application `*Shell` components are state/effect adapters around canonical `*Pane` presentation components from `@nervekit/workbench-ui`. Do not recreate shared pane markup in this package.

## Two authoring tiers

- **Tier 1 (default): Tailwind token utilities in markup** for layout, spacing,
  typography, color, borders, radius, and shadow. Use theme tokens only
  (`text-muted-foreground`, `bg-card`, `border`, `rounded-md`, `text-xs`, …) plus
  `success`/`warning`/`info`. No hard-coded colors, font sizes, spacing, or
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

## Global CSS lives only in `src/styles/`

Shared theme tokens, base resets, animations, and cross-app component partials
live in `@nervekit/ui-kit` (`packages/ui-kit/src/styles/`, entry `app.css`).
This package only layers app-specific globals on top:

```
src/styles/
  app.css          # ENTRY (imported once by main.ts). Imports
                   #   @nervekit/ui-kit/styles/app.css (theme/base/animation/
                   #   shared partials), then ./components.css, then Tailwind
                   #   @source hints for workbench-ui and this app.
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

## Misc

- Icons: `@lucide/svelte`, sized/colored via `class` on the icon. Loading
  spinners use the shared `Spinner` component
  (`@nervekit/ui-kit/components/ui/spinner`), not ad-hoc spinning loader icons.
- Monospace (`font-mono`) is for code, logs, and paths only.
- Validate with `pnpm check`; verify visuals (light + dark) with the
  `agent-browser` skill.
- Guardrails (should stay clean): no `import "*.css"` outside `styles/app.css`;
  no `@keyframes` in `*.svelte`; `:global(` only in the documented cases.
