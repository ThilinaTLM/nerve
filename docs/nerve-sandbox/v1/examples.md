# Examples

These examples are illustrative. IDs, timestamps, URLs, image names, model names, and paths are placeholders. Raw secret values are intentionally omitted.

## 1. Minimal YAML config

```yaml
version: 1

modelCatalog:
  providers:
    - id: anthropic
      builtin: true
      credential:
        type: api_key
        apiKey:
          env: ANTHROPIC_API_KEY

agent:
  mainModel:
    provider: anthropic
    model: claude-sonnet-4-5
    thinkingLevel: medium

controller:
  websocket:
    url: wss://api.example.invalid/sandboxes/connect
  auth:
    type: api_key
    apiKey:
      env: NERVE_SANDBOX_AGENT_API_KEY

tools:
  groups:
    fileInspection:
      enabled: true
    todos:
      enabled: true

security:
  network:
    default: deny
    allow:
      - api.anthropic.com
      - api.example.invalid
```

## 2. Full YAML config

```yaml
version: 1

identity:
  sandboxId: sbx_01KWFTEST00000000000000001
  name: platform-repo-worker
  labels:
    team: platform
    tier: dev

secretStores:
  defaultStore: manager
  stores:
    manager:
      type: http_kv
      endpoint: https://api.example.invalid/sandboxes/secrets/resolve
      auth:
        type: api_key
        apiKey:
          file: /secrets/controller/secret-store-api-key
      response:
        valueJsonPointer: /value
        expiresAtJsonPointer: /expiresAt
      cache:
        enabled: true
        ttlMs: 300000

modelCatalog:
  providers:
    - id: anthropic
      builtin: true
      credential:
        type: oauth
        provider: anthropic
        source:
          kv:
            key: model/anthropic/oauth
        refresh:
          enabled: true
          persist: state
    - id: openai-codex
      builtin: true
      credential:
        type: oauth
        provider: openai-codex
        source:
          kv:
            key: model/openai-codex/oauth
        refresh:
          enabled: true
          minTtlMs: 300000
    - id: corp-openai
      displayName: Corp OpenAI Gateway
      api: openai-compatible
      baseUrl: https://models.example.invalid/openai/v1
      credential:
        type: bearer
        token:
          kv:
            key: model/corp-openai/token
  models:
    - provider: corp-openai
      model: gpt-4.1-corp
      name: GPT 4.1 via Corp Gateway
      reasoning: false
      supportedThinkingLevels: [off]

agent:
  mainModel:
    provider: anthropic
    model: claude-sonnet-4-5
    thinkingLevel: medium
  exploreModel:
    provider: openai-codex
    model: gpt-5-codex
    thinkingLevel: low
  initialPrompt: |
    Wait for controller instructions and keep changes small.
  systemPromptAmendment: |
    Do not modify files outside /workspace. Ask before risky operations.
  permissionLevel: supervised

controller:
  websocket:
    url: wss://api.example.invalid/sandboxes/connect
    heartbeatIntervalMs: 30000
    reconnect:
      minDelayMs: 1000
      maxDelayMs: 30000
      multiplier: 2
      jitter: true
  auth:
    type: api_key
    apiKey:
      file: /secrets/controller/api-key

git:
  enabled: true
  identity:
    name: Nerve Sandbox Bot
    email: nerve-bot@example.invalid
    signCommits: true
    signingFormat: ssh
    sshSigningKey:
      kv:
        key: git/signing-key
  credentials:
    github-ssh:
      match:
        protocol: ssh
        host: github.com
        user: git
      credential:
        type: ssh
        privateKey:
          kv:
            key: git/id_ed25519
        knownHosts:
          kv:
            key: git/known_hosts
  clone:
    url: git@github.com:example/repo.git
    ref: main
    targetDir: /workspace
    depth: 50
    submodules: false
    credential: github-ssh
  remotes:
    - name: origin
      url: git@github.com:example/repo.git
      credential: github-ssh
  safeDirectory: workspace
  lfs: false

github:
  enabled: true
  host: github.com
  auth:
    type: pat
    token:
      kv:
        key: github/pat
  cli:
    enabled: true
    protocol: ssh
  defaultOwner: example
  defaultRepo: repo

tools:
  groups:
    fileInspection:
      enabled: true
    fileEditing:
      enabled: true
      requireApproval: risky
    planMode:
      enabled: true
    todos:
      enabled: true
    shell:
      enabled: true
      defaultTimeoutMs: 30000
      maxTimeoutMs: 300000
      allowLongRunning: false
    python:
      enabled: true
      network: inherit
      fileWrites: workspace
    taskManagement:
      enabled: true
      maxTasks: 8
      maxTaskRuntimeMs: 86400000
    explore:
      enabled: true
      maxDepth: 3
      maxParallel: 5
    web:
      enabled: true
      provider: tavily
      credential:
        type: api_key
        apiKey:
          kv:
            key: tavily/api-key
    jira:
      enabled: true
      siteUrl: https://example.atlassian.net
      email: bot@example.invalid
      defaultProjectKey: NER
      credential:
        type: api_key
        apiKey:
          kv:
            key: atlassian/jira-token
    confluence:
      enabled: true
      siteUrl: https://example.atlassian.net
      email: bot@example.invalid
      defaultSpaceKey: DEV
      credential:
        type: api_key
        apiKey:
          kv:
            key: atlassian/confluence-token

skills:
  enabled: true
  contextFiles:
    enabled: true
  builtin:
    enabled: true
    path: /agent/skills
  project:
    enabled: true
    path: /workspace/.agents/skills
  searchPaths:
    - /secrets/skills
  allowWorkspaceSkills: true
  maxSkillCount: 100

boot:
  phases:
    - name: install-js
      network: package_registries_only
      timeoutMs: 600000
      env:
        NPM_TOKEN:
          kv:
            key: registries/npm/token
      script: |
        cd /workspace
        corepack enable
        if [ -f pnpm-lock.yaml ]; then
          pnpm install --frozen-lockfile
        elif [ -f package-lock.json ]; then
          npm ci
        fi
    - name: git-status
      network: deny
      script: |
        cd /workspace
        git status --short || true
  onFailure: fail_sandbox

security:
  filesystem:
    writable:
      - /workspace
      - /tmp
      - /state
    readonly:
      - /agent
      - /agent/skills
      - /secrets
    denySymlinkEscape: true
  network:
    default: deny
    allow:
      - api.example.invalid
      - api.anthropic.com
      - api.openai.com
      - chatgpt.com
      - models.example.invalid
      - api.tavily.com
      - example.atlassian.net
      - github.com
      - api.github.com
      - registry.npmjs.org
      - pypi.org
      - files.pythonhosted.org
    packageRegistryHosts:
      - registry.npmjs.org
      - pypi.org
      - files.pythonhosted.org
  apt:
    allowed: false
    mode: build_time_only
  process:
    runAsUser: sandbox
    noNewPrivileges: true
    maxProcesses: 256
  capabilities:
    dropAll: true
    privileged: false

storage:
  stateDir: /state
  credentials:
    dir: /state/credentials
    persistRefreshes: true
  cache:
    dependencyDir: /state/cache/dependencies
    secretStoreDir: /state/cache/secrets
  retention:
    maxRuns: 100
    maxAgeDays: 30
  checkpoint:
    onEveryTurn: true

observability:
  logLevel: info
```

## 3. Key-value secret store

The manager can expose a simple endpoint that accepts a key and returns a secret value. The sandbox resolves the secret only when needed.

```yaml
secretStores:
  defaultStore: manager
  stores:
    manager:
      type: http_kv
      endpoint: https://api.example.invalid/secrets/resolve
      auth:
        type: bearer
        token:
          file: /secrets/controller/secret-store-token
      response:
        valueJsonPointer: /value
      cache:
        enabled: true
        ttlMs: 120000

modelCatalog:
  providers:
    - id: anthropic
      builtin: true
      credential:
        type: api_key
        apiKey:
          kv:
            key: model/anthropic/api-key
```

Example request/response shape for an HTTP store is implementation-specific but SHOULD be equivalent to:

```http
POST /secrets/resolve
Authorization: Bearer <redacted>
Content-Type: application/json

{ "key": "model/anthropic/api-key" }
```

```json
{ "value": "<redacted>", "expiresAt": "2026-07-02T13:00:00.000Z" }
```

The value is never emitted in protocol payloads, logs, snapshots, or transcripts.

## 4. Built-in provider with OAuth credentials

```yaml
modelCatalog:
  providers:
    - id: openai-codex
      builtin: true
      credential:
        type: oauth
        provider: openai-codex
        source:
          file: /secrets/model/openai-codex-oauth.json
        refresh:
          enabled: true
          persist: state

agent:
  mainModel:
    provider: openai-codex
    model: gpt-5-codex
    thinkingLevel: medium
```

The file contains a provider-issued OAuth credential bundle supplied by the manager. It is not shown because it contains secrets.

## 5. Custom OpenAI-compatible provider

```yaml
modelCatalog:
  providers:
    - id: corp-openai
      displayName: Corp OpenAI Gateway
      api: openai-compatible
      baseUrl: https://models.example.invalid/openai/v1
      credential:
        type: bearer
        token:
          kv:
            key: model/corp-openai/token
  models:
    - provider: corp-openai
      model: gpt-4.1-corp
      name: GPT 4.1 via Corp Gateway
      contextWindow: 128000
      maxTokens: 8192
      supportedThinkingLevels: [off]

agent:
  mainModel:
    provider: corp-openai
    model: gpt-4.1-corp
    thinkingLevel: off
```

## 6. Jira and Confluence tool groups

```yaml
tools:
  groups:
    jira:
      enabled: true
      siteUrl: https://example.atlassian.net
      email: bot@example.invalid
      defaultProjectKey: NER
      credential:
        type: api_key
        apiKey:
          kv:
            key: atlassian/jira-token
    confluence:
      enabled: true
      siteUrl: https://example.atlassian.net
      email: bot@example.invalid
      defaultSpaceKey: DEV
      credential:
        type: api_key
        apiKey:
          kv:
            key: atlassian/confluence-token
```

Mutation tools should require approval in supervised mode.

## 7. Git and GitHub startup setup

```yaml
git:
  enabled: true
  identity:
    name: Nerve Sandbox Bot
    email: nerve-bot@example.invalid
    signCommits: true
    signingFormat: ssh
    sshSigningKey:
      file: /secrets/git/signing-key
  credentials:
    github-ssh:
      match:
        protocol: ssh
        host: github.com
        user: git
      credential:
        type: ssh
        privateKey:
          file: /secrets/git/id_ed25519
        knownHosts:
          file: /secrets/git/known_hosts
  clone:
    url: git@github.com:example/repo.git
    ref: main
    targetDir: /workspace
    depth: 50
    credential: github-ssh

github:
  enabled: true
  host: github.com
  auth:
    type: pat
    token:
      kv:
        key: github/pat
  cli:
    enabled: true
    protocol: ssh
```

This setup runs before boot phases. It prepares credentials and checkout state; it does not grant the model permission to run mutating Git/GitHub operations. Those operations still require shell or dedicated tools plus policy approval.

## 8. Package manager access during boot

There is no top-level dependency configuration block. Dependency installation is expressed as boot phases plus network/firewall policy and scoped secret injection.

```yaml
boot:
  phases:
    - name: install-deps
      network: package_registries_only
      env:
        NPM_TOKEN:
          kv:
            key: registries/npm/token
      script: |
        cd /workspace
        corepack enable
        pnpm install --frozen-lockfile

security:
  network:
    default: deny
    allow:
      - registry.npmjs.org
    packageRegistryHosts:
      - registry.npmjs.org

storage:
  cache:
    dependencyDir: /state/cache/dependencies
```

## 9. Built-in and project skills

```yaml
skills:
  enabled: true
  contextFiles:
    enabled: true
    names: [AGENTS.md, AGENTS.MD]
  builtin:
    enabled: true
    path: /agent/skills
  project:
    enabled: true
    path: /workspace/.agents/skills
  searchPaths:
    - /secrets/org-skills
```

Example project layout:

```text
/workspace/
  AGENTS.md
  .agents/
    skills/
      review/
        SKILL.md
```

The sandbox lists model-visible skills in `<available_skills>`. Skills and `AGENTS.md` do not grant tools or credentials.

## 10. Docker run example

```sh
docker run --rm \
  --read-only \
  --user 10001:10001 \
  --cap-drop=ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --memory 4g \
  --cpus 2 \
  --network bridge \
  -e NERVE_SANDBOX_AGENT_CONFIG=/etc/nerve/sandbox.yaml \
  -e NERVE_SANDBOX_AGENT_API_KEY \
  --mount type=bind,src="$PWD/sandbox.yaml",target=/etc/nerve/sandbox.yaml,readonly \
  --mount type=bind,src="$PWD/.sandbox/secrets",target=/secrets,readonly \
  --mount type=volume,src=nerve-workspace,target=/workspace \
  --mount type=volume,src=nerve-state,target=/state \
  --tmpfs /tmp \
  ghcr.io/example/nerve-sandbox-agent:latest
```

Use `/credentials` only when the config uses `refresh.persist: file`. Production deployments should prefer immutable image digests and platform-native secret mounts or manager key-value stores.

## 11. WebSocket events

A config-loaded event reports effective status without secrets:

```json
{
  "type": "sandbox.config.loaded",
  "durability": "durable",
  "data": {
    "configDigest": "sha256:abc123",
    "models": [
      { "provider": "anthropic", "model": "claude-sonnet-4-5", "active": true }
    ],
    "secretStores": [
      { "id": "manager", "status": "available", "cacheEnabled": true }
    ],
    "setup": {
      "git": { "configured": true, "status": "completed" },
      "github": { "configured": true, "status": "completed" }
    },
    "toolGroups": [
      { "group": "fileInspection", "configured": true, "active": true, "tools": ["read", "ls", "find", "grep"] },
      { "group": "shell", "configured": true, "active": true, "tools": ["bash"] }
    ]
  }
}
```

A run-start command may omit conversation/agent IDs to use defaults:

```json
{
  "kind": "request",
  "id": "msg_001",
  "data": {
    "method": "sandbox.run.start",
    "params": {
      "commandId": "cmd_001",
      "prompt": "Inspect the repo and summarize risks."
    }
  }
}
```

The response includes resolved identifiers:

```json
{
  "kind": "response",
  "id": "msg_001",
  "data": {
    "accepted": true,
    "conversationId": "conv_001",
    "agentId": "agent_main",
    "runId": "run_001",
    "status": "queued"
  }
}
```

## 12. Snapshot example

```json
{
  "sandboxId": "sbx_01KWFTEST00000000000000001",
  "instanceId": "inst_001",
  "status": "ready",
  "configDigest": "sha256:abc123",
  "secretStores": [
    { "id": "manager", "status": "available", "cacheEnabled": true }
  ],
  "setup": {
    "git": { "configured": true, "status": "completed" },
    "github": { "configured": true, "status": "completed" }
  },
  "contextFiles": [
    { "path": "/workspace/AGENTS.md", "digest": "sha256:def456" }
  ],
  "skills": [
    { "name": "agent-browser", "source": "builtin", "path": "/agent/skills/agent-browser/SKILL.md", "modelVisible": true },
    { "name": "review", "source": "workspace", "path": "/workspace/.agents/skills/review/SKILL.md", "modelVisible": true }
  ],
  "conversations": [
    { "conversationId": "conv_001", "status": "active", "agentIds": ["agent_main"] }
  ],
  "runs": [
    { "conversationId": "conv_001", "agentId": "agent_main", "runId": "run_001", "status": "completed" }
  ],
  "cursor": {
    "streams": [{ "stream": "global", "processedSeq": 42 }]
  }
}
```

## 13. Recovery flow

On restart, a conforming sandbox:

1. reacquires `/state/lock`;
2. validates the current config digest;
3. restores credential and secret-store status;
4. reapplies or verifies idempotent Git/GitHub setup;
5. loads conversations, agents, runs, checkpoints, context/skill metadata, and outbox;
6. reconnects to the controller;
7. replays unacknowledged durable events;
8. announces `sandbox.ready` or `sandbox.degraded` with redacted recovered state.

## 14. Migration notes from earlier draft shapes

Because v1 is still proposed, these are spec cleanup notes rather than compatibility requirements:

- Move Git config from `tools.groups.*` into top-level `git`.
- Move GitHub config from `tools.groups.*` into top-level `github`.
- Move provider credentials/API/base URL/model metadata from `agent.mainModel` and `agent.exploreModel` into `modelCatalog`.
- Keep `agent.mainModel` and `agent.exploreModel` as `{ provider, model, thinkingLevel }` selectors.
- Replace raw env/file-only secret refs with env/file/kv `SecretRef` values as needed.
- Replace package dependency config blocks with `boot.phases`, `security.network`, firewall policy, cache paths, and scoped package-manager credential refs.
- Prefer `/workspace/AGENTS.md` and `/workspace/.agents/skills`; legacy project resource paths require explicit compatibility support.

## 15. Sandbox manager with built-in KV secrets

The baseline sandbox manager can launch a Docker/Podman sandbox and expose a private key-value secret endpoint. The sandbox YAML references the endpoint; the raw values stay in manager storage.

```yaml
secretStores:
  defaultStore: manager
  stores:
    manager:
      type: http_kv
      endpoint: http://sandbox-manager.internal/api/sandboxes/sbx_001/secrets/resolve
      auth:
        type: api_key
        apiKey:
          file: /secrets/controller/secret-store-token
      response:
        valueJsonPointer: /value
        expiresAtJsonPointer: /expiresAt
```

Example manager KV request shape:

```http
POST /api/sandboxes/sbx_001/secrets/resolve
Authorization: Bearer <redacted>
Content-Type: application/json

{ "key": "model/anthropic/oauth" }
```

Example response shape, never logged or emitted to ordinary events:

```json
{
  "value": "<redacted-secret-value>",
  "expiresAt": "2026-07-02T12:00:00.000Z"
}
```

## 16. Boot sequence with Git, GitHub, then custom phases

Startup order is fixed: secret resolver setup, Git setup, GitHub setup, context/skills loading, then custom boot phases.

```yaml
controller:
  websocket:
    url: ws://sandbox-manager.internal/api/sandboxes/sbx_001/connect
  auth:
    type: api_key
    apiKey:
      file: /secrets/controller/api-key
  disconnectPolicy:
    mode: exit_self
    exitAfterMs: 300000

git:
  enabled: true
  credentials:
    github-ssh:
      match: { protocol: ssh, host: github.com, user: git }
      credential:
        type: ssh
        privateKey:
          kv: { key: git/id_ed25519 }
        knownHosts:
          kv: { key: git/known_hosts }
  clone:
    url: git@github.com:example/repo.git
    ref: main
    credential: github-ssh

github:
  enabled: true
  auth:
    type: pat
    token:
      kv: { key: github/pat }
  cli:
    enabled: true

boot:
  phases:
    - name: install-dependencies
      network: package_registries_only
      timeoutMs: 600000
      env:
        NPM_TOKEN:
          kv: { key: registries/npm/token }
      script: |
        cd /workspace
        corepack enable
        pnpm install --frozen-lockfile
    - name: verify-workspace
      network: deny
      timeoutMs: 120000
      script: |
        cd /workspace
        pnpm check
  onFailure: fail_sandbox
```

The `install-dependencies` phase can reach only package registry hosts allowed by both `boot.phases[*].network` and `security.network`. The `verify-workspace` phase has no external egress.

## 17. Disconnect self-exit and manager GC flow

```text
T+000s  sandbox has established controller WebSocket session
T+010s  manager restarts; WebSocket closes
T+010s  sandbox writes controller connectivity state: reconnecting
T+010s  sandbox starts reconnect loop and schedules self-exit at T+310s
T+120s  reconnect still failing; healthcheck reports reconnecting within grace period
T+310s  reconnect not restored; sandbox writes shutdown state when possible
T+311s  sandbox exits with controller-disconnect timeout exit code
T+315s  manager observes exited container and records observedState=exited
T+retention  manager removes container; /state is preserved unless retention permits deletion
```

If reconnect succeeds before the deadline, the sandbox emits `sandbox.controller.reconnected`, clears the deadline, and resumes replay/ack behavior.

## 18. Sandbox-manager web UI flow

The dedicated frontend in `packages/sandbox-manager-ui` connects to the sandbox manager, not directly to sandbox containers.

```text
1. UI authenticates to sandbox manager.
2. UI loads a sandbox dashboard snapshot.
3. UI opens a Nerve Protocol v1 WebSocket as role ui.
4. UI applies manager/sandbox event batches and sends processed acks.
5. User opens a sandbox detail page.
6. UI shows image/backend/config digest, health, reconnect countdown, and GC state.
7. User opens boot timeline and sees secret resolver setup, Git, GitHub, skills, and custom phases.
8. User resolves a pending approval; UI sends manager-mediated sandbox.approval.resolve.
9. Manager forwards the authorized command to the sandbox daemon.
```

The UI displays secret keys only when policy permits and never displays secret values.
