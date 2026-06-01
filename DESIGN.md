# Nerve Design System

Nerve is a compact desktop workbench for local coding agents. The interface should feel closer to a native inspector/debugger than a web dashboard: dense, direct, low ornament, and optimized for long-running work.

## Principles

- **Desktop density:** fit project navigation, conversation, process logs, and settings without modal churn.
- **Crisp structure:** use 1px separators, pane headers, and row alignment instead of heavy cards.
- **Stable context:** the active working directory is the project identity and should stay visible in header, left panel, and footer.
- **Reserved color:** neutral surfaces carry layout; accent, warning, and danger colors carry state.
- **No marketing gloss:** avoid broad gradients, oversized shadows, glass effects, and decorative illustrations.

## Tokens

Implementation tokens live in `packages/web/src/design/tokens.css`.

### Color roles

| Role | Use |
| --- | --- |
| `--color-bg` | conversation workspace background |
| `--color-bg-deep` | app gutters and pane backing |
| `--color-titlebar` | compact global header and utility tabs |
| `--color-pane` | left/right pane surface |
| `--color-panel` | raised rows and message bodies |
| `--color-panel-muted` | pane headers, composer, secondary surfaces |
| `--color-field` | inputs, selects, code/editor fields |
| `--color-border` / `--color-border-subtle` | primary and hairline dividers |
| `--color-text` | primary UI text |
| `--color-muted` / `--color-faint` | metadata and disabled copy |
| `--color-accent` | selected, live, focus, primary action |
| `--color-good` | ready/success |
| `--color-warn` | pending approvals and caution |
| `--color-danger` | errors and destructive actions |

### Typography

- `--font-ui` / `--font-body`: bundled Google Font Inter, followed by SF Pro/Segoe UI/system fallbacks for dense controls and conversation chrome.
- `--font-display`: bundled Inter, followed by native display/system fallbacks for the app mark/name and short headings.
- `--font-mono`: bundled Google Font JetBrains Mono, followed by Cascadia/SF Mono/system fallbacks for code, logs, composer text, command snippets, and IDs.
- Font files are bundled through `@fontsource` dependencies, not loaded from a remote CDN.
- UI labels use 11-13px equivalents with medium/semibold weights.
- Logs and status metadata favor tabular, compact rows over paragraphs.

### Spacing

Use a small scale: `--space-1` 4px, `--space-2` 6px, `--space-3` 8px, `--space-4` 12px, `--space-5` 16px, `--space-6` 20px.

Dense rows should usually use 4-8px internal padding. Reserve 16px+ only for empty states or dialogs.

### Sizing

- `--size-header`: global title/header row.
- `--size-footer`: global status/footer row.
- `--size-pane-header`: pane-local header rows.
- `--control-height-xs/sm/md/lg`: buttons, tabs, inputs, selects.
- `--size-row-sm/md`: compact list rows.

## Components

### App shell

The app has three fixed-purpose, horizontally resizable columns:

1. **Agents:** projects grouped by canonical working directory, then conversations.
2. **Conversation:** active transcript and prompt composer.
3. **Utility:** exactly four tabs: History, Processes, Settings, Info.

Header and footer stay visible. Pane resizers are 1px with a wider invisible hit area.

### Header

The header is compact and informational: app mark, project/session breadcrumb, approvals count, and live connection status. Avoid stuffing secondary actions here; settings belong in the Settings tab.

### Footer

The footer is a dense status strip showing working directory, session/agent state, branch depth, processes, approvals, and connection state.

### Lists and rows

Rows should be single-click, low-height, and aligned to a consistent grid. Prefer ellipsis for long paths/IDs and show full values in `title` attributes.

### Tabs

Tabs use short labels and only necessary counts. The right panel tab strip must contain only `History`, `Processes`, `Settings`, and `Info`.

### Composer

The composer is a command surface:

- model/mode/access controls sit in a compact toolbar;
- the editor uses the mono font and constrained height;
- pending approvals render above the toolbar so tool-call decisions happen near the prompt workflow.

### Approvals

Approval rows use warning tone, show tool name/risk/reason, truncate args by default, and provide explicit `Approve` and `Deny` actions. They are not a right-panel tab.

### Process logs

Logs use mono text, compact rows, and error/warn coloring only on the relevant line. Avoid wrapping status controls into large cards.

## Accessibility

- Every interactive element must have visible `:focus-visible` styling.
- Accent and status colors must be backed by text labels or icons; color alone is not sufficient.
- Pane resizing must remain keyboard accessible through Paneforge.
- Respect reduced-motion preferences and keep animations minimal.
- Maintain readable contrast in both dark and light themes.
