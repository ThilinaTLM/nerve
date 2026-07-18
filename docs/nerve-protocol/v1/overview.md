# Protocol v1 overview

## Roles and routing

Wire roles are `workbench_server`, `ui`, `desktop_shell`, `cli`, `sandbox_manager`, and `sandbox_agent`. A peer is `{ role, id?, name?, instanceId? }`; every message has explicit `source` and `target`.

Manager UI requests for a sandbox target `{ role: "sandbox_agent", id: sandboxId }`. The manager forwards the catalog method, parsed params, idempotency key, timeout, and lineage without renaming the operation.

## Links and streams

| Link                     | Client                | Server                          | Sequenced streams                                     |
| ------------------------ | --------------------- | ------------------------------- | ----------------------------------------------------- |
| workbench UI → server    | shared client session | workbench shared server session | `workspace`, selected `conv/<conversationId>` streams |
| manager UI → manager     | shared client session | manager shared server session   | `manager`, selected `sandbox:<id>`                    |
| sandbox daemon → manager | shared client session | manager agent endpoint          | the daemon's `sandbox:<id>`                           |

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
