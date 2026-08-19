---
title: Persistence and security boundaries
description: Understand authoritative files, event logs, indexes, secrets, protocol auth, and migration.
sidebar:
  order: 5
---

## Authoritative state

Projects and conversations live under `NERVE_HOME`. Conversation entries are append-only JSONL with parent IDs and an active leaf; the active branch is reconstructed by following parents. Protocol sequenced events use dense per-stream JSONL logs with bounded retention. Ephemeral notifications are not persisted or replayed.

SQLite supports rebuildable search/index/cache behavior. Code should not turn it into a second authoritative source without changing the documented persistence model.

## Filesystem safety

Server state mutations use same-directory temporary files, sync/close, atomic replacement, bounded native-host retries, and per-process serialization. Directory cleanup skips symlinks. POSIX mode bits harden Unix files but are not a Windows ACL boundary.

## Secrets and authentication

A local token authorizes HTTP and WebSocket access. Browser bootstrap converts query token to a Strict HttpOnly cookie. Provider/tool secrets use encrypted storage and selective migration/re-encryption where possible.

Schemas reject secret-like protocol metadata keys, but a broad error/details schema is not itself a redaction guarantee. Host boundaries must sanitize logs/errors before public transmission.

## Migration

State marker versioning prevents automatic downgrade or malformed/future resets. A server-owned startup coordinator uses a sibling lock/journal, retains the complete legacy home, and imports only validated portable state through the migration ledger. Desktop supplies consent and presentation only; headless startup uses the same backup policy, and remote shell mode never touches local `NERVE_HOME` data.

## Electron boundary

Renderer sandboxing and narrow IPC reduce desktop attack surface. The renderer still intentionally talks to a powerful authenticated daemon; origin/token protection remains critical.

## Next steps

- [Protocol v1](/developers/protocol/)
- [Storage operations](/operations/storage-migration/)
