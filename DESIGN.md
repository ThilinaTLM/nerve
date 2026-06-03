# Nerve Design System

Nerve is a compact, pane-based workbench for local coding agents. The interface is
**calm, neutral, and dense** — closer to a native IDE/inspector than a web dashboard.
The aesthetic follows the **shadcn semantic token model** tuned to a **ChatGPT-style
near-monochrome neutral palette**: grayscale surfaces, no brand accent, hue reserved
for status only. We follow shadcn conventions but own our primitives, built on
[`bits-ui`](https://bits-ui.com) headless components.

Implementation reference:

- Tokens: `packages/web/src/design/tokens.css` (per-theme semantic variables).
- Tailwind mapping: `packages/web/src/design/theme.css` (`@theme inline`).
- Base/reset: `packages/web/src/design/globals.css`.
- Primitives: `packages/web/src/lib/components/ui/*` (Svelte 5 wrappers over `bits-ui`).
- Icons: `lucide-svelte` (bundled, never a CDN). Fonts: bundled via `@fontsource`.

## Principles

- **Neutral & monochrome.** Surfaces are grayscale. `primary` is a solid near-white
  (dark) / near-black (light). Color appears only in semantic status
  (`success`, `warning`, `destructive`, `info`).
- **Compact density.** 48px header, 28px footer, 32px pane/tab bars, 4px spacing base.
  Body text 13–14px; metadata 11–12px.
- **Tonal layering, not elevation.** Depth comes from a neutral surface ladder
  (`sidebar` → `background` → `card` → `popover`) plus 1px borders. Shadows are
  reserved for popovers, dialogs, and the composer dock.
- **Active = subtle fill.** Selected/active rows use a quiet `accent` fill (and a thin
  rail), never a loud color.
- **Sans for the tool, mono for the work.** Inter for all chrome, labels, and body;
  JetBrains Mono only for code, logs, paths, and IDs.
- **Pane-based shell.** Resizable columns (Paneforge) with a persistent header and a
  minimal footer — the foundation for a future VSCode-like, customizable layout.

## Tokens

Tokens are defined as HSL channel triples per theme in `tokens.css` (dark is the
`:root` default; `:root[data-theme="light"]` overrides), then exposed as Tailwind
utilities through `@theme inline` in `theme.css`. Use the Tailwind utilities
(`bg-card`, `text-muted-foreground`, `border-border`, `ring-ring`) in primitives, and
`hsl(var(--token))` in app-shell scoped styles.

### Color roles

| Token | Tailwind | Use |
| --- | --- | --- |
| `--background` / `--foreground` | `bg-background` / `text-foreground` | conversation canvas + primary text |
| `--sidebar` / `--sidebar-foreground` | `bg-sidebar` | left/right rails, footer, gutters (deeper than canvas) |
| `--card` / `--card-foreground` | `bg-card` | panes, cards, header, tab strips |
| `--popover` / `--popover-foreground` | `bg-popover` | menus, popovers, dialogs |
| `--primary` / `--primary-foreground` | `bg-primary` | primary action, solid fills (near-white / near-black) |
| `--secondary` / `--secondary-foreground` | `bg-secondary` | secondary buttons, chips, badges |
| `--muted` / `--muted-foreground` | `bg-muted` / `text-muted-foreground` | muted surfaces + metadata text |
| `--accent` / `--accent-foreground` | `bg-accent` | hover/active row fills |
| `--destructive` / `--destructive-foreground` | `bg-destructive` | errors, destructive actions |
| `--border` | `border-border` | 1px dividers and pane edges (hairlines via `/ 0.6`) |
| `--input` | `bg-input` / `border-input` | field backgrounds and borders |
| `--ring` | `ring-ring` | focus ring, resizer active, active strokes |
| `--success` / `--warning` / `--info` | `text-success` … | status only (always paired with icon/text) |

### Typography, spacing, shape

- `--font-ui` (Inter) for chrome; `--font-mono` (JetBrains Mono) for code/logs/paths.
- Text scale `--text-2xs` (11px) … `--text-xl` (18px); tight line-heights (~1.18–1.55).
- Spacing scale `--space-1` (4px) … `--space-6` (20px).
- Sizing: `--size-header` 48px, `--size-footer` 28px, `--size-pane-header` 32px,
  `--control-height-xs/sm/md/lg` (24/28/32/36px).
- Radius: `--radius` 0.5rem base, with `--radius-sm/md/lg/xl` derived; badges are pills.
- Elevation: flat by default; `--shadow-popover` / `--shadow-dialog` / `--shadow-dock`.

## Primitives

All primitives live in `lib/components/ui/` and share one grammar: a `cva()` variant
map + Tailwind utility classes bound to the tokens, merged with `cn()` (clsx +
tailwind-merge). bits-ui wrappers keep scoped styles only where a portalled part needs
it. The `class` prop is always accepted and merged last.

- **Leaf (Tailwind + CVA):** `Button`, `Badge`, `Card`, `Input`, `Textarea`, `Kbd`,
  `StatusDot`, `Label`, `Checkbox`, `Toggle`, `Progress`.
- **bits-ui wrappers:** `Select`, `Tabs`, `Dialog`, `AlertDialog`, `ContextMenu`,
  `DropdownMenu`, `Popover`, `Tooltip`, `Switch`, `RadioGroup`, `ToggleGroup`,
  `ScrollArea`, `Separator`.
- **Raw families** are re-exported from `ui/primitives.ts` for advanced/compound cases
  (`Accordion`, `Collapsible`, `Command`, `Menubar`, …); prefer a styled wrapper.

Variant grammar:

- `Button`: `variant` = `primary | secondary | ghost | outline? | danger | toolbar |
  icon`; `size` = `xs | sm | md | lg | icon`.
- `Badge` / `StatusDot`: `tone` = `neutral | accent | good | warn | danger | running`
  (resolved to the semantic status colors); `size` = `xs | sm`.
- `ContextMenu`: an `items` model of `item | separator | label | submenu`, each item
  supporting `label`, `icon`, `shortcut`, `disabled`, `destructive`, `onSelect`.
- `AlertDialog`: `title` / `description` / `confirmLabel` / `cancelLabel` /
  `destructive` + `onConfirm`. (`Action` does not auto-close; the wrapper closes after
  `onConfirm`.) Use it for destructive confirmations instead of a generic `Dialog`.

## Shell

A persistent header + footer wrap three resizable panes (Paneforge):

- **Left — Agents (`sidebar`):** search + project→session tree. Right-click rows for
  actions; selected rows get a quiet `accent` fill and a thin rail.
- **Center — Conversation (`background`):** a continuous transcript (no sub-header) and
  the composer dock. Each message has a gutter icon; code blocks get a header
  (language + Copy) over a neutral syntax-highlighted body.
- **Right — Utility (`sidebar`):** History / Processes / Context tabs.

### Header (48px)

`bg-card` with a bottom hairline. Left: **Nerve** wordmark, a `project › conversation`
breadcrumb, and an agent status pill (idle/running/error). Right: the connection
status popover and a Settings icon button. Room is reserved for future toolbar/pane
controls.

### Footer (28px)

`bg-sidebar`, sans, minimal. Left: left-panel toggle + a shortened project path
(`~/P/90events` via `utils/path.ts`). Right: a git-status slot (hidden until the
backend exposes git), compact process/approval count chips, a connection dot, and the
right-panel toggle.

## Context menus

Right-click is the primary secondary-action surface (a visible affordance such as the
`+` button is kept for discoverability):

- **Project rows:** New conversation · Copy path · Delete (destructive → `AlertDialog`).
- **Session rows:** Open · New conversation · Copy session id · Delete (destructive).
- **Transcript messages:** Copy text · Quote in composer · Copy message id.
- **Process rows:** Restart · Stop · Refresh logs · Copy command · Copy cwd.
- **History entries:** Jump here · Jump + summarize · Copy entry id.

## Accessibility

- Every interactive element has a visible `:focus-visible` ring (`ring`).
- Status color is always backed by an icon or text label — never color alone.
- Pane resizing stays keyboard-accessible via Paneforge.
- `prefers-reduced-motion` is respected; animation stays minimal.
- Both dark (default) and light themes maintain readable contrast.
