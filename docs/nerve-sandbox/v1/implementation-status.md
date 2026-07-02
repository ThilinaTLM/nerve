# Nerve Sandbox v1 non-UI implementation status

| Area | Status | Notes |
| --- | --- | --- |
| Shared protocol/state schemas | Complete for v1 foundation | Durable command/result, run, transcript, tool-call, wait, session, cursor schemas are exported from `packages/shared`; known protocol event payloads validate by type while unknown event types remain forward-compatible. |
| Startup pipeline | Complete for deterministic local daemon path | Entrypoint runs ordered config/state/preflight/model/secrets/setup/skills/boot/session/ready stages and maps documented exit codes. |
| Tool runtime policy | Complete for local adapter foundation | Sandbox adapter mediates `packages/tools`, enforces group/read-only/path/symlink/timeout/env/long-running policy, persists redacted tool records, and checkpoints approval waits. |
| Agent run persistence | Complete for durable v1 harness shell | Run state, transcript, cancel events, summaries, and recovery reads are file-first under `/state/conversations`. Model execution hooks are ready for deeper harness streaming integration. |
| Manager lifecycle APIs | Complete for v1 HTTP control plane | Create/start/stop/restart/delete/status/snapshot/logs/commands support materialized config, recorded runtime refs, idempotency, bounded/redacted logs, and disconnected fallbacks. |
| Manager secret policy/audit | Complete | Per-sandbox KV policy is generated from config refs, daemon resolves require controller token, policy violations are rejected, and audit records redact key names/values. |
| Reconciliation/GC/orphans | Complete for fake-driver and runtime-driver flows | Reconciler updates observed state from inspections, self-exit 22 is surfaced as reconnecting, GC honors failed preservation, and orphan policy supports adopt/stop/remove/ignore. |
| Protocol recovery/flow control | Complete for v1 baseline | Command idempotency stores results/conflicts, manager command forwarding has bounded pending queues/timeouts, event replay/dedupe is durable, and close reasons are stored. |
| Image build/smoke | Guarded | Dockerfile and smoke coverage detect Docker/Podman at runtime and skip clearly when unavailable. Full operator smoke requires a configured runtime image. |

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
