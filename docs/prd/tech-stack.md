# nerve Tech Stack

## Final stack direction

`nerve` is a TypeScript monorepo with a local orchestrator daemon, a plain Svelte web UI, isolated agent processes, and file-first storage under `~/.nerve`.

## Monorepo and runtime

```txt
pnpm workspace
TypeScript
Node.js 22+
strict ESM across all packages
Vite
Biome
```

Package layout:

```txt
nerve/
  packages/
    cli/
    web/
    orchestrator/
    agent/
    tools/
    shared/
```

## Web UI

Use a plain Svelte SPA, not SvelteKit initially.

```txt
Svelte 5
Vite
TypeScript
TailwindCSS
CSS variable design tokens
Bits UI
Paneforge
@tanstack/svelte-query
Svelte stores/runes
CodeMirror 6
unified/remark/rehype markdown pipeline
Shiki
```

### Why plain Svelte instead of SvelteKit

The orchestrator is already the backend. The UI is a local client served by the orchestrator, so a static Vite SPA is enough initially.

This keeps routing/deployment simple:

```txt
packages/web build -> static assets -> served by orchestrator
```

SvelteKit can be reconsidered later if file-based routing or app conventions become valuable.

## Headless UI primitives

Primary choice:

```txt
Bits UI
```

Layout panes:

```txt
Paneforge
```

Use Bits UI as an accessible behavior layer, not as the design system itself. Wrap primitives in Nerve components.

```txt
packages/web/src/lib/components/ui/
  button.svelte
  dialog.svelte
  dropdown-menu.svelte
  popover.svelte
  tooltip.svelte
  tabs.svelte
  select.svelte
  switch.svelte
  checkbox.svelte
  input.svelte
  textarea.svelte
  badge.svelte
  card.svelte
  separator.svelte
```

Likely Bits UI primitives:

- Dialog
- Popover
- Dropdown Menu
- Context Menu
- Tooltip
- Tabs
- Select
- Combobox
- Checkbox
- Radio Group
- Switch
- Slider
- Progress
- Accordion
- Collapsible
- Separator
- Toggle / Toggle Group

## Styling and design system

Use TailwindCSS utilities backed by CSS variable design tokens.

```txt
packages/web/src/design/
  tokens.css
  themes.css
  globals.css
```

Example token shape:

```css
:root {
  --color-bg: ...;
  --color-panel: ...;
  --color-border: ...;
  --color-text: ...;
  --radius-md: ...;
  --space-4: ...;
}
```

Tailwind should map to these variables so the visual language remains Nerve-owned and not tied to a component library.

## Web state management

Use a clear split between server/cache state and local UI state.

```txt
@tanstack/svelte-query:
  projects
  sessions
  agents
  approvals
  processes
  settings
  provider key metadata

Svelte stores/runes:
  selected project/session/agent
  layout panes
  open drawers/dialogs
  event stream buffers
  composer draft
  theme
```

No Zustand is needed with Svelte.

## Markdown rendering

Assistant output and plans need safe, high-quality markdown rendering.

Use:

```txt
unified
remark-parse
remark-gfm
remark-rehype
rehype-sanitize
rehype-stringify or custom Svelte rendering
Shiki
```

Requirements:

- GitHub-flavored markdown
- fenced code blocks
- syntax highlighting
- tables and task lists
- copy-code buttons
- sanitized HTML
- raw HTML disabled by default
- optional Mermaid later behind explicit opt-in

Security rule:

> Assistant output is untrusted content. Any HTML rendering must be sanitized before use.

Streaming strategy:

- render plain text or throttled markdown while streaming
- render full markdown on message completion

## Prompt composer

Use CodeMirror 6 for the main text composer.

```txt
@codemirror/state
@codemirror/view
@codemirror/autocomplete
@codemirror/commands
@codemirror/language
```

Reasons:

- robust multiline input
- autocomplete support
- keyboard shortcuts
- decorations for file/folder mentions
- slash command suggestions
- easier than custom `contenteditable`

Initial composer capabilities:

- normal prompt text
- file/folder suggestions
- slash commands
- keyboard shortcuts for send/newline

Future composer capabilities:

- symbol references
- agent/session references
- tool snippets
- prompt templates

## Orchestrator

```txt
Node.js 22+
Hono
WebSocket
Zod
better-sqlite3
pino
```

Responsibilities:

- HTTP API
- WebSocket event stream
- agent lifecycle
- tool routing
- policy enforcement
- approvals
- process management
- `~/.nerve` storage
- SQLite indexes
- provider keys/auth metadata
- serving the built web UI

## Agent runtime

```txt
Node.js 22+
TypeScript
@earendil-works/pi-ai
JSON-RPC 2.0 over stdio
```

The agent process should request tools from the orchestrator instead of directly mutating files, spawning child agents, or managing long-running processes.

## Protocols

Client/orchestrator:

```txt
HTTP JSON for commands and queries
WebSocket for live events and replay
Zod schemas in packages/shared
```

Orchestrator/agent:

```txt
JSON-RPC 2.0 over stdio initially
transport-neutral message types
future-compatible with WebSocket remote workers
```

## Tooling

Use Biome for formatting/linting where supported.

```txt
Biome
svelte-check
TypeScript compiler checks
```

Recommended scripts:

```txt
pnpm format
pnpm lint
pnpm check
```

If Biome does not fully cover `.svelte` formatting/linting, keep Biome for TypeScript/JavaScript/JSON/CSS and add the minimum extra Svelte-specific tooling needed.

## First implementation milestone

```txt
nerve daemon
nerve status
nerve ui
~/.nerve initialization
HTTP /api/status
WebSocket /ws
minimal Svelte UI shell
```

Then:

```txt
create project
create session
spawn agent process
send prompt
stream assistant output
persist session/events files
index in SQLite
```
