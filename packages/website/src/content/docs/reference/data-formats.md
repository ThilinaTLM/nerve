---
title: Data formats and locations
description: Default storage, logs, reports, exports, task artifacts, and temporary media paths.
sidebar:
  order: 6
---

All Nerve-home paths move with `NERVE_HOME`; default is `~/.nerve`.

| Data                              | Default location / format                                    |
| --------------------------------- | ------------------------------------------------------------ |
| Nerve-home marker                 | `<NERVE_HOME>/manifest.json`; `nerve-home` v1                |
| Canonical domain records          | `<NERVE_HOME>/data/nerve.sqlite` plus SQLite WAL/SHM         |
| Conversation/tool payloads        | `<NERVE_HOME>/data/conversations`                            |
| Durable images and plans          | `<NERVE_HOME>/data/images` and `<NERVE_HOME>/data/plans`     |
| Explore reports                   | `<NERVE_HOME>/data/reports`                                  |
| RPC, maintenance, and trust state | Tables/documents in `<NERVE_HOME>/data/nerve.sqlite`         |
| Rebuildable query cache           | `<NERVE_HOME>/cache/query-cache.sqlite` plus SQLite sidecars |
| Other disposable caches           | Other content under `<NERVE_HOME>/cache`                     |
| Task records and logs             | `<NERVE_HOME>/data/tasks`                                    |
| Agent resources                   | `<NERVE_HOME>/agent`                                         |
| Desktop/daemon/event logs         | `<NERVE_HOME>/logs`, JSONL                                   |
| Crash/Node reports                | `<NERVE_HOME>/crashes`; age-retained diagnostics             |
| Configuration and credentials     | `<NERVE_HOME>/config` and encrypted `<NERVE_HOME>/secrets`   |
| TLS CA/leaf material              | `<NERVE_HOME>/tls` when mobile HTTPS is enabled              |
| Active daemon discovery/lease     | `<NERVE_HOME>/daemon.json`; absent after clean shutdown      |
| Migration history and backups     | `<NERVE_HOME>/migrations` and `<NERVE_HOME>/backups`         |
| Python/large tool artifacts       | Nerve artifact paths returned by the tool                    |
| Pasted clipboard images           | OS temp directory under `nerve/`; not durable attachments    |

## Conversation exports

JSON uses bundle format `nerve.conversation.v1` and includes all stored entries, project, conversation, and agents. Markdown and escaped HTML are reading formats. Imports remap IDs and can skip malformed optional records.

## Electron profile

Electron browser cache, cookies, and local/session storage live in the platform Electron `userData` profile outside `NERVE_HOME`. Back up/isolate both only when browser state is required.

## Sensitive data

Logs, exports, reports, artifacts, and task output can contain prompts, source, paths, commands, remote URLs, or provider details. Redact before sharing.
