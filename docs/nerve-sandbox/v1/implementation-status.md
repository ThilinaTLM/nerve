# Sandbox implementation status and resets

Sandbox v1 manager, browser app, daemon, shared host services, protocol sessions, storage, runtime drivers, and images are implemented. Local Docker/Podman and ECS/Fargate drivers are supported according to configured infrastructure. Manager operation requires PostgreSQL; local volume paths or AWS EFS/S3-files depend on the chosen backend.

## Exact state versions

- Workbench: `<NERVE_HOME>/VERSION`, format `nerve-workbench-state`, version 2.
- Sandbox daemon: `/state/VERSION`, format `nerve-sandbox-agent-state`, version 4.
- Sandbox manager storage directory: `VERSION`, format `nerve-sandbox-manager-state`, version 1; PostgreSQL must match the same deployment reset.
- Manager browser cursor record: `nerve.protocol.v1.sandbox-manager-ui`, epoch `protocol-v1`.
- Shared browser IDs: local storage `nerve.protocol.clientId`; session storage `nerve.protocol.instanceId`.

Incompatible stores fail with deterministic instructions:

- `Incompatible Nerve state at <path>. Reset this directory before starting Nerve Protocol v1.`
- `Incompatible sandbox agent state at <path>. Reset this directory before starting Nerve Protocol v1.`
- `Incompatible sandbox manager state at <path>. Reset this directory before starting Nerve Protocol v1.`

Stop processes first. Reset the whole affected workbench home, sandbox `/state`, or both manager storage directory and PostgreSQL database. Clear browser site local/session storage. Partial deletion and migration are not supported.
