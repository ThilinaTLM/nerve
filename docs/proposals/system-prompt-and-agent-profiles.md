# System prompt, tool descriptions, and agent profiles

> **Status:** Implemented baseline; completion review pending for detailed UI and migration acceptance criteria. Source review confirms the core Phase 5 template model, applied snapshots, bundled profiles, planning approval and migration implementation. This review did not verify every UI requirement or migration-rehearsal gate, so full completion is not yet certified. Phase 5 supersedes conflicting earlier phases. Subsequent redesign is tracked in [Scoped configuration and active agent profiles](scoped-configuration-and-active-profiles/README.md), not as unfinished work in this proposal.
>
> **Follow-up already implemented:** Coding now resets permission and plan presentation to application settings through the explicit Reset to settings mode. This extends the original Phase 5 behavior; the historical specification below is preserved.

## Reading this historical proposal

Sections 1–4 and the original baseline describe earlier phases, not the current normative design. Phase 5 superseded their conflicting inheritance, storage and approval rules. The implemented model/thinking controls share a picker but are independent settings; the Phase 5 phrase “one profile setting” should not be read as an atomic model-and-reasoning value. The scoped-configuration successor defines the next redesign; do not combine its overlay behavior with this document's materialized-template behavior.

## Summary

Make the prompt sent to the model small and regular, and drive its variations from data instead of from a mode flag:

1. **System prompt.** A short intro and three general guidelines. `<instructions>` comes from the active agent profile. Delegatable profiles are listed in `<available_agent_profiles>`. All tool-specific guidance moves into tool descriptions.
2. **Tool descriptions.** Follow written rules for token efficiency. Long tool groups (Jira, Confluence) keep one-line descriptions and point to a built-in guide skill by file path.
3. **Agent profiles.** Sub-agent profiles become agent profiles, usable by the lead agent, sub-agents, or both. Each setting is Inherit, Set, or Lock.
4. **Planning.** The planning/coding mode is replaced by bundled **Coding** and **Planning** lead profiles plus a built-in `planning` skill. The composer's mode toggle becomes a profile selector.

Principle: tell the agent what it can do and what isn't obvious. Don't restate things a capable model already knows.

## Original baseline (before implementation)

| Concern         | Where                                                                | Today                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt assembly | `workbench-server/src/core-host/nerve-system-prompt.ts`              | Intro, `<tool_rules>`, `<working_rules>`, planning-only `<mode_controls>`/`<plan_mode>`, `<project_instructions>`, `<agent_instructions>`, `<available_skills>`, `<environment>`                                                   |
| Tool rules      | `tools/src/catalog/prompt-guidelines.ts`                             | 6 conditional strings: bash vs. file tools, launch, sub-agents, Jira, Confluence, python_exec                                                                                                                                      |
| Custom prompt   | `resource-loader.ts` (`SYSTEM.md`, `APPEND_SYSTEM.md`)               | `SYSTEM.md` replaces the entire default prompt                                                                                                                                                                                     |
| Profile listing | `turn-resources.adapter.ts` `withSubagentProfiles`                   | Enum plus a `name — description` list injected into the `subagent_prompt` `profile` parameter                                                                                                                                      |
| Profiles        | `contracts/src/domains/subagents/subagent-profile.ts`                | Built-ins `explore`, `developer`; user/project/conversation scopes; model/thinking `lead` or explicit; permission explicit; tools/skills changes relative to the lead. Sub-agent only, applied at creation                         |
| Mode            | `conversation.mode` column (CHECK `planning`/`coding`), `modeSchema` | Forces the `planning` rule set (`conversation-core/.../permission-rule-set.ts`), locks the permission picker (`workbench-app/.../rule-set-options.ts`), gates `plan_mode_present`, adds prompt blocks, composer toggle and `/plan` |
| Plan review     | `conversation-core/src/tool-calls/core-tool-handlers.ts`             | `plan_mode_present` → `plan_review` interaction. Approval sets mode to coding; rejection ends the run                                                                                                                              |

Measured tool definition size (description + parameter schema; about 4 characters per token):

| Group                | Tools | Description text | Parameter description text | Total schema                         |
| -------------------- | ----- | ---------------- | -------------------------- | ------------------------------------ |
| Core + orchestration | 22    | 2.8k             | 3.0k                       | 9.3k                                 |
| Jira                 | 17    | 1.3k             | 2.8k                       | 12.5k                                |
| Confluence           | 11    | 0.8k             | 1.3k                       | 7.8k                                 |
| **All**              | 50    |                  |                            | **≈ 34.7k characters (≈ 9k tokens)** |

For comparison, the system prompt without project instructions and skills is about 1.5k characters. Tool definitions are the main cost.

## 1. System prompt

```
You are Nerve's coding agent, working in the user's project. Keep responses concise.

<guidelines>
- Continue until the task is complete or blocked by a user decision.
- Responses render as Markdown with Mermaid; use diagrams for complex relationships or flows, otherwise prose.
- Ask the user questions with `ask_user`, not in your reply.
</guidelines>

<instructions>                  active profile; omitted when empty
…
</instructions>

<project_instructions path="…">   AGENTS.md files, unchanged
…
</project_instructions>

<available_skills>              unchanged; only when `read` is available
…
</available_skills>

<available_agent_profiles>      only when new sub-agents can be created
- explore: For codebase or web research that returns evidence. (permission: Read only)
- developer: For implementing and testing a scoped code change. (permission: Autonomous)
</available_agent_profiles>

<environment>
Current date: …
Current working directory: …
</environment>
```

### Guidelines (final)

| Guideline                                             | Why it stays                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Continue until complete or blocked by a user decision | Models stop early. Not obvious to them.                                                        |
| Markdown + Mermaid rendering                          | States something Nerve can do; models can't know it.                                           |
| Ask questions with `ask_user`, not in the reply       | Models put questions at the end of their messages. Included only when `ask_user` is available. |

Removed:

- **"Summarize changes, validation, and remaining limits"** moves to the Coding profile's instructions.
- **All tool rules** move to tool descriptions (section 2).
- **No general safety, quality, or "be careful" lines.** They're obvious and make the model more hesitant.

The intro gets no capability summary. The tool list already shows what the agent can do.

### Assembly rules

- **Order** puts rarely changing content first. A profile switch rebuilds the prompt from `<instructions>` onward; switches are rare and made by the user.
- **`SYSTEM.md`** replaces only the intro and `<guidelines>`. The other sections are still added. `APPEND_SYSTEM.md` is unchanged.
- **`<mode_controls>` and `<plan_mode>`** are removed (phase 4).
- **`<available_agent_profiles>`** lists usable profiles whose `usableBy` is `subagent` or `both`, as `name: <when to use> (permission: <rule set name>)`. The profile `description` is written as when to use the profile, and its UI help text says so. The permission shows the resolved rule set's display name. `subagent_prompt` keeps `profile` as an enum of usable names, so names are still validated, but the parameter has no description. When no profiles are usable but sub-agents exist, the section is omitted and today's follow-up-only behavior stays.
- **Placeholders.** Profile instructions and tool descriptions may contain `{{skill:<name>}}`. It's resolved to the built-in skill's absolute `SKILL.md` path when the turn's resources are prepared.

## 2. Tool descriptions

### Writing rules

1. **Description:** one sentence on what the tool does, plus only what the model can't infer: output bounds, background behavior and notifications, side effects, data sent to outside services, and which tool to use instead.
2. **Parameters:** no descriptions that repeat the name or type. Keep units, defaults, indexing, mutually exclusive options, and examples only where the format isn't obvious.
3. **No configuration details the agent can't act on**, such as which provider is used or where the API key is set. Error messages carry those.
4. **Safety wording goes only on tools that make changes**, and it stays explicit ("only when the user explicitly asks").
5. **Usage guides for long tool groups go in a guide skill** (below). What's needed to call the tool correctly and safely stays in the tool definition.

### Moved tool rules

`prompt-guidelines.ts` and the `promptGuidelines` builder option are deleted:

| Rule                                                       | New home                                              |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| Prefer dedicated file tools over bash                      | `bash`                                                |
| Check launch status; prefer launch definitions for servers | `bash`, `launch`                                      |
| Sub-agent workflow                                         | `subagent_prompt`, `subagent_status`                  |
| Jira / Confluence usage and mutation rules                 | Mutating tools (safety rule), guide skills (the rest) |
| python_exec artifacts, secrets, long-lived processes       | `python_exec`                                         |

### Target text: core and orchestration tools

Parameters that aren't listed lose their description.

| Tool                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                            | Parameter descriptions kept                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `read`                    | Read a text file or image. Text output is bounded; page with offset/limit, or byteOffset/byteLimit for long lines.                                                                                                                                                                                                                                                                                                                     | `path`: relative or absolute. `offset`: 1-indexed line. `byteOffset`: 0-indexed; not with offset/limit.                              |
| `bash`                    | Run a shell command in the project. Prefer read/grep/find/ls for inspection and launch for the user's servers. Moves to the background after {N}s (`background: true` returns at once); background runs notify you on exit, so don't poll. Large output is saved to files for read/grep.                                                                                                                                               | `cwd`: must resolve inside the project. `projectEnvironment`: false skips project environment activation.                            |
| `async_bash`              | Manage your background bash runs. list: running runs (`all: true` includes finished). logs: output from offset (default: tail). stop: kills the process tree.                                                                                                                                                                                                                                                                          | —                                                                                                                                    |
| `launch`                  | Use the user's launch definitions (dev servers etc.); you can't create or edit them. Check status before starting. Select by exact name; `runId` targets one run (default: latest). logs: output from offset (default: tail).                                                                                                                                                                                                          | —                                                                                                                                    |
| `python_exec`             | Run inline Python or a script with bounded output. Save large outputs under `$NERVE_PYTHON_ARTIFACT_DIR`. Not for long-lived or interactive processes.                                                                                                                                                                                                                                                                                 | `code`/`path`: exactly one. `env`: non-secret only; sensitive keys are rejected. `timeout`: seconds, capped.                         |
| `edit`                    | Replace exact, unique text in an existing file; all edits resolve against the original content.                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                    |
| `write`                   | Create or overwrite a file, creating parent directories.                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                    |
| `grep`                    | Search file contents by regex or literal string; results are bounded.                                                                                                                                                                                                                                                                                                                                                                  | `paths`: several targets instead of `path`. `glob`: e.g. `**/*.ts`. `context`: lines around each match. Defaults stay in the schema. |
| `find`                    | Find files by glob; respects .gitignore; results are bounded.                                                                                                                                                                                                                                                                                                                                                                          | `pattern`: e.g. `src/**/*.test.ts`.                                                                                                  |
| `ls`                      | List a directory, including dotfiles.                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                    |
| `ask_user`                | Ask focused questions when progress depends on the user's decision. Batch related questions (max 5). Offer options for clear choices and mark at most one recommended. Users can also answer in free text and attach images (returned as readable paths).                                                                                                                                                                              | `context`, `recommendation` (one short line each).                                                                                   |
| `todos_set` / `todos_get` | Replace / get the task todo list.                                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                    |
| `web_search`              | Search the web.                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                    |
| `web_fetch`               | Fetch a URL. HTML is converted to Markdown unless `raw`; large or binary responses are saved to files.                                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                    |
| `explain_image`           | Describe an image in detail using the configured vision model; use when you can't view the image directly.                                                                                                                                                                                                                                                                                                                             | `prompt`: what to focus on.                                                                                                          |
| `generate_image`          | Generate an image from a text prompt.                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                    |
| `kroki_export`            | Render a diagram to SVG/PNG through the configured Kroki server (the source is sent to it). Prefer `source_path` so fixes can be targeted edits. Returns the output path.                                                                                                                                                                                                                                                              | Unchanged (formats, size limits).                                                                                                    |
| `subagent_prompt`         | Assign work to agents from `<available_agent_profiles>`. A new name creates one; an existing name queues a follow-up. Sub-agents share your worktree, can't see this conversation, and run asynchronously; completion notices wake you, so continue or end your turn. Batch parallel work in one call with non-overlapping scopes, put shared background in `context`, and give each one the paths, constraints, and expected outcome. | —                                                                                                                                    |
| `subagent_status`         | Inspect sub-agents: without a name, one line each; with a name, its final response or recent activity. Use only for long or suspicious work; notices already wake you.                                                                                                                                                                                                                                                                 | —                                                                                                                                    |
| `subagent_stop`           | Stop sub-agents' current execution; they can be prompted again.                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                    |
| `plan_present`            | Submit a plan file from plan storage for user review. Ends your turn; approval switches the conversation to the default profile for implementation.                                                                                                                                                                                                                                                                                    | `file_path`: inside plan storage.                                                                                                    |

Final wording is checked against the existing tool tests and adjusted only where behavior differs (for example, the bash background timeout is `{N}`, filled from configuration).

### Guide skills for tool groups

Jira and Confluence get built-in **guide skills**: `packages/skills/src/builtin/guides/jira/SKILL.md` and `…/guides/confluence/SKILL.md`.

- **Content:** workflows, query patterns (JQL and CQL tips, narrow queries), the Confluence editable-source rules (storage XML/JSONL is the source of truth, Markdown is read-only), pagination, attachments, linking, and the parameter details currently in the schema prose.
- **Not user-toggleable and not listed in `<available_skills>`.** They're part of the tool group and load with it. They live in their own catalog segment, so the skill settings UI doesn't show them.
- **Each tool in the group** has a one-line description ending with `Read {{skill:jira}} before first use.` Mutating tools also keep "Only when the user explicitly asks."
- **Tool errors** caused by misuse (invalid JQL, wrong body format) append `See {{skill:…}}.`
- **Kept in the schema:** parameter names, types, enums, required fields, and the minimal hints needed for a valid call.

This saves at most the ~6k characters of prose in these two groups, but the guidance is only paid for when the tools are used. The remaining ~14k characters of schema structure are left to a separate proposal. Options there include merging tools, or exposing Jira and Confluence as a built-in SDK through `python_exec` or the TypeScript execution environment (`docs/proposals/typescript-execution-environment.md`) instead of as separate tools. The guide skills would then document the SDK.

## 3. Agent profiles

Rename sub-agent profiles to **agent profiles** throughout: contracts (`domains/subagents` → `domains/agent-profiles`), the service, the settings UI, and stored profile documents. Documents are migrated in the single unreleased migration step.

### Fields

New field `usableBy: "lead" | "subagent" | "both"`.

Scalar settings (`model`, `thinking`, `permission`, `compaction`) each have three choices. They differ in what happens when the user switches into the profile, and whether the user can change the value afterwards:

| Choice      | Document form                               | On switch into the profile (lead)                                                                                          | User can change it afterwards | Sub-agent                |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------ |
| **Inherit** | `"inherit"`                                 | Not specified: a change the user made carries over; a value set by the previous profile falls back to the settings default | Yes                           | The lead's current value |
| **Set**     | value or `"default"`, e.g. `"openai/gpt-5"` | Always applied, replacing the current value                                                                                | Yes                           | Applied at creation      |
| **Lock**    | `{ "lock": <value or "default"> }`          | Always applied                                                                                                             | No: the picker is disabled    | Same as Set              |

- **`"default"`** resolves to the settings default (project → user → built-in) when the profile is applied.
- **Inherit vs. Set `default`:** these differ only when the user changed the value in the previous profile. Inherit carries that change over; Set `default` discards it.
- **Set** writes the resolved value to the conversation config when the profile is applied.
- **Lock** is not written. The effective value is read from the active profile every turn, and the picker is disabled while the profile is active.

`lead` (model/thinking) is renamed to `inherit`. Permission gains `inherit` and `default`. `compatibleModes` is removed from permission rule sets: the picker shows every enabled rule set, with no profile-only hiding. Only a profile's Lock disables the picker.

`tools` and `skills` keep their current form: changes relative to the parent context's effective capabilities (the lead's for sub-agents; project/user capabilities for the lead). Each change counts as Set. `instructions` renders as `<instructions>`.

### Built-in profiles

| Name               | usableBy | model / thinking | permission           | tools                | skills  | instructions                                                                  |
| ------------------ | -------- | ---------------- | -------------------- | -------------------- | ------- | ----------------------------------------------------------------------------- |
| `coding` (default) | lead     | inherit          | `default` (Set)      | —                    | inherit | "In the final response, summarize changes, validation, and remaining limits." |
| `planning`         | lead     | inherit          | `{ lock: planning }` | `plan_present: true` | inherit | "Before anything else, read {{skill:planning}} and follow it."                |
| `explore`          | subagent | inherit          | `read_only`          | unchanged            | `none`  | unchanged                                                                     |
| `developer`        | subagent | inherit          | `autonomous`         | unchanged            | inherit | unchanged                                                                     |

### Active lead profile

- **Storage:** the `conversation.mode` column is repurposed as the active profile name (for example `agent_profile`) and its CHECK constraint is dropped. `planning` → `planning` and `coding` → `coding` in the unreleased migration step. No new column. `modeSchema` is replaced by a profile name.
- **New conversations** start with the default lead profile: the `defaultAgentProfile` setting (project overrides user; built-in fallback `coding`). The config is initialized from settings defaults, then the profile's Set values are applied.
- **Who switches:** only the user, through the composer profile selector (profiles with `usableBy` of `lead` or `both`) or `/profile <name>`. `/plan` is kept as a shortcut for `/profile planning`. The only automatic switch is plan approval, which goes to the default lead profile (`defaultAgentProfile`). The agent has no tool to switch profiles.
- **Sub-agent conversations** store the name of the profile they were created from in the same column. The UI shows it, and it never changes.
- **Permission resolution** (`permission-rule-set.ts`, `rule-set-options.ts`) reads the active profile instead of `mode`.

### Switching profiles in an existing conversation

Rule: **Set and Lock values are applied on every switch; for inherited settings, the user's changes carry over and the previous profile's values don't.**

For each scalar setting, with old profile P, new profile Q, and stored value v:

1. If Q sets the field, write Q's resolved value. If Q locks it, write nothing; the value is resolved from Q while it's active.
2. If Q inherits the field:
   - P inherited it: keep v.
   - P set it: keep v if it differs from P's resolved value (a user change); otherwise write the settings default.
   - P locked it: keep v. P never overwrote it, so v is the value from before P was active.

Capability toggles: conversation capability changes are already stored separately from the profile, so on a switch, drop those for keys that Q changes and keep the rest.

Example: the user picks model M and the `autonomous` rule set in Coding, then switches to Planning:

- **Model:** M is kept, because Planning inherits the model.
- **Permission:** becomes `planning` and the picker is disabled, because Planning locks it.

After approval back to Coding:

- **Model:** M is still kept.
- **Permission:** resets to the settings default, because Coding sets `default`. The earlier `autonomous` choice isn't restored; the user picks it again if they want it. A custom lead profile that _inherits_ permission would get `autonomous` back instead, because Planning's Lock never overwrote it.

Known edge case: if the user explicitly picks the same value that P set, it's treated as unchanged. This does no harm.

Sub-agent profiles stay creation-time templates. Switching a sub-agent's profile later is out of scope.

### Editing a profile that is in use

The active profile is stored by name and resolved again every turn. That needs no extra stored state:

- **Instructions, tools, skills, and Lock values** are read from the profile each turn, so edits apply from the next turn.
- **Set values** are written only when the profile is applied, so edits apply on the next switch into the profile. Re-applying them every turn would overwrite the user's changes, and detecting an edit would need a stored profile version.
- **Deleted or disabled profile:** fall back to the default lead profile and show a notice.

## 4. Planning

- **Built-in `planning` skill** (`packages/skills/src/builtin/planning/SKILL.md`, added to the catalog name list) covers how to plan:
  - research read-only;
  - brainstorm with the user through `ask_user` on decisions that depend on requirements;
  - where plans are written (plan storage);
  - plan structure: files/symbols, ordered steps, validation, risks, migrations;
  - no open questions;
  - present with `plan_present`;
  - after rejection, wait for the next user prompt.
- **`plan_mode_present` → `plan_present`:** a normal catalog tool, disabled by default and enabled by the Planning profile. The `config.mode` filter in `turn-resources.adapter.ts` is removed.
- **Approval** switches to the default lead profile (`defaultAgentProfile`, `coding` unless changed). **Rejection** keeps the profile and ends the run.
- **Unchanged:** the plan review interaction, plan asset storage, and the `plans` permission root.

## 5. Settings layers and profile templates (Phase 5)

> **Approved target.** This phase supersedes conflicting earlier rules about prompt files, inheritance, live profile resolution, storage and plan approval. The earlier sections describe phases 1–4; they are not compatibility requirements for phase 5. Profile IDs remain `coding`, `planning`, `explore` and `developer`.

### Goals

- Give agent settings one four-layer model: **built-in → user → project → conversation**.
- Make profiles pure, explicit templates that write ordinary conversation settings, not an extra live settings layer.
- Use per-file profile storage, host-owned bundled definitions and the approved settings redesign without DB schema changes.

### Model

**Settings.** LLM providers, integration accounts (Tavily and Atlassian) and app preferences are user-only. Projects and conversations select user models/accounts; they do not define their own accounts or app preferences. Agent settings at user, project and conversation scope are model, thinking, permission rule set, compaction, tools and skills. Each configurable tool has on/off state and typed configuration. `read`, `edit`, `bash` and `ask_user` stay always on and are governed by permissions; only optional tools toggle. Always-on tools can still have configuration, such as bash limits.

**Templates.** There is one agent-profile concept; `usableBy: lead | subagent | both` determines applicability. Every scalar, each tool entry and skills use the same mode vocabulary:

| Mode             | On apply                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Use settings** | Keep the conversation's current value. A new conversation is initialized from application settings before applying a template. |
| **Same as lead** | Copy the lead's effective value at sub-agent creation; valid only for sub-agent use.                                           |
| **Set**          | Write the selected value; the user can change it afterwards.                                                                   |
| **Lock**         | Write the selected value and prevent subsequent user mutation while this applied lock is in force.                             |

A tool entry reuses the capability payload: `enabled`, account `profileId` where supported, and typed settings. Modes apply to that payload, not a second profile-only tool configuration shape. Credentials remain user-owned.

Applying a template materializes its values into existing conversation settings and captures **profile name, instructions and locked fields** in `<NERVE_HOME>/data/conversations/<id>/config/applied-agent-profile.json`. The snapshot is apply-time policy, not a separate baseline settings store. Turns read conversation settings and this snapshot; they do not resolve the source profile again. Later edits, deletion or disabling of a template do not change already applied values, instructions or locks. Reapplication captures a new snapshot. The profile editor states that it is a template and changes affect future applies only.

A switch replaces the previous applied lock policy. **Use settings keeps current values even if the previous template set or locked them**; it does not restore pre-lock values or reset them to application defaults. Remove previous-Set-equality cleanup and the overloaded `default` form. Server mutation paths enforce scalar, tool and skill locks, not just disabled UI controls; applying a new template is the authorized operation that replaces values and locks.

**Built-ins.** Lead profiles remain `coding` and `planning`; sub-agent profiles remain `explore` and `developer`. `coding` uses **Use settings** for every configurable setting, drops its Set-default permission, and keeps its summary instruction. Planning keeps its planning instructions and permission lock, enables `plan_present`, and configures that tool's approval profile as `coding`. Explore and Developer retain their research/implementation purposes and explicit permission/skill choices, with source inheritance expressed using the new modes.

### Changes by area

- **Prompt resources:** load no user-level prompt/context files, including `<NERVE_HOME>/agent/{AGENTS.md,SYSTEM.md,APPEND_SYSTEM.md}`. At project scope load only applicable `AGENTS.md` files (root and nested working-directory ancestry) and the project's `.nerve/APPEND_SYSTEM.md`. Remove project `SYSTEM.md` and implicit user/above-project context loading. Keep user skill discovery; it is not prompt-file loading.
- **Settings resolution:** stop loading project `providers.json`, `integrations.json` and `ui.json`. Keep user account catalogs separate from scoped model/account selection. Reuse existing conversation scalar storage, harness compaction and capability overrides; complete tool configuration at every layer rather than adding a new settings store.
- **Tool configuration:** move Python interpreter path into `python_exec` configuration, and shell/background/timeout limits into `bash` configuration. Extend typed capability settings and their runtime consumers for user, project and conversation scopes. Unify duplicate project-harness image/Kroki configuration with the capability tool-config ladder. Profile entries use the same account/config validation, including Jira, Confluence and web-search `profileId`; they cannot disable always-on core tools.
- **Apply/runtime:** use one apply path for creation, switching and child initialization. Materialize Set and Lock values, capture instructions/lock metadata in the conversation file, and remove live per-turn profile capability, instruction and lock overlays. Enforce locks on configure, compaction and capability mutation APIs. Do not introduce profile-specific baseline/provenance columns or duplicate harness defaults in profiles.
- **Plan review:** add a typed `plan_present` approval-profile setting, not an agent-call argument. Capture its effective value in the persisted `plan_review` interaction payload when presenting the plan; validate the target on approval and switch to that captured profile. Preserve user-approved model/thinking overrides subject to locks. Approval no longer uses `defaultAgentProfile`; that setting remains the start profile for new main conversations. Rejection behavior is unchanged.
- **Profile files:** user files are `<NERVE_HOME>/data/agent-profiles/<name>.json`; project files are `.nerve/agent-profiles/<name>.json`. Use one versioned named definition/override per file, with filename/name validation. Trust exact project-file bytes; digest, `expectedDigest` concurrency, diagnostics and deletion are per file. Delete unlinks the local file; removing an override exposes the inherited definition. Reuse existing trust records, path protection and atomic writes. Replace aggregate-document mutation/replacement assumptions; in-memory draft collections need not be persisted as aggregate documents.
- **Bundled profiles:** move definitions out of contracts into `packages/workbench-server/src/domains/agent-profiles/builtin/{coding,planning,explore,developer}.json`. Load, validate and freeze them like permission rule sets, include JSON in emitted/packaged assets, and inject the catalog into the transport-neutral contracts resolver. Base definitions have `source: builtin`; clients consume the existing profile APIs, not a duplicate TS catalog.
- **Settings UI:** follow `/dev/wireframes/settings-redesign`, using shared primitives in `$lib/presentation/settings` and updated typography/style contracts.
  - **User navigation:** Connections → Providers, Integrations; Agent → General, Tools, Skills; Catalog → Profiles, Permission rules, Models; App → Workbench, Notifications, Shortcuts (read-only), Voice, Suggestions; System → Storage, System.
  - **Project navigation:** Agent → General, Tools, Skills; Catalog → Profiles, Permission rules; This project → Launch, Instructions files, Suggestions, Trust. Open this separate area from the project menu; desktop and mobile route identities carry `projectId`. Each Agent page shows changed-value dots, ↺ and a per-page “N differ · Reset all”.
  - **General and Models:** General contains start profile, remember-last-selection, model with reasoning, permission rule set and compaction. Model and reasoning form **one picker and one profile setting** wherever a single model is chosen. Models is a separate model-scope multi-select page, not another default-model picker.
  - **Tools and Skills:** skills enablement exists only on Skills pages, not General or a second skills-library page; profiles may still specify skill changes. Tool rows expose on/off for optional tools, supported account pickers, typed configuration, setup state and resets. Core tools have no off toggle. Integration entries are called **accounts**; support multiple Tavily and Atlassian accounts, with independent Jira and Confluence selections.
  - **Profiles:** show change lists with modes and the template notice. Lock is available for **all** profiles; Same as lead is available only for profiles usable by sub-agents (`subagent` or `both`).
  - **Composer:** show the profile picker, “Locked by <profile>” chips, a dot and ↺ for values differing from settings, and a Tools popover with optional-tool toggles, account pickers and configuration. Values and locks come from applied conversation state, not the editable template.

### Migration

Extend unreleased **`0002-agent-profiles`** and its frozen conversions/fixtures; never edit released migrations. **No DB schema changes** are part of phase 5.

- Split existing aggregate user/project/conversation profile documents into per-profile files where scoped definitions remain supported. Preserve source digests, per-target receipts, collision protection, quarantine, rollback and retry safety; delete aggregate sources only after all targets verify. Old whole-document trust must not become blanket approval of transformed files: require per-file project review.
- Convert legacy modes to explicit Use settings / Same as lead / Set / Lock according to their old scope and meaning. Resolve old `default` references into concrete values where possible; route ambiguous or unresolvable input through repair rather than guessing. No runtime aliases or dual readers.
- Move detached execution configuration and duplicate project tool configuration into their canonical typed tool settings. Preserve account selections without copying credentials or silently importing project accounts into the user catalog.
- Materialize existing conversations' effective profile values and instructions, including locks, into their settings and applied snapshots so they do not depend on the template after upgrade. Preserve conversation-specific choices and distinguish lead from child state; do not snapshot a live profile twice over an already materialized child.
- Keep all existing profile IDs and stored `agent_profile` / `defaultAgentProfile` names unchanged. Rehearse on a fresh/copied slot, never slot 1, and verify restart, exact-byte trust, deletion, idempotence and rollback.

### Out of scope

- Profile renames, new DB tables/columns, released-migration edits, runtime compatibility shims and a separate profile-baseline store.
- Disabling always-on core tools, project-owned provider/integration accounts or app preferences, and changing an existing sub-agent's profile.
- Unrelated mock-only features such as new model providers, editable shortcuts, named compaction-strategy CRUD or desktop autostart. Use real supported controls/catalogs in the approved layout.

### Implementation waves and ownership

Use four stable ownership lanes; two developers can combine lanes serially. No parallel developer edits another lane's files. Contracts are agreed before consumers are wired; shared composition/registry files have one owner.

| Owner                               | Exclusive paths / responsibility                                                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — shared model and core           | `packages/contracts/**`, `packages/conversation-core/**`: mode/tool/snapshot/interaction contracts, apply lifecycle and core mutation/approval mechanics. No DB schema changes.                                                                          |
| B — host and migration              | `packages/workbench-server/**`: scoped settings/tool resolution, snapshot/profile files, bundled JSON/build inclusion, trust, runtime adapters and all `0002-agent-profiles` conversions. Owns required host build/config files; no released migrations. |
| C — settings presentation and pages | Workbench app `$lib/presentation/settings/**`, `$lib/features/settings/views/**` and styling guidance: primitives, typography tests, Agent/Profiles/tool rows and restructured pages. No app composition/registry edits.                                 |
| D — app state, routing and composer | Workbench app settings state/API/registry and app composition, application/workspace/commands, project-menu wiring, mobile routes and composer: explicit scope targets, applied-state UI and integration. Owns shared exports/wiring outside C's paths.  |

1. **Contracts and UI foundation** — A defines mode semantics, typed tool payloads, snapshot and captured approval contracts; B fixes file formats, migration mapping and JSON loader/build plan against them. C ports canonical primitives and updates typography/style rules; D defines bound User/Project route and controller interfaces. Gate: no overloaded inheritance/default, no core-off capability, no duplicated built-in definitions.
2. **Persistence and apply behavior** — A implements materialization, lock mutation enforcement and approval routing; B implements per-file catalogs/trust/concurrency/delete, layered tool resolution, prompt-source removal, snapshots and 0002. C builds Agent/Profiles pages against settled interfaces; D builds state/API adapters and scoped navigation. Gate: later template edits cannot alter an applied conversation; config/account choices work at all allowed scopes; per-file conflicts and trust are isolated.
3. **Redesign integration** — C completes page merges/moves, change lists, mode editors and account/config rows; D wires desktop/project menus/mobile/composer and removes old live-template UI assumptions. A/B close owning-layer runtime gaps. Gate: start profile and captured approval target are independent, locks are truthful and server-enforced, project saves cannot drift to another project, and forbidden prompt/project settings sources are gone.
4. **Validation and cleanup** — each owner tests touched behavior; B rehearses 0002 on a copied slot and checks packaged JSON assets. D coordinates light/dark, narrow/mobile and multi-project review plus the final focused fix/check pass after parallel edits settle. Gate: relevant unit tests and focused checks pass; no aliases, aggregate storage, live profile layer, stale controls or unrelated edits remain. Run integration/browser suites only when explicitly requested.

## Phases

1. **System prompt + core tool descriptions.** New sections, order, and guidelines. Tool rules move to descriptions. Rename `<instructions>`. Add `<available_agent_profiles>` and the `{{skill:}}` placeholder. Change the `SYSTEM.md` scope. Rewrite core/orchestration descriptions. Mode and its prompt blocks stay for now.
2. **Jira/Confluence guide skills.** Guide catalog segment, one-line descriptions, error hints, trimmed schema prose.
3. **Agent profiles.** Rename, `usableBy`, Inherit/Set/Lock, lead resolution, switching rules, `defaultAgentProfile`, settings UI, document migration.
4. **Planning as a profile.** `planning` skill, `plan_present`, `mode` column repurposed (approved), composer selector, `/profile <name>` and the `/plan` shortcut, approval switch, removal of `<mode_controls>`/`<plan_mode>`, `modeSchema`, `compatibleModes`. Update `ui-kit` `status.ts`. The marketing simulation (`website/src/scripts/marketing/run-simulation.ts`) shows the profile selector with Coding/Planning. Test the migration on a copied slot (`pnpm storage:copy --slot N`).

5. **Settings layers and pure templates.** Implement section 5: four settings layers, explicit modes, apply-time snapshots, typed tool configuration and approval targets, per-file/bundled JSON profiles, and the approved settings redesign.

Phases ship independently. Phase 5 extends the existing unreleased `0002-agent-profiles` migration; released migrations stay unchanged.

## Follow-up proposals

- **Atlassian tool surface:** merge Jira/Confluence tools, or expose them as a built-in SDK through `python_exec`/TypeScript execution, to cut the remaining schema cost.
