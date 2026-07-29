---
title: Protocol v1 overview
sidebar:
  order: 2
---

## Roles and routing

Wire roles are `workbench_server`, `ui`, `desktop_shell`, and `cli`. A peer is `{ role, id?, name?, instanceId? }`; every message has explicit `source` and `target`.

The operation catalog declares the allowed target roles for every method. The workbench server validates the catalog method, parameters, target, idempotency key, timeout, and lineage before dispatch.

## Link and streams

| Link                  | Client                | Server                          | Sequenced streams                                     |
| --------------------- | --------------------- | ------------------------------- | ----------------------------------------------------- |
| workbench UI → server | shared client session | workbench shared server session | `workspace`, selected `conv/<conversationId>` streams |

Each stream has one sequence owner and a dense positive sequence. Only sequenced events enter stream logs. Ephemeral events use `event.notify`, have no sequence, and never change a cursor.

## Guarantees

- strict version-1 envelopes and message-specific schemas;
- catalog-authoritative RPC/event parsing and target-role checks;
- hello/welcome/ready negotiation and bounded heartbeats;
- exact-set stream subscriptions as the only replay/resume mechanism;
- per-stream replay before buffered live delivery;
- snapshot recovery when a cursor is ahead or older than retention;
- reducer completion before cursor advancement;
- bounded outgoing buffers; unsafe overflow closes with `resync_required`;
- operation-catalog idempotency and retry restrictions;
- the same typed handlers for HTTP and WebSocket where both are exposed.

Configuration, secrets, OAuth callbacks, binary transfer, and large file/log bodies remain intentional HTTP or out-of-band surfaces.
