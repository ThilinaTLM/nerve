# Sandbox v1 implementation status

This implementation adds the non-UI Sandbox v1 foundations:

- shared sandbox config/command/event/state/manager schema tightening and stable canonical digest helpers;
- sandbox image state layout, single-writer lock, atomic JSON/JSONL stores, command idempotency, event outbox/ack persistence, redaction, preflight, health status, secrets, model catalog, boot/setup/skills/tool/agent skeletons, and protocol message primitives;
- Dockerfile hardening labels, non-root runtime, immutable `/agent`, and healthcheck against daemon state;
- sandbox manager service bootstrap with loopback-only default binding, file-first stores, HTTP APIs, file KV secrets, event ingestion/deduplication, Docker/Podman CLI drivers, launch-spec materialization, orphan discovery, and basic lifecycle/GC foundations.

Local smoke test outline:

```sh
pnpm --filter @nervekit/shared build
pnpm --filter @nervekit/agent build
pnpm --filter @nervekit/tools build
pnpm --filter @nervekit/sandbox-image build
pnpm --filter @nervekit/sandbox-manager build
NERVE_SANDBOX_MANAGER_API_KEY=dev pnpm --filter @nervekit/sandbox-manager dev
curl -H 'authorization: Bearer dev' http://127.0.0.1:7869/health
```

Docker/Podman operations report backend unavailability clearly when the CLI is missing.
