# Nerve Design System

Nerve's frontend (`packages/web`) uses the **official
[shadcn-svelte](https://www.shadcn-svelte.com)** component library (Svelte 5 + Tailwind v4,
built on [`bits-ui`](https://bits-ui.com)). We do **not** maintain a bespoke primitive layer
— components are generated with the shadcn-svelte CLI and owned in-repo.

The visual theme is **"Jamaica"** from [tweakcn](https://tweakcn.com) — a green/gold palette
with generous radius (`1.25rem`), **Outfit** for UI text and **Iosevka** for code.

Implementation reference:

- Theme + tokens: `packages/web/src/app.css` (`:root` light, `.dark` dark, `@theme inline`).
- Components: `packages/web/src/lib/components/ui/*` (shadcn-svelte, generated via the CLI).
- Project wrappers: a few thin convenience components over the shadcn primitives (see below).
- Utilities: `packages/web/src/lib/utils.ts` (`cn`, `WithElementRef`, …).
- Dark mode: [`mode-watcher`](https://mode-watcher.svecosystem.com) toggles the `.dark` class.
- Icons: `@lucide/svelte` (bundled). Fonts: bundled via `@fontsource` (`outfit`,
  `iosevka`).
- Config: `packages/web/components.json` (`style: vega`, aliases under `$lib`).

## Principles

- **Stay official.** Prefer stock shadcn-svelte components and the standard token set. Add
  new components with `pnpm dlx shadcn-svelte@latest add <name>`.
- **Token-driven color.** All color comes from the shadcn semantic tokens
  (`bg-primary`, `text-muted-foreground`, `border-border`, `bg-sidebar`, …). Never hard-code
  colors. This keeps whole-theme swaps trivial.
- **Plain & swappable.** The token vocabulary is exactly the official shadcn set plus three
  semantic status additions (`success`, `warning`, `info`). No project/domain tokens — a
  one-off value (e.g. a 48px header) is written inline in its single component, not tokenized.
- **Sans for the tool, mono for the work.** Outfit for UI/chrome; Iosevka for code,
  logs, paths, IDs, and inline technical metadata.
- **Pane-based shell.** Resizable columns via the shadcn `resizable` component (Paneforge),
  with a persistent header and a minimal footer.

## Tokens

Defined in `app.css` as oklch values: `:root` (light) and `.dark` (dark), then exposed as
Tailwind utilities through `@theme inline`. The set is the **official shadcn tokens**:

`background`, `foreground`, `card(-foreground)`, `popover(-foreground)`,
`primary(-foreground)`, `secondary(-foreground)`, `muted(-foreground)`,
`accent(-foreground)`, `destructive(-foreground)`, `border`, `input`, `ring`,
`chart-1..5`, `sidebar(-foreground/-primary/-accent/-border/-ring)`, `radius`,
`font-sans`/`font-serif`/`font-mono`, and the `shadow-2xs..2xl` scale.

**Only addition:** semantic status colors `success`, `warning`, `info` (each with a
`-foreground`), used for status dots/badges and connection state — always paired with an
icon or text label, never color alone.

### Swapping the theme

Because we stick to the official tokens, changing the entire look is a copy-paste:

1. Pick a theme on [tweakcn](https://tweakcn.com) and open its registry item
   (`https://tweakcn.com/r/themes/<id>`).
2. Replace the values under `:root` and `.dark` in `app.css` with the theme's `light` and
   `dark` `cssVars` (keep the `success`/`warning`/`info` additions, deriving sensible values
   from the new palette).

## Components

Generated shadcn-svelte components live in `lib/components/ui/<name>/` with namespaced
`index.ts` exports. Import the official compositional primitives directly, e.g.:

```svelte
import { Button } from "$lib/components/ui/button";
import * as Select from "$lib/components/ui/select";
```

A handful of generated components carry small, intentional project extensions (documented in
the component file):

- **`button`** — adds an `active`/`pressed` toggle state (`data-active`/`aria-pressed`) and
  an `ariaLabel` convenience alias. Variants/sizes are stock vega.
- **`badge`** — adds project status `tone`s (`neutral|accent|good|warn|danger|running`) and
  `size`s (`xs|sm`) alongside the stock `variant`s.
- **`input`** — adds a `size` (`sm|default`) and an `ariaLabel` alias.
- **`scroll-area`** — adds a `viewportClass` pass-through.

### Project wrappers (thin convenience layers)

These compose the official primitives but expose a prop-driven API the app already used. They
are clearly project-level, not modifications to shadcn:

- `ui/context-menu-list` — `items`-model context menu over `ui/context-menu`.
- `ui/tabs-bar` — `tabs`-model bar over `ui/tabs`.
- `ui/select-field` — `items`-model select over `ui/select`.
- `ui/radio-group-field` — labeled `items`-model radio cards over `ui/radio-group`.
- `ui/confirm-dialog` — title/confirm/cancel wrapper over `ui/alert-dialog`.
- `ui/dialog-shell` — titled dialog with header-actions/footer snippets over `ui/dialog`.
- `ui/popover-panel` — trigger/content wrapper over `ui/popover`.
- `ui/switch-field` — labeled toggle row over `ui/switch`.

### Custom components

- `ui/status-dot` — a small status indicator (no shadcn equivalent), using the status tokens.

## Styling boundaries

- Use shadcn/Tailwind utilities for primitive composition, variants, and simple layout.
- Use scoped Svelte CSS for complex app components, pane layout, third-party internals,
  generated HTML, Markdown rendering, and CodeMirror styling.
- Use `app.css` `@layer components` only for small shared app patterns that repeat across
  multiple features, such as surfaces, captions, muted text, empty states, and custom
  interactive rows.
- Keep shared app classes generic (`app-*`) and token-driven; one-off dimensions stay local
  to the component that owns them.
- Formatting today is split: Biome covers TypeScript, CSS, and JSON, while Svelte files are
  excluded from Biome and validated with `svelte-check`. Keep Tailwind class strings readable
  and stable manually until a dedicated Svelte/Tailwind formatter is adopted in a separate
  tooling change.

## Shell

A persistent header + footer wrap three resizable panes (shadcn `resizable` / Paneforge):

- **Left — Agents (`bg-sidebar`):** search + project→session tree. Right-click rows for
  actions; selected rows get a quiet `accent` fill.
- **Center — Conversation (`bg-background`):** a tab strip for open conversations, the
  transcript, and the composer dock.
- **Right — Utility (`bg-sidebar`):** History / Processes / Context tabs.

The shell is currently desktop/workbench-first. Below the compact breakpoint, panes keep a
minimum workbench width and the workspace scrolls horizontally rather than converting to a
mobile drawer/tab model. If full mobile support becomes a product goal, treat it as a separate
layout project.

## Accessibility

- Every interactive element has a visible `:focus-visible` ring (`ring`).
- Status color is always backed by an icon or text label — never color alone.
- Pane resizing stays keyboard-accessible via the `resizable` handle.
- `prefers-reduced-motion` is respected (see `app.css`).
- Both light and dark themes maintain readable contrast.
