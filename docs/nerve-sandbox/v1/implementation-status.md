# Nerve Sandbox v1 non-UI implementation status

| Area | Status | Notes |
| --- | --- | --- |
| Shared protocol/state schemas | UI contract frozen for current tranche | `sandbox.status.get` and `sandbox.snapshot.get` now expose exported summary schemas/types for model, credential, secret-store, setup, network, tool group, conversation, agent, run, transcript, tool-call, wait, checkpoint, replay cursor, session, and manager staleness data. Fixtures cover connected, stale/disconnected, degraded/no-provider, active run, waits, and startup failure states with no secret-value scanning. |
| Startup pipeline | Complete for deterministic local daemon path | Entrypoint runs ordered config/state/preflight/model/secrets/setup/skills/boot/session/ready stages and maps documented exit codes. |
| Tool runtime policy | Complete for local adapter foundation | Sandbox adapter mediates `packages/tools`, enforces group/read-only/path/symlink/timeout/env/long-running policy, persists redacted tool records, and checkpoints approval waits. Unsupported external groups remain unavailable rather than unsafe stubs. |
| Agent run persistence and live harness streaming | Foundation live path implemented | The sandbox daemon now creates deterministic `AgentHarness` JSONL conversations under `/state/conversations/<conversation>/agents/<agent>/conversation.jsonl`, starts real harness turns asynchronously, streams transient `run.delta` events, persists transcript/terminal events, rejects unavailable credentials before launch, and keeps command acceptance write-ahead. Input/approval waits now suspend with provider tool-call IDs and can be continued after durable resolution; broader recovery/explore/integration coverage remains an active hardening area. |
| Manager lifecycle APIs | PostgreSQL-backed baseline | Create/start/stop/restart/delete/status/snapshot/logs/events/commands/session-latest routes exist. Manager records, events, sessions, idempotency, secret policies, encrypted secrets, runtime volume refs, and credential profiles are now PostgreSQL-backed; runtime files/volumes remain backend-specific execution artifacts. Public lifecycle responses redact controller tokens; disconnected status/snapshot return shared-schema manager-derived fallbacks with staleness/session/event metadata. |
| Manager secret policy/audit | PostgreSQL encrypted baseline | Per-sandbox KV policy is generated from config refs, daemon resolves require controller token, policy violations are rejected, and audit records redact key names/values. Manager secret values are encrypted at the application layer before PostgreSQL storage; development cleartext requires explicit opt-in. Recursive-auth hardening remains part of future operational hardening. |
| Reconciliation/GC/orphans | Complete for fake-driver and runtime-driver flows | Reconciler updates observed state from inspections, self-exit 22 is surfaced as reconnecting, GC honors failed preservation, and orphan policy supports adopt/stop/remove/ignore. Startup/periodic wiring should be reviewed for production deployments. |
| Protocol recovery/flow control | Baseline complete | Command idempotency stores results/conflicts, manager command forwarding has bounded pending queues/timeouts, event replay/dedupe is durable, and close reasons are stored. `run.delta` is transient; transcript, wait, tool lifecycle, checkpoint, and terminal events are durable replay inputs. Richer daemon-side backpressure remains a follow-up hardening area. |
| Sandbox manager web UI | Credential/profile surface added | `/sandbox-manager` renders as a separate same-origin surface in `packages/web` (dynamic-imported chunk, its own runes store/provider). Ships fleet dashboard + filters/search, lifecycle controls with idempotency keys and destructive confirmation, a create dialog (form + advanced JSON, controller omitted/manager-owned) with credential profile selectors, a manager credential dialog for encrypted secrets and reusable auth profiles, detail tabs (overview/boot/runtime-logs/secrets/events), and a manager-mediated chat surface (durable transcript + live deltas, tool cards, input/approval waits, run cancel). REST/WS clients validate with shared schemas and connect only to the manager. Loopback `HttpOnly` cookie auth issued by the manager static handler; remote auth stays external/proxy-backed. Advanced create input is JSON (not YAML) to keep the web bundle dependency-free. |
| Image build/smoke | Guarded | Dockerfile and smoke coverage detect Docker/Podman at runtime and skip clearly when unavailable. Full operator smoke requires a configured runtime image. |

## Stable UI-facing manager endpoints

```text
GET    /api/sandboxes
POST   /api/sandboxes
GET    /api/sandboxes/:sandboxId
POST   /api/sandboxes/:sandboxId/start
POST   /api/sandboxes/:sandboxId/stop
POST   /api/sandboxes/:sandboxId/restart
DELETE /api/sandboxes/:sandboxId
GET    /api/sandboxes/:sandboxId/status
GET    /api/sandboxes/:sandboxId/snapshot
GET    /api/sandboxes/:sandboxId/logs
GET    /api/sandboxes/:sandboxId/events
POST   /api/sandboxes/:sandboxId/commands
GET    /api/sandboxes/:sandboxId/sessions/latest
```

Status/snapshot payloads should be parsed with `sandboxStatusGetResultSchema` and `sandboxSnapshotResultSchema` from `@nervekit/shared`. Public manager responses must not expose raw controller tokens, credential values, provider keys, secret values, or unbounded logs.

## Operational commands

```sh
pnpm --filter @nervekit/shared check
pnpm --filter @nervekit/sandbox-image check
pnpm --filter @nervekit/sandbox-manager check
pnpm --filter @nervekit/shared test
pnpm --filter @nervekit/sandbox-image test
pnpm --filter @nervekit/sandbox-manager test
pnpm lint
pnpm check
pnpm test
```

Container smoke tests are guarded and run as part of the sandbox-manager test suite; they skip with a clear message when neither Docker nor Podman is reachable.
