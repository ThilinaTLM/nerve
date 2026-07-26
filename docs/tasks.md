# Tasks and process recovery

Nerve separates a durable **task definition** from its immutable **task runs**. A definition owns its label, command, working directory, and launch policy; restarting creates a new run in the same lineage, so the logical task and its tab remain stable while prior output stays available in History.

- `single` (default): launching an active definition focuses its existing run.
- `concurrent`: launching may create another active run.
- Ad-hoc active and recovery runs appear in Tasks. Completed unsaved runs appear in History.

Agent behavior is unchanged: use finite Bash naturally, let Nerve promote execution that remains active, and use `task_start` for known servers and watchers.

## Recovery

Nerve does not install a persistent sidecar supervisor. On application restart it verifies persisted process identity using platform-specific evidence:

- verified live: `recovered`; stop/restart remains available, but stdout and stderr captured before the restart are frozen because pipes cannot be reattached;
- verified gone: `interrupted`;
- identity unverifiable: `recovery_unknown`; destructive PID actions are blocked to avoid signaling a reused PID.

Linux uses `/proc` process-start identity and process groups. macOS uses process start fingerprints and process groups. Windows uses process creation time and process-tree termination. Port discovery is best effort on each platform. Force stop uses the same identity checks as graceful stop.
