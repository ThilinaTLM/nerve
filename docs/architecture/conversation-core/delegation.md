# Delegation and sub-agent profiles

Part of the [conversation core redesign](README.md).

> **Status:** Current implementation. Owning contracts, the delegation handlers in `conversation-core` and the host adapters in `workbench-server` are authoritative.

A lead delegates to **sub-agents** with three tools. A sub-agent is an ordinary child conversation. What kind of sub-agent it is (persona, model, permission rule set, tools, skills, compaction) comes from a **profile**, a Markdown file that is applied once, when the sub-agent is created.

## Principles

- **A profile is a template, not a policy.** It is applied at creation through existing mechanisms: conversation configuration, the conversation `capabilities.json` and the conversation `harness.json`. Nothing about the profile is stored on the child or looked up later. Editing or deleting a profile affects only sub-agents created afterwards.
- **A sub-agent is a conversation.** It has the same runtime, history, controls and per-conversation configuration as a lead. A small set of host-enforced rules is the only difference.
- **Conversation core knows nothing about profiles.** It talks to the host through the `SubagentHost` port. The host owns profile files, trust and capability files.
- **The lead's context is the scarce resource.** Tool definitions, arguments, results and notices are sized for long-running leads, and nobody polls: completion notices wake the lead.
- **Asynchronous only.** There is no blocking delegation tool; parallel research is several sub-agents in one batch.

## Layers

| Layer                                                                                             | Owns                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`contracts/subagents`](../../../packages/contracts/src/domains/subagents/)                       | Limits, blocked tool names, allowed rule sets, profile schemas, built-in profiles, the `subagentProfiles.*` operations                                                              |
| [`conversation-core/delegation`](../../../packages/conversation-core/src/delegation/)             | The three tool handlers, batch validation, notices, report spill, status formatting, the [`SubagentHost`](../../../packages/conversation-core/src/delegation/subagent-host.ts) port |
| [`workbench-server/domains/subagents`](../../../packages/workbench-server/src/domains/subagents/) | Profile files, precedence, enablement, project trust (`SubagentProfileService`)                                                                                                     |
| [`workbench-server/core-host`](../../../packages/workbench-server/src/core-host/)                 | `SubagentHost` implementation, tool filtering and profile enum per turn, instructions in the system prompt, conversation `harness.json`, child capability files                     |

## Profiles

A profile is one Markdown file: frontmatter for configuration, body for instructions. The file name without `.md` is the profile name, and it is what the lead passes as `profile`. The format is defined by `subagentProfileFrontmatterSchema`; the user-facing description is the [profile format reference](../../../packages/website/src/content/docs/reference/subagent-profiles.md).

| Level    | Location                                                        | Notes                                                        |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| Built-in | `builtInSubagentProfiles` in contracts (`explore`, `developer`) | Read-only; editing one writes a user file with the same name |
| User     | `<NERVE_HOME>/agent/subagents/*.md`                             | Created and edited from Settings                             |
| Project  | `<project>/.nerve/subagents/*.md`                               | Used only while trusted                                      |

- **Precedence:** project beats user beats built-in, by name. The first definition stays authoritative even when it is invalid, disabled or untrusted, so a lower one never reappears. Shadowed definitions are still listed for Settings.
- **Invalid files** are listed with their error and fallback values, and are never offered to the lead. One broken file does not hide the others.
- **Enablement:** a per-profile switch in `config/subagents.json` (`SubagentEnablementService`) overrides the file's `enabled` without rewriting the file. The `subagents` capability remains the master switch at user, project and conversation level.
- **Project trust:** a project profile can grant `autonomous` permission and inject instructions, so a cloned repository must not do that silently. Each project profile is a `TRUSTED_RESOURCE` (kind `subagent_profile`) bound to its content digest. Until trusted it is listed with a Trust action and not offered. Editing the file requires trust again; saves made from Nerve's own Settings are trusted on save. Deleting a project profile removes its trust record.
- **Usable** means enabled, valid, trusted and not shadowed (`isUsable`). The lead sees only usable profiles.
- **Blocked configuration:** `permission` accepts only the rule sets in `subagentPermissionRuleSetIds`, and `tools` rejects the names in `subagentBlockedToolNames`. Core tools are not toggleable per profile; the permission rule set governs them.

## Agent interface

Three tools in the `subagents` capability group: `subagent_prompt`, `subagent_status` and `subagent_stop`. The catalog owns their definitions; core owns the handlers (`createDelegationTools`). Results are plain text, one line per assignment or sub-agent, and never echo the prompt.

### Profile enum per turn

Each turn, turn resources rewrite the `subagent_prompt` definition so `profile` is an enum of the currently usable profiles with their one-line descriptions (`withSubagentProfiles`). With no usable profile, or with the `subagents` capability off, all three tools are removed. Descriptions are paid for on every lead turn, which is why they are capped at 200 characters.

### `subagent_prompt`

A batch of 1–`SUBAGENT_BATCH_LIMIT` assignments, each `{ name, profile?, prompt }`, plus optional shared `context` that is written once and prepended to every prompt.

- **Validation is all-or-nothing.** The whole batch is checked before anything is created or queued. Duplicate names (case-insensitive), a missing or unusable profile for a new name, a profile that does not match an existing sub-agent, and empty names or prompts all fail the call with every reason listed.
- **New name:** the child is created with `{ ...leadConfig, systemPrompt: null, instructions: null, ...resolved.config }`, where `resolved.config` comes from `SubagentHost.resolveProfile`. Mode and working directory are copied from the lead. Then `SubagentHost.initializeChild` writes the child's files, and the assignment (`context`, a blank line, `prompt`) is submitted.
- **Existing name:** the prompt is queued as a follow-up. A stopped (paused) sub-agent is resumed, because prompting it is explicit intent. Idle and waiting sub-agents start a new execution; a running one picks the prompt up at its next turn boundary.
- **Names** are the child's title, unique per lead and case-insensitive.

A sub-agent's profile is derived, not stored: core follows `parentToolCallId` to the arguments of the creating `subagent_prompt` call and finds the assignment with that name. If it cannot be found (for example for legacy children) the profile is unknown, and the mismatch check is skipped.

### `subagent_status` and `subagent_stop`

`subagent_status` without a name returns one line per sub-agent, newest activity first, with the profile, state, context usage and age. With a name it adds a header (model, `tokens/window`, run time) and a state-dependent body: the final response, the recent activity window (`SUBAGENT_STATUS_ACTIVITY_ITEMS` items, oldest first), the running background commands, or the failure message. Formatting lives in `subagent-status.ts`; context usage comes from `ConversationCore.contextUsage`.

`subagent_stop` stops the current execution of the named sub-agents and ends their background commands, as conversation stop does. They remain and can be prompted again. A sub-agent that is idle and has no background commands is left alone and reported as such.

## Completion notices

Each finished child execution sends the lead one `sub_conversation_event` notice that wakes it when idle. Notices queued together are delivered in the same lead turn. The first line depends on the outcome:

| Outcome                                    | First line                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Completed                                  | `Sub-agent "<name>" (<profile>) completed.`                                                |
| Failed                                     | `… failed: <error>`                                                                        |
| Interrupted                                | `… interrupted.`                                                                           |
| Stopped by the user                        | `… was stopped by the user.`                                                               |
| Completed with background commands running | `… is waiting on N background command(s) and accepts follow-ups:` and one line per command |

The last response, if any, follows. When a background command finishes, its `async_bash_event` wakes the sub-agent, which starts a new execution and sends a new notice.

**Who stopped it.** Core keeps no stop-source field:

- `subagent_stop` records the child id in an in-memory set while it awaits the stop; a cancelled execution of such a child sends no notice, because the tool result already reports it.
- A stop that cascades from the lead pauses the lead before any descendant finishes cancelling, so a cancelled execution whose parent is paused sends no notice.
- Any other cancelled execution is treated as a stop by the user.

User configuration changes (model, rule set, tools, skills, compaction, instructions) are never reported; the lead reads current values through `subagent_status`.

### Report cap

A final response is included in full up to `SUBAGENT_REPORT_INLINE_BYTES`. Above that, the notice (and a named `subagent_status`) carries the first bytes and ends with `[truncated; full response: <path>]`. The full text is written to `data/conversations/<childId>/reports/<executionId>.md`, which is deleted with the conversation. The cap is applied by core when it builds the notice; it is not a tool-result projection profile (see [tool-result projection](../tool-result-projection.md)).

## Child configuration

On creation the host copies the profile into the places a lead is configured through:

| Profile field       | Becomes                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `model`, `thinking` | `model` and `reasoning_level`; `lead` copies the lead's current values. A named model must resolve or creation fails.               |
| `permission`        | `permission_rule_set_id`                                                                                                            |
| Body                | `conversation_config.instructions`                                                                                                  |
| `tools`, `skills`   | The child's `capabilities.json`: the lead's conversation overrides plus the profile's changes (`CapabilityService.initializeChild`) |
| `compaction`        | The child's `harness.json`, unless `inherit`                                                                                        |

### Rules enforced for every sub-agent

They apply to any conversation with a parent, whatever its profile or later edits:

| Rule                                              | Enforced in                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| No `ask_user`, `plan_mode_*`, `subagent_*`        | `createTurnResourcesPort` removes `subagentBlockedToolNames` from a child's tools                                 |
| Rule set is one of `subagentPermissionRuleSetIds` | `ConversationService` on create and every configuration change                                                    |
| No direct user prompts                            | `InputQueueService` and `ConversationCore.submitInput` reject user-sourced input for a conversation with a parent |

Neither allowed rule set contains "ask" rules and sub-agents skip the permission overlays, so a sub-agent never waits for a person. There is no authority cap relative to the lead. Everything else is editable per sub-agent in its transcript view.

### Instructions

`conversation_config.instructions` is persona and working rules for one conversation, up to `SUBAGENT_INSTRUCTIONS_MAX_BYTES`. When set, the generated system prompt renders it as an `<agent_instructions>` section after the project context files and before the skills. Any conversation can have it. It is part of the generated prompt only: a conversation with its own `system_prompt` replaces the whole prompt and does not render it. A change applies from the next turn.

### Compaction settings

Auto-compaction is a layered setting, `user → project → conversation`, in `harness.json`. The conversation file is `data/conversations/<id>/config/harness.json` and accepts conversation-scoped settings only (`compaction` today). An override replaces the inherited value as a whole, and saving a value equal to the inherited one removes the override (`ConversationHarnessSettings`).

Core asks the host through `ConversationCoreOptions.compactionSettings` before each turn and for manual compaction. The result drives the auto-compaction check (`auto: false` is respected) and the manual thresholds. A profile's explicit compaction is written at creation as written, even when equal to the inherited value.

## Async bash in sub-agents

Sub-agents keep `bash` background runs and `async_bash`. A sub-agent that ends its turn with background commands running finishes its execution normally; the lead gets the _waiting_ notice and `subagent_status` shows `waiting: N background commands`. A follow-up while waiting starts an execution immediately, since the sub-agent is not busy.

## Stop and recovery

Stopping a lead pauses it and cascades to its sub-agents and their background commands (see the stop semantics in the [README](README.md)). Sub-agents live as long as their lead and are deleted with it.

## User interface

The UI adds no behavior of its own; it renders the data above.

- **Agents pill** at the top right of the transcript area, shown when the conversation tree has sub-agents or the viewed conversation has background commands. Its popover lists the lead and sub-agents as a tree and the viewed conversation's background commands. Finished sub-agents fold after ten minutes without activity; failed ones stay.
- **Waiting state:** the transcript activity row stays visible after a turn while sub-agents or background commands are pending, and names them.
- **Sub-agent view:** a sub-agent opens in the main view with the lead's transcript and composer components. The composer editor is covered by "Sub-agents take prompts only from their lead." with a way back; the toolbar controls (permission within the two rule sets, model, tools and skills, context popover) stay usable.
- **Context popover:** usage and compaction, per-conversation compaction override and instructions, and session details. It replaces the former Context dock panel.
- **Settings → Sub-agents:** profile list with source, enabled switch, trust state, and an editor, in user and project scope.

## Legacy

The `explore` tool, `subagent_new` and `subagent_list`, the `exploreAgent` and `asyncSubagent` settings, and `data/reports/` are gone. Step 0001 of the [storage migrations](../migrations.md) converts customized settings into user profile files and `config/subagents.json`, and moves existing reports into the owning child's `reports/` directory. Old transcripts keep rendering; the app derives `explore` or `developer` for legacy children from the legacy tool name.
