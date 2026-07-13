# Sandbox configuration

The daemon reads strict YAML from `NERVE_SANDBOX_AGENT_CONFIG` (default `/etc/nerve/sandbox.yaml`). The manager materializes and mounts this file read-only. The Zod schema in `packages/contracts/src/domains/sandbox/sandbox.config.schema.ts` is authoritative and rejects unknown fields and raw secrets.

Configuration covers controller endpoint/auth references/disconnect policy, model catalog and model selectors, Git/GitHub setup, tool groups and policy, skills/context, boot phases, storage, observability, and sandbox security. Sandbox identity, image, backend, labels, and resource limits are manager launch data rather than YAML.

Manager launch environment uses:

- `NERVE_SANDBOX_AGENT_SANDBOX_ID`
- `NERVE_SANDBOX_AGENT_INSTANCE_ID`
- `NERVE_SANDBOX_AGENT_STATE_DIR`
- `NERVE_SANDBOX_AGENT_WORKSPACE_DIR`
- `NERVE_SANDBOX_AGENT_CONFIG`

Credentials are referenced by secret/profile IDs and resolved into protected files or narrowly scoped process environments. Provider API keys, OAuth refresh values, SSH/GPG private material, and controller credentials must not appear inline in YAML, protocol data, or logs.

Project context is `AGENTS.md`; portable skills use `.agents/skills` and built-ins use read-only `/agent/skills`. Unsupported resource-path flags are not part of Sandbox v1.
