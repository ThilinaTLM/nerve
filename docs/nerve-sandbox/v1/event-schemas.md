# Sandbox event schemas

Sandbox event payloads and source-role permissions are defined in `packages/contracts/src/domains/sandbox/` and the shared public-event catalog.

Catalog delivery is authoritative:

- `sequenced` transition/state events enter the sandbox's dense outbox, receive a positive stream-local sequence, and are persisted by the manager without rewriting;
- `ephemeral` progress such as `run.delta`, `task.output`, usage, and activity uses unsequenced `event.notify` and never enters the outbox or advances a cursor.

Task output history is owned by the task log store and queried through task APIs; the notification is only a best-effort live signal.
