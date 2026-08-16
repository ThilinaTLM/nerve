---
title: Run background tasks
description: Supervise servers, watchers, and other long-running processes.
sidebar:
  order: 10
---

Nerve separates a durable **task definition** from immutable **task runs**. A definition owns its label, command, working directory, and launch policy. Restarting creates a new run in the same lineage, so the task and tab remain stable while prior output stays in History.

- `single` (default): launching an active definition focuses its current run.
- `concurrent`: launching can create another active run.

Use finite Bash for commands that should finish. Use a task for a known server or watcher. Nerve can also promote a command that remains active. A task is separate from an agent todo: tasks supervise processes, while todos describe work inside a conversation.

## Supervision

A task can define readiness by URL, first detected URL, or output pattern. The agent receives asynchronous status rather than polling. Dedicated views provide status and bounded streaming logs with cursor, error, warning, and first-failure modes. Runtime can be capped at up to 24 hours.

Environment values supplied to task start are encrypted at rest and displayed as redacted keys. They still enter the child process; treat its logs and behavior as sensitive.

## Recovery

Nerve has no persistent sidecar supervisor. On restart it verifies process identity with platform evidence:

- `recovered`: verified live; stop/restart remains available, but old stdout/stderr is frozen because pipes cannot be reattached;
- `interrupted`: verified gone;
- `recovery_unknown`: identity cannot be proven, so destructive PID actions are blocked.

Linux uses `/proc` start identity and process groups; macOS uses process-start fingerprints and groups; Windows uses creation time and process-tree termination. Port discovery is best effort.

A normal **Stop** requests graceful process-tree termination and escalates after a bounded wait. Verified recovered and stuck-stopping runs also offer **Force kill**: immediate for stuck-stopping runs, confirmed for verified recovered runs because you may not have asked to terminate them. After the run is terminal, remove its history or choose **Run saved task again** to launch the definition's current configuration. Nerve does not force-kill `recovery_unknown` records because their PID identity is unverified.

Quitting the desktop app immediately terminates active local task process trees before its owned daemon exits. Closing to the tray leaves tasks running.

## Task controls

The Tasks panel and task-output tab let you switch between sibling runs, restart a saved task, cancel a run, load earlier log output, clean up terminal history, and prune old runs. **Force kill** is available only when Nerve has verified the process identity (or a run is stuck stopping); it is intentionally unavailable for `recovery_unknown` records. Removing a run's history does not remove the durable task definition.

## Agent notifications

Task terminal changes can become deduplicated `task_event` system entries in the conversation and can wake an agent waiting for completion. This is separate from desktop/browser toast notifications.

## Next steps

- [Task recovery troubleshooting](/troubleshooting/tasks-and-recovery/)
- [Configure Settings](/guides/settings/)
- [Task tool reference](/reference/tools/#background-tasks)
