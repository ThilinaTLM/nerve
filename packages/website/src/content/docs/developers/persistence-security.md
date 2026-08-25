---
title: Persistence and security boundaries
description: Understand authoritative files, event logs, indexes, secrets, protocol auth, and migration.
sidebar:
  order: 5
---

## Authoritative state

Projects and conversations live under `NERVE_HOME`. Canonical conversation records and durable protocol events use SQLite. Complete truncated tool results use private owner-scoped files under `payloads/`, referenced by digest-bearing conversation records. Ephemeral notifications are not persisted or replayed.

The same database also contains rebuildable query projections. Code must keep the canonical conversation records distinct from disposable indexes and caches.

## Filesystem safety

Server state mutations use same-directory temporary files, sync/close, atomic replacement, bounded native-host retries, and per-process serialization. Directory cleanup skips symlinks. POSIX mode bits harden Unix files but are not a Windows ACL boundary.

## Secrets and authentication

A local token authorizes HTTP and WebSocket access. Browser bootstrap converts query token to a Strict HttpOnly cookie. Provider/tool secrets use encrypted storage and selective migration/re-encryption where possible.

Schemas reject secret-like protocol metadata keys, but a broad error/details schema is not itself a redaction guarantee. Host boundaries must sanitize logs/errors before public transmission.

## Migration

Manifest versioning prevents automatic downgrade and malformed/future resets. Ordinary startup is fail-closed. A dedicated offline migrator accepts only the immediately preceding `nerve-workbench-state` v2 format, uses a sibling lock/journal and validated staging home, re-encrypts recognized credentials, converts semantic conversation state and referenced managed files, and retains the complete legacy tree under `backups/`. Desktop supplies explicit consent and presentation; remote shell mode never touches local `NERVE_HOME` data. Logs, caches, task runtime state, daemon metadata, and TLS identity are regenerated rather than imported.

## Electron boundary

Renderer sandboxing and narrow IPC reduce desktop attack surface. The renderer still intentionally talks to a powerful authenticated daemon; origin/token protection remains critical.

## Next steps

- [Protocol v1](/developers/protocol/)
- [Storage operations](/operations/storage-migration/)
