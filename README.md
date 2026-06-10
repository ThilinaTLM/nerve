# nerve

Nerve is a UI-first local AI coding harness with a daemon, CLI, Web UI, and Electron desktop shell.

> Status: alpha. APIs, storage formats, and packaging may change without migration support.

## Packages

- `packages/orchestrator` — local HTTP/WebSocket daemon, auth, conversations, tools, and agent lifecycle.
- `packages/agent` — agent harness and conversation runtime.
- `packages/web` — Svelte Web UI.
- `packages/cli` — terminal client and daemon entrypoint.
- `packages/desktop` — Electron desktop shell.
- `packages/tools` and `packages/shared` — coding tools and shared schemas.

## Development

Requirements: Node.js `>=22.19.0` and pnpm `11.3.0`.

```sh
pnpm install
pnpm dev              # run the orchestrator daemon
pnpm serve -- --open  # serve/open the bundled Web UI
pnpm desktop          # run the desktop shell
pnpm check
pnpm test
```

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
