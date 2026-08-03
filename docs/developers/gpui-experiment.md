# Experimental GPUI client

`crates/nerve-gpui` is an experimental native Rust UI. It is an additional Protocol v1 `ui` peer, not a replacement for `packages/workbench-app` or `packages/desktop-shell`.

## Boundaries

- `crates/nerve-client` owns Rust daemon discovery, redacted Bearer authentication, HTTP RPC, WebSocket session/reconnect, stream cursors, and narrow Rust DTOs.
- `crates/nerve-gpui` owns only GPUI state adaptation and native presentation.
- `workbench-server` remains authoritative for storage, agents, tools, policy, Git, tasks, settings, and all host effects.
- The experiment connects to an existing local or remote daemon. It never owns daemon lifecycle and never writes under `NERVE_HOME`.

The initial UI loads workspace and conversation snapshots. Sequenced WebSocket events are validated as dense invalidations: the affected snapshot is refreshed before its cursor advances. Feature-specific reducers can replace this conservative behavior incrementally without weakening snapshot recovery.

## Cross-language contracts

TypeScript Zod contracts remain authoritative. JSON under `packages/contracts/test/fixtures/rust-client/` is validated by both the contracts package and `nerve-client` tests. Every operation or event payload implemented natively must add a shared fixture. Unknown event payloads remain JSON values rather than becoming speculative Rust models.

JSON Schema generation is deferred because contract refinements and transforms are not represented losslessly. Revisit generation only if the fixture policy becomes a material maintenance burden.

## Roadmap

1. Read-only projects, conversations, transcripts, reconnect, and recovery.
2. Composer and live run reducers.
3. Approvals, questions, and plan review.
4. Tasks, logs, tools, Git, files, settings, providers, and auth.
5. Only then evaluate native daemon supervision, packaging, signing, and update behavior.

The Electron app remains the supported distribution throughout this experiment.

## Native presentation architecture

The native shell uses Nerve-owned GPUI components and the semantic light/dark palette from `packages/ui-kit/src/styles/theme.css`. Rust mirrors the authoritative OKLCH triples and verifies them against the CSS in tests; it does not parse CSS at runtime. Appearance follows the operating system unless `--theme light` or `--theme dark` is supplied for review. Outfit and Iosevka subsets and the small Lucide icon catalog are embedded with their upstream licenses.

The shell follows the desktop workbench hierarchy—workspace header, activity rail, conversations dock, editor tab, transcript, collapsed right edge, and status bar—but deliberately omits controls that have no native command implementation. Zed's GPUI codebase is used as a pattern reference only; no Zed workspace crate is linked or copied.

Visual review covers 1200×800 and wide windows in both palettes against `packages/website/src/assets/shots/d1-conversation-{light,dark}.webp`, including long-title truncation, empty/loading/error states, keyboard selection, reconnect state, and transcript scrolling.
