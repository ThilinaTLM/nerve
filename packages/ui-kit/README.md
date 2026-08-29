# `@nervekit/ui-kit`

Contract-free Svelte UI and display infrastructure.

- `components/ui/`: registry-owned official shadcn-svelte primitives only.
- `components/composites/`: Nerve-owned generic controls built from primitives.
- `renderers/`: Markdown, Mermaid, and plain-text rendering.
- `highlighting/`, `terminal/`: code and ANSI presentation.
- `browser/`: generic clipboard and notification capabilities.
- `display/`, `collections/`, `scheduling/`: focused display/runtime helpers.
- `utils.ts`: shadcn-compatible `cn` and component utility types.
- `styles/`: shared theme and CSS contracts, loaded through `app.css`.

Application HTTP, contracts, protocol state, and product features do not belong here.
