# Tools

Sandbox tools expose controlled capabilities to the agent. Tool availability is configured by YAML tool groups, constrained by permission policy, and enforced by the sandbox daemon and container runtime.

The model must not be trusted to enforce policy. Prompt instructions, `AGENTS.md`, and `SKILL.md` files may describe available tools, but all authorization decisions happen before tool execution.

Git and GitHub are configured as top-level startup services, not tool groups. Their credentials, identity, remotes, CLI/API auth, and optional checkout are prepared before boot phases. Actual model-callable Git/GitHub operations are exposed through `shell` or future dedicated tools and still require the same policy, risk, approval, filesystem, and network checks as any other command.

## Tool-group catalog

Sandbox v1 SHOULD organize model-callable tools using the same conceptual groups exposed by Nerve Settings → Tools. A sandbox implementation MAY support a subset, but it MUST accurately advertise configured/active groups and tools in config-loaded/status events and prompts.

| Group key | Tool names | Purpose | Credential/config level |
| --- | --- | --- | --- |
| `fileInspection` | `read`, `ls`, `find`, `grep` | Inspect files under allowed roots. | Filesystem policy. |
| `fileEditing` | `write`, `edit` | Mutate files under allowed writable roots. | Filesystem/write policy. |
| `planMode` | `plan_mode_enter`, `plan_mode_present`, `plan_mode_force_exit` | Planning workflow and plan review. | Controller/run state. |
| `todos` | `todos_set`, `todos_get` | Maintain task checklist. | Run state. |
| `web` | `web_search`, `web_fetch` | Search/fetch web resources. | Web group credential/policy. |
| `jira` | Jira issue/user/project tools | Jira Cloud operations. | Jira group URL, identity, credential. |
| `confluence` | Confluence page/space/attachment tools | Confluence Cloud operations. | Confluence group URL, identity, credential. |
| `taskManagement` | `task_start`, `task_status`, `task_logs`, `task_cancel`, `task_restart`, `task_list` | Supervise long-lived commands. | Managed task runtime. |
| `shell` | `bash` | Run finite shell commands in `/workspace`. | Shell group policy; may use top-level Git/GitHub setup. |
| `python` | `python` | Run bounded Python snippets/scripts. | Python group policy. |
| `explore` | `explore` | Spawn bounded read-oriented subagents. | Explore model/tool policy. |

## Enablement model

Tool activation is the intersection of:

1. implementation support;
2. YAML `tools.groups.<group>.enabled` and group `tools.enabled`/`tools.disabled` filters;
3. required secrets/config availability;
4. sandbox security policy;
5. agent permission level and mode;
6. controller approvals, when required;
7. runtime availability, such as Python, shell, browser support, `git`, or `gh` when commands need them.

If a tool or group is enabled in YAML but unavailable at runtime, the sandbox MUST report a safe warning or error and MUST NOT advertise that tool as active.

Tool groups SHOULD be reported in `sandbox.config.loaded` with at least:

```ts
type ToolGroupStatus = {
  group: string;
  configured: boolean;
  active: boolean;
  tools: string[];
  unavailableTools?: string[];
  credentialType?: "none" | "api_key" | "bearer" | "oauth" | "ssh" | "gpg" | "basic";
  limitations?: string[];
};
```

Credential material MUST NOT be included.

## Permission levels

| Level | Behavior |
| --- | --- |
| `read_only` | Read, search, status, and interaction tools only. No workspace writes, shell mutations, network mutations, commits, pushes, package installs, or deployments. |
| `supervised` | Risky tools require controller approval. |
| `autonomous` | Risky tools may run without per-call approval if allowed by config/security policy. |

Implementations MAY define stricter policy. They MUST NOT grant broader authority than requested by config.

## Risk categories

Tool calls SHOULD be classified into stable risk categories:

| Risk | Meaning |
| --- | --- |
| `read` | Reads local or remote data without mutation. |
| `workspace_write` | Writes under `/workspace` or another configured writable root. |
| `command` | Runs shell/process code. |
| `network` | Calls external network services. |
| `secret` | Uses or may expose configured credentials. |
| `destructive` | Deletes, overwrites, force-pushes, drops data, changes permissions broadly, or discards uncommitted work. |
| `agent_spawn` | Starts explore/subagent work. |
| `deployment` | Deploys or publishes changes outside the sandbox. |
| `interaction` | Asks the controller/user for input or approval. |

Specific operations map onto these categories:

- OAuth refresh and key-value secret resolution are `secret` and often `network`, but they are internal credential lifecycle operations, not model-callable tools.
- Package installs are at least `command`, `network`, and `workspace_write`; they may be `destructive` if they change lockfiles or remove dependencies.
- Git fetch/pull/push are `network` and `secret` when authenticated. Push/force-push is also `destructive` or `deployment` depending on policy.
- Jira/Confluence/GitHub mutations are `network`, `secret`, and `deployment` or `workspace_write` depending on operation.

A single tool may have different risk depending on arguments. For example, `bash` may be `read` for `git status` and `destructive` for `git reset --hard` or `git push --force`.

## Policy decisions

Before execution, the daemon MUST produce one decision:

```ts
type ToolPolicyDecision = {
  decision: "allow" | "approval" | "deny";
  risk: string;
  reason: string;
  normalizedArgs: unknown;
  cwd: string;
  group?: string;
};
```

Requirements:

- `deny` MUST emit a durable `sandbox.security.denied` or `tool.call.failed` event.
- `approval` MUST emit `run.waiting_for_approval` or `tool.call.requested` with approval metadata, then checkpoint before waiting.
- `allow` MAY execute immediately but still must journal the tool call lifecycle.
- Decisions MUST be based on normalized paths/arguments, not raw user strings alone.
- Group-level `requireApproval` may strengthen but MUST NOT weaken global permission and security policy.

## Filesystem tools

Filesystem tools MUST resolve paths against configured roots before execution.

Requirements:

- Relative paths resolve under `/workspace` by default.
- Writes outside allowed writable paths MUST be denied.
- Symlink traversal MUST NOT escape allowed roots when `denySymlinkEscape` is true.
- Reads from `/agent`, `/agent/skills`, `/secrets`, credential files, host mounts, or provider credential files MUST be denied unless explicitly allowed and safe.
- Built-in skills may be read by the agent only through ordinary read policy or explicit skill invocation. Skill contents are not automatically secret, but they may still contain sensitive organization guidance and should be bounded.
- File outputs in events MUST be bounded; full large content should be referenced by path or artifact ID.

## Shell tool

The shell tool runs finite commands in the sandbox environment.

Requirements:

- Default cwd MUST be `/workspace`.
- Commands MUST have timeouts.
- Long-running servers/watchers MUST be denied unless the `taskManagement` group is active and the command is supervised.
- Destructive command patterns SHOULD be denied or require approval even in autonomous mode.
- Shell output MUST be bounded and redacted before being sent to the model or controller.
- Commands MUST NOT receive all environment variables by default; only safe runtime variables and explicitly required secret refs should be injected.
- Runtime `apt`, `sudo`, container runtime access, host service control, and broad permission changes SHOULD be denied in production profiles.
- Language package managers such as `pnpm`, `npm`, `yarn`, `pip`, `poetry`, `uv`, `mvn`, `gradle`, `cargo`, `go`, `bundle`, and `nuget` are allowed only when boot/tool policy and the effective `security.network`/firewall policy allow the relevant registries. Phase/tool network settings intersect with global network policy and never expand it. Credentials MUST be injected through temporary config or process env scoped to the package-manager invocation.

## Python tool

The Python tool SHOULD run with the same filesystem and network restrictions as shell commands.

Requirements:

- Python execution MUST be bounded by timeout and output limits.
- File writes MUST be limited to configured writable roots.
- Network access MUST follow `security.network` and `tools.groups.python.network`.
- Long-running Python services MUST be denied unless the `taskManagement` group is active and the service is supervised.

## Web group

`web_search` and `web_fetch` may use external APIs, direct egress, or controller-mediated fetch.

Requirements:

- API keys MUST come from the web group credential, which may resolve through env, file, or key-value secret store.
- Fetched content MUST be size-bounded and content-type checked.
- Network egress MUST comply with sandbox network policy.
- Search/fetch events MUST not include raw API keys, cookies, or authorization headers.
- If `web_fetch` stores a large/binary artifact, the artifact path MUST be within an allowed writable root and surfaced as a bounded reference.

## Jira and Confluence groups

Jira and Confluence tools are disabled unless explicitly configured and credentials are available.

Requirements:

- Group credentials MUST be supplied by YAML `SecretRef` values or protected manager mounts.
- The sandbox does not run Atlassian login flows.
- Read and mutation operations MUST be risk-classified separately.
- Mutation operations SHOULD require approval in `supervised` mode.
- OAuth/access tokens/API tokens MUST be injected only into the Atlassian tool client.
- Events SHOULD include resource IDs, URLs, and safe summaries, not credential material or full unbounded document bodies.
- Downloaded page/issue artifacts MUST be written only to allowed roots and should be bounded or referenced.

## Git and GitHub commands

Top-level `git` and `github` config supplies startup setup, credentials, identity, signing state, remotes, optional clone, and GitHub CLI/API authentication. It is not a model-callable group.

When the model invokes Git/GitHub operations through `bash`, `python`, task tools, or future dedicated tools:

- Git/GitHub credentials MUST be injected narrowly through scoped mechanisms such as `GIT_ASKPASS`, `GIT_SSH_COMMAND`, temporary credential helpers under protected state, `GH_TOKEN`, or a protected CLI auth file.
- SSH keys, GPG private keys, signing keys, passphrases, and known-hosts material MUST NOT be written to `/workspace`.
- `GNUPGHOME`, SSH config, and credential-helper state SHOULD live under protected state with restrictive permissions.
- Clone/fetch/pull/push/API network access MUST comply with `security.network` and any firewall profile. Prepared startup credentials do not imply network authorization or mutation authorization.
- Mutating operations such as `git commit`, `git checkout`, `git switch`, `git merge`, `git rebase`, `git reset`, `git clean`, `git tag`, `git push`, PR creation, PR comments, workflow dispatch, and release publication MUST be risk-classified even when Git/GitHub credentials were prepared at startup.
- `git push --force`, `git reset --hard`, `git clean -fd`, and equivalent destructive operations SHOULD require approval even in autonomous mode unless policy explicitly allows them.
- `gh auth login`, browser login, and device-code login MUST be denied.
- Output MUST be redacted for embedded credentials in remote URLs, authorization headers, or CLI debug logs.

## Task management group

Task tools manage long-running processes inside the sandbox.

Requirements:

- Tasks MUST be supervised and bounded inside the sandbox, not untracked background processes.
- Task logs MUST be bounded and redacted.
- Task environment variables must follow the same narrow secret-injection rules as shell.
- Network listeners are disabled unless `taskManagement.allowNetworkListeners` and network policy allow them.

A sandbox without managed task support MUST not advertise task tools.

## Interaction tools

Interaction tools bridge the agent to the controller/user.

- `ask_user` MUST use the provider tool-call ID as the request/wait anchor, persist the wait/checkpoint, emit a durable waiting event, and suspend the harness with `AgentToolSuspension` before the run waits.
- Controller answers MUST arrive through `sandbox.input.submit`; the answer is written durably before `sandbox.run.continue` re-enters the same pending harness tool call.
- Pending questions MUST survive restart.
- The sandbox MUST reject answers for unknown, dismissed, mismatched, or already-answered request IDs.

## Explore agent

The explore agent is a read-oriented subagent used for codebase investigation.

Requirements:

- It SHOULD use `agent.exploreModel` when configured; otherwise it MAY use `agent.mainModel`. Both selections resolve through the model catalog.
- Its default tool set SHOULD be read-only: `read`, `grep`, `find`, `ls`, and bounded status/log tools if supported.
- It MUST inherit filesystem and network policy from the parent sandbox.
- It MUST not exceed configured explore depth/run budgets.
- Explore outputs SHOULD be summarized and bounded before returning to the main agent.

## Context files and skills

Skills are not tools. They are task-specific prompt resources loaded from `SKILL.md` files. `AGENTS.md` files are project context resources.

Requirements:

- Loaded `AGENTS.md` context should be included in the system prompt according to harness policy.
- Loaded skills SHOULD be listed in the system prompt using `<available_skills>` with name, description, and location.
- Project skills default to `/workspace/.agents/skills`; built-ins default to `/agent/skills`.
- The model may request to read a skill file when its description matches the task, subject to file-read policy.
- Skill frontmatter such as `allowed-tools` is advisory and MUST NOT authorize tool use.
- Workspace-provided context files and skills are untrusted prompt content and may contain prompt injection.
- Built-in image skills under `/agent/skills` are immutable runtime resources, but still MUST NOT bypass policy.
- Skill/context diagnostics SHOULD be durable and visible to the controller without including full unbounded file contents.

## Tool call lifecycle

Tool calls SHOULD produce durable lifecycle events:

1. `tool.call.requested` for approval or audit, with redacted normalized args.
2. `tool.call.started` when execution begins.
3. `tool.call.completed` with bounded/redacted result and artifact references.
4. `tool.call.failed` with redacted error details.
5. `tool.call.cancelled` when a pending or running tool is cancelled.

Approval-required tools MUST persist `waiting_for_approval` before side effects. Granting an approval resumes the exact provider tool-call ID and normalized args; denying returns a redacted `POLICY_DENIED` tool error to the model without executing the side effect.

The sandbox MUST journal enough tool-call state to recover or explain the latest stable run state after restart.
