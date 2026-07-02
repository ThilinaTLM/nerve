# Runtime Image

The sandbox image packages the Nerve agent runtime and sandbox daemon. It must be usable by generic container platforms while preserving a strict separation between runtime code, built-in skills, workspace files, durable state, refreshed credentials, secret-store cache/status, scratch files, package caches, and secrets.

## Required filesystem layout

A conforming image/container MUST support these paths:

| Path | Required | Writable by agent tools | Purpose |
| --- | --- | --- | --- |
| `/agent` | yes | no | Sandbox daemon and Nerve agent runtime code. |
| `/agent/skills` | optional but recommended | no | Built-in image-packaged `SKILL.md` files. |
| `/workspace` | yes | yes | Working directory for repository/user files. May contain `AGENTS.md` and `.agents/skills`. |
| `/state` | yes | yes, except protected subtrees | Durable journals, checkpoints, transcripts, refreshed credentials, secret-store cache/status, Git/GitHub setup status, skills metadata, run/conversation/agent state. |
| `/state/credentials` | yes when credential refresh or protected auth material is enabled | no ordinary file-tool access | Protected refreshed credential store and scoped auth homes. |
| `/state/cache/dependencies` | optional | controlled | Package-manager caches for boot/tool dependency installs. |
| `/state/cache/secrets` | optional | no ordinary file-tool access | Protected key-value secret cache metadata/values when caching is enabled. |
| `/tmp` | yes | yes | Non-durable scratch space. |
| `/secrets` | optional | no | Mounted read-only secret files. |
| `/credentials` | optional | no ordinary file-tool access | Manager-owned writable credential-sync mount when `refresh.persist: file` is used. |

Requirements:

- `/agent` MUST be read-only from the sandbox user and all tool processes.
- `/agent/skills`, when present, MUST be read-only from the sandbox user and all tool processes.
- `/workspace` MUST be the default current working directory for agent tools.
- `/workspace/AGENTS.md` and `/workspace/.agents/skills` are workspace resources, not privileged runtime files.
- `/state` SHOULD be mounted as a persistent volume for durable operation.
- `/state/credentials` and `/state/cache/secrets` MUST have restrictive permissions and MUST NOT be included in ordinary snapshots, transcripts, or workspace archives.
- `/state/cache/dependencies` MAY be retained across restarts but MUST NOT be required to reconstruct run state.
- `/tmp` MAY be ephemeral and SHOULD NOT be used for recovery-critical state.
- `/secrets`, when present, MUST be read-only and MUST NOT be included in transcripts, events, or workspace archives.

## Entrypoint contract

The image MUST provide an entrypoint that performs this sequence:

1. Locate the YAML config.
2. Parse and validate the config.
3. Compute and persist the sanitized config digest.
4. Acquire a state lock for `/state`.
5. Recover any existing local journals, refreshed credentials, secret-store status, Git/GitHub setup status, skill diagnostics, conversations, agents, runs, and checkpoints.
6. Initialize protected state directories such as `/state/credentials`, `/state/cache/secrets`, and dependency caches.
7. Apply container-visible security setup that can be enforced from inside the container.
8. Initialize secret resolvers and secret-store clients without logging values; resolve only startup-critical secret-store/controller auth at this point.
9. Resolve model catalog provider/model metadata and verify selected `agent.mainModel`/`agent.exploreModel` selectors.
10. Apply top-level Git setup, including identity, signing state, remotes, credentials, safe-directory config, and optional clone.
11. Apply top-level GitHub setup, including CLI/API auth and default repo metadata.
12. Load `AGENTS.md` context files and configured `SKILL.md` resources. If Git clone populated `/workspace`, loading MUST occur after clone.
13. Run optional custom boot phases if configured.
14. Start the sandbox daemon event loop.
15. Connect to the controller WebSocket.
16. Resume or announce the latest durable sandbox state.

See [Boot Sequence](./boot-sequence.md) for the normative startup state machine.

The entrypoint MUST NOT start the agent before config validation, startup setup, resource loading, and required boot phases succeed or enter an explicitly configured degraded state.

## Config location

The container SHOULD support one of these config inputs:

- `NERVE_SANDBOX_CONFIG=/path/to/config.yaml` environment variable;
- default file `/etc/nerve/sandbox.yaml`;
- controller-provided config mounted into a read-only path.

If multiple locations are provided, `NERVE_SANDBOX_CONFIG` SHOULD take precedence.

## Environment variables

Reserved environment variables:

| Variable | Purpose |
| --- | --- |
| `NERVE_SANDBOX_CONFIG` | Path to YAML config. |
| `NERVE_SANDBOX_ID` | Optional controller-assigned sandbox ID. |
| `NERVE_SANDBOX_INSTANCE_ID` | Optional unique process/container instance ID. |
| `NERVE_SANDBOX_STATE_DIR` | Optional override for `/state`. |
| `NERVE_SANDBOX_WORKSPACE_DIR` | Optional override for `/workspace`. |
| `NERVE_SANDBOX_LOG_LEVEL` | Optional log-level override. |
| `NERVE_SANDBOX_CONTROLLER_EXIT_AFTER_MS` | Optional manager-provided override for controller disconnect self-exit, subject to YAML validation. |

Provider/tool/controller/secret-store secrets MAY also be supplied through environment variables named by the config's `SecretRef` values. The sandbox MUST NOT enumerate and forward all environment variables to model providers or tool processes; secrets must be injected only where explicitly configured.

## Container runtime defaults

A production sandbox SHOULD be launched with equivalent protections:

```text
--read-only
--user <non-root-uid>:<non-root-gid>
--cap-drop=ALL
--security-opt no-new-privileges:true
--pids-limit <bounded>
--memory <bounded>
--cpus <bounded>
--network <policy-specific>
-v workspace:/workspace
-v state:/state
--tmpfs /tmp
--mount type=bind,src=<secrets>,target=/secrets,readonly
```

Requirements:

- The sandbox daemon MUST run as a non-root user in production profiles.
- The container MUST NOT be privileged in production profiles.
- The Docker socket, host container runtime socket, cloud metadata credentials, and host root filesystem MUST NOT be mounted into the sandbox.
- Linux capabilities SHOULD be dropped by default.
- Root filesystem read-only mode SHOULD be used where compatible.
- Writable mounts MUST be explicit.
- Secret and credential mounts MUST NOT be mounted below `/workspace`.

## Runtime user

The default runtime user SHOULD be named `sandbox` and have:

- no password login;
- no sudo privileges;
- ownership or write permission for `/workspace`, `/state`, and `/tmp` only;
- read/execute permission for `/agent` and `/agent/skills`;
- read-only permission for configured secret files;
- restrictive ownership for `/state/credentials`, `/state/cache/secrets`, and any temporary SSH/GPG/package-manager credential homes.

If a boot step requires root, it SHOULD be moved to build time. Runtime root is only for explicit unsafe/dev profiles and SHOULD be rejected by production managers.

## Git/GitHub startup setup

When top-level `git` or `github` is enabled, the entrypoint applies setup before boot phases.

Requirements:

- Setup MUST run after config validation and protected state initialization.
- Setup MUST NOT expose raw credentials in logs, command lines, events, or model-visible files.
- SSH config, GPG homes, credential helpers, and GitHub CLI auth files SHOULD live under protected state.
- Optional clone MUST respect target directory policy and configured non-empty workspace behavior.
- Startup network calls MUST comply with `security.network` and advertised firewall policy.
- Setup status MUST be recorded under `/state` and emitted in sanitized config/status events when possible.
- Failure MUST prevent boot/run acceptance unless the config explicitly allows a degraded read-only mode.

## Boot phase

If `boot.script` or `boot.phases` is configured, the entrypoint runs custom boot phases after secret resolver initialization, Git setup, GitHub setup, and resource loading, but before accepting commands. Boot phase semantics are defined in [Boot Sequence](./boot-sequence.md).

Requirements:

- Boot MUST run after config validation and before the sandbox emits `sandbox.ready`.
- Boot stdout/stderr MUST be bounded and redacted before events/logs.
- Boot start, completion, failure, and timeout MUST be recorded in `/state` and emitted when possible.
- If `boot.onFailure` is `fail_sandbox`, the daemon MUST not accept run commands after a failed boot.
- If `boot.onFailure` is `continue_readonly`, the daemon MUST force a read-only or stricter policy before accepting commands.
- Production boot MUST run as the `sandbox` user.
- `boot.runAs: root` or phase-level root MUST emit a degraded-security warning and SHOULD be rejected outside unsafe/dev profiles.
- Runtime `apt` during boot MUST be denied unless `security.apt.mode` explicitly allows runtime package installation and the container was launched with the required privileges.
- Language dependency installation during boot MUST comply with `boot.phases[*].network`, `security.network`, firewall policy, filesystem policy, and narrow secret injection.
- Boot MUST NOT write to `/agent` or `/agent/skills`.

## Package managers and dependency caches

The runtime image SHOULD provide common package-manager binaries or allow project-specific tools to bootstrap them inside `/workspace` when policy permits.

Requirements:

- Dependency caches SHOULD live under `/state/cache/dependencies` or an implementation-documented equivalent.
- Package manager temporary credential files MUST live under protected state and be removed or retained according to retention policy.
- Package registry network egress MUST be limited to configured hosts when default-deny networking is used.
- Public registry defaults, private mirrors, and package registry hosts MUST be reported in effective config/status without credential values.
- There is no top-level dependency configuration block; package access is derived from boot/tool phase policy, network/firewall allowlists, cache paths, and secret refs.

## Context files and skills

Images MAY package built-in skills under `/agent/skills`:

```text
/agent/skills/
  agent-browser/SKILL.md
  frontend-design/SKILL.md
```

Project resources MAY live in the workspace:

```text
/workspace/
  AGENTS.md
  .agents/
    skills/
      project-review/SKILL.md
```

Requirements:

- Built-in skills MUST be immutable from the sandbox user and tool processes.
- Workspace `AGENTS.md` and `.agents/skills` are untrusted project prompt resources.
- Skill/context loading MUST honor the configured `skills` policy.
- Skill diagnostics SHOULD be persisted under `/state/skills`.
- The system prompt SHOULD include loaded context and list loaded model-visible skills using `<available_skills>`.
- Skills and context files MUST NOT grant tools, filesystem access, network access, or credentials.

## Credential and secret-store state

When refreshable credentials or secret-store caching are configured, the sandbox SHOULD create protected directories such as:

```text
/state/credentials/
  oauth/<provider>.json
  ssh/
  gpg/
/state/cache/secrets/
  metadata.json
```

Requirements:

- Protected directories SHOULD be `0700`; credential files SHOULD be `0600`.
- Writes SHOULD use temporary file + flush + atomic rename.
- A failed refresh or secret-store fetch MUST NOT corrupt the last valid credential bundle or cache metadata.
- Credential and secret cache files MUST NOT be exposed through ordinary file tools, snapshots, transcripts, or artifact exports.

## Controller disconnect self-exit

A sandbox daemon MUST not run indefinitely when detached from its manager/controller. When the controller WebSocket is lost for a retryable reason, the daemon enters reconnecting state. If it cannot establish a valid protocol session within `controller.disconnectPolicy.exitAfterMs`, default `300000` ms, it MUST exit itself.

Requirements:

- The disconnect timer starts when an established protocol session is lost or a retryable connection/session error occurs.
- Successful WebSocket authentication and `welcome` reset the timer.
- During reconnecting state, the sandbox SHOULD continue bounded local cleanup and checkpointing but MUST NOT start new controller-commanded runs.
- Before exiting, the sandbox SHOULD persist controller connectivity status under `/state`, enqueue shutdown events when possible, and close tool processes.
- The manager is responsible for observing exit and garbage-collecting the container according to retention policy.

## Healthcheck

The image SHOULD expose a local healthcheck command, for example:

```sh
nerve-sandbox healthcheck
```

A healthy sandbox means:

- config loaded successfully;
- `/workspace`, `/state`, and `/tmp` are accessible with expected permissions;
- `/agent` and `/agent/skills` are read-only from the sandbox user;
- protected credential/cache directories have expected permissions when enabled;
- the state lock is held by this process;
- model catalog and selected agent models resolved;
- required secret stores are configured and startup-critical references are resolvable;
- Git/GitHub startup setup completed, skipped, or is in a configured degraded state;
- boot has completed or is not configured;
- context/skill loading completed or diagnostics were recorded;
- conversation/agent/run state was recovered or initialized;
- the daemon event loop is responsive;
- the controller WebSocket is connected or reconnecting according to policy, and if reconnecting the disconnect grace period has not expired.

A healthcheck MUST NOT require raw secrets to be printed or sent.

## Exit codes

Recommended exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Graceful shutdown after `goodbye` or completed one-shot mode. |
| `10` | Config validation failed. |
| `11` | Required mount missing or not writable/readable as required. |
| `12` | State lock conflict. |
| `13` | Boot phase failed. |
| `14` | Security setup failed. |
| `15` | Required credential or secret-store value unavailable or unrefreshable before ready. |
| `16` | Skill/context loading failed in fail-closed mode. |
| `17` | Git/GitHub startup setup failed. |
| `20` | Controller authentication failed. |
| `21` | Controller protocol/session rejected. |
| `22` | Controller disconnect grace period expired; sandbox self-exited. |
| `30` | Unrecoverable state corruption. |

## Image labels

Images SHOULD include labels such as:

```text
org.nerve.sandbox.spec=v1
org.nerve.sandbox.runtime.version=<runtime-version>
org.nerve.sandbox.skills.digest=<skills-digest>
```

These labels help controllers correlate events, image provenance, skills, and reproducibility.

## Recovery summary

On restart, the entrypoint SHOULD:

1. reacquire the state lock;
2. validate the current sanitized config digest against prior state;
3. recover credential and secret-store status;
4. recover Git/GitHub setup status and reapply idempotent setup if required;
5. restore conversations, agents, runs, checkpoints, and outbox cursors;
6. reload context files and skills if workspace/image/config inputs changed;
7. replay unacknowledged durable events;
8. reconnect to the controller and announce recovered state.
