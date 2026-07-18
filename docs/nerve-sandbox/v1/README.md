# Nerve Sandbox v1

Sandbox v1 is implemented by three dedicated packages:

- `@nervekit/sandbox-manager`: authenticated API/protocol controller, lifecycle, storage, runtime drivers, secrets, and bundled static UI;
- `@nervekit/sandbox-manager-app`: browser workbench for manager and selected sandbox state;
- `@nervekit/sandbox-agent`: in-sandbox daemon, tools, tasks, runs, Git, persistent state, dense outbox, and checkpoints.

The manager UI and sandbox daemon use Nerve Protocol v1 shared sessions. Manager lifecycle events use stream `manager`; each sandbox writes `sandbox:<id>`. See [manager](manager.md), [control link](websocket-control.md), [persistence and recovery](persistence-and-recovery.md), [runtime image](runtime-image.md), and [web UI](web-ui.md).

Contracts and implementation are authoritative: `packages/contracts/src/domains/sandbox/`, `packages/sandbox-manager/`, and `packages/sandbox-agent/`.
