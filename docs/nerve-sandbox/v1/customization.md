# Customization

Sandbox customization has five layers for the sandbox agent image/runtime, plus a separate manager layer that decides how containers are launched and observed. Reproducible behavior depends on keeping these layers explicit and pinned.

```text
Manager launch policy -> Base image -> Derived image -> Built-in skills -> Runtime YAML config -> Boot phases
```

## Customization layers

| Layer | When applied | Reproducibility | Purpose |
| --- | --- | --- | --- |
| Base image | Build time | High if pinned by digest | OS, Node, sandbox daemon, core runtime. |
| Derived image | Build time | High if pinned and locked | Project/tool dependencies, system packages, certificates, git/gh/gpg/ssh tooling. |
| Built-in skills | Build time | High if versioned with image | Immutable `SKILL.md` task guidance under `/agent/skills`. |
| Runtime YAML config | Start time | High if digested | Model catalog, agent selectors, secret stores, top-level Git/GitHub setup, tool groups, controller URL, skills/context paths, policy, resources. |
| Boot phases | Start time | Medium/low | Final workspace setup, dependency install, generated files, and convenience commands. |
| Manager launch policy | Before start | High if stored | Container backend, image digest, volume refs, config mount, secret mounts, network/security profile, retention, and GC. |

Build-time customization is preferred for stable dependencies. Runtime boot phases are useful for per-workspace setup but should be treated as mutable and recorded. Manager launch policy should be stored with sandbox records so a container can be explained or recreated.

## Base image requirements

A Sandbox v1 base image SHOULD provide:

- Nerve sandbox daemon;
- Nerve agent runtime under `/agent`;
- optional built-in skills directory under `/agent/skills`;
- Node.js runtime compatible with the packaged agent;
- shell environment for configured shell tools;
- optional Python runtime if Python tools are supported;
- common repository tooling where practical: `git`, `openssh-client`, `gpg`, and optionally `gh`;
- CA certificates and minimal diagnostics;
- non-root `sandbox` user;
- entrypoint and healthcheck command.

The reference `packages/sandbox-agent/Dockerfile` includes a broad generic development toolchain: Node 24 with `npm`, `pnpm`, `yarn`, Corepack, and `nvm`; Python 3 with `pip`, `venv`, `pipx`, and `uv`/`uvx`; the default JDK; GCC/G++, `make`, CMake, Ninja, pkg-config, and autotools; Git/Git LFS, SSH/GPG; and common diagnostics/archive helpers such as `curl`, `wget`, `jq`, `ripgrep`, `shellcheck`, `sqlite3`, `rsync`, `zip`, and `unzip`. Heavier or more sensitive tools such as Docker/Podman CLIs, cloud CLIs, browsers, database servers, and project-specific SDKs should be added in derived images when the controller policy explicitly allows them.

The base image SHOULD be referenced by immutable digest in production:

```Dockerfile
FROM ghcr.io/example/nerve-sandbox-agent@sha256:<digest>
```

## Derived image pattern

A project or platform can build a derived image for reproducible dependencies:

```Dockerfile
FROM ghcr.io/example/nerve-sandbox-agent@sha256:<digest>

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    gh \
    gpg \
    openssh-client \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Optional: add organization CA certificates, language runtimes, or tools.
# COPY corp-ca.crt /usr/local/share/ca-certificates/corp-ca.crt
# RUN update-ca-certificates

# Optional built-in skills. Do not copy secrets.
COPY skills/ /agent/skills/
RUN chmod -R a-w /agent/skills

USER sandbox
WORKDIR /workspace
```

Guidelines:

- Pin the base image by digest.
- Pin apt/package versions where practical.
- Prefer lockfiles for language dependencies.
- Keep secrets out of image layers.
- Record source revision, built-in skills digest, and build metadata in OCI labels.

## Built-in skills

Built-in skills are image-packaged `SKILL.md` files under `/agent/skills`.

Recommended layout:

```text
/agent/skills/
  agent-browser/SKILL.md
  frontend-design/SKILL.md
  org-review/SKILL.md
```

Guidelines:

- Treat built-in skills as part of the image artifact.
- Version them with the image and include their digest in provenance metadata.
- Keep secrets, access tokens, and environment-specific credentials out of skills.
- Use skills for task-specific guidance, not for policy enforcement.
- Remember that skill metadata is advisory and cannot grant tool permissions.

## Runtime config

Runtime YAML config is part of reproducibility. The sandbox MUST compute a config digest as described in [Configuration](./configuration.md#config-digest).

The controller SHOULD store:

- image reference and digest;
- sandbox runtime version;
- config digest;
- sanitized config copy;
- model catalog and selected model summary;
- secret-store endpoint IDs and credential reference names, not values;
- top-level Git/GitHub setup summary;
- effective tool groups;
- effective context/skill search paths and loaded skill names;
- workspace source revision if known;
- state volume identity;
- boot transcript digest when boot is used.

## Project and controller-provided resources

Runtime prompt resources may come from:

- project `AGENTS.md` files under `/workspace` and safe ancestors within the workspace mount;
- project skills under `/workspace/.agents/skills` when workspace skills are allowed;
- manager-mounted read-only skill bundles, for example `/secrets/skills` or `/state/skills/mounted`;
- image built-ins under `/agent/skills`.

Workspace context files and skills are untrusted prompt content. Manager-provided and built-in skills may be more trusted for authorship, but they still do not grant tools or secret access.

`.nerve` project resources are not default v1 paths. An implementation MAY support them only through explicit legacy compatibility configuration.

## Boot phases

Boot phases are less reproducible because they run at container start and may depend on current network/package state. They run after secret resolver initialization, Git setup, GitHub setup, and context/skill loading as described in [Boot Sequence](./boot-sequence.md).

If boot phases are used, the sandbox SHOULD record:

- script digest;
- phase names;
- start/end timestamps;
- run user (`sandbox` or explicit unsafe root);
- exit status;
- bounded/redacted stdout/stderr;
- package manager lockfile digests before/after when available;
- network/firewall status;
- registry hosts used, without tokens;
- generated artifacts that affect future runs.

A boot phase SHOULD be promoted into a derived image when it becomes stable or security-sensitive.

## Repository setup

The manager may provide source by mounting/copying a workspace before container start, or by configuring top-level `git.clone`.

Recommended patterns:

1. **Manager-prepared workspace** — preferred when the manager owns source checkout and credentials.
2. **Startup clone** — useful for generic runners; configure `git.clone` with credential refs and allow only necessary Git hosts. Startup clone runs before boot phases.
3. **Derived image source** — acceptable for read-only fixtures or conformance tests, not for mutable production workspaces.

Git credentials, SSH keys, and GPG signing keys must be runtime inputs, not image contents.

## GitHub setup

Top-level `github` config can prepare GitHub API/CLI authentication before boot phases.

Guidelines:

- Use PAT, app token, SSH, or provided OAuth credentials through `SecretRef`.
- Do not run `gh auth login` inside the sandbox.
- Keep CLI auth files and SSH config under protected state.
- Treat PR creation, comments, workflow dispatch, branch publication, and releases as policy-controlled tool operations, not as automatic consequences of enabling `github`.

## Package installation policy

Recommended policy:

1. **System packages**: install at image build time.
2. **Shared language dependencies**: install at image build time when stable and lockfile-pinned.
3. **Workspace-specific language dependencies**: install during boot when `boot.phases[*].network`, `security.network`, and firewall policy allow the registry hosts.
4. **Tool-time dependency changes**: require explicit permission and usually approval because they mutate the workspace.
5. **Unpinned latest packages**: avoid in production.
6. **Runtime apt**: disabled except explicit unsafe/dev profiles.
7. **Package caches**: keep under `/state/cache/dependencies` unless the controller intentionally manages them elsewhere.

Common registry hosts include:

| Ecosystem | Public hosts commonly needed |
| --- | --- |
| npm/pnpm/yarn | `registry.npmjs.org` |
| Python/pip/uv/poetry | `pypi.org`, `files.pythonhosted.org` |
| Maven/Gradle | `repo.maven.apache.org` or configured mirror |
| Cargo | `crates.io`, `static.crates.io`, configured git indexes |
| Go | `proxy.golang.org`, `sum.golang.org`, module VCS hosts |
| Ruby | `rubygems.org` |
| NuGet | `api.nuget.org` |

Private registry credentials MUST be supplied by `SecretRef`, injected narrowly, and redacted from logs/transcripts.

## Secret and credential customization

Secrets must be runtime inputs, not image contents.

Recommended methods:

- environment variables referenced by `SecretRef`;
- read-only secret files under `/secrets`;
- key-value secret store references resolved through configured manager/private HTTP endpoints;
- protected writable credential-sync files outside `/workspace` for refreshed OAuth bundles;
- platform secret stores materialized by the container runtime.

Secret-store endpoints may be authenticated by API key, bearer token, or already-provided OAuth bundle. Store authentication secrets are themselves configured through `SecretRef` and must not be embedded in YAML.

Secrets MUST NOT be placed in Dockerfiles, image layers, image labels, config examples, skills, `AGENTS.md`, workspace prompt files, or command-line arguments that may be logged by the host.

## Workspace customization

The workspace is user/project state, not runtime code.

- The sandbox MAY run dependency installation in `/workspace` if policy allows.
- Generated files in `/workspace` are visible to agent tools and may be modified.
- Controller-provided source should be mounted, copied, or cloned before boot when possible.
- Workspace cleanup should not delete `/state`, `/state/credentials`, `/state/cache/secrets`, or dependency caches unless explicitly requested by retention policy.

## Manager launch customization

The baseline `packages/sandbox-manager` launch layer controls Docker/Podman and future ECS runtime settings.

A manager SHOULD record:

- container backend (`docker`, `podman`, future `ecs`);
- image reference and digest;
- config digest and config mount path;
- workspace/state volume refs;
- secret/credential mount refs without values;
- network mode and effective egress limitations;
- security options such as user, read-only root, capabilities, and no-new-privileges;
- retention/GC policy.

The manager MAY expose this information through the sandbox-manager web UI, but it MUST NOT expose raw secrets.

## Sandbox-manager web UI customization

The optional sandbox-manager UI lives in `packages/sandbox-manager-ui`, separate from the current workbench. It should reuse shadcn-svelte components, theme tokens, and generic display helpers from `packages/ui`, while maintaining separate manager API clients, routes/views, and state stores. See [Web UI](./web-ui.md).

## Image labels

Derived images SHOULD include labels:

```text
org.opencontainers.image.source=<repo-url>
org.opencontainers.image.revision=<git-sha>
org.opencontainers.image.created=<iso-time>
org.nerve.sandbox.spec=v1
org.nerve.sandbox.base.digest=<base-digest>
org.nerve.sandbox.customization=<description-or-id>
org.nerve.sandbox.skills.digest=<skills-digest>
```

These labels help controllers correlate events, image provenance, skills, and reproducibility.

## Upgrade compatibility

A v1-compatible image upgrade MUST preserve:

- YAML `version: 1` loading semantics;
- required filesystem paths;
- WebSocket baseline capabilities;
- durable state migration or clear migration failure;
- event ID and sequence replay semantics;
- command idempotency behavior;
- protected credential and secret-store state migration;
- Git/GitHub setup status migration or idempotent reapplication;
- context/skill loading diagnostics or clear reload behavior.

If a new image cannot read existing `/state`, it MUST fail closed with `SANDBOX_STATE_CORRUPT` or a more specific migration error rather than silently starting fresh.

## Reproducibility checklist

Before production use, record:

- base image digest;
- derived image digest and labels;
- sandbox runtime version;
- sanitized config digest;
- model catalog and selected model IDs;
- secret reference locations, not values;
- Git/GitHub setup summary;
- loaded `AGENTS.md` and skill metadata/digests;
- boot phase digests and redacted transcripts;
- workspace source revision;
- network/firewall status;
- state volume identity.
