# Protocol v1 overview

## Roles and routing

Wire roles are exactly:

- `workbench_server`
- `ui`
- `desktop_shell`
- `cli`
- `sandbox_manager`
- `sandbox_agent`

A peer is `{ role, id?, name?, instanceId? }`. Every message has explicit `source` and `target`. Manager UI requests for a sandbox target `{ role: "sandbox_agent", id: sandboxId }`. The manager forwards the catalog method, parsed params, idempotency key, timeout, and correlation/causation/trace lineage without renaming the method or params.

## Links and streams

| Link                     | Client lifecycle                                     | Server lifecycle                                      | Durable streams                         |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| workbench UI → server    | `ProtocolClientConnection` + `ProtocolClientSession` | shared server session composed by workbench server    | `local`                                 |
| manager UI → manager     | same shared client                                   | `ManagerUiSharedSession` over shared server lifecycle | `manager`, plus selected `sandbox:<id>` |
| sandbox daemon → manager | shared client session in sandbox agent               | shared server session in manager                      | `sandbox:<id>`                          |

The stream writer is unique: workbench server writes `local`; manager lifecycle writes `manager`; a sandbox daemon writes its own `sandbox:<id>`. Forwarding preserves the sandbox event sequence.

## Guarantees

- strict version-1 envelopes and strict message-specific schemas;
- catalog-authoritative operation/event parsing and target-role checks;
- hello/welcome/ready negotiation and bounded heartbeats;
- idempotency policy from the operation catalog; mutation retries require an idempotency key;
- ACK of durable progress only after reducer/durable application;
- replay with live buffering, snapshot recovery, and atomic cursor installation;
- bounded queues: transient data may coalesce/drop, while durable overflow closes rather than losing accepted state;
- the same typed operation handlers for HTTP and WebSocket where an operation is exposed over both.

Bootstrap configuration, secrets, OAuth callbacks/tokens, binary upload/download, and large file/log bodies remain intentional REST or out-of-band surfaces.
