# Nerve Sandbox v1

Status: **proposed specification**

Scope: Docker/container runtime contract for a configurable, reproducible Nerve agent sandbox, plus the baseline sandbox manager and web UI surfaces used to operate it.

Nerve Sandbox v1 defines how to package and run the Nerve agent harness as an isolated sandbox daemon. The sandbox is configured by a YAML spec, connects to a sandbox controller over WebSocket, emits durable events, accepts steering commands, and persists enough local state to resume multiple conversations, agents, subagents, and runs after restarts, errors, completion, or human-input waits.

Baseline implementation is split into `packages/sandbox-agent` for the containerized daemon/runtime, `packages/sandbox-manager` for container lifecycle, built-in key-value secrets, protocol APIs, web-asset serving, and garbage collection, `packages/sandbox-manager-ui` for the dedicated manager UI, and `packages/shared-ui` for shared Svelte UI primitives/styles. Docker and Podman are the initial manager backends; AWS ECS is a planned backend extension.

The sandbox does **not** require the current Nerve orchestrator or current local Web UI. Those components may later act as one possible controller/UI, but the v1 sandbox is intended as a standalone platform building block.

## Reading order

1. [Overview](./overview.md) — goals, non-goals, topology, terminology, invariants.
2. [Manager](./manager.md) — sandbox-manager responsibilities, Docker/Podman drivers, built-in KV secrets, lifecycle, and GC.
3. [Configuration](./configuration.md) — canonical YAML input spec and validation rules.
4. [Boot Sequence](./boot-sequence.md) — startup order, startup-critical secrets, Git/GitHub setup, custom boot phases, degraded behavior.
5. [Runtime Image](./runtime-image.md) — Docker/container image, mounts, entrypoint, health, and lifecycle contract.
6. [WebSocket Control](./websocket-control.md) — controller connection profile, replay, ack behavior, and links to command/event schemas.
7. [Commands](./commands.md) — sandbox command parameter/result schemas and idempotency rules.
8. [Event Schemas](./event-schemas.md) — concrete sandbox event payload schemas.
9. [Durability](./durability.md) — `/state` layout, journals, checkpoints, snapshots, credential refresh, secret-store status, and recovery.
10. [Tools](./tools.md) — tool groups, policy, secrets, approvals, Git/GitHub command policy, skills, and explore-agent behavior.
11. [Security](./security.md) — trust model, filesystem, network/firewall, process, package registries, credentials, secret stores, and secret handling.
12. [Customization](./customization.md) — reproducible derived images, runtime config, built-in skills, boot phases, Git/GitHub setup, and upgrades.
13. [Web UI](./web-ui.md) — dedicated sandbox-manager UI app in `packages/sandbox-manager-ui`.
14. [Examples](./examples.md) — YAML, manager, Docker/Podman, WebSocket frames, events, and recovery flows.
15. [Implementation Guide](./implementation-guide.md) — non-normative implementation phases and conformance checks.

## Relationship to Nerve Protocol v1

Sandbox v1 reuses [Nerve Protocol v1](../../nerve-protocol/v1/README.md) for the message envelope, session lifecycle, event batches, acknowledgements, replay, flow control, request/response messages, and errors.

Sandbox v1 adds a **profile** on top of that protocol:

- peer role `agent` for the sandbox daemon;
- a **sandbox controller** peer, normally `packages/sandbox-manager`, that receives sandbox events and sends commands;
- sandbox-specific capabilities such as `sandbox.runtime.v1`, `sandbox.commands.v1`, `sandbox.secret_stores.v1`, `sandbox.git_config.v1`, `sandbox.github_config.v1`, and `sandbox.skills.v1`;
- sandbox command methods such as `sandbox.run.start` and `sandbox.input.submit`, defined in [Commands](./commands.md);
- sandbox event families such as `sandbox.ready`, `sandbox.config.loaded`, `sandbox.credentials.refreshed`, `sandbox.skills.loaded`, `run.checkpointed`, and `tool.call.completed`, defined in [Event Schemas](./event-schemas.md);
- container runtime, filesystem, durability, credential refresh, key-value secret resolution, Git/GitHub startup setup, tool-group, and security requirements.

When mapped onto the existing `PeerDescriptor` type, the controller SHOULD use role `orchestrator`, because it owns command intake, policy decisions, durable event ingestion, and replay for the sandbox session. This does not imply the controller is the current local Nerve orchestrator implementation.

## Manager-owned authentication model

A sandbox manager/controller authenticates users and external services, then provides the sandbox with validated YAML, secret references, mounted credential files, optional key-value secret endpoints, and repository inputs. The baseline manager also manages Docker/Podman containers, exposes a built-in KV secret API, exposes protocol-compatible HTTP/WebSocket APIs to frontend clients, and garbage-collects stopped/orphaned containers. The sandbox does **not** perform interactive login flows.

The sandbox MAY refresh already-provided OAuth credential bundles for model/tool/secret-store providers, such as `openai-codex` and Anthropic subscription credentials, when the YAML explicitly supplies refresh material. Refreshed credentials remain secret and are persisted only in protected state or an explicitly configured credential file.

Controller WebSocket authentication remains API-key based in baseline v1. OAuth for the controller transport is not part of baseline v1.

## Normative language

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** are used as normative terms. Sections explicitly labeled as implementation guidance are recommendations rather than conformance requirements.

## Sandbox summary

A conforming v1 sandbox:

- loads a YAML config with `version: 1`;
- runs the agent runtime from an immutable `/agent` path;
- provides `/workspace` as the working directory visible to tools;
- uses `AGENTS.md` context files and `/workspace/.agents/skills` project skills by default;
- uses `/state` for durable journals, checkpoints, transcripts, refreshed credentials, secret-store cache/status, Git/GitHub setup status, and skills metadata;
- treats `/tmp` as writable non-durable scratch space;
- can load built-in skills from `/agent/skills` and configured `SKILL.md` search paths;
- resolves secrets lazily from env vars, files, or configured key-value secret stores;
- connects to the configured controller WebSocket with API-key authentication;
- exchanges only Nerve Protocol v1 JSON messages after handshake;
- journals accepted commands before execution;
- writes outgoing durable events before attempting delivery;
- checkpoints every terminal, waiting, and error state;
- supports multiple conversations, agents, subagents, and runs in durable filesystem semantics;
- supports pi-ai-compatible model/provider configuration through `modelCatalog`, with `agent.defaultModel`/`agent.defaultExploreModel` as provider/model/thinking selectors;
- applies top-level Git/GitHub identity, signing, credentials, CLI/API auth, remotes, and optional clone before custom boot phases;
- organizes model-callable tools by group, including web, Jira, Confluence, shell, Python, tasks, plan mode, todos, filesystem, and explore groups;
- supports manager-provided package registry access through boot/tool policy, network/firewall allowlists, protected cache paths, and secret refs;
- exits itself after the configured controller disconnect grace period, 5 minutes by default, so the manager can garbage-collect it;
- enforces tool, filesystem, network, process, credential, and secret policy in the sandbox daemon and container runtime.

## Implementation readiness scope

This specification is ready to guide an initial implementation with:

- one sandbox daemon per sandbox container in `packages/sandbox-agent`;
- a sandbox manager in `packages/sandbox-manager` with Docker/Podman container drivers, built-in KV secrets, protocol API/WS, and container GC;
- a separate sandbox-manager web UI app in `packages/sandbox-manager-ui` using shared primitives from `packages/shared-ui`;
- durable state semantics for multiple conversations, agents, subagents, and runs;
- one writable workspace mount;
- one durable state volume;
- API-key WebSocket authentication;
- model selection backed by pi-ai provider semantics and `modelCatalog`;
- model OAuth credential refresh for already-provided `openai-codex` and Anthropic subscription credential bundles;
- secret resolution from env, file, and HTTP key-value stores;
- top-level Git/GitHub startup setup;
- model-callable tool-group configuration for filesystem, shell, Python, web, Jira, Confluence, tasks, plan mode, todos, and explore;
- manager-provided tool credentials via secret refs or protected files;
- `AGENTS.md`, `.agents/skills`, and built-in `SKILL.md` support;
- boot-time repository/dependency setup controlled by network/firewall policy;
- durable command/event journals;
- checkpoint and resume behavior;
- strict default security posture with a non-root production runtime.

Future versions may add richer firewall backends, binary attachments, stronger conformance test suites, OAuth for the controller transport, and an AWS ECS manager backend. Baseline v1 already covers consuming and refreshing provider/tool/secret-store OAuth credentials that are supplied by the manager.
