# Sandbox Manager

Sandbox Manager v1 is the controller-side component that creates, supervises, and garbage-collects sandbox containers. It is the default controller implementation for the Nerve Sandbox v1 profile, but the sandbox daemon remains controller-agnostic: any peer that implements the WebSocket profile can control it.

The intended package is `packages/sandbox-manager`.

## Responsibilities

| Area | Manager responsibility | Sandbox responsibility |
| --- | --- | --- |
| User/API auth | Authenticate users, services, and frontend clients. | Trust only configured controller transport auth. |
| Authorization | Decide which images, repositories, providers, tools, secrets, and container backends may be used. | Enforce the validated sandbox YAML and runtime policy locally. |
| Container lifecycle | Create, start, inspect, stop, remove, restart, and garbage-collect containers/tasks. | Self-terminate on prolonged manager/controller disconnect. |
| Config materialization | Generate or validate YAML, mount it read-only, set safe env vars. | Load, validate, digest, and apply YAML. |
| Secrets | Store manager-owned secret values and serve them through a built-in KV API or mounted secret files. | Resolve `SecretRef`s lazily, inject narrowly, redact aggressively. |
| Workspace/state volumes | Create and attach workspace, state, secret, and credential mounts. | Use `/workspace`, `/state`, `/secrets`, `/credentials` according to policy. |
| Protocol API/WS | Expose Nerve Protocol-compatible HTTP/WebSocket endpoints to frontend clients and sandbox daemons. | Connect to the configured controller WebSocket and exchange protocol messages. |
| Durable product state | Persist sandbox records, desired lifecycle, user-facing metadata, processed event cursors. | Persist local command/event journals, checkpoints, transcripts, and protected credential state. |
| Tool execution | Never execute model tools directly. | Execute tools through sandbox daemon policy and container boundaries. |

The manager MUST NOT rely on prompt instructions, `AGENTS.md`, or skills for authorization. The manager MAY impose stricter policy than the sandbox YAML requests.

The manager may serve the dedicated sandbox-manager web UI when `NERVE_SANDBOX_MANAGER_SERVE_WEB_UI` is enabled. Static assets are resolved from an explicit `NERVE_SANDBOX_MANAGER_WEB_DIST`, bundled `dist/web`, or workspace `packages/sandbox-manager-ui/dist`. Remote deployments should place an authenticated reverse proxy in front of the manager; the built-in browser cookie flow is loopback-oriented.


## Topology

```text
+-------------------------------+
| Frontend / CLI / API clients   |
| packages/sandbox-manager-ui    |
+---------------+---------------+
                | Nerve Protocol v1 / HTTP
                v
+---------------+---------------+
| Sandbox Manager               |
| packages/sandbox-manager       |
| - API + WebSocket controller   |
| - built-in KV secret API       |
| - Docker/Podman drivers        |
| - lifecycle + GC               |
+---------------+---------------+
                | container runtime API
                v
+---------------+---------------+
| Docker / Podman / ECS/Fargate  |
+---------------+---------------+
                |
                v
+---------------+---------------+
| Sandbox container              |
| packages/sandbox-agent         |
| - sandbox daemon               |
| - agent runtime + tools        |
| - /workspace + /state          |
+-------------------------------+
```

## Manager records

A manager SHOULD persist at least:

```ts
type ManagedSandboxRecord = {
  sandboxId: string;
  instanceId?: string;
  name?: string;
  labels?: Record<string, string>;
  backend: "auto" | "docker" | "podman" | "podman-wsl" | "ecs" | string;
  resources?: RuntimeResourceSpec;
  image: {
    reference: string;
    digest?: string;
    sandboxSpec?: "v1";
    runtimeVersion?: string;
  };
  desiredState: "created" | "running" | "stopped" | "removed";
  observedState: ManagedSandboxObservedState; // low-level container/runtime state
  lifecycleState:
    | "record_created"
    | "container_creating"
    | "container_created"
    | "container_starting"
    | "container_started"
    | "daemon_connected"
    | "booting"
    | "ready"
    | "degraded"
    | "reconnecting"
    | "stopping"
    | "stopped"
    | "failed"
    | "removed";
  lifecycleUpdatedAt?: string;
  daemon?: { connectedAt?: string; readyAt?: string; sessionId?: string; lastHeartbeatAt?: string };
  configDigest?: string;
  workspaceRef: VolumeRef;
  stateRef: VolumeRef;
  secretMountRefs?: VolumeRef[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  stoppedAt?: string;
  gcAfter?: string;
  retention?: ManagedSandboxRetention;
  containerRef?: ManagedContainerRef;
};

type SandboxLaunchConfig = {
  sandboxId?: string;
  name?: string;
  image?: string;
  backend?: "auto" | "docker" | "podman" | "podman-wsl" | "ecs";
  labels?: Record<string, string>;
  resources?: RuntimeResourceSpec;
};

// SandboxConfigV1 YAML is mounted inside the container. SandboxLaunchConfig is
// manager-owned launch state decided before the container is created. The
// manager injects NERVE_SANDBOX_AGENT_SANDBOX_ID and
// NERVE_SANDBOX_AGENT_INSTANCE_ID so the daemon knows its runtime identity.

type ManagedContainerRef = {
  kind: "docker" | "podman" | "podman-wsl" | "ecs" | string;
  id: string;
  name?: string;
  /** Backend-neutral, non-secret runtime metadata such as ECS task/log ARNs. */
  metadata?: Record<string, string>;
};

type ManagedSandboxObservedState =
  | "unknown"
  | "creating"
  | "starting"
  | "running"
  | "reconnecting"
  | "exited"
  | "failed"
  | "stopping"
  | "removed";

type VolumeRef = {
  kind: "bind" | "volume" | "tmpfs" | "efs" | "ephemeral" | string;
  name?: string;
  source?: string;
  target: string;
  readonly?: boolean;
};

type ManagedSandboxRetention = {
  removeContainerAfterMs?: number;
  removeWorkspaceAfterMs?: number;
  removeStateAfterMs?: number;
  preserveFailed?: boolean;
};
```

Manager records MUST NOT contain raw secret values.

## Primary manager storage

`packages/sandbox-manager` uses PostgreSQL as its required primary storage backend for manager-owned state. The local filesystem is not authoritative manager storage; in local Docker/Podman deployments it is used only as a runtime materialization root for bind-mounted workspace/state/config/secrets artifacts.

Required production settings:

```sh
NERVE_SANDBOX_MANAGER_DATABASE_URL=postgres://...
NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY=<32-byte/base64/hex-or-passphrase>
```

PostgreSQL stores sandbox records, materialized config JSON, event intake, session snapshots, idempotency records, secret policies, encrypted secret envelopes, credential profiles, runtime volume refs, and manager audit records. Schema management is SQL-first through `node-pg-migrate`; pending migrations run during manager startup before HTTP/WebSocket listeners start. Migration history is stored in `manager.schema_migrations`.

Manager-owned tables are split by use case: `sandbox` contains sandbox records, event/session state, and runtime volume refs; `identity` contains encrypted secret envelopes, secret policies, credential profiles, profile-owned secret mappings, OAuth flows, and credential refresh records; `manager` contains cross-cutting idempotency and audit records. Secret values are encrypted by the manager before being written to PostgreSQL and are never returned by public APIs. Credential profiles are manager-owned records for model providers, GitHub, Jira, Confluence, and web providers. Profile-owned secrets are exposed to sandboxes only as manager KV refs; when a profile is OAuth-backed, the manager refreshes the underlying credential before returning current access material to the sandbox and includes `expiresAt`/`refreshAfter` cache metadata in the resolve response.


Runtime filesystems remain container-backend specific:

- Docker/Podman use local bind directories or named volumes for `/workspace`, `/state`, config, and protected controller-token materialization.
- ECS/Fargate uses EFS mounts for live writable `/workspace`, `/state`, and `/tmp` filesystem semantics; the manager must mount the same EFS filesystem to materialize config/token files and serve workspace previews.
- S3-backed file storage may be used only through an explicit mount/sync adapter or for seed/snapshot file flows; plain object storage is not a direct POSIX replacement for live agent state.


## Container runtime driver contract

The manager SHOULD implement runtime backends through a driver abstraction equivalent to:

```ts
type ContainerRuntimeDriver = {
  kind: "docker" | "podman" | "podman-wsl" | "ecs" | string;
  capabilities(): RuntimeDriverCapabilities;
  create(spec: ManagedContainerCreateSpec): Promise<ManagedContainerRef>;
  start(ref: ManagedContainerRef): Promise<void>;
  inspect(ref: ManagedContainerRef): Promise<ManagedContainerStatus>;
  logs(ref: ManagedContainerRef, options: LogReadOptions): AsyncIterable<LogChunk>;
  stop(ref: ManagedContainerRef, options: StopOptions): Promise<void>;
  kill(ref: ManagedContainerRef, signal?: string): Promise<void>;
  remove(ref: ManagedContainerRef, options: RemoveOptions): Promise<void>;
};
```

A driver MUST report limitations rather than claiming support for controls it cannot enforce.

### Create spec

```ts
type ManagedContainerCreateSpec = {
  backend: "auto" | "docker" | "podman" | "podman-wsl" | "ecs" | string;
  sandboxId: string;
  instanceId: string;
  image: string;
  command?: string[];
  env: Record<string, string>;
  labels: Record<string, string>;
  mounts: VolumeRef[];
  workingDir?: string;
  user?: string;
  network?: RuntimeNetworkSpec;
  security?: RuntimeSecuritySpec;
  resources?: RuntimeResourceSpec;
  healthcheck?: RuntimeHealthcheckSpec;
};

type RuntimeNetworkSpec = {
  mode: "bridge" | "none" | "host" | "container" | "pod" | "ecs-awsvpc" | string;
  aliases?: string[];
  ports?: Array<{ containerPort: number; hostPort?: number; protocol?: "tcp" | "udp" }>;
  egressPolicyRef?: string;
};

type RuntimeSecuritySpec = {
  readOnlyRootFilesystem?: boolean;
  user?: string;
  privileged?: boolean;
  capDrop?: string[];
  capAdd?: string[];
  noNewPrivileges?: boolean;
  pidsLimit?: number;
  prohibitedMountChecks?: boolean;
};

type RuntimeResourceSpec = {
  memoryMb?: number;
  vcpu?: number;
  cpuUnits?: number; // ECS/Fargate advanced override
  diskMb?: number;
  maxOpenFiles?: number;
};
```

The manager MUST apply labels that allow orphan discovery, such as:

```text
org.nerve.sandbox.spec=v1
org.nerve.sandbox.id=<sandbox-id>
org.nerve.sandbox.instance=<instance-id>
org.nerve.sandbox.manager=<manager-id>
```

## Docker and Podman baseline

Docker and Podman are baseline v1 manager backends.

Local deployments may use `NERVE_SANDBOX_MANAGER_BACKEND=auto` (the default) to select a reachable backend at runtime. Auto mode tries Docker first, then native Podman, then Podman through Windows Subsystem for Linux (`wsl.exe -- podman`). Explicit `docker`, `podman`, or `podman-wsl` values remain deterministic overrides; ECS remains explicit because it requires provisioned AWS configuration.

Requirements:

- The manager MUST support image references by tag and digest. Production SHOULD use immutable digests.
- The manager MUST mount config read-only into the container, normally at `/etc/nerve/sandbox.yaml`.
- The manager MUST provide writable `/workspace`, `/state`, and `/tmp` according to the runtime image contract.
- The manager MUST NOT mount the Docker socket, Podman socket, host root filesystem, host cloud credential directories, or arbitrary host secret paths into the sandbox.
- Production containers MUST be created with non-root user, no privileged mode, dropped capabilities, no-new-privileges, bounded resources, and explicit writable mounts unless the manager is running an unsafe/dev profile.
- If the local runtime cannot enforce an option, the manager MUST record a limitation in sandbox status and SHOULD reject production launches that require strict enforcement.
- Podman rootless mode is acceptable and SHOULD be preferred where available, but rootless limitations MUST be reported.

## ECS/Fargate backend

`packages/sandbox-manager` includes an ECS/Fargate driver selected with `NERVE_SANDBOX_MANAGER_BACKEND=ecs`. It is intended for AWS deployments where Terraform or another IaC layer provisions the cluster, networking, EFS, IAM roles, and manager service. The driver preserves the same sandbox contract:

- one sandbox daemon per task/container;
- `/agent`, `/workspace`, `/state`, `/tmp`, `/secrets`, and `/credentials` equivalents;
- durable state on an explicitly configured durable store such as EFS or another manager-supported state volume;
- controller WebSocket reachability;
- secret refs materialized through manager-owned secret stores, mounted files, or AWS secret mechanisms without exposing raw values in task definitions visible to the model;
- security groups or egress proxies that implement the requested network policy or report limitations;
- task logs collected with redaction expectations;
- task stop/removal and retention behavior equivalent to local GC semantics.

ECS launches are one sandbox per task. `create()` registers a per-sandbox task definition and calls `RunTask`; `start()` is a no-op because ECS has no Docker-style created-but-not-started task state. The task definition mounts EFS root directories from `VolumeRef.name` and keeps manager-local preview paths in `VolumeRef.source`.

Required manager settings include `NERVE_SANDBOX_MANAGER_VOLUME_BACKEND=efs`, `NERVE_SANDBOX_MANAGER_AWS_REGION`, ECS cluster/subnet/security-group variables, task execution role, EFS filesystem ID, and manager EFS mount root. Unsupported Docker controls such as tmpfs, arbitrary POSIX signals, and pids limits are reported as runtime limitations.

ECS IAM roles MUST be scoped to manager/runtime operations and MUST NOT grant broad cloud metadata credentials to the sandbox container unless an explicit tool/provider integration requires narrowly scoped credentials. A reference deployment lives in `deploy/aws`, with reusable Terraform in `deploy/aws/modules/sandbox-manager` and environment roots such as `deploy/aws/environments/nonprod/dev`.

## Built-in key-value secret API

The manager SHOULD provide a built-in HTTP key-value secret endpoint suitable for sandbox `SecretRef` values:

```http
POST /api/sandboxes/{sandboxId}/secrets/resolve
Authorization: Bearer <manager-issued-secret-store-token>
Content-Type: application/json
```

Request:

```ts
type ManagerSecretResolveRequest = {
  key: string;
  version?: string;
};
```

Response:

```ts
type ManagerSecretResolveResponse = {
  value: string;
  expiresAt?: string;
  metadata?: Record<string, string>;
};
```

Requirements:

- The endpoint MUST authenticate every request.
- The manager MUST authorize the sandbox ID and requested key against the sandbox's configured secret policy.
- The response body field containing `value` is secret material and MUST be redacted from logs, events, and traces.
- The endpoint SHOULD be reachable only from the sandbox network or via a private manager address.
- TLS is REQUIRED except for local/private runtime networks whose isolation is explicitly documented.
- Recursive secret-store auth chains MUST be rejected.
- Response size MUST be bounded.
- Secret key names MAY be sensitive; manager events SHOULD hash or redact keys unless configured otherwise.

A sandbox config using the manager KV endpoint normally uses:

```yaml
secretStores:
  defaultStore: manager
  stores:
    manager:
      type: http_kv
      endpoint: http://sandbox-manager.internal/api/sandboxes/sbx_123/secrets/resolve
      auth:
        type: api_key
        apiKey:
          file: /secrets/controller/secret-store-token
```

## Manager protocol surface

The manager exposes two protocol-facing surfaces:

1. **Sandbox daemon connection** — the sandbox connects as protocol role `agent`; the manager accepts as role `orchestrator`.
2. **Frontend/client connection** — web UI, CLI, or API clients connect to the manager and consume snapshots/events or issue commands.

The manager MAY multiplex multiple sandbox streams to frontend clients. If it does, stream names SHOULD be stable, for example `sandbox:<sandboxId>`, and the capability MUST be negotiated. A baseline frontend can also use manager HTTP snapshot endpoints plus a global manager event stream.

Frontend clients MUST NOT connect directly to sandbox containers for control, secrets, or tool execution.

## Lifecycle and garbage collection

The manager owns desired lifecycle and a user-facing `lifecycleState`. `observedState` remains the low-level container/runtime inspection state. `POST /api/sandboxes` is a create-and-run operation across all backends; it persists the manager record and immediately enters the shared runtime startup flow. `POST /api/sandboxes/{sandboxId}/start` remains available for an existing stopped or failed sandbox. Normal startup progresses:

`record_created → container_creating → container_created → container_starting → container_started → daemon_connected → booting → ready/degraded`.

For ECS, `container_created` means `RunTask` returned a task ARN; `container_started` is only reached after inspection reports the task/container is `RUNNING`.

The sandbox owns self-preservation and self-exit if disconnected too long.

Requirements:

- The manager MUST record desired state transitions before issuing runtime operations.
- The manager SHOULD stop containers gracefully before killing them.
- The manager SHOULD preserve `/state` for exited or failed sandboxes until retention policy permits deletion.
- The manager MAY remove non-durable containers immediately after successful stop when state/workspace are preserved separately.
- The manager MUST discover orphaned containers by labels on startup and reconcile them with manager records.
- The manager MUST NOT delete protected credential or state volumes for active/recoverable sandboxes.
- GC actions MUST be auditable and MUST not include raw secrets.

## Sandbox disconnect and self-exit

A sandbox daemon that loses manager/controller WebSocket reachability MUST attempt reconnect with backoff. If it cannot establish a valid protocol session for the configured disconnect grace period, it MUST exit itself.

Baseline default:

```yaml
controller:
  disconnectPolicy:
    exitAfterMs: 300000
```

Requirements:

- The timer starts when the current protocol session is lost or rejected for a retryable reason.
- Successful re-authentication and `welcome` reset the timer.
- During the grace period, the sandbox MAY finish local cleanup/checkpoint work, but MUST NOT start new controller-commanded runs.
- Before exiting, the sandbox SHOULD persist a local shutdown record and enqueue `sandbox.shutdown.scheduled` / `sandbox.shutdown.started` events if possible.
- Exit due to disconnect SHOULD use the runtime-image exit code reserved for controller disconnect timeout.
- The manager performs container GC after observing exit.

Intentional manager shutdown is different: when the manager sends a graceful stop command or stops the container, the sandbox SHOULD send `goodbye` when possible and exit without treating the stop as connectivity loss.

## Manager conformance checklist

A baseline manager implementation SHOULD verify:

- Docker and/or Podman driver can create a sandbox with required mounts and labels;
- config is mounted read-only;
- `/workspace`, `/state`, and `/tmp` are writable as expected;
- prohibited host mounts are rejected;
- built-in KV secret endpoint resolves authorized keys and rejects unauthorized keys;
- frontend clients can load snapshots and receive event updates without raw secrets;
- sandbox daemon reconnect and 5-minute self-exit behavior is observable;
- exited containers are garbage-collected according to retention;
- orphaned containers are discovered after manager restart;
- backend limitations are reported and do not silently weaken production policy.
