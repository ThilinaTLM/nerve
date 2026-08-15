---
title: Data formats and locations
description: Default storage, logs, reports, exports, task artifacts, and temporary media paths.
sidebar:
  order: 6
---

All Nerve-home paths move with `NERVE_HOME`; default is `~/.nerve`.

| Data                                       | Default location / format                                 |
| ------------------------------------------ | --------------------------------------------------------- |
| State marker                               | `<NERVE_HOME>`; `nerve-workbench-state` v2                |
| Projects/conversations/settings/auth/tasks | File-first domain storage under `<NERVE_HOME>`            |
| Conversation entries                       | Append-oriented JSONL with parent lineage                 |
| Protocol event streams                     | Dense per-stream JSONL with bounded retention             |
| Search/index cache                         | Rebuildable SQLite/cache                                  |
| Desktop/daemon logs                        | `<NERVE_HOME>/logs`, JSONL                                |
| Crash/Node reports                         | `<NERVE_HOME>/crashes`; age-retained diagnostics          |
| TLS CA/leaf material                       | `<NERVE_HOME>/tls` when mobile HTTPS is enabled           |
| Daemon metadata                            | `<NERVE_HOME>/daemon.json`                                |
| Explore reports                            | Nerve-owned report storage under the active home          |
| Python/large tool artifacts                | Nerve artifact paths returned by the tool                 |
| Pasted clipboard images                    | OS temp directory under `nerve/`; not durable attachments |

## Conversation exports

JSON uses bundle format `nerve.conversation.v1` and includes all stored entries, project, conversation, and agents. Markdown and escaped HTML are reading formats. Imports remap IDs and can skip malformed optional records.

## Electron profile

Electron browser cache, cookies, and local/session storage live in the platform Electron `userData` profile outside `NERVE_HOME`. Back up/isolate both only when browser state is required.

## Sensitive data

Logs, exports, reports, artifacts, and task output can contain prompts, source, paths, commands, remote URLs, or provider details. Redact before sharing.
