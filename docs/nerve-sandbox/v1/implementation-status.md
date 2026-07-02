# Nerve Sandbox v1 non-UI implementation status

| Area | Status | Notes |
| --- | --- | --- |
| Shared protocol/state schemas | UI contract frozen for current tranche | `sandbox.status.get` and `sandbox.snapshot.get` now expose exported summary schemas/types for model, credential, secret-store, setup, network, tool group, conversation, agent, run, transcript, tool-call, wait, checkpoint, replay cursor, session, and manager staleness data. Fixtures cover connected, stale/disconnected, degraded/no-provider, active run, waits, and startup failure states with no secret-value scanning. |
| Startup pipeline | Complete for deterministic local daemon path | Entrypoint runs ordered config/state/preflight/model/secrets/setup/skills/boot/session/ready stages and maps documented exit codes. |
| Tool runtime policy | Complete for local adapter foundation | Sandbox adapter mediates `packages/tools`, enforces group/read-only/path/symlink/timeout/env/long-running policy, persists redacted tool records, and checkpoints approval waits. Unsupported external groups remain unavailable rather than unsafe stubs. |
| Agent run persistence | Partial UI-ready durability | Run state, transcript, cancel events, summaries, prompt fallback/rejection, and recovery reads are file-first under `/state/conversations`. Full provider streaming, durable input/approval resume, and explore subagent execution remain deeper runtime work. |
| Manager lifecycle APIs | UI-ready baseline | Create/start/stop/restart/delete/status/snapshot/logs/events/commands/session-latest routes exist. Public lifecycle responses redact controller tokens; disconnected status/snapshot return shared-schema manager-derived fallbacks with staleness/session/event metadata. |
| Manager secret policy/audit | Complete baseline | Per-sandbox KV policy is generated from config refs, daemon resolves require controller token, policy violations are rejected, and audit records redact key names/values. Encryption-at-rest hooks and recursive-auth hardening should remain part of future operational hardening. |
| Reconciliation/GC/orphans | Complete for fake-driver and runtime-driver flows | Reconciler updates observed state from inspections, self-exit 22 is surfaced as reconnecting, GC honors failed preservation, and orphan policy supports adopt/stop/remove/ignore. Startup/periodic wiring should be reviewed for production deployments. |
| Protocol recovery/flow control | Baseline complete | Command idempotency stores results/conflicts, manager command forwarding has bounded pending queues/timeouts, event replay/dedupe is durable, and close reasons are stored. Richer daemon-side backpressure and resume semantics remain a follow-up hardening area. |
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
