# Async bash and launch configurations

Part of the [conversation core redesign](README.md).

Background commands and user launches are separate by owner.

|                    | Async bash                                                          | Launch configuration                      |
| ------------------ | ------------------------------------------------------------------- | ----------------------------------------- |
| Started by         | A conversation, when a bash tool call is promoted to the background | The user, from the UI                     |
| Layer              | Conversation core                                                   | Workbench                                 |
| Definition storage | None; created from the tool call                                    | Project file                              |
| Run storage        | `ASYNC_BASH` row                                                    | Memory only                               |
| Output             | `ASSET` rows owned by the conversation                              | Log files in the workbench data directory |
| Completion         | Queued `async_bash_event` notice to the conversation                | Workbench change notice to the UI         |

## Async bash

A bash call that exceeds its foreground limit keeps running as a background process (unless foreground promotion is disabled by host settings):

1. Insert an `ASYNC_BASH` row with status `running` and settle the original tool call with a response that explains the promotion and identifies the async bash.
2. Stream output to files registered as `bash_output` assets owned by the conversation.
3. On exit, timeout or cancellation, update the row and queue an `async_bash_event` notice. The notice's `wake_when_idle` decides whether the conversation resumes processing.

Status:

```text
running | completed | failed | timed_out | cancelled | lost
```

`lost` means the daemon restarted and could not reattach to or confirm the process. It replaces the legacy `orphaned`, `recovered` and `recovery_unknown` distinctions. `process_ref` stores the host reference. On restart, rows still `running` are reattached if the process can be verified; otherwise they become `lost` and a notice is queued. The current native host retains handles only within its own instance, so daemon restart cannot reattach them.

Stopping or deleting a conversation cancels its running async bash processes.

## Launch configurations

Launch configurations retain the saved task-definition format and location: the project file `.nerve/tasks/definitions.json`, so they can be shared with the repository. A definition holds a label, command, working directory, optional port, readiness check and run policy (single or concurrent).

Running instances are held in memory by the workbench:

- Status, readiness and listening ports are pushed through the [workbench channel](channels.md).
- Logs live under `data/launches/<instanceId>/` with bounded per-instance output retention.
- A daemon restart ends tracking of running instances; nothing durable waits for them.

Conversations do not depend on launch configurations. Agents start background work through bash promotion or `task_start`; `task_status`, `task_logs` and `task_control` operate only on their conversation-owned async bash. `task_control` supports stop, not restart; these tools never manage UI launch instances.
