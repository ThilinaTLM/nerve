# Desktop performance profiling

Use an isolated Nerve home and Electron profile for performance investigations. Never profile, signal, automate, or stop a live instance that is hosting active work.

## Safe setup

1. Prefer copying a stopped `NERVE_HOME`. On Btrfs, a reflink copy avoids duplicating unchanged data.
2. If the source daemon must remain online, use SQLite's online backup API for `state.sqlite`; do not copy a live database/WAL trio as independent files.
3. Remove `daemon.json` and stale SQLite `-wal`/`-shm` files only from the clone after creating the online database backup.
4. Give the clone all of the following:
   - a separate `NERVE_HOME`;
   - a fresh Electron `--user-data-dir` outside `NERVE_HOME`;
   - non-default daemon/mobile ports;
   - a non-default CDP `--remote-debugging-port`.
5. Validate the copied database with `PRAGMA quick_check` before launch.

Example development launch (replace every path/port explicitly):

```sh
NERVE_HOME=/path/to/isolated-home \
NERVE_PORT=4747 \
NERVE_HTTPS_PORT=4748 \
NERVE_PERFORMANCE_DIAGNOSTICS=1 \
pnpm desktop -- \
  --user-data-dir=/path/to/fresh-electron-profile \
  --remote-debugging-port=49222
```

`NERVE_PERFORMANCE_DIAGNOSTICS=1` is opt-in. It appends content-free process samples every ten seconds to `<NERVE_HOME>/logs/performance.jsonl`. Startup phase records are in `<NERVE_HOME>/logs/startup.jsonl`.

## Renderer tracing

Read the installed agent-browser core and Electron skill instructions before connecting. Connect only to the isolated CDP port and use a dedicated session name. Keep captures bounded and cover one scenario at a time:

- clean foreground idle;
- clean minimized idle;
- Tasks panel mounted for at least 15 seconds;
- workspace panel navigation;
- opening and jumping through a large transcript.

Chromium and Node profilers materially increase CPU use. Always repeat idle without any profiler and treat that clean control as the authoritative baseline. Process-tree `/proc` samples are useful alongside traces because they separate Electron main, renderer, GPU, network service, and daemon load.

## Summaries

Generate a Markdown summary:

```sh
pnpm performance:summarize -- \
  --startup /path/to/isolated-home/logs/startup.jsonl \
  --performance /path/to/isolated-home/logs/performance.jsonl \
  --format markdown
```

Use `--format json` for machine-readable output. Either input may be omitted. The summarizer streams JSONL, ignores one torn final record, rejects malformed interior records, and emits only known numeric fields.

## Shutdown and review

- Quit only the isolated clone and verify its daemon, Electron helpers, ports, and CDP endpoint are gone.
- Confirm the original daemon and Electron processes remain alive.
- Review raw traces and screenshots before sharing. They can contain local paths, conversation text, or visible UI strings even though `performance.jsonl` does not.
- Delete or securely retain copied homes according to the sensitivity of the source data.
