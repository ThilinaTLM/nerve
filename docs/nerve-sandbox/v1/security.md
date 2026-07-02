# Security

Sandbox v1 assumes the model, prompts, `AGENTS.md`, workspace content, workspace-provided skills, downloaded content, package dependencies, tool outputs, and tool arguments are untrusted. Security must be enforced by the sandbox daemon, container runtime, and host platform.

A YAML policy is declarative. It is not sufficient unless the runtime enforces it.

## Trust model

| Actor/data | Trust level | Notes |
| --- | --- | --- |
| Model output | Untrusted | May request dangerous tools or leak secrets. |
| User/controller commands | Authenticated but validated | Auth proves source, not safety. |
| Workspace files | Untrusted | May contain malicious scripts, symlinks, prompt injection, or malicious skills. |
| Workspace `AGENTS.md` and `.agents/skills` | Untrusted prompt resources | Must not grant permissions or credentials. |
| Built-in `/agent/skills` | Trusted only as image content | Immutable from tools; still cannot bypass policy. |
| Downloaded web content | Untrusted | Must be bounded and treated as data. |
| Package dependencies | Untrusted | Install scripts can execute code; use lockfiles and policy. |
| Tool outputs | Untrusted | May contain secrets or hostile text. |
| YAML config | Trusted only after validation | Must not contain raw secrets. |
| Secret-store key names | Sensitive metadata in some deployments | May reveal provider/account/service intent. |
| Secret values | Highly sensitive | Inject only at narrow boundaries; never log. |
| Refreshed credentials | Highly sensitive | Store only in protected state/credential files. |
| `/agent` runtime | Trusted base | Must be immutable from agent tools. |

## Filesystem policy

Default writable paths are:

```text
/workspace
/tmp
/state
```

Requirements:

- `/agent` MUST be read-only and outside `/workspace`.
- `/agent/skills`, when present, MUST be read-only.
- `/secrets`, when present, MUST be read-only.
- `/state/credentials` and `/state/cache/secrets` MUST be writable only by the sandbox user and MUST NOT be browsable by ordinary file tools unless explicitly allowed.
- Agent-visible file operations MUST resolve paths before execution.
- Relative tool paths MUST resolve from `/workspace` unless the tool explicitly targets `/state` or `/tmp`.
- Writes outside configured writable roots MUST be denied.
- Symlink escapes MUST be denied when `security.filesystem.denySymlinkEscape` is true.
- File tools MUST NOT follow symlinks into `/agent`, `/agent/skills`, `/secrets`, `/state/credentials`, `/state/cache/secrets`, host root mounts, or container runtime sockets unless explicitly allowed by a stronger host policy.

Recommended container flags:

```text
--read-only
--mount type=bind|volume,target=/workspace
--mount type=volume,target=/state
--tmpfs /tmp
--mount type=bind,src=<secrets>,target=/secrets,readonly
```

## Runtime code and skill isolation

The agent must not be able to modify its own runtime or built-in skills.

- `/agent` SHOULD be owned by root or a build user and mounted/read-only at runtime.
- `/agent/skills` SHOULD be owned by root or a build user and mounted/read-only at runtime.
- The sandbox user SHOULD have read/execute permissions only.
- Boot scripts and tool commands MUST NOT write into `/agent` or `/agent/skills` in production profiles.
- If runtime plugin or skill installation is supported in the future, it MUST use a separate explicit extension directory with policy and provenance checks.

Workspace `AGENTS.md` files and `.agents/skills` are untrusted prompt resources. They MUST NOT grant tools, filesystem permissions, network permissions, or credential access.

## Process policy

The sandbox daemon and tools MUST run as a non-root user in production profiles.

Requirements:

- Production containers MUST NOT run privileged.
- Production containers MUST run as the `sandbox` user or another non-root UID/GID.
- `no_new_privileges` SHOULD be enabled.
- Linux capabilities SHOULD be dropped by default.
- Process count, memory, CPU, file descriptor, and runtime limits SHOULD be configured.
- Tool subprocesses MUST be children of the sandbox daemon or a managed supervisor.
- The daemon MUST be able to cancel or reap tool subprocesses.
- Long-running unmanaged background processes MUST be denied by default.
- `sudo`, `su`, privilege escalation helpers, and host service managers SHOULD be absent or denied.

The sandbox MUST NOT mount:

- Docker/container runtime sockets;
- host `/var/run/docker.sock`;
- host root filesystem;
- cloud metadata credential paths;
- SSH agent sockets unless explicitly allowed for a narrow use case.

## Root and boot hardening

Boot scripts are useful but risky.

Requirements:

- Git/GitHub startup setup runs before boot when configured.
- Boot scripts MUST run before the sandbox accepts run commands.
- Boot scripts MUST be time-limited.
- Boot output MUST be bounded and redacted.
- Boot filesystem writes MUST follow configured policy.
- Boot network access MUST follow configured policy.
- Boot failure MUST produce durable state and an event when possible.
- Production boot phases MUST run as the non-root sandbox user.
- `boot.runAs: root` or a root boot phase is an unsafe/dev profile. It MUST be explicitly configured, SHOULD be rejected by production managers, and MUST emit a visible degraded-security event.
- Boot scripts MUST NOT silently escalate to root for package installation.

For reproducibility and least privilege, system packages should be installed in a derived image rather than at runtime.

## Network and firewall policy

Network policy has two levels:

1. declared policy in YAML;
2. actual enforcement by container runtime, sidecar, firewall, proxy, CNI, or host platform.

Requirements:

- The sandbox MUST interpret `security.network` before making provider/tool/controller/secret-store/setup calls.
- If the implementation cannot enforce a declared deny/allow rule, it MUST report that limitation in `sandbox.config.loaded` or `sandbox.security.denied`.
- Default production posture SHOULD be `default: deny` with explicit egress allowlist.
- Controller WebSocket, configured model/tool providers, credential refresh endpoints, secret-store endpoints, Git/GitHub hosts, Atlassian hosts, and package registries MUST be allowlisted when default deny is used.
- DNS and proxy behavior MUST be documented by the implementation.

Recommended allowlist categories:

- controller API host;
- manager key-value secret endpoint hosts;
- selected model provider APIs and OAuth refresh endpoints;
- selected web search provider APIs;
- Jira/Confluence hosts when enabled;
- Git/GitHub hosts when enabled;
- package registries only during controlled boot/tool phases;
- organization package/proxy mirrors where configured.

If `sandbox.security.firewall.v1` is advertised, the sandbox/controller pair may rely on structured firewall enforcement.

```ts
type NetworkPolicyStatus = {
  requestedDefault: "allow" | "deny";
  enforcedDefault: "allow" | "deny" | "unknown";
  allowedHosts: string[];
  deniedHosts: string[];
  packageRegistryHosts?: string[];
  backend: "container" | "iptables" | "nftables" | "proxy" | "cni" | "none";
  limitations?: string[];
};
```

If the backend is `none` or `unknown`, the implementation MUST NOT claim strict egress isolation.

## Secret stores

Key-value secret stores allow a manager server or other service to return secret values by key.

Requirements:

- Secret-store endpoint URLs and auth credentials MUST come from validated config and `SecretRef` values.
- Store auth API keys, bearer tokens, and OAuth bundles are secrets.
- Secret-store requests MUST use TLS except for explicitly local/private endpoints protected by runtime network isolation.
- Store key names MAY be sensitive metadata. Events SHOULD expose key names only when configured; otherwise they SHOULD hash or redact them.
- Secret-store responses MUST be bounded, parsed according to config, and treated as secret material immediately.
- Store responses MUST NOT be exposed to the model or tool output except through narrow credential injection to the provider/tool that requested them.
- Optional caches MUST live in memory or protected state, honor TTL/expiry/revocation semantics where available, and be excluded from ordinary snapshots/artifacts.
- A failed store lookup MUST fail closed for the affected credential unless a still-valid cached value is allowed by policy.
- Recursive secret refs in store auth MUST be detected and rejected.

## `apt` and system package installation

Runtime system package installation is disabled by default.

Requirements:

- `security.apt.allowed: false` MUST block runtime `apt`, `apt-get`, and equivalent system package-manager mutations where detected.
- Build-time installation in a derived image is the RECOMMENDED path.
- Runtime apt requires a deliberately weaker profile with root/write access and MUST be reported as non-reproducible unless package versions and transcripts are captured.
- Boot scripts MUST NOT silently escalate to root for package installation.

## Language package registry access

Language package managers, such as `pnpm`, `npm`, `yarn`, `pip`, `poetry`, `uv`, `mvn`, `gradle`, `cargo`, `go`, `bundle`, and `nuget`, are workspace mutations and network operations.

Requirements:

- Package manager network access MUST be explicitly allowed by boot/tool phase policy and `security.network`/firewall configuration.
- Public registries and private registry mirrors SHOULD be allowlisted by host, for example through `security.network.packageRegistryHosts` and `security.network.allow`.
- Registry tokens MUST be supplied by `SecretRef` values and injected only into the package-manager invocation or temporary config under protected state.
- Dependency caches SHOULD live under `/state/cache/dependencies` or another configured cache path, not `/agent`.
- Package installs MUST write only to `/workspace`, `/tmp`, `/state`, configured cache dirs, or package-manager cache dirs under protected state.
- Lockfiles SHOULD be used in production. Installs that update lockfiles SHOULD be classified as workspace writes and may require approval.
- Install transcripts SHOULD be bounded, redacted, and recorded with lockfile digests before/after where possible.
- Package install scripts should be treated as untrusted code executed inside the sandbox boundary.

## Credential refresh

OAuth refresh tokens, access tokens, API keys, PATs, cookies, SSH keys, GPG keys, passphrases, package registry tokens, and secret-store credentials are secrets.

Requirements:

- The sandbox MUST NOT initiate interactive login flows.
- OAuth refresh is allowed only when the manager supplies refresh material through `CredentialConfig`.
- Refreshed credentials MUST be written only to protected `/state/credentials` or an explicitly configured credential file outside `/workspace`.
- Refreshed credential writes MUST use temp-file + fsync/equivalent + atomic rename where practical.
- Refresh failures MUST be redacted and fail closed for the affected provider/tool/setup when no valid token remains.
- Credential-refresh events MUST include only safe metadata: provider, credential type, expiry, status, and error code/message without secret values.
- A valid previous credential SHOULD be preserved if a refresh attempt fails after writing a partial result.

## Secret handling

Secrets include API keys, OAuth tokens, passwords, cookies, SSH keys, private keys, GPG keys, credential envelopes, provider headers, package registry tokens, controller transport keys, and key-value secret-store values.

Requirements:

- Secrets MUST be supplied by `SecretRef` or controller-managed secure injection.
- Raw secret values MUST NOT appear in YAML examples, config digests, skills, `AGENTS.md`, ordinary state snapshots, or command-line arguments that may be logged by the host.
- Raw secret values MUST NOT be sent in protocol metadata, ordinary events, transcripts, logs, or error messages.
- Tool subprocesses MUST receive only the secrets they need.
- Secret files MUST be read-only unless explicitly configured as protected credential-refresh outputs.
- Redaction MUST be recursive and bounded.

If a tool output appears to contain a configured secret value, the sandbox SHOULD redact it before storing or sending it.

## Git and GitHub secrets

Git/GitHub credentials are high-value and often provide write access to source code. They are configured through top-level `git` and `github` blocks and may be used by startup setup or later policy-approved commands.

Requirements:

- PATs/App tokens MUST be injected only into GitHub API/CLI clients, normally through `GH_TOKEN` or equivalent scoped environment variables/protected CLI auth files.
- SSH private keys MUST be materialized only in protected state or read directly from read-only secrets; they MUST NOT be copied to `/workspace`.
- `known_hosts` SHOULD be pinned by config or provided by the manager for SSH remotes.
- `GIT_SSH_COMMAND`, SSH config, and credential helpers MUST be scoped to the setup/tool call or sandbox user, not host-global state.
- Remote URLs containing credentials MUST be normalized/redacted before logs/events/model output.
- GPG private keys and passphrases MUST be imported only into an isolated `GNUPGHOME` under protected state and removed according to retention policy.
- Commit signing SHOULD use configured key IDs and isolated signing state.
- `gh auth login` and browser/device GitHub login flows MUST be denied.

## Provider requests

Model provider requests may contain user/workspace content, context files, skills, and tool results.

- Provider API keys and OAuth access tokens MUST be injected only into provider clients.
- Provider request/response metadata emitted to events MUST be safe and bounded.
- Full provider payload logging SHOULD be disabled by default.
- If enabled for debugging, payload logs MUST be local, redacted, bounded, and clearly marked sensitive.

## Controller command validation

Authenticated controller commands still require validation.

The sandbox MUST validate:

- protocol envelope;
- accepted capabilities;
- method name;
- command ID/idempotency;
- conversation/agent/run identifiers;
- requested tool/group availability;
- approval IDs and pending-input IDs;
- payload sizes and content types.

## Security conformance checklist

A production-ready implementation SHOULD verify:

- non-root runtime;
- read-only `/agent` and `/agent/skills`;
- no host/container sockets mounted;
- protected `/state/credentials` and `/state/cache/secrets`;
- no raw secrets in logs/events/transcripts/snapshots;
- secret-store requests comply with network/firewall policy;
- Git/GitHub setup happens before boot and does not expose secrets;
- writes outside allowed roots are denied;
- symlink escapes are denied;
- shell/Python commands are bounded;
- long-running tasks are supervised;
- package-manager access is controlled by boot/tool policy and network/firewall allowlists;
- Git/GitHub command checks happen before invoking `git` or `gh`;
- network allowlists happen in the runtime/proxy/firewall;
- destructive operations require approval where configured.
