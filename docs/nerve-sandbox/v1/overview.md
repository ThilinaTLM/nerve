# Overview

Nerve Sandbox v1 packages the Nerve agent runtime as a durable, isolated container component and defines a baseline sandbox manager for operating those containers. An external API, service, CLI, scheduler, or the new sandbox-manager web UI can create a sandbox through the manager and control one or more conversations, agents, and runs over Nerve Protocol v1 without embedding the current Nerve desktop app, local orchestrator, or local workbench UI.

## Topology

```text
+-------------------------------------------------------------+
| Frontend / CLI / scheduler / external automation             |
| - packages/sandbox-manager-app web app                        |
| - other protocol-compatible clients                          |
+-----------------------------+-------------------------------+
                              | Nerve Protocol v1 / HTTP
                              v
+-----------------------------+-------------------------------+
| Sandbox manager/controller API (packages/sandbox-manager)    |
| - authenticates users and external services                  |
| - exposes frontend API/WS and sandbox controller WS          |
| - provides built-in HTTP key-value secret API                |
| - materializes YAML, secret refs, repo inputs, credentials   |
| - starts/supervises/garbage-collects sandbox containers      |
| - persists controller-side state in its own DB/storage       |
+-----------------------------+-------------------------------+
                              | Docker/Podman API now; ECS later
                              v
+-----------------------------+-------------------------------+
| Docker / Podman / future ECS or other container runtime      |
|                                                             |
|  +-------------------- Sandbox container ----------------+   |
|  | /agent        read-only Nerve agent runtime            |   |
|  | /agent/skills read-only built-in SKILL.md files        |   |
|  | /workspace    writable working tree                    |   |
|  |   AGENTS.md and .agents/skills project resources       |   |
|  | /state        durable journals, checkpoints, cache      |   |
|  | /tmp          writable scratch space                    |   |
|  | /secrets      optional read-only secret files           |   |
|  | sandbox daemon: config, setup, tools, WebSocket         |   |
|  +--------------------------+-----------------------------+   |
+-----------------------------|---------------------------------+
                              | WebSocket / Nerve Protocol v1
                              v
                    Sandbox manager/controller
```

The manager-to-sandbox WebSocket is initiated by the sandbox daemon. Frontend clients connect to the manager, not directly to sandbox containers.

The sandbox manager/controller is the API-side peer that starts or supervises sandbox containers. Baseline v1 defines `packages/sandbox-manager` with Docker/Podman drivers, a built-in KV secret API, Nerve Protocol-compatible frontend/sandbox APIs, and container garbage collection. It MAY be implemented by the current Nerve orchestrator in the future, but Sandbox v1 does not require that implementation.

## Manager responsibility vs sandbox responsibility

The manager/controller owns authentication and account-level authorization. It decides which users, organizations, repositories, model providers, tool families, Git/GitHub capabilities, and external services a sandbox may use. It provides the sandbox with:

- a validated or generated YAML configuration;
- model and tool credentials as `SecretRef` values, mounted files, environment variables, or key-value secret-store references;
- optional HTTP key-value secret endpoints authenticated by API key, bearer token, or already-provided OAuth credentials, including the baseline manager built-in KV endpoint;
- pi-ai OAuth credential bundles for subscription providers such as `openai-codex` and Anthropic, when those providers are enabled;
- Jira, Confluence, Git, GitHub, and package-registry credential references;
- repository/workspace inputs and optional boot instructions;
- controller WebSocket endpoint and API-key transport credential;
- Docker/Podman container lifecycle management and garbage collection when using the baseline manager.

The sandbox is responsible for validating the YAML, enforcing local policy, resolving credentials lazily, applying Git/GitHub startup setup before custom boot phases, running the agent/tools, journaling state, refreshing **already-provided** OAuth credential bundles when configured, redacting secrets, and exiting itself after prolonged controller disconnect. The sandbox MUST NOT perform interactive login flows or ask the model to authenticate to providers. If required credentials are absent, expired without refresh material, invalid, or blocked by network policy, the sandbox reports the affected provider/setup/tool as unavailable or failed.

## Goals

Sandbox v1 aims to provide:

1. **Portable agent runtime and manager**
   - The agent can run in Docker, Podman, future ECS, Kubernetes, or another container platform.
   - The baseline manager supports Docker and Podman first, while preserving a backend contract for ECS.
   - Any controller API can drive the sandbox if it implements the WebSocket profile.

2. **Configuration by spec**
   - The sandbox is configured by one YAML document.
   - Model catalog, agent model selection, secret stores, Git/GitHub startup setup, model-callable tool groups, boot behavior, skills/context resources, storage, and security policy are explicit and validated.
   - Secrets are referenced by environment variable, mounted file, or key-value store key, not embedded as raw YAML values.

3. **pi-ai model/provider parity with simple agent selectors**
   - Built-in providers and models resolve through the bundled pi-ai catalog.
   - Custom providers, known pi-ai API types, compatible APIs, custom headers, compat options, thinking levels, and model metadata can be represented in `modelCatalog`.
   - `agent.defaultModel` and `agent.defaultExploreModel` select only provider, model, and thinking level.
   - The sandbox can refresh `openai-codex` and Anthropic subscription credentials when the manager provides refresh material and the runtime supports the provider.

4. **First-class Git/GitHub startup configuration**
   - Git identity, signing, remotes, credentials, safe-directory config, optional clone, and GitHub API/CLI auth are applied before boot phases.
   - This setup is separate from model-callable tool authority. Later Git/GitHub commands still require shell or dedicated tool enablement and policy approval.

5. **Tool-family based capabilities**
   - Model-callable tool availability is organized by groups such as file inspection/editing, web, Jira, Confluence, shell, Python, task management, plan mode, todos, and explore.
   - Tool-level authentication is configured at the relevant group or top-level service config and injected narrowly at execution time.

6. **Durable operation**
   - Accepted commands, outgoing durable events, transcripts, tool calls, credential-refresh records, secret-store status, Git/GitHub setup status, skills/context metadata, and checkpoints survive process/container restarts when `/state` is mounted durably.
   - The filesystem/state model supports multiple conversations, multiple agents, subagents, and multiple runs within one sandbox, even when a deployment uses a single active conversation by default.

7. **Reproducible customization**
   - Stable behavior comes from pinned base images, derived images, built-in skills, config digests, and recorded boot transcripts.
   - Runtime boot phases are supported for repository setup and dependency installation, but are less reproducible than build-time image customization.

8. **Security by boundary**
   - `/agent` and `/agent/skills` are immutable from the agent's perspective.
   - Production containers run as a non-root `sandbox` user.
   - Default writable paths are limited to `/workspace`, `/tmp`, `/state`, and explicitly configured cache/credential mounts.
   - Tool policy is enforced by the sandbox daemon and container runtime, not by prompt text, `AGENTS.md`, or `SKILL.md` metadata.
   - Network, package installation, Git remote operations, external API calls, and dangerous capabilities are denied or require approval unless explicitly configured.

9. **AGENTS.md and skills resources**
   - `AGENTS.md` files are loaded as project context resources by default.
   - Project skills default to `/workspace/.agents/skills`.
   - Built-in skills may be packaged under `/agent/skills`.
   - Skills are prompt resources exposed through `<available_skills>`; they do not grant tool permissions or secret access.

10. **Protocol reuse**
    - Control and events use the Nerve Protocol v1 envelope, session lifecycle, event batches, replay, ack, and error model.
    - Payloads remain transport-neutral and do not depend on a specific UI framework.

11. **Manager-operated lifecycle**
    - The manager owns container creation, supervision, stop/remove, orphan discovery, and garbage collection.
    - The sandbox self-exits after the configured controller disconnect grace period, 5 minutes by default, so detached containers do not run indefinitely.

12. **Separate sandbox-manager web UI**
    - `packages/sandbox-manager-app` provides a dedicated UI app for the sandbox manager.
    - `packages/workbench-ui` provides shared Svelte primitives/theme used by both UI apps.
    - The UI connects to manager APIs without reusing the local workbench as-is.

## Non-goals

Sandbox v1 does not define:

1. **A replacement for all product behavior**
   - Billing, multi-tenant quotas, organization policy, account login, and product-specific UI state are manager/product concerns.
   - Baseline v1 defines manager container lifecycle behavior, but not a complete SaaS control plane.

2. **Interactive provider authentication inside the sandbox**
   - The sandbox consumes credentials supplied by the manager or secret stores. It MUST NOT run model-provider, Jira, Confluence, GitHub, package-registry, or secret-store login flows.

3. **OAuth for controller transport authentication**
   - Baseline v1 defines API-key authentication for the WebSocket connection. OAuth for the controller transport is reserved for a future profile.
   - This does not forbid baseline v1 from consuming and refreshing manager-provided OAuth credentials for model, secret-store, or tool providers.

4. **A required current-orchestrator integration**
   - The current Nerve orchestrator may later host or control sandboxes, but v1 is written for any compatible controller.

5. **Exactly-once execution**
   - Commands are idempotent by command ID, events are at-least-once delivered, and receivers must deduplicate.

6. **A guarantee of host-level containment by YAML alone**
   - YAML declares desired policy. The container runtime and host platform must enforce mounts, user, privileges, network policy, firewall behavior, and resource limits.

7. **Unrestricted runtime package-manager freedom**
   - Runtime `apt` is disabled by default. Build-time image customization is the preferred reproducible path for system packages.
   - Language package managers may be used only when boot/tool policy and network/firewall allow the relevant registries.

8. **A binary attachment protocol**
   - v1 command/event payloads are JSON. Large files and artifacts should be referenced by path, content ID, or controller-specific resource APIs.

## Terminology

| Term | Meaning |
| --- | --- |
| Sandbox | One configured agent runtime instance, usually one container. |
| Sandbox daemon | The process inside the container that loads config, applies Git/GitHub setup, runs boot, manages the agent harness and tools, journals state, refreshes configured credentials, and connects to the controller. |
| Manager/controller | The external API/service peer that authenticates users/services, starts sandboxes, provides config/credentials, sends commands, receives events, exposes frontend APIs, and owns product-specific persistence/UI integration. Baseline package: `packages/sandbox-manager`. |
| Sandbox agent image | The container image/runtime package that contains `/agent`, the sandbox daemon, agent runtime, tools, and built-in skills. Baseline package: `packages/sandbox-runtime`. |
| Sandbox-manager UI | A dedicated `packages/sandbox-manager-app` app that connects to the manager to observe and operate sandboxes. |
| Workspace | The writable project directory mounted at `/workspace`. Agent file tools operate here by default. |
| State store | Durable directory mounted at `/state`; contains journals, checkpoints, refreshed credentials, run/conversation/agent state, skills metadata, and transcripts. |
| Conversation | A durable thread of agent/user/tool interaction. A sandbox commonly starts with one conversation but the state model allows more. |
| Agent instance | A configured main agent or subagent participating in a conversation. |
| Run | A durable agent activity started by a controller command. A run may contain multiple turns, tool calls, waits, and continuations. |
| Turn | One model/tool loop segment inside a run. |
| Steering | Additional user/controller input delivered while a run is active. |
| Checkpoint | A durable snapshot of run state sufficient to resume or report a stable waiting/terminal/error state. |
| Tool group | A named set of model-callable tools plus group-level policy, such as `web`, `jira`, `confluence`, `shell`, `python`, or `explore`. |
| Secret store | A configured service, usually manager-owned, that accepts a key and returns a secret value. |
| Credential bundle | A secret provider credential, such as an API key, bearer token, OAuth access/refresh token pair, SSH key, GPG key, or JSON OAuth bundle. |
| Refreshable credential | A credential bundle with enough refresh material for the sandbox to obtain a new access token without interactive login. |
| Git/GitHub setup | First-class startup configuration for repository checkout, identity, signing, remotes, and GitHub CLI/API auth. |
| Boot phase | Ordered startup script defined in YAML and run after secret resolver initialization plus Git/GitHub setup, before the daemon accepts work. |
| Package registry access | Network/firewall and credential policy that permits npm, PyPI, Maven, Cargo, Go, RubyGems, NuGet, or other dependency downloads during boot/tool execution. |
| Context file | A project instruction file such as `AGENTS.md` loaded into the prompt context. |
| Skill | A `SKILL.md` prompt-resource file loaded from configured search paths and listed in `<available_skills>`. |
| Build-time customization | Creating a derived image with pinned packages, tools, and built-in skills before runtime. |
| Runtime customization | YAML configuration, environment variables, mounted secrets, mounted skills, credential refs, secret stores, and optional boot phases. |

## Layering model

Sandbox implementations SHOULD keep these layers separate:

```text
+--------------------------------------------------------------+
| Frontend/UI product logic (`packages/sandbox-manager-app`)      |
+--------------------------------------------------------------+
| Sandbox manager API, KV secrets, lifecycle, and GC             |
+--------------------------------------------------------------+
| Sandbox command/event domain payloads                         |
+--------------------------------------------------------------+
| Nerve Protocol v1: envelope, session, events, ack, replay      |
+--------------------------------------------------------------+
| Sandbox daemon: journals, setup, credentials, tools            |
+--------------------------------------------------------------+
| Container runtime: mounts, user, network, capabilities         |
+--------------------------------------------------------------+
| Host/cloud scheduler and durable volumes                       |
+--------------------------------------------------------------+
```

## Core invariants

A conforming Sandbox v1 implementation MUST preserve these invariants:

1. **Configuration is explicit**
   - The loaded YAML document MUST declare `version: 1` and MUST pass schema validation before setup, boot, WebSocket connection, or run acceptance.

2. **Runtime code is not workspace state**
   - Agent runtime code MUST live outside `/workspace`, normally under `/agent`, and MUST NOT be writable by agent tools.

3. **Resources are not authority**
   - `AGENTS.md`, skills, and prompt instructions MAY influence model behavior, but they MUST NOT expand tool permissions, filesystem access, network access, or credential access.

4. **Git/GitHub setup precedes boot**
   - Top-level Git/GitHub setup MUST run before boot phases when configured, and failures MUST be reported before accepting work unless a fail-open/degraded policy is explicit.

5. **Writable paths are constrained**
   - By default, agent tools MAY write only under `/workspace`, `/tmp`, and `/state`.
   - Writes outside those paths MUST be denied unless an explicit mounted writable path is configured and enforced.

6. **Secrets stay out of ordinary messages**
   - Protocol metadata, event payloads, transcripts, logs, config digests, context files listings, skill listings, and examples MUST NOT contain raw API keys, OAuth tokens, passwords, private keys, or decrypted credentials.

7. **Credential refresh is secret and durable**
   - Refreshed credentials MUST be written only to protected state or explicitly configured credential files.
   - Refreshed credentials MUST NOT appear in ordinary events, snapshots, transcripts, or tool outputs.

8. **Commands are journaled before execution**
   - The sandbox MUST persist an accepted command to the local command journal before executing it.

9. **Events are durable before send**
   - Durable events MUST be written to the local outbox before the sandbox attempts WebSocket delivery.

10. **Multiple durable scopes are explicit**
    - Conversation, agent, run, and subagent identifiers MUST be persisted where relevant so concurrent or future multi-conversation operation does not collide in `/state`.

11. **Recovery reports stable state**
    - On restart, the sandbox MUST recover or report the last stable waiting, terminal, cancelled, failed, or runnable state for each known run.

12. **Policy is enforced by code and runtime**
    - Prompt instructions and skills MAY describe policy, but authorization MUST be enforced in the sandbox daemon and, where possible, by container runtime controls.

13. **Disconnected sandboxes terminate**
    - If the sandbox cannot re-establish a valid controller session within the configured disconnect grace period, 5 minutes by default, it MUST persist shutdown state when possible and exit so the manager can garbage-collect the container.

14. **Frontend control is manager-mediated**
    - Web UIs, CLIs, and external clients SHOULD control sandboxes through the sandbox manager. They MUST NOT receive raw secrets or directly bypass sandbox daemon policy.

