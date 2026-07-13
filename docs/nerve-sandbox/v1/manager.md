# Sandbox manager

The manager requires PostgreSQL through `NERVE_SANDBOX_MANAGER_DATABASE_URL` or `DATABASE_URL`. It runs migrations and stores sandboxes, sessions, events, idempotency, audit records, credentials/policies, pinned commands, and runtime-volume metadata. Its configured storage directory has marker `{ "format": "nerve-sandbox-manager-state", "version": 1 }` and contains backend files such as local volumes.

Runtime drivers support local Docker/Podman and ECS/Fargate. Local storage uses bind-mounted workspace/state/secrets/config paths. ECS uses AWS task control with EFS-backed volumes as configured; S3-files/EFS providers are explicit backend choices.

The manager owns stream `manager`. Every connected sandbox owns `sandbox:<sandboxId>`. The manager persists the sandbox's original sequence and rejects gaps or predecessor mismatches. UI snapshots include exact manager and selected-sandbox cursors.

Sandbox operations target `{ role: "sandbox_agent", id: sandboxId }`. The forwarding layer preserves method, params, idempotency key, timeout, and request lineage. Lifecycle operations target `sandbox_manager`.
