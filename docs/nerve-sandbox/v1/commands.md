# Sandbox operations

Sandbox operations are the catalog entries in `@nervekit/contracts` whose allowed target includes `sandbox_agent`. They cover recovery/status, conversations/interactions, runs, tools, files, Git/GitHub, tasks/logs, and pinned commands.

Every request is a normal Protocol v1 `request` targeted to `{ role: "sandbox_agent", id: sandboxId }`. The manager forwards typed params unchanged. Mutation idempotency follows the catalog; retries require a stable idempotency key. The daemon persists idempotent outcomes/conflicts under `/state` so reconnect or restart does not duplicate accepted mutations.

Run and task changes pass through transition-backed `RunCoordinator` and `TaskService` state. Cancellation terminates sandbox task process groups and reconciles durable task/run state. Large file and log bodies may use authenticated manager HTTP routes while control metadata remains catalog typed.

Use `allOperationDefinitions` rather than copying a method list into clients; unsupported methods, targets, aliases, and malformed params are rejected.
