# Development performance diagnostics

Source desktop launches collect lightweight performance diagnostics automatically. Run Nerve normally:

```sh
pnpm desktop
```

No alternate home, ports, Electron profile, or profiling flags are required. The unpackaged desktop process enables diagnostics for itself and the local daemon it owns. Packaged/released Nerve does not enable these diagnostics automatically.

## When CPU becomes high

1. Note the approximate clock time.
2. If practical, leave the activity running for another 10–20 seconds so at least one complete sample captures it.
3. Tell the coding agent that CPU is high and what was running in parallel.

The agent can inspect the normal files directly:

- `~/.nerve/logs/performance-<session-id>.jsonl` (or the equivalent beneath `<NERVE_HOME>`);
- `~/.nerve/logs/startup.jsonl`.

Each desktop launch creates a timestamped performance file. Desktop and daemon samples share that file, and automatic daemon restarts remain in the same desktop session. Fully quitting and reopening Nerve creates a new file. The agent selects the newest file for the current incident or an older timestamped file for a previous launch.

Routine samples are written every ten seconds. They contain process CPU/memory, event-loop health, and aggregate RPC, event, WebSocket, task-output, and Git-watcher activity. They do not contain prompts, output text, paths, record IDs, request arguments, or event payloads.

If the source desktop attached to a daemon that was already running outside this launch, stop that daemon and reopen the source desktop once so the newly owned daemon inherits the session ID.

## AI-oriented analysis

The coding agent uses the summarizer directly. Its default output is structured JSON with aggregate metrics and the ten hottest daemon samples:

```sh
latest=$(ls -1t "$HOME/.nerve/logs"/performance-*.jsonl | head -n1)
pnpm performance:summarize -- \
  --startup "$HOME/.nerve/logs/startup.jsonl" \
  --performance "$latest"
```

For an intermittent incident, the agent can isolate an inclusive time window:

```sh
pnpm performance:summarize -- \
  --performance "$latest" \
  --since "2026-08-15T10:20:00Z" \
  --until "2026-08-15T10:25:00Z"
```

`--format markdown` remains available for human review. Either input may be omitted. The summarizer streams JSONL, bounds hot samples, ignores one torn final record, rejects malformed interior records, and emits only recognized content-free fields.

Common signatures are:

- task bytes/lines rising with event delivery: task-output amplification;
- many Git filesystem callbacks but few invalidations: watcher churn;
- event publications multiplied by delivery attempts: WebSocket fan-out;
- high RPC count or duration: a chatty or slow operation;
- high CPU and event-loop utilization with little recorded activity: an uninstrumented CPU path;
- low CPU with high event-loop delay: blocking I/O or native pauses.

## Clean baseline

To compare against a source launch with diagnostics disabled:

```sh
NERVE_PERFORMANCE_DIAGNOSTICS=0 pnpm desktop
```

An explicit `0` or `1` is always respected. Do not run two daemons against the same `NERVE_HOME`. Diagnostics remain local and are never uploaded automatically.
