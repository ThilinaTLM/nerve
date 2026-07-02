# Sandbox Manager Web UI

The sandbox-manager web UI is a new frontend surface in `packages/web` for managing and observing sandboxes through `packages/sandbox-manager`.

It is not the current local workbench with minor changes. It should reuse the same design language, shadcn-svelte primitives, theme tokens, protocol helpers, and event-stream patterns, but it has distinct navigation, state, and user workflows centered on sandbox lifecycle and fleet operations.

## Goals

The UI should let users:

- connect to a sandbox manager;
- view sandbox fleet status across Docker/Podman backends and future ECS backends;
- create/start/stop/remove sandboxes according to manager policy;
- inspect sanitized configs, image/runtime metadata, workspace/state volume refs, and backend limitations;
- view setup and boot timelines;
- observe conversations, runs, events, transcripts, tool calls, approvals, and pending input;
- resolve approvals and submit input through manager-mediated commands;
- inspect key-value secret references and status without seeing secret values;
- monitor manager health, runtime driver health, logs, reconnect/self-exit state, and garbage collection.

## Non-goals

The web UI MUST NOT:

- connect directly to sandbox containers for control;
- receive raw secrets, provider tokens, private keys, or protected credential files;
- execute tools directly;
- bypass sandbox manager authorization;
- assume Docker-only semantics in user-facing state models;
- reuse local workbench state stores in a way that couples unrelated lifecycle concerns.

## Package boundary

Recommended package organization:

```text
packages/web/src/lib/sandbox-manager/
  api/
    manager-client.ts
    manager-events.ts
    snapshots.ts
  state/
    sandbox-manager-store.svelte.ts
    sandbox-detail-store.svelte.ts
    runtime-backend-store.svelte.ts
  routes-or-views/
    SandboxManagerShell.svelte
    SandboxDashboard.svelte
    SandboxDetail.svelte
    SandboxRuns.svelte
    SandboxBootTimeline.svelte
    SandboxRuntime.svelte
    SandboxSecrets.svelte
    SandboxSettings.svelte
  components/
    SandboxStatusBadge.svelte
    RuntimeBackendBadge.svelte
    BootPhaseTimeline.svelte
    SecretRefTable.svelte
    EventStreamPanel.svelte
    SandboxActionMenu.svelte
```

Actual routing may follow the app's router architecture, but the sandbox-manager UI should remain a clearly separated module/surface.

## Manager connection model

The UI connects to the sandbox manager, not to sandbox containers.

Baseline client flow:

1. Authenticate to the manager using product-level auth.
2. Load manager status and sandbox list via HTTP snapshot/resource endpoints or protocol request/response.
3. Open a Nerve Protocol v1 WebSocket to the manager.
4. Send `hello` with role `ui` and sandbox-manager UI capabilities.
5. Receive `welcome`, then `ready`.
6. Apply manager/sandbox event batches.
7. Acknowledge processed durable cursors.
8. Request snapshots or replay when gaps are detected.

The UI SHOULD use shared protocol helpers where possible. Snapshot cursors and processed event cursors MUST follow Nerve Protocol v1 semantics.

## Suggested capabilities

```json
[
  "encoding.json",
  "event.batch",
  "event.replay",
  "event.ack.processed",
  "flow.backpressure",
  "sandbox.manager.ui.v1",
  "sandbox.manager.snapshots.v1",
  "sandbox.manager.lifecycle.v1"
]
```

If the manager multiplexes sandbox streams, it SHOULD negotiate a stream capability and expose streams such as `sandbox:<sandboxId>`.

## Information architecture

### Dashboard

Shows all known sandboxes:

- name/ID;
- desired and observed state;
- runtime backend (`docker`, `podman`, future `ecs`);
- image reference/digest;
- daemon status (`ready`, `running`, `degraded`, `failed`, `reconnecting`);
- active run count;
- pending approval/input count;
- disconnect self-exit countdown if reconnecting;
- GC/retention status.

### Sandbox detail

Shows one sandbox:

- identity and labels;
- manager record;
- sanitized config digest and effective config summary;
- image/runtime metadata;
- workspace/state/secret volume refs;
- controller connectivity;
- healthcheck summary;
- lifecycle controls allowed by authorization.

### Boot/setup timeline

Shows startup in chronological order:

1. config validation;
2. protected state initialization;
3. secret resolver and secret-store checks;
4. Git setup;
5. GitHub setup;
6. context/skills loading;
7. custom YAML boot phases;
8. controller connection;
9. ready/degraded/failed status.

The timeline MUST show redacted summaries only. Boot logs are bounded and redacted.

### Runs and conversations

Shows durable run state:

- conversations/agents/runs;
- transcript entries;
- tool-call lifecycle;
- checkpoints;
- waiting-for-input prompts;
- waiting-for-approval requests;
- terminal state and failure summaries.

Approval and input actions are sent through manager-mediated protocol commands.

### Runtime/backend

Shows Docker/Podman driver status and future ECS status:

- runtime availability and version;
- enforcement capabilities/limitations;
- container/task ID;
- resource usage where available;
- logs with redaction and bounds;
- stop/kill/remove state;
- orphan/GC status.

### Secrets/KV references

Shows only safe metadata:

- configured secret-store IDs;
- key reference names only when policy permits;
- hashed/redacted key names otherwise;
- cache status;
- last checked time;
- availability errors without values.

The UI MUST never display raw secret values.

### Settings/backend configuration

Shows manager-level runtime backend configuration:

- Docker/Podman availability;
- default image references;
- default resource/security profiles;
- retention defaults;
- future ECS profile placeholders.

## Frontend command model

The UI can issue commands only through the manager. Examples:

- create sandbox from template/config;
- start sandbox;
- stop sandbox;
- remove sandbox/container;
- request sandbox status/snapshot;
- start/cancel/continue a run;
- submit input;
- resolve approval.

Manager-only lifecycle commands should have their own manager API methods. Sandbox-daemon commands should use the baseline command schemas in [Commands](./commands.md), with the manager acting as the authorized controller.

All mutating commands need idempotency keys. The UI SHOULD generate stable operation IDs for retries.

## Event model

The UI consumes:

- manager lifecycle events, such as sandbox created/started/stopped/removed/gc-scheduled;
- sandbox daemon events defined in [Event Schemas](./event-schemas.md), forwarded or materialized by the manager;
- protocol flow/replay/ack events.

The manager SHOULD provide snapshots that allow the UI to recover without replaying all history.

UI reducers MUST deduplicate durable events by event ID/sequence and MUST NOT advance processed cursors for transient-only updates.

## Design and styling requirements

The UI must follow `packages/web/AGENTS.md`:

- use official shadcn-svelte components from `packages/web/src/lib/components/ui`;
- use Tailwind token utilities and theme tokens for colors, typography, spacing, radius, and shadows;
- use only approved semantic additions such as `success`, `warning`, and `info`;
- avoid hard-coded colors, font sizes, spacing, and one-off visual constants;
- use `@lucide/svelte` icons;
- use monospace only for code, logs, IDs, and paths;
- keep global CSS under `packages/web/src/styles/`;
- avoid component `<style>` blocks except for documented escape hatches;
- validate important flows visually in light and dark mode when implementation begins.

The UI should feel related to the existing app, but it should optimize for fleet/lifecycle observability rather than a single local coding workbench.

## State separation

Sandbox-manager UI state SHOULD be separate from the current workbench state:

- separate API client configuration;
- separate event reducers for manager/sandbox fleet events;
- separate selected sandbox/run state;
- separate route/query params;
- no assumption of one local project/workspace;
- no direct dependency on desktop-only APIs.

Shared utilities may be reused for protocol messages, event streams, markdown/plain text, terminal/log rendering, time formatting, and status utilities.

## Security requirements

- The UI MUST assume all logs, tool outputs, workspace content, and transcripts are untrusted.
- Rendered markdown/log output must use existing safe rendering patterns.
- Raw secrets MUST never be requested, stored, rendered, copied, or exported.
- Protected paths under `/state/credentials`, `/state/cache/secrets`, `/secrets`, and `/credentials` MUST not be browsable through UI file views.
- Mutating actions MUST show clear risk and confirmation where manager policy requires it.
- Approval UI must show normalized args and risk categories, not raw unbounded tool input.

## Initial UI milestones

1. **Read-only dashboard**
   - connect to manager;
   - list sandboxes;
   - show status, backend, image, health, and disconnect countdown.

2. **Sandbox detail and boot timeline**
   - load snapshot;
   - show setup/boot phases and redacted logs.

3. **Runs/events view**
   - stream events;
   - show transcript/tool lifecycle;
   - recover via replay/snapshot.

4. **Lifecycle actions**
   - start/stop/remove sandbox through manager commands;
   - show idempotent operation state.

5. **Human-in-the-loop actions**
   - resolve approvals;
   - submit input;
   - continue/cancel runs.

6. **Backend/settings view**
   - Docker/Podman health;
   - runtime limitations;
   - future ECS profile display.

## Web UI conformance checklist

A first implementation SHOULD verify:

- UI connects only to manager endpoints;
- snapshots and event replay reconstruct dashboard state;
- raw secrets are absent from network payloads and rendered UI;
- disconnect countdown is visible when sandbox is reconnecting;
- boot timeline accurately reflects setup order;
- approval/input actions use manager-mediated commands;
- Docker/Podman limitations are visible;
- styling follows `packages/web/AGENTS.md` guardrails;
- light and dark mode remain readable.
