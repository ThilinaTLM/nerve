---
title: Launch and process recovery
description: Diagnose lost background commands, launch readiness, and process shutdown.
sidebar:
  order: 6
---

## Async Bash becomes `lost`

Nerve does not recover processes after a daemon restart. Async Bash runs become `lost`; inspect their retained output before starting a fresh command. Explicit and auto-promoted background commands both queue completion notices during normal operation.

## A launch disappears after restart

Launch instances are memory-only. Definitions remain in `.nerve/launches/definitions.json`, and logs remain under `data/launches/<launchId>/`. Inspect retained logs, check `launch status`, and start the current definition if needed. Agents cannot create or edit definitions.

## Readiness never arrives

For `bash` with `background: true`, check the `ready` URL or output regex and inspect `async_bash logs`. Readiness waits at most 60 seconds; a timeout does not stop the command.

For a launch with a declared port, start and restart wait up to 30 seconds for it to listen. Check `launch logs` and the definition's port. A server on a different interface or port may run correctly while missing the check. Read logs on demand rather than repeatedly polling for completion.

## A port is already in use

Launch start reports the listener's PID and process name. Agents never terminate foreign listeners; only the user can do so from the UI. Check the listener before deciding whether to stop it or change the definition.

## Stop does not complete

`async_bash stop` and `launch stop` terminate the process tree gracefully, then escalate after a bounded wait. Platform security software or child detachment can still interfere. Inspect logs and confirm process identity before any manual OS termination.

## Quitting Nerve

Quitting the desktop application terminates active local process trees before the owned daemon shuts down. Closing a window to the system tray does not quit Nerve or stop processes.

## Agent run recovery is separate

Process lifetime and model execution are separate. Background Bash completion notices and agent-started launch exit notices can wake the originating conversation, but restarting the daemon does not recover their processes. Conversation continuation resumes persisted conversation state, not a live shell command.

## Next steps

- [Background launches](/guides/background-tasks/)
- [Logs and diagnostics](/operations/diagnostics/)
