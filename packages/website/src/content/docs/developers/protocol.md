---
title: Nerve Protocol
description: Learn the typed RPC and recoverable event-stream protocol between workbench and server.
sidebar:
  order: 6
---

Nerve Protocol v1 connects the Workbench UI to `workbench_server` over authenticated HTTP and WebSocket. Contracts define transport-neutral operations/events; the protocol package implements sessions and recovery; the server provides authorization, persistence, handlers, and stream composition.

## Roles and catalogs

The schema reserves `workbench_server`, `ui`, `desktop_shell`, and `cli` roles so every strict envelope can name its source and target. The implemented product link today is the Workbench UI (`ui`) to `workbench_server`; the desktop shell manages daemon lifecycle outside that session, and there is no active CLI Protocol v1 client.

The operation catalog declares method schemas, roles, capabilities, idempotency, and transport exposure. The public event catalog declares payload, source roles, delivery class, and routing.

## Session and streams

After `hello → welcome → ready`, the client sends the complete desired stream/cursor set. Each stream independently becomes live, replays retained events, requests a snapshot, or is unavailable. Replay arrives before buffered live events.

A client advances a cursor only after its reducer successfully processes an event. If bounded buffers cannot preserve sequenced ordering, the session closes with `resync_required` and reconnect recovery rebuilds state.

:::note[No wire acknowledgement window]
Protocol v1 has no event-progress ACK message or flow-control window. Subscription cursors, bounded delivery, reconnect, replay, snapshots, and resync form the control plane.
:::

HTTP and WebSocket share typed handlers where operations expose both transports. Large files/logs, OAuth callbacks, binary transfer, and selected configuration remain HTTP or out-of-band.

## Follow one client flow

1. Start with the [message envelope](/developers/protocol/v1/message-envelope/) and [session lifecycle](/developers/protocol/v1/session-lifecycle/) to negotiate `hello → welcome → ready`.
2. Use the [HTTP mapping](/developers/protocol/v1/http-mapping/) for a typed request, or send the same catalog operation through WebSocket RPC when exposed there.
3. Install the complete desired stream set using [subscriptions and recovery](/developers/protocol/v1/subscription-and-recovery/); process [event batches](/developers/protocol/v1/event-stream/) before advancing each cursor.
4. On a gap or retention miss, apply the repository snapshot and resubscribe instead of inventing a second recovery path. The [examples](/developers/protocol/v1/examples/) show the messages together.

## Versioned reference

Read the [Protocol v1 reference](/developers/protocol/v1/) for envelopes, lifecycle, streams, HTTP mapping, errors/security, extension rules, examples, status, and coverage.

## Next steps

- [Extension model](/developers/extensions/)
- [Protocol v1 overview](/developers/protocol/v1/overview/)
