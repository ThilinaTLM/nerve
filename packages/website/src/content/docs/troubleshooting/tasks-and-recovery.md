---
title: Task and process recovery
description: Interpret recovered, interrupted, and recovery-unknown task runs.
sidebar:
  order: 6
---

## `recovered`

The persisted process identity still matches a live process. Nerve can stop or restart it, but cannot reconnect old stdout/stderr pipes. Output captured before application restart stays frozen; only newly observable state is available.

## `interrupted`

The process is verified gone. Restart creates a new immutable run in the same task definition lineage. Inspect the prior run's terminal state and application logs before restarting.

## `recovery_unknown`

Nerve cannot prove that the PID still belongs to the original process. It blocks destructive PID actions to avoid signaling an unrelated reused process. Verify externally and start a new task rather than forcing through Nerve.

## Readiness never arrives

Check the readiness URL/pattern and task logs. A server listening on a different interface/port can run correctly while missing the declared check. Use task log filters instead of polling repeatedly from the agent.

## Stop does not complete

Nerve attempts graceful process-tree termination then bounded escalation. Platform security software or child detachment can interfere. Confirm identity before manual OS termination.

## Agent run recovery is separate

Conversation runs use durable checkpoints, retry policy, and manual continuation. A background process being recovered does not automatically mean the model run is resumable, and vice versa.

## Next steps

- [Background tasks](/guides/background-tasks/)
- [Logs and diagnostics](/operations/diagnostics/)
