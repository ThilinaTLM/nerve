# Styling reference

Full styling model for `packages/ui-kit` and `packages/workbench-app`. The enforceable summary lives in [`packages/workbench-app/AGENTS.md`](../../packages/workbench-app/AGENTS.md); this page holds the rationale and details. Many rules are enforced by `pnpm check` (`scripts/checks/check-package-boundaries.ts`, which runs `ui-style-checks.ts` with the lists in `style-policy.ts`) and the ui-kit tests named below.

## Tokens and colour

- Use theme tokens only (`text-muted-foreground`, `bg-card`, `border`, `rounded-md`, `text-ui`, …) plus `success`/`warning`/`info`. `destructive` is the readable text/tint red; opaque destructive fills use `destructive-solid` / `destructive-solid-foreground`. No hard-coded colors, font sizes, spacing, or one-off visual constants.
- **Colours are tokens or derived recipes, never local alphas.** App code (`workbench-app`) may not use opacity modifiers (`bg-destructive/10`, `border-border/60`) or `color-mix()`; the style policy rejects them. `theme.css` derives the recipes once: `bg-<tone>-subtle` (8% tint for callouts, chips and soft fills), `border-<tone>-strong` / `ring-<tone>-strong` (40% for tinted edges and highlight marks), `border-border-subtle` (inner hairlines), `ring-focus` / `outline-focus` (focus halo), `bg-scrim` (behind overlays) and `--text-selection` (selected text in editors); `<tone>` is `primary`, `info`, `success`, `warning` or `destructive`. The style policy also scans app TypeScript (editor themes) for `color-mix()`. Only ui-kit primitives compose their own alphas, and theme previews (`ThemePreviewPicker`, `SettingsPreviewCards`) are exempt.
- **No `dark:` utilities** (style policy, `ui-kit` and `workbench-app`). Mode differences live in token values so previews and portalled content resolve them correctly. Use `bg-input-background` for field fills (transparent in light, a faint lift in dark) and one `aria-invalid` ring/border alpha that works in both modes.
- **File-type icons are deliberately outside the token system.** The Material Icon Theme sprite in `$lib/features/filesystem/views` keeps its own multi-hued palette so file types stay recognizable; do not recolour it with theme tokens.

## Surfaces and elevation

- **Surfaces are a four-step ladder plus an inset**, deepest to highest: `panel` (movable panel and shell chrome), `background` (workspace), `card` (raised content), `popover` (floating layers). `well` (recessed output — terminal, logs, tool results, code blocks) is one step below whichever surface holds it: `bg-*` utilities and the dialog/popover/shell surfaces point `--well` at their `--well-on-*` variant, so a new element that paints a surface with a raw `var(--…)` must do the same. `well` and `panel` pair with the global `foreground` / `muted-foreground`; they deliberately have no foreground tokens of their own. Never reach for a surface to get a shade you like — pick the one that matches the role.
- **The quiet fill** (`muted`) sits beyond the surface ladder on the foreground side so it stays visible on every surface (dark: `popover < muted`; light: `muted < well`). Every theme follows this, and `theme-contrast.test.ts` enforces it. For recessed tracks and output use `well`; for interaction states prefer `bg-hover` or `bg-selected`.
- **Two elevations:** controls are flat (border only); `shadow-sm` for raised cards, `shadow-overlay` for anything floating (popovers, menus, dialogs, sheets, tooltips, floating toolbars).

## Themes

The theme is one flat choice and each theme is either light or dark: `nerve-light`, `nerve-dark`, `melange-light`, `melange-dark`, `graphite`, `indigo` (family order, `colorThemeSchema`), default `nerve-dark`, with `colorThemeKind` in `contracts/settings` as the source of truth.

- The app does not follow the OS colour scheme: the client stores one theme (`nerve-theme`, `platform/appearance`), and the theme's kind sets `.dark` and `color-scheme`. Settings offers a single Theme picker of equal-width preview cards.
- The pre-paint bootstrap in `index.html` mirrors `theme-preference.ts`, including the one-time migration from the old light/dark/colour-mode keys.
- A theme owns colour only: radius, elevation strength and shadow recipes are global. A theme has exactly one block (`:root[data-theme="<id>"], [data-theme-preview="<id>"]`) in `theme.css` (`nerve-light` and `nerve-dark` also match the unthemed root as fallbacks), and the `card`/`popover` foregrounds, `ring` (= `primary`), the derived recipes and the syntax diff/link roles are aliases of `foreground` and the status tokens.
- Mode-dependent globals (shadow colour, input fill, overlay edge) key on `.dark` / `[data-color-mode="dark"]`, so a preview root sets `data-color-mode` from the theme's kind.
- Derived tokens such as `--hover`, `--input-background` and `--chrome-track` are declared on `:root, [data-theme-preview]` so previews re-resolve them.

## Typography

**Type scale has four roles, 13–16px** (defined in `ui-kit` `theme.css`; Tailwind's default sizes are cleared and the style-policy check rejects them and arbitrary `text-[…]` sizes):

- `text-caption` 13px for glanceable extras (timestamps, counts, chips, kbd, section captions, settings supporting text; never errors or instructions).
- `text-ui` 13px for everything interactive or list-like.
- `text-body` 15px for prose the user reads (transcript, markdown, PR descriptions).
- `text-title` 16px for page, dialog and card titles and headline numbers, always `font-medium` (regular for a welcome line).

The only exception is the phone composer, which stays at 16px so iOS does not zoom on focus.

**Monospace is only for code, logs and paths.** Tool, skill and setting names, counts and other metadata use the sans face. The exception is tool call card headers (`CardHeader` with `mono`: tool name and argument summary), which are monospace like the card body's code, output, diffs and file lists; notice cards keep a sans header.

## Interaction and state

- **Neutral hover is `hover:bg-hover`** (`--hover`, a translucent foreground overlay that works on any surface), including menu highlights. Keep the opaque `muted` fill for resting or pressed states.
- **Selection is `bg-selected` plus a brand marker.** `--selected` is a brand tint (12% `primary`) in every theme, light enough that `text-muted-foreground` keeps 4.5:1 on it (`theme-contrast.test.ts`), so secondary text stays grey and is never re-coloured by hand. Selection never changes the weight: a selected row only takes the tint and, where it has one, renders its leading icon or idle dot in `text-primary`; status-coloured glyphs keep their tone. Never add a stronger fill, border, or bar to signal selection.
- **Buttons never underline.** Buttons, clickable badges and other button-like elements answer hover with a fill (`hover:bg-hover`, a stronger tone tint on Badge) or a colour change (`hover:text-foreground`). Underlines are for prose links only; the style-policy check rejects `hover:underline` outside `PROSE_LINK_UNDERLINE_ALLOWLIST`.
- **Action labels never end in an ellipsis.** Menu items, buttons, and titles read `Edit`, `Review`, `Delete profile` — not `Edit…`. Reserve `…` for in-progress status text such as `Saving…` and for placeholders.

## Status tone

**Status colour has one vocabulary**: `neutral`, `brand` (primary, for what the app highlights: Default markers, meters), `info`, `success`, `warning`, `destructive` (`StatusTone` in `@nervekit/ui-kit/display/status`). `StatusDot`, `Badge`, `ProgressRing`, `PanelRow`, `Callout layout="strip"`, and the status helpers all speak it, so a tone computed once can drive any of them.

Never invent a parallel set of tone names (`good`/`warn`/`danger`/`error`/`muted`/`default` are all spellings of tones that already exist). Domain vocabularies that are genuinely not status — diff line kinds, notification sounds — stay separate. Text strength (foreground vs `muted-foreground`) is not a tone; set it with text colour, never by picking a tone.

**Group captions use `GroupLabel`** (ui-kit composite): the quiet sentence-case caption above a group of rows (Pinned, Today, Connections), with optional icon and count. Never an uppercase eyebrow.

## Controls

Controls share a compact desktop scale of two heights — the theme tokens `--spacing-control` (28px) and `--spacing-control-sm` (24px), raised under `@media (pointer: coarse)` (36 / 32px), so touch sizing needs no per-component rules.

- Button is exactly `default` / `sm` / `icon` / `icon-sm`; ToggleGroup is `chip` or `outline` × `default` / `sm`; IconAction is one size (24px).
- Fields (Input, Select, SearchInput, SelectField) are one 28px height and Textarea is at least that tall; none takes a size prop. Switch, Checkbox, and Radio have one size; Tabs have one style (a `primary` indicator bar on the active trigger).
- Pick from these; never add a size level, and never patch a control's height or padding through `class`. If a size feels wrong, fix the core component in `ui-kit` (`control-scale.test.ts` enforces this).
- Icons: `@lucide/svelte`, sized/colored via `class` on the icon. Loading spinners use the shared `Spinner` component (`@nervekit/ui-kit/components/ui/spinner`), not ad-hoc spinning loader icons.

## Scoped `<style>` blocks (Tier 2)

Tier 1 (the default) is Tailwind token utilities in markup. A scoped `<style>` block is allowed ONLY for things utilities cannot express. Use theme tokens inside it too. A component should not carry a `<style>` block of plain layout/typography CSS that maps cleanly to utilities.

Allowed escape hatches:

1. `@keyframes` / `animation` — but the keyframe itself must live in `packages/ui-kit/src/styles/animation.css` (never define `@keyframes` in a component).
2. `::-webkit-scrollbar*` / `scrollbar-*` theming.
3. Styling **rendered HTML** you don't author per-element: markdown (`Markdown.svelte`), shiki syntax highlighting (`var(--shiki-light/dark)`), code blocks, file/line viewers.
4. Pseudo-elements / generated content: `::before`/`::after`, CSS counters (line numbers), accent bars.
5. Styling **bits-ui / shadcn primitive internals** that render their own DOM and only accept a `class`/`triggerClass`/`viewportClass` prop on a wrapper (Dialog overlay/content, Popover content/arrow, Switch root/thumb via `[data-state]`, ContextMenu/Tooltip portals).
6. `[data-state]` / `[data-tone]` / `[data-*]` styling that reassigns custom properties.
7. Platform CSS (`-webkit-app-region: drag/no-drag`).
8. Derived colour recipes in scoped CSS: use the token variables (`var(--warning-subtle)`, `var(--border-subtle)`, `var(--scrim)`); new recipes are added to `theme.css`, not mixed locally.
9. Virtualizer / measured-layout internals: the viewport, spacer, and absolutely positioned rows generated by `packages/ui-kit/src/lib/components/composites/virtual-list/virtual-scroller.svelte`.

A compliant component has no `<style>` block at all, uses token utilities only, returns semantic status colours from a TypeScript helper, and passes primitive layout through props (for example `viewportClass` on `VirtualScroller`) instead of `:global()`.

## `:global()` policy

- Avoid `:global()`. Prefer passing Tailwind classes through the child's `class` / `triggerClass` / `viewportClass` props (shadcn-svelte merges via `cn()`): `<StatusDot class="mr-1.5" />`, `<Icon class="size-4 text-muted-foreground" />`, `<ScrollArea class="…" viewportClass="…" />`.
- `:global()` is acceptable only for escape-hatch reasons 3, 5, and 9 above. Keep it scoped under a local class (`.foo :global(svg)`); `pnpm check` fails on a bare app-wide `:global(.thing)`.
- The sanctioned bare `:global()` roots (`GLOBAL_SELECTOR_ALLOWLIST`) are the theme root `.dark` and a portalled dialog shell, which has no ancestor inside the component. Anchor a dialog on the shell's own class so it stays ahead of the shared defaults: `:global(.dialog-content.project-picker-dialog) { … }`.
- When a wrapper component sets **default** styles on a bits-ui/shadcn primitive it owns, put them in a layered partial (`@layer components`, see `packages/ui-kit/src/styles/components/popover.css`) rather than in the component's `<style>`. Layered defaults always lose to a consumer's Tailwind utilities, which is what `triggerClass`/`class` props are for.

## Global CSS

Shared theme tokens, base resets, animations, and cross-app component partials live in `@nervekit/ui-kit` (`packages/ui-kit/src/styles/`, entry `app.css`). `workbench-app` only layers app-specific globals on top:

```
packages/workbench-app/src/styles/
  app.css          # ENTRY (imported once by main.ts). Imports
                   #   @nervekit/ui-kit/styles/app.css (theme/base/animation/
                   #   shared partials), then ./components.css, then Tailwind
                   #   (sourcing the local app tree).
  components.css   # aggregates app-specific components/* partials
  components/      # workbench-app-only cross-component contracts
                   #   (composer.css, panel.css, shell.css)
```

- Design tokens (`:root`/`.dark` + `@theme inline`) live ONLY in `packages/ui-kit/src/styles/theme.css`; never redefine them elsewhere. Keyframes belong in `packages/ui-kit/src/styles/animation.css`, including those used by app partials and CodeMirror themes; the style policy rejects `@keyframes` anywhere in `workbench-app/src`.
- **Never `import "./x.css"` from a component.** The only stylesheet import in the app is `src/styles/app.css` in `main.ts`.
- A class may be global only if it is **(a)** consumed by two or more components **AND (b)** a deliberate cross-component contract, not an incidental name match. Everything else belongs to the component that renders it. The partial allowlist in `scripts/checks/style-policy.ts` is authoritative: adding a partial requires editing the guard, which forces the "is this really shared?" conversation into code review.
- A class name defined in another component's scoped `<style>` does **nothing** when copied into a different component — Svelte scoping only matches elements authored in the component that owns the rule. The only ways to share styling are a utility string, a `class`/`triggerClass`/`viewportClass` prop on the child, or an allowlisted global partial. `pnpm check` fails on inert copied class names.
- `composer.css` and ui-kit's `popover.css` are layered (`@layer components`) so a consumer's own utilities always win. `dialog.css` and `terminal-output.css` are intentionally **unlayered** so they override shadcn utility classes; that precedence is load-bearing for every dialog, so do not layer them. Prefer layering for new partials.
