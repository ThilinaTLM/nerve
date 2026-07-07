# Implementation Guide

This guide is non-normative. It describes a practical path for implementing Sandbox v1 in the Nerve codebase while preserving the runtime contract defined by the other documents.

## Suggested package shape

A future implementation could use modules such as:

```text
packages/shared/src/domains/sandbox/
  config.schema.ts
  commands.schema.ts
  events.schema.ts
  snapshots.schema.ts
  credentials.schema.ts
  secret-stores.schema.ts
  manager.schema.ts
  state.schema.ts
  skills.schema.ts
  setup.schema.ts

packages/sandbox-agent/
  src/entrypoint.ts
  src/config/load-config.ts
  src/config/digest.ts
  src/daemon/sandbox-daemon.ts
  src/protocol/websocket-client.ts
  src/protocol/command-router.ts
  src/state/state-store.ts
  src/state/event-outbox.ts
  src/state/command-inbox.ts
  src/state/checkpoints.ts
  src/state/credential-store.ts
  src/state/secret-cache.ts
  src/credentials/oauth-refresh.ts
  src/credentials/secret-resolver.ts
  src/secret-stores/http-kv-client.ts
  src/setup/git-setup.ts
  src/setup/github-setup.ts
  src/tools/tool-groups.ts
  src/tools/tool-policy.ts
  src/tools/tool-runtime.ts
  src/security/filesystem-policy.ts
  src/security/network-policy.ts
  src/boot/boot-runner.ts
  src/skills/skills-loader.ts
  Dockerfile

packages/sandbox-manager/
  src/api/http-server.ts
  src/api/protocol-ws.ts
  src/drivers/container-runtime-driver.ts
  src/drivers/docker-driver.ts
  src/drivers/podman-driver.ts
  src/drivers/ecs-driver.ts
  src/secrets/kv-secret-store.ts
  src/lifecycle/sandbox-supervisor.ts
  src/lifecycle/garbage-collector.ts
  src/state/manager-store.ts
  src/config/materialize-sandbox-config.ts
  src/events/manager-event-bus.ts

packages/sandbox-manager-ui/
  src/lib/api/
  src/lib/state/
  src/lib/routes/
  src/lib/components/

packages/ui/
  src/lib/components/ui/
  src/styles/
```

This layout is illustrative. Protocol, config, command, event, state, credential, and manager schemas that are shared by controllers, sandboxes, and the web UI should live in `packages/shared`. Svelte components, CSS, and browser display helpers belong in `packages/ui`, not `packages/shared`.

## Reuse candidates

Current Nerve components that may be reused or adapted:

| Area | Current anchor |
| --- | --- |
| Agent harness | `packages/agent` |
| pi-ai provider/model resolution | `packages/agent/src/runtime.ts` |
| Skill loading/formatting | `packages/agent/src/harness/skills/*` |
| Conversation JSONL/storage patterns | `packages/agent/src/harness/conversation/*` |
| `AGENTS.md` and `.agents/skills` resource loading | `packages/orchestrator/src/domains/agents/prompting/resource-loader.ts` |
| Tool definitions and execution | `packages/tools` |
| Tool names, risks, call records | `packages/shared/src/domains/tools/*` |
| Agent settings and workspace scope | `packages/shared/src/domains/agents/agent.schema.ts` |
| Provider/catalog schemas | `packages/shared/src/domains/providers/providers.schema.ts` |
| Model selection/thinking levels | `packages/shared/src/domains/models/models.schema.ts` |
| Auth metadata and OAuth flow schemas | `packages/shared/src/domains/auth/auth.schema.ts` |
| Git/GitHub request/response schemas | `packages/shared/src/domains/git/git.schema.ts` |
| Event envelope | `packages/shared/src/domains/events/envelope.schema.ts` |
| Tool policy ideas | `packages/orchestrator/src/domains/tools/policy.ts` |
| Git/GitHub service ideas | `packages/orchestrator/src/domains/git/*` |
| Agent/tool orchestration glue | `packages/orchestrator/src/domains/agents/run/*` and `domains/tools/*` |

The sandbox agent image should avoid copying UI-specific or desktop-specific concerns. The sandbox-manager UI should be a separate `packages/sandbox-manager-ui` app using shared primitives from `packages/ui`, not the current local workbench reused unchanged.

## Phase 1: shared schemas

Implement shared schemas for:

- Sandbox YAML config v1;
- secret references, credential configs, and key-value secret-store configs;
- model catalog provider/model config and simplified agent model selectors;
- top-level Git and GitHub setup config/status;
- tool-group config/status for model-callable tools;
- skills and `AGENTS.md` context metadata;
- sandbox capabilities;
- command params/results with optional conversation/agent IDs as defined in [Commands](./commands.md);
- event payloads as defined in [Event Schemas](./event-schemas.md);
- snapshot shape;
- durable state metadata for multiple conversations, agents, subagents, and runs.

Validation:

- valid minimal/full config fixtures parse;
- env, file, and kv secret refs parse;
- HTTP key-value secret-store fixtures parse for API-key, bearer, and OAuth auth;
- model selectors reference model catalog or built-in catalog entries;
- `openai-codex` and Anthropic OAuth credential fixtures parse without raw secret values;
- custom provider/model fixtures parse with `api`, `baseUrl`, `headers`, and `compat`;
- tool group fixtures parse for web, Jira, Confluence, shell, Python, tasks, plan mode, todos, and explore;
- top-level Git/GitHub fixtures parse;
- raw-secret-like fixture examples are rejected where possible;
- unknown fields are rejected according to the spec;
- config digest is stable across key-order differences;
- config digest excludes secret contents but includes safe secret reference locations;
- conditional validation rejects missing default KV stores, selected custom providers without required fields, enabled Jira/Confluence groups without required fields, duplicate boot phase names, and invalid disconnect policies.

## Phase 2: manager local driver skeleton

Implement a minimal `packages/sandbox-manager` that can persist manager records and speak to Docker or Podman through a driver abstraction.

Validation:

- driver capabilities report Docker/Podman availability and limitations;
- create spec includes labels, mounts, env, resources, and security options;
- prohibited mounts are rejected;
- manager records desired/observed lifecycle state;
- orphan discovery by labels works after manager restart.

## Phase 3: image and entrypoint

Create a minimal sandbox agent image with:

- `/agent` runtime;
- optional `/agent/skills` built-in skills directory;
- non-root `sandbox` user;
- `/workspace`, `/state`, `/tmp` paths;
- protected `/state/credentials` and `/state/cache/secrets` paths;
- dependency cache path under `/state/cache/dependencies`;
- config loading from `NERVE_SANDBOX_AGENT_CONFIG`;
- healthcheck command;
- no current orchestrator/UI dependency.

Entrypoint order:

1. load/validate config;
2. acquire state lock and recover state;
3. initialize protected directories;
4. resolve model catalog and selected models;
5. initialize secret resolvers and startup-critical secret-store status;
6. apply Git/GitHub setup;
7. load `AGENTS.md` context and `.agents/skills`/built-in skills;
8. run boot phases;
9. connect to controller and announce ready/recovered state.

Validation:

- container starts with minimal config;
- missing config exits with code `10`;
- missing writable `/state` exits with code `11`;
- `/agent` and `/agent/skills` are not writable by the sandbox user;
- `/state/credentials` and `/state/cache/secrets` are private to the sandbox user;
- production profile runs as non-root.

## Phase 4: daemon skeleton and state

Implement:

- config validation;
- state lock;
- protected state directory creation;
- sanitized config persistence;
- config digest;
- effective model/setup/tool status computation;
- multi-conversation/agent/run state indexes;
- context/skills metadata records;
- boot event records;
- daemon status transitions;
- local structured logs with redaction.

Validation:

- state lock prevents two daemons from using one state dir;
- restart reloads config digest and prior status;
- unsafe launch warnings are emitted where detectable;
- root boot is rejected or visibly marked in production profile;
- configured but unsupported tool groups are reported unavailable;
- multiple run IDs under different conversation/agent IDs do not collide.

## Phase 5: WebSocket protocol client

Implement the sandbox side of the WebSocket profile:

- API-key auth during upgrade;
- `hello`/`welcome`/`ready`;
- capability advertisement for pi-ai models, OAuth refresh, secret stores, Git/GitHub setup, tool groups, skills, multi-agent state, network policy, and firewall where supported;
- heartbeats;
- `request` command dispatch;
- `response` and `error` handling;
- durable `event.batch` send;
- `ack` persistence;
- reconnect backoff.

Validation:

- invalid `welcome` is rejected;
- command before `ready` is rejected or queued according to policy;
- duplicate command IDs are idempotent;
- heartbeat timeout reconnects;
- provider/tool/secret-store OAuth credentials are never sent in protocol payloads.

## Phase 6: command inbox and event outbox

Implement local durability:

- append-only command journal;
- command idempotency index;
- append-only durable event outbox;
- event sequence allocation;
- ack cursor persistence;
- replay unacknowledged events after reconnect.

Validation:

- crash after command acceptance does not lose the command;
- crash after event write but before send replays the event;
- duplicate durable events keep stable IDs/seq values;
- acked events are not required for immediate deletion;
- credential/setup/skill status events replay safely and contain no secrets.

## Phase 7: manager built-in KV secret API

Implement the manager HTTP key-value secret endpoint.

Validation:

- authorized sandbox can resolve configured key;
- unauthorized key is denied;
- response values are redacted from logs/events;
- recursive secret-store auth is rejected;
- endpoint can be exposed on a private/local sandbox network.

## Phase 8: pi-ai model provider integration

Integrate model configuration with the agent runtime:

- resolve built-in providers/models from pi-ai;
- resolve custom providers/models from `modelCatalog`;
- keep agent model selection limited to provider/model/thinking level;
- pass `api`, `baseUrl`, `headers`, and `compat` correctly from provider/model definitions;
- clamp/validate thinking levels;
- support API-key/bearer credentials;
- support refreshable OAuth bundles for `openai-codex` and Anthropic subscription auth when runtime support exists.

Validation:

- built-in model selector resolves;
- custom provider fixture resolves;
- unsupported API type/model fails closed;
- OAuth access token is used only by provider client;
- expired OAuth credential refreshes without interactive login;
- failed refresh is redacted and marks only affected provider unavailable.

## Phase 9: secret resolver, credential store, and OAuth refresh

Implement protected credential lifecycle:

- load credential refs lazily;
- resolve env/file/kv secret refs through one `SecretResolver`;
- call HTTP key-value stores with configured auth and bounded responses;
- parse pi-ai-compatible OAuth bundles;
- refresh before expiry based on `minTtlMs`;
- persist refreshed bundles under `/state/credentials` or configured file;
- cache key-value store responses only when configured;
- use atomic writes and restrictive permissions;
- emit redacted refresh/store status events;
- preserve previous valid bundle/cache entry on failure when policy allows.

Validation:

- kv secret resolves and is redacted;
- recursive secret-store auth is rejected;
- secret-store network denial fails closed;
- refreshed credential survives restart;
- `refresh.persist: none` does not write token material;
- `refresh.persist: file` writes only to allowed protected file;
- no raw token appears in logs/events/snapshots/transcripts;
- concurrent refresh requests for one provider coalesce.

## Phase 10: Git/GitHub setup

Implement first-class startup setup:

- configure Git identity and signing state;
- prepare scoped SSH, GPG, askpass, credential helper, and safe-directory config under protected state;
- optionally clone into `/workspace` before boot;
- configure GitHub CLI/API auth without interactive login;
- record redacted setup status.

Validation:

- setup runs before boot phases;
- clone can use SSH or HTTPS credentials from secret refs;
- keys are never copied to `/workspace`;
- `gh auth login` is never invoked;
- setup failure prevents ready unless explicitly degraded;
- setup events contain no raw tokens/private keys.

## Phase 11: agent harness integration

Run the agent harness inside the sandbox:

- create/run a main agent from `agent.mainModel` selector;
- configure explore agent from `agent.exploreModel` or main model;
- load `AGENTS.md`, project `.agents/skills`, manager-mounted skills, and built-in skills according to sandbox policy;
- map controller commands to run/steer/follow-up behavior;
- persist transcript and run state under conversation/agent scope;
- checkpoint waiting/terminal/error states;
- emit durable and transient sandbox events.

Validation:

- `sandbox.run.start` produces `run.started`;
- live assistant deltas are transient;
- durable transcript append events reconstruct final state;
- waiting for user input survives restart;
- failed run can be continued only when retryable;
- loaded skills appear in `<available_skills>` when file-read tools are active.

## Phase 12: tools and group policy

Integrate tools with sandbox group policy:

- active tool list from implementation support and `tools.groups`;
- filesystem root checks;
- shell/Python timeout and output bounds;
- web/Jira/Confluence group credentials;
- Git/GitHub command policy through shell/future dedicated tools using top-level setup;
- task supervisor for `taskManagement`;
- approval workflow for supervised risks;
- redaction across logs/events/results.

Validation:

- write outside `/workspace` is denied;
- symlink escape is denied;
- disabled group/tool is not advertised and cannot execute;
- secrets do not appear in event snapshots/logs;
- supervised risky tool waits for approval and checkpoints;
- `git push --force` and destructive commands are denied or require approval;
- package-manager commands require allowed network/firewall hosts and scoped credentials.

## Phase 13: boot and package manager policy

Implement boot runner:

- run boot phases as the sandbox user by default;
- enforce per-phase network mode and firewall profile;
- inject only explicitly configured environment secret refs;
- configure package manager cache dirs under `/state/cache/dependencies`;
- record phase transcripts and lockfile digests where practical.

Validation:

- boot cannot write `/agent`;
- package installs fail when registry egress is denied;
- private registry token is not logged;
- boot failure follows `boot.onFailure`;
- boot after Git clone can see the checked-out workspace.

## Phase 14: manager protocol API/WS and lifecycle

Implement manager-facing HTTP/WebSocket APIs for frontend clients and sandbox daemon sessions.

Validation:

- sandbox daemon connects as role `agent` and manager accepts as role `orchestrator`;
- frontend UI can load snapshots and subscribe to manager/sandbox event streams;
- manager forwards or materializes sandbox events without raw secrets;
- lifecycle commands are idempotent;
- sandbox stop/remove updates desired state before runtime operations;
- manager observes sandbox disconnect self-exit and records exit code/status.

## Phase 15: lifecycle garbage collection

Implement container and record cleanup according to manager retention.

Validation:

- exited containers are removed after retention;
- failed containers are preserved when `preserveFailed` is true;
- `/state` is not deleted for recoverable sandboxes;
- orphaned containers are reconciled by labels;
- GC actions are audited without secrets.

## Phase 16: sandbox-manager web UI

Implement the dedicated `packages/sandbox-manager-ui` app described in [Web UI](./web-ui.md).

Validation:

- UI connects only to the sandbox manager;
- read-only dashboard loads via snapshot and live events;
- sandbox detail shows backend/image/config digest/health;
- boot timeline shows secret resolver setup, Git setup, GitHub setup, skills loading, and custom phases;
- run view supports transcript/tool lifecycle, approvals, and input waits;
- lifecycle actions use idempotent manager commands;
- no raw secrets are requested or rendered;
- styling follows `packages/ui`/`packages/sandbox-manager-ui` AGENTS guidance and shadcn-svelte conventions.

## Phase 17: future ECS driver

Add an ECS manager backend after Docker/Podman are stable.

Validation:

- ECS task definition preserves required sandbox paths and env/config semantics;
- state/workspace durability is explicit;
- security group/egress policy limitations are reported;
- task logs and status map to manager lifecycle state;
- IAM permissions are narrow and do not expose broad cloud credentials to the sandbox.

## Conformance checks

A first implementation should include fixtures/tests for:

- minimal and full YAML configs;
- secret-store resolution and redaction;
- model catalog selection;
- top-level Git/GitHub setup before boot;
- `AGENTS.md` and `.agents/skills` loading;
- multi-conversation/agent/run state recovery;
- WebSocket reconnect and outbox replay;
- credential refresh persistence;
- filesystem and symlink policy;
- network/firewall denial;
- approval workflow;
- no raw secrets in logs/events/snapshots.

Use `pnpm check`; use `pnpm lint` and `pnpm test` when relevant to implementation changes.
