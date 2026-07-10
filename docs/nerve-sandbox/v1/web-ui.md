# Sandbox Manager Web UI

The sandbox-manager web UI is a dedicated Svelte app in `packages/sandbox-manager-ui` for managing and observing sandboxes through `packages/sandbox-manager`.

It is not the current local workbench with minor changes. It should reuse the same design language, shadcn-svelte primitives, theme tokens, protocol helpers, and event-stream patterns, but it has distinct navigation, state, and user workflows centered on sandbox lifecycle and fleet operations.

## Goals

The UI should let users:

- connect to a sandbox manager;
- view sandbox fleet status across Docker, Podman, Podman-on-WSL, and ECS/Fargate backends;
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

Current package organization:

```text
packages/sandbox-manager-ui/  # dedicated Svelte app: routes, manager API clients, state, components
packages/shared-ui/                  # shared shadcn-svelte primitives, theme/styles, generic display helpers
packages/web/                 # local workbench UI only; no sandbox-manager surface
packages/shared/              # transport-neutral protocol/schema types only
packages/sandbox-manager/     # manager API/service; serves the built UI when enabled
```

The sandbox-manager UI is always the sandbox manager app. `/` is the server/deployment landing path handled by `packages/sandbox-manager`, and `/settings` is the dedicated configuration route; neither is a runtime surface switch inside `packages/web`.

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
- runtime backend (`docker`, `podman`, `podman-wsl`, `ecs`);
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

Shows Docker/Podman driver status and ECS/Fargate status:

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

### Runtime backend status

The application titlebar shows the manager's effective runtime backend immediately before the Settings control, including its version or unavailable state. Detailed runtime information remains available in sandbox status views, including:

- Docker/Podman/Podman-on-WSL/ECS availability;
- backend-specific resource/security capabilities and limitations;
- container/task identity and lifecycle state;
- ECS cluster/network/EFS profile summaries where available.

## Frontend command model

The UI can issue commands only through the manager. Examples:

- create and run a sandbox from template/config with separate manager launch options for identity, image, labels, backend, memory, and vCPU/CPU units;
- start an existing stopped or failed sandbox;
- stop sandbox;
- remove sandbox/container;
- request sandbox status/snapshot;
- start/cancel/continue a run;
- submit input;
- resolve approval.

Manager-only lifecycle commands should have their own manager API methods. Sandbox-daemon commands should use the baseline command schemas in [Commands](./commands.md), with the manager acting as the authorized controller.

All mutating commands need idempotency keys. The UI SHOULD generate stable operation IDs for retries.

The composer MAY accept text while the sandbox is still starting, but dispatch MUST wait until lifecycle is `ready` or `degraded` and a controller session is connected. A first prompt from the create dialog is a UI/manager queue item, not sandbox YAML.

## Event model

The UI consumes:

- manager lifecycle events, including `container_created`, `container_started`, `daemon_connected`, `booting`, `ready/degraded`, stopped, failed, and removed;
- sandbox daemon events defined in [Event Schemas](./event-schemas.md), forwarded or materialized by the manager;
- protocol flow/replay/ack events.

The manager SHOULD provide snapshots that allow the UI to recover without replaying all history.

UI reducers MUST deduplicate durable events by event ID/sequence and MUST NOT advance processed cursors for transient-only updates.

## Design and styling requirements

The UI must follow the shared styling conventions:

- use official shadcn-svelte primitives from `@nervekit/shared-ui/components/ui/*`;
- import shared theme/base styles from `@nervekit/shared-ui/styles/app.css`;
- use Tailwind token utilities and theme tokens for colors, typography, spacing, radius, and shadows;
- use only approved semantic additions such as `success`, `warning`, and `info`;
- avoid hard-coded colors, font sizes, spacing, and one-off visual constants;
- use `@lucide/svelte` icons;
- use monospace only for code, logs, IDs, and paths;
- keep app-specific global CSS under `packages/sandbox-manager-ui/src/styles/`;
- avoid component `<style>` blocks except for documented escape hatches;
- validate important flows visually in light and dark mode.

The UI should feel related to the existing app, but it should optimize for fleet/lifecycle observability rather than a single local coding workbench.

## State separation

Sandbox-manager UI state SHOULD be separate from the current workbench state:

- separate API client configuration;
- separate event reducers for manager/sandbox fleet events;
- separate selected sandbox/run state;
- separate route/query params;
- no assumption of one local project/workspace;
- no direct dependency on desktop-only APIs.

Shared UI/display utilities come from `@nervekit/shared-ui`. Shared protocol schemas remain in `@nervekit/shared`; do not place Svelte components or browser CSS in `packages/shared`.

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
   - ECS profile display, including CloudWatch log and EFS limitations.

## Web UI conformance checklist

A first implementation SHOULD verify:

- UI connects only to manager endpoints;
- snapshots and event replay reconstruct dashboard state;
- raw secrets are absent from network payloads and rendered UI;
- disconnect countdown is visible when sandbox is reconnecting;
- boot timeline accurately reflects setup order;
- approval/input actions use manager-mediated commands;
- Docker/Podman limitations are visible;
- styling follows `packages/shared-ui` and `packages/sandbox-manager-ui` guardrails;
- light and dark mode remain readable.

## Implemented app (v1)

The implementation ships as `packages/sandbox-manager-ui`, a dedicated Svelte
app built independently from the local workbench. `packages/sandbox-manager`
serves it same-origin at `/` from, in order: an explicit
`NERVE_SANDBOX_MANAGER_WEB_DIST`, bundled `packages/sandbox-manager/dist/web`,
or workspace `packages/sandbox-manager-ui/dist`. The top-level `/settings`
route manages all LLM providers exposed by the installed `@earendil-works/pi-ai`
package, including subscription/OAuth providers, API-key providers, provider
`env`/endpoint overrides, Git/GitHub, Jira, Confluence, and web-search
credential profiles.

### Bootstrap

- `packages/sandbox-manager-ui/src/App.svelte` always renders the sandbox
  manager app; there is no workbench surface switch or service worker.
- `SandboxManagerProvider.svelte` creates a runes `SandboxManagerStore`
  (`state/sandbox-manager-state.svelte.ts`) and provides it via context.
- The workbench `packages/web` app, desktop bridge, shortcuts, and PWA setup are
  not mounted by the sandbox-manager UI.

### Clients

- REST: `api/manager-client.ts` wraps same-origin `/api/*` calls and unwraps
  `{ ok, data }`, validating status/snapshot/record responses with shared
  schemas.
- WebSocket: `api/manager-ws-client.svelte.ts` speaks the sandbox protocol
  frame format on `/api/manager/ws`, sends the shared `ui` hello, maintains
  per-stream cursors, requests replay on connect/gap, and coalesces acks.

### State and views

- `state/sandbox-event-reducers.ts`, `state/sandbox-snapshot-adapter.ts`, and
  `state/sandbox-status.ts` are pure/testable modules covered by unit tests.
- Views include dashboard, filtered fleet list, detail tabs (Overview, Chat,
  Boot/setup, Runtime/logs, Secrets/config, Events), create dialog, credential
  manager, transcript rendering, tool-call cards, and input/approval wait cards.

### Auth model

When the manager is configured with an API key, the default loopback static
handler issues an `HttpOnly` `nerve_sandbox_manager_auth` cookie so the browser
never stores the key in JavaScript. Remote deployments must front the manager
with an external authenticated proxy and may opt into
`NERVE_SANDBOX_MANAGER_UI_AUTH_COOKIE_MODE=trusted_proxy`, which issues the
cookie only for HTTPS requests from configured trusted proxy CIDRs and, when
configured, only when the trusted auth header is present.

## Running the UI

Dev (Vite against a running manager):

```sh
# terminal 1: sandbox manager
NERVE_SANDBOX_MANAGER_MODE=development node packages/sandbox-manager/dist/main.js

# terminal 2: sandbox-manager UI dev server proxied to the manager
NERVE_SANDBOX_MANAGER_API_TARGET=http://127.0.0.1:7869 \
  pnpm --filter @nervekit/sandbox-manager-ui dev
```

Production / static with explicit dist:

```sh
pnpm --filter @nervekit/sandbox-manager-ui build
NERVE_SANDBOX_MANAGER_WEB_DIST=packages/sandbox-manager-ui/dist \
  node packages/sandbox-manager/dist/main.js
```

Bundled production:

```sh
pnpm --filter @nervekit/sandbox-manager-ui build
pnpm --filter @nervekit/sandbox-manager build
node scripts/copy-sandbox-manager-ui-dist-to-manager.mjs
node packages/sandbox-manager/dist/main.js
```

Container build example:

```sh
pnpm --filter @nervekit/shared-ui build
pnpm --filter @nervekit/sandbox-manager-ui build
pnpm --filter @nervekit/sandbox-manager build
docker build -f packages/sandbox-manager/Dockerfile -t nerve-sandbox-manager:dev .
```

Set `NERVE_SANDBOX_MANAGER_SERVE_WEB_UI=0` to disable static serving. Set
`NERVE_SANDBOX_MANAGER_WEB_DIST` to override bundled/workspace UI assets. The
advanced create path accepts JSON (not YAML) in the first implementation to
keep the web bundle dependency-free.
