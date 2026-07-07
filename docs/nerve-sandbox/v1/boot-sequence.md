# Boot Sequence

Sandbox v1 startup is a deterministic sequence. A sandbox MUST complete required startup phases, or enter an explicitly configured degraded state, before it accepts run commands.

This document is normative for the sandbox agent image and daemon.

## Phase order

The sandbox entrypoint MUST perform phases in this order:

1. **Process preflight**
   - Verify runtime user, required paths, mount permissions, and prohibited mounts where detectable.
   - Initialize logging with redaction.

2. **Locate config**
   - Load `NERVE_SANDBOX_AGENT_CONFIG` or the default config path.

3. **Parse and validate config**
   - Validate the full YAML document, including conditional requirements.
   - Reject unknown fields unless an explicit compatibility mode allows them.

4. **Acquire state lock**
   - Lock `/state` or configured state directory before recovery or writes.

5. **Initialize protected state**
   - Create `/state/credentials`, `/state/cache/secrets`, setup, boot, skills, command, and event directories with restrictive permissions.

6. **Recover state**
   - Load previous config digest, local journals, checkpoints, credentials status, secret-store status, setup status, skills metadata, run state, and ack cursors.

7. **Initialize secret resolution**
   - Build the `SecretResolver` for `env`, `file`, and `kv` refs.
   - Initialize secret-store clients.
   - Resolve only startup-critical secret-store auth and controller auth.

8. **Resolve model catalog metadata**
   - Resolve built-in/custom provider and model metadata.
   - Validate `agent.mainModel` and `agent.exploreModel` selectors.
   - Do not call model providers unless readiness policy requires credential validation.

9. **Apply Git setup**
   - Configure identity, signing, credentials, safe directory, remotes, LFS, and optional clone.

10. **Apply GitHub setup**
    - Configure GitHub API/CLI authentication and default repo metadata without interactive login.

11. **Load context and skills**
    - Load `AGENTS.md` and `SKILL.md` resources after any configured clone.

12. **Run custom boot phases**
    - Run `boot.script` and/or `boot.phases` in config order.

13. **Connect to controller**
    - Open the WebSocket, authenticate, negotiate protocol capabilities, and recover cursors.

14. **Announce state**
    - Emit `sandbox.config.loaded`, setup/boot/skills status events, and `sandbox.ready` or degraded/failed status.

The sandbox MUST NOT start the agent harness before required setup, resource loading, and boot phases complete or enter a configured degraded state.

## Startup-critical vs lazy secrets

Secrets SHOULD be resolved lazily. Startup does not mean resolving every configured provider/tool secret.

Startup-critical secrets are limited to secrets required to complete startup phases, such as:

- controller WebSocket API key;
- secret-store authentication needed to resolve startup-critical secrets;
- Git clone/remotes/signing secrets needed during Git setup;
- GitHub auth needed during GitHub setup;
- boot phase environment secrets for the phase currently executing;
- model credentials only when the implementation performs startup model credential validation or refresh before readiness.

Tool credentials, web/Jira/Confluence credentials, package registry tokens for later tool calls, and model credentials for future runs SHOULD remain unresolved until needed.

Resolved secrets MUST be injected only into the process/client that needs them and MUST NOT appear in logs, events, transcripts, snapshots, command lines, or config digests.

## Boot config execution model

```ts
type BootExecutionPlan = {
  phases: BootExecutionPhase[];
  defaultTimeoutMs: number;
  defaultRunAs: "sandbox" | "root";
  defaultNetwork: "inherit" | "deny" | "package_registries_only";
  onFailure: "fail_sandbox" | "continue_readonly";
};

type BootExecutionPhase = {
  index: number;
  name: string;
  script: string;
  timeoutMs: number;
  runAs: "sandbox" | "root";
  network: "inherit" | "deny" | "package_registries_only";
  env: Record<string, SecretRef>;
};
```

Requirements:

- `boot.script`, when present, is treated as a phase named `default` before `boot.phases` unless an implementation documents that `boot.script` and `boot.phases` are mutually exclusive. The recommended implementation is to reject configs that set both to avoid ambiguity.
- `boot.phases[*].name` MUST be unique and non-empty.
- Phases MUST run in config order.
- Each phase MUST have a timeout.
- Production phases MUST run as `sandbox` unless an unsafe/dev profile explicitly allows root.
- Phase stdout/stderr MUST be bounded and redacted.
- Phase transcripts and status MUST be written to `/state/boot`.
- Phase environment variables MUST include only safe defaults plus the phase's explicit `env` secret refs.
- Phase working directory SHOULD default to `/workspace`.
- Phase writes MUST follow filesystem policy.

## Network policy composition

Boot phase network mode MUST NOT expand global network policy. Effective boot egress is the intersection of:

1. container/runtime network attachment;
2. `security.network.default`, `allow`, and `deny`;
3. `security.firewall` backend enforcement;
4. `boot.network` default;
5. `boot.phases[*].network` override for the current phase.

Semantics:

| Phase network mode | Effective behavior |
| --- | --- |
| `deny` | No external network egress except loopback/private manager endpoints explicitly required for controller/secret resolution and allowed by global policy. |
| `package_registries_only` | Egress only to `security.network.packageRegistryHosts` that also appear in the global allowlist when default deny is used. |
| `inherit` | Egress allowed only by the global network/firewall policy; it does not bypass denies. |

If a phase requests network access that cannot be enforced, the sandbox MUST either fail closed or emit a degraded-security event according to production/dev profile. A production profile SHOULD fail closed when strict network enforcement is required but unavailable.

## Setup phase network use

Git and GitHub setup occur before custom boot phases. Their network access is controlled by the same composition model:

- Git clone/fetch/pull may contact configured Git remote hosts only when allowed by `security.network` and firewall policy.
- GitHub API/CLI setup may contact `github.host` and API hosts only when allowed.
- Secret-store lookups may contact configured secret-store endpoints only when allowed.
- Controller WebSocket host must be allowed when default deny is used.

Setup phases MUST report a clear unavailable/failed status when network policy blocks required hosts.

## Failure behavior

Startup failures are classified as:

```ts
type StartupFailureKind =
  | "config_validation"
  | "mount_permissions"
  | "state_lock"
  | "secret_unavailable"
  | "model_unavailable"
  | "git_setup_failed"
  | "github_setup_failed"
  | "skills_failed"
  | "boot_failed"
  | "controller_unreachable"
  | "security_enforcement_unavailable";
```

Default behavior is fail closed. The daemon exits non-zero or stays failed and refuses run commands.

### `boot.onFailure: fail_sandbox`

The sandbox MUST NOT accept run commands after a required boot phase fails. It SHOULD emit/persist `sandbox.boot.completed` with `status: "failed"` and a redacted error, then exit or remain in failed status according to runtime policy.

### `boot.onFailure: continue_readonly`

The sandbox MAY become `degraded` and accept only safe commands. Effective restrictions MUST include:

- file inspection allowed within policy;
- status/snapshot commands allowed;
- input/approval resolution allowed only for already-waiting runs if safe;
- file editing disabled;
- shell/Python mutation disabled;
- package installs disabled;
- Git/GitHub mutations disabled;
- deployment/external mutation tools disabled;
- new runs allowed only if the effective tool set is read-only and the controller accepts degraded mode.

The degraded reason MUST be visible in status, snapshots, and `sandbox.ready` or equivalent events.

## Idempotent setup on restart

On restart, setup phases SHOULD be idempotent:

- Git identity/config may be reapplied.
- Git clone should respect `git.clone.ifWorkspaceNotEmpty`.
- GitHub CLI/API auth files may be regenerated under protected state.
- Boot phases are rerun only when the implementation policy says startup boot is always run, the config digest changed, the workspace changed, or a previous attempt did not complete. The selected policy MUST be recorded in `/state/boot/attempts.jsonl`.

If rerunning a boot phase could be destructive, the phase should be designed by the manager/user to be idempotent or guarded. The sandbox MUST still enforce filesystem, network, timeout, and secret injection policy.

## Boot events

Boot and setup phases SHOULD emit these durable events with payload schemas from [Event Schemas](./event-schemas.md):

- `sandbox.secret_store.checked`
- `sandbox.setup.git.started`
- `sandbox.setup.git.completed`
- `sandbox.setup.github.started`
- `sandbox.setup.github.completed`
- `sandbox.boot.started`
- `sandbox.boot.completed`
- `sandbox.skills.loaded`
- `sandbox.ready`

Events MUST be written to the outbox before delivery and MUST contain no raw secrets or unbounded transcripts.

## Conformance checks

A conforming implementation SHOULD test:

- boot phases run after Git/GitHub setup;
- context/skills load after clone;
- phase order is stable;
- duplicate phase names are rejected;
- phase secret env vars are injected narrowly;
- phase logs are bounded/redacted;
- `package_registries_only` cannot reach non-registry hosts;
- `deny` blocks package install network access;
- setup failure fails closed by default;
- `continue_readonly` disables mutation tools;
- restart records whether boot was rerun or skipped.
