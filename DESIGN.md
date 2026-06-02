# Nerve Design System — Technical Precision

Nerve is a compact desktop workbench for local coding agents. The interface follows
**Terminal-Adjacent Minimalism**: dense, glass-less, low-ornament, and optimized for
long-running work. It should read like a native IDE/inspector, not a web dashboard.
The emotional target is *total control and professional-grade power* — the tool stays
out of the way and signals stability and low-latency interaction.

The implementation reference for every token is
`packages/web/src/design/tokens.css`. Components are Svelte 5 with scoped `<style>`
blocks driven by these CSS custom properties; primitives wrap `bits-ui`. Icons use
`lucide-svelte` (bundled — never a CDN icon font). Fonts are bundled via `@fontsource`.

## Principles

- **Desktop density:** fit project navigation, conversation, process logs, and
  settings without modal churn. 4px base unit; 32px header/footer/toolbars; 36px tab
  strips; ~12px pane padding.
- **Glass-less tonal layering:** depth comes from a solid surface ladder plus 1px
  borders, not translucency, big shadows, or gradients. Shadows are reserved for
  popovers, dialogs, and the composer dock.
- **Lime is the surgical instrument:** the lime accent marks primary actions, active
  state, focus, and live/success status only. Neutral surfaces carry layout.
- **Active state is a stroke, never elevation:** a 2px lime rail on rows, a 2px lime
  top border on tabs, a lime focus ring on fields.
- **Mono = "the work", sans = "the tool":** JetBrains Mono for anything typed by the
  user/agent or emitted by the system (code, logs, paths, IDs, status); Inter for UI
  chrome and labels.
- **Stable context:** the active working directory is the project identity and stays
  visible in the header breadcrumb, left panel, and footer.

## Tokens

### Color roles (dark, MD3 surface ladder)

| Token | Stitch role | Value | Use |
| --- | --- | --- | --- |
| `--color-bg` | surface | `#131313` | conversation workspace, settings canvas |
| `--color-bg-deep` / `--color-field` | surface-container-lowest | `#0e0e0e` | gutters, footer, inputs, code/log backing |
| `--color-titlebar` / `--color-panel-muted` | surface-container-low | `#1c1b1b` | header, tab strips, breadcrumb bars |
| `--color-pane` / `--color-panel` | surface-container | `#201f1f` | left/right panes, cards |
| `--color-panel-raised` | surface-container-high | `#2a2a2a` | hover/active rows, dialog chrome |
| `--color-panel-highest` | surface-container-highest | `#353534` | code-block headers, icon chips |
| `--color-border` | outline-variant | `#424936` | primary 1px dividers and pane edges |
| `--color-border-subtle` | — | `#2f3527` | hairline dividers inside panes |
| `--color-text` | on-surface | `#e5e2e1` | primary UI text |
| `--color-muted` | on-surface-variant | `#c2cab0` | metadata, secondary copy |
| `--color-faint` | outline | `#8c947c` | tertiary/mono timestamps prefixes |
| `--color-accent` | primary | `#ccff80` | selected, live, focus, primary action |
| `--color-accent-strong` | primary-container | `#a3e635` | primary hover/avatars |
| `--color-accent-ink` / `--color-on-accent` | on-primary | `#213600` | text on lime fills |
| `--color-good` | surface-tint | `#98da27` | ready/success, log timestamps |
| `--color-warn` | — | `#ffd166` | pending approvals, caution |
| `--color-danger` | error | `#ffb4ab` | errors, destructive actions |

Light theme mirrors these roles with a darker lime (`#5c8e18`) as a compatibility
fallback; dark is the reference. `:root[data-theme="light"]` retunes every role.

### Typography

- `--font-ui` / `--font-display` / `--font-body`: bundled **Inter**, then SF Pro /
  Segoe UI / system fallbacks. 13px base, 11px small, 18px headline. The wordmark and
  short headings use the display family.
- `--font-mono`: bundled **JetBrains Mono**, then Cascadia / SF Mono / system. Used
  for code, logs, composer text, command snippets, paths, IDs, and status chips.
- Tight line-heights (~1.4). Labels are 11–13px with medium/semibold weight.

### Spacing & sizing

- Spacing scale: `--space-1` 4px … `--space-6` 20px. Dense rows use 4–8px internal
  padding; reserve 16px+ for empty states and dialogs.
- Sizing: `--size-header` / `--size-footer` / `--size-pane-header` 32px; tab strip
  36px; `--control-height-xs/sm/md/lg` for controls; `--size-row-sm/md` for rows.

### Shape & elevation

- Radii: `--radius-xs` 2px, `--radius-sm`/`--radius-md` 4px, `--radius-lg` 8px,
  badges fully rounded (pill, ~18px). Tabs are square-bottomed and flush.
- Elevation: flat. `--shadow-popover` / `--shadow-dialog` for floating layers and
  `--shadow-dock` for the composer; otherwise borders only.

## Components

### App shell

Three fixed-purpose, horizontally resizable columns with a persistent header and
footer:

1. **Agents (left, ~260px, `surface-container`):** an avatar + active-project header,
   a full-width lime **New Agent** button, search, and a project→session tree.
2. **Conversation (center, `surface`):** a mono breadcrumb sub-header, the transcript,
   and the composer dock.
3. **Utility (right, ~320px, `surface-container`):** exactly three tabs — History,
   Processes, Context.

Pane resizers are 1px with a wider invisible hit area and turn lime on hover/active.

### Header

Compact and informational: lime **Nerve** wordmark, a mono `project › session`
breadcrumb (chevron separators), the agent status pill, a live connection chip
(pulsing lime dot when live), and the Settings button. No secondary action clutter.

### Footer

A dense mono status strip (`surface-container-lowest`): working directory, session,
process count, branch depth, pending approvals, and connection state via a status dot.

### Sidebar tree

Project groups are collapsible rows; session rows show a status dot, title, and mono
metadata (mode · permission · model). Active/selected rows get a 2px lime left rail,
lime text, and a `surface-container-high` hover.

### Conversation transcript

A continuous flow separated by 1px rules — no bubbles. Each entry has a 24px gutter
icon + body: user = lime double-chevron, assistant = boxed bot glyph, system = dim
info glyph. A copy button appears on hover. Code blocks render with a
`surface-container-highest` header (mono filename/language + lime-hover Copy) over a
dark, syntax-highlighted body.

### Composer

A sticky dock over the conversation: an editor card (`surface-container-lowest`) whose
border turns lime on focus-within, above a toolbar row with the model selector, a
run-options control (mode/access), the project pill, and a lime **Send** button (an
**Abort** appears while running). Pending approvals disable the editor with a
"waiting for approval" state.

### Approvals

Rendered above the composer (not a tab). A lime-ringed card with a round gavel chip,
"Action Required" heading, and a TOOL / RISK / REASON detail panel (mono lime tool
name, colored risk dot, wrapped reason; raw args in a collapsible `<details>`).
Actions are a full-width lime **Approve & Execute** and an outlined **Deny**.

### Utility panel

Flush square-bottom tabs with a 2px lime top border when active. Processes show a
spinner/status header with Stop/Restart and a terminal log (`surface-container-lowest`,
JetBrains Mono, lime timestamps, warn/error coloring on the relevant line only).
History lists branch entries with an active rail; Context shows cards for the active
context, session agents, and export links.

### Settings

A full page: a mono `nerve › settings › section` breadcrumb (lime current segment)
with Discard/Save actions, a left rail (`surface-container`) that filters to a single
section (General, Appearance, Providers, Agents, Network) with a 2px lime active rail,
and a centered content canvas of bordered cards. Credentials are CLI-managed and never
rendered as raw secrets in the browser; provider rows show status chips and the CLI
command to configure them.

### Project picker

A dialog (`surface-container`, 8px radius, dialog shadow): header + close, a path
search with Go/Up, Recent Directories and a live Browse column (folder rows with name
over mono path, 2px lime rail when selected), and a footer with the selected path plus
Cancel and a lime **Open Directory**.

## Accessibility

- Every interactive element has a visible `:focus-visible` outline (lime ring).
- Accent and status colors are always backed by text labels or icons; color alone is
  never the only signal.
- Pane resizing stays keyboard-accessible via Paneforge.
- Respect `prefers-reduced-motion`; animations stay minimal.
- Maintain readable contrast in both dark and light themes.
