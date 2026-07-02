# Nerve Sandbox v1

Status: **proposed specification**

Scope: Docker/container runtime contract for a configurable, reproducible Nerve agent sandbox that can be driven by external APIs, UIs, CLIs, or schedulers.

Nerve Sandbox v1 defines how to package and run the Nerve agent harness as an isolated sandbox daemon. The sandbox is configured by a YAML spec, connects to a sandbox controller over WebSocket, emits durable events, accepts steering commands, and persists enough local state to resume multiple conversations, agents, subagents, and runs after restarts, errors, completion, or human-input waits.

The sandbox does **not** require the current Nerve orchestrator or Web UI. Those components may later act as one possible controller/UI, but the v1 sandbox is intended as a standalone platform building block.

## Reading order

1. [Overview](./overview.md) — goals, non-goals, topology, terminology, invariants.
2. [Configuration](./configuration.md) — canonical YAML input spec and validation rules.
3. [Runtime Image](./runtime-image.md) — Docker/container image, mounts, entrypoint, health, and lifecycle contract.
4. [WebSocket Control](./websocket-control.md) — controller connection profile, commands, events, replay, and ack behavior.
5. [Durability](./durability.md) — `/state` layout, journals, checkpoints, snapshots, credential refresh, secret-store status, and recovery.
6. [Tools](./tools.md) — tool groups, policy, secrets, approvals, Git/GitHub command policy, skills, and explore-agent behavior.
7. [Security](./security.md) — trust model, filesystem, network/firewall, process, package registries, credentials, secret stores, and secret handling.
8. [Customization](./customization.md) — reproducible derived images, runtime config, built-in skills, boot scripts, Git/GitHub setup, and upgrades.
9. [Examples](./examples.md) — YAML, `docker run`, WebSocket frames, events, and recovery flows.
10. [Implementation Guide](./implementation-guide.md) — non-normative implementation phases and conformance checks.

## Relationship to Nerve Protocol v1

Sandbox v1 reuses [Nerve Protocol v1](../../nerve-protocol/v1/README.md) for the message envelope, session lifecycle, event batches, acknowledgements, replay, flow control, request/response messages, and errors.

Sandbox v1 adds a **profile** on top of that protocol:

- peer role `agent` for the sandbox daemon;
- a **sandbox controller** peer that receives sandbox events and sends commands;
- sandbox-specific capabilities such as `sandbox.runtime.v1`, `sandbox.commands.v1`, `sandbox.secret_stores.v1`, `sandbox.git_config.v1`, `sandbox.github_config.v1`, and `sandbox.skills.v1`;
- sandbox command methods such as `sandbox.run.start` and `sandbox.input.submit`;
- sandbox event families such as `sandbox.ready`, `sandbox.config.loaded`, `sandbox.credentials.refreshed`, `sandbox.skills.loaded`, `run.checkpointed`, and `tool.call.completed`;
- container runtime, filesystem, durability, credential refresh, key-value secret resolution, Git/GitHub startup setup, tool-group, and security requirements.

When mapped onto the existing `PeerDescriptor` type, the controller SHOULD use role `orchestrator`, because it owns command intake, policy decisions, durable event ingestion, and replay for the sandbox session. This does not imply the controller is the current local Nerve orchestrator implementation.

## Manager-owned authentication model

A sandbox manager/controller authenticates users and external services, then provides the sandbox with validated YAML, secret references, mounted credential files, optional key-value secret endpoints, and repository inputs. The sandbox does **not** perform interactive login flows.

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
- supports pi-ai-compatible model/provider configuration through `modelCatalog`, with `agent.mainModel`/`agent.exploreModel` as provider/model/thinking selectors;
- applies top-level Git/GitHub identity, signing, credentials, CLI/API auth, remotes, and optional clone before boot phases;
- organizes model-callable tools by group, including web, Jira, Confluence, shell, Python, tasks, plan mode, todos, filesystem, and explore groups;
- supports manager-provided package registry access through boot/tool policy, network/firewall allowlists, protected cache paths, and secret refs;
- enforces tool, filesystem, network, process, credential, and secret policy in the sandbox daemon and container runtime.

## Implementation readiness scope

This specification is ready to guide an initial sandbox implementation with:

- one sandbox daemon per sandbox container;
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

Future versions may add controller-side scheduling, richer firewall backends, binary attachments, stronger conformance test suites, and OAuth for the controller transport. Baseline v1 already covers consuming and refreshing provider/tool/secret-store OAuth credentials that are supplied by the manager.
