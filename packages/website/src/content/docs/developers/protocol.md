---
title: Nerve Protocol
description: Learn the typed RPC and recoverable event-stream protocol between workbench and server.
sidebar:
  order: 6
---

Nerve Protocol v1 connects the Workbench UI to `workbench_server` over authenticated HTTP and WebSocket. Contracts define transport-neutral operations/events; the protocol package implements sessions and recovery; the server provides authorization, persistence, handlers, and stream composition.

## Roles and catalogs

Roles are `workbench_server`, `ui`, `desktop_shell`, and `cli`. Strict envelopes name source/target. The operation catalog declares method schemas, roles, capabilities, idempotency, and transport exposure. The public event catalog declares payload, source roles, delivery class, and routing.

## Session and streams

After `hello → welcome → ready`, the client sends the complete desired stream/cursor set. Each stream independently becomes live, replays retained events, requests a snapshot, or is unavailable. Replay arrives before buffered live events.

A client advances a cursor only after its reducer successfully processes an event. If bounded buffers cannot preserve sequenced ordering, the session closes with `resync_required` and reconnect recovery rebuilds state.

:::note[No wire acknowledgement window]
Protocol v1 has no event-progress ACK message or flow-control window. Subscription cursors, bounded delivery, reconnect, replay, snapshots, and resync form the control plane.
:::

HTTP and WebSocket share typed handlers where operations expose both transports. Large files/logs, OAuth callbacks, binary transfer, and selected configuration remain HTTP or out-of-band.

## Versioned reference

Read the [Protocol v1 reference](/developers/protocol/v1/) for envelopes, lifecycle, streams, HTTP mapping, errors/security, extension rules, examples, status, and coverage.

## Next steps

- [Extension model](/developers/extensions/)
- [Protocol v1 overview](/developers/protocol/v1/overview/)
