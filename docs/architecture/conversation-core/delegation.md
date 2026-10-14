# Delegation and sub-agent profiles

Part of the [conversation core redesign](README.md).

> **Status:** Current implementation. Owning contracts, delegation handlers and host adapters are authoritative. See [profile customization](../subagent-profiles.md) for scoped JSON configuration.

A lead delegates to **sub-agents** with three tools. A sub-agent is an ordinary child conversation. What kind of sub-agent it is (persona, model, permission rule set, tools, skills, compaction) comes from a **profile**, resolved from scoped JSON configuration and applied once, when the sub-agent is created.

## Principles

- **A profile is a template, not a policy.** It is applied at creation through existing mechanisms: conversation configuration, the conversation `capabilities.json` and the conversation `harness.json`. Its name may be derived from the creating tool call for provenance and assignment checks, but is never a live configuration binding. Editing or deleting a profile affects only sub-agents created afterwards.
- **A sub-agent is a conversation.** It has the same runtime, history, controls and per-conversation configuration as a lead. A small set of host-enforced rules is the only difference.
- **Conversation core knows nothing about profiles.** It talks to the host through the `SubagentHost` port. The host owns profile documents, trust and capability files.
- **The lead's context is the scarce resource.** Tool definitions, arguments, results and notices are sized for long-running leads, and nobody polls: completion notices wake the lead.
- **Asynchronous only.** There is no blocking delegation tool; parallel research is several sub-agents in one batch.

## Layers

| Layer                                                                                             | Owns                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`contracts/subagents`](../../../packages/contracts/src/domains/subagents/)                       | Limits, blocked tool names, allowed rule sets, profile schemas, built-in profiles, the `subagentProfiles.*` operations                                                              |
| [`conversation-core/delegation`](../../../packages/conversation-core/src/delegation/)             | The three tool handlers, batch validation, notices, report spill, status formatting, the [`SubagentHost`](../../../packages/conversation-core/src/delegation/subagent-host.ts) port |
| [`workbench-server/domains/subagents`](../../../packages/workbench-server/src/domains/subagents/) | Scoped profile documents, resolution, diagnostics, enablement and project trust                                                                                                     |
| [`workbench-server/core-host`](../../../packages/workbench-server/src/core-host/)                 | `SubagentHost` implementation, tool filtering and profile enum per turn, instructions in the system prompt, conversation `harness.json`, child capability files                     |

## Profiles

Each writable scope has one versioned `config/subagents.json` document containing named entries and their instructions. The entry key is what the lead passes as `profile`. See the [profile customization reference](../subagent-profiles.md) for ownership and resolution decisions and the [profile format reference](../../../packages/website/src/content/docs/reference/subagent-profiles.md) for fields and examples.

| Level        | Location                                                        | Notes                                                            |
| ------------ | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Built-in     | `builtInSubagentProfiles` in contracts (`explore`, `developer`) | Read-only defaults; both use `model: "lead"`, `thinking: "lead"` |
| User         | `<NERVE_HOME>/config/subagents.json`                            | Full Settings editor                                             |
| Project      | `<project>/.nerve/config/subagents.json`                        | Full Settings editor; exact document content must be trusted     |
| Conversation | `<NERVE_HOME>/data/conversations/<id>/config/subagents.json`    | Conversation-owned overrides; deleted with its owner             |

- **Precedence:** resolve by name through built-in → user → project → conversation. Entries are sparse overrides: missing fields inherit, scalars/instructions replace, tool and skill maps merge by name, and structured compaction replaces as a whole. New names must resolve to valid complete profiles.
- **Reset and copy:** reset removes a local field or entry. Explicit values stay pinned even when equal to inherited values. Copy-to-scope materializes the effective fields, while duplicating under a new name creates an independent profile.
- **Enablement:** `enabled` belongs to the same scoped document, not a separate preference file. Higher scopes can re-enable profiles; the `subagents` capability remains the master switch.
- **Project trust:** profiles can grant autonomous permission and inject instructions. Untrusted project content is visible but blocks affected profiles; conversation overrides cannot bypass it. External edits invalidate trust. Editing, toggling or resetting an entry in an untrusted imported project document does not trust it or activate untouched entries; explicit whole-document trust is required. Nerve-authored updates can automatically trust missing/new documents or updates to previously exact-trusted documents only.
- **Diagnostics:** preserve unknown/unavailable enabled tools and skills with warnings, but omit them from the child. Skill loadability follows existing resource-loader policy, with no independent skill trust system or new database gate; profile trust covers the project `subagents.json` document only. An unavailable explicit model or known incompatible thinking level blocks creation; never silently substitute or downgrade. Invalid entries do not hide unrelated valid entries or silently reveal a lower same-name profile. Malformed documents are visible errors, not empty configuration.
- **Usable:** enabled, valid, trusted and free of blocking diagnostics. Capability warnings alone permit use with reduced capabilities. Advertising and creation use the same conversation-aware resolver, with availability rechecked at creation.
- **Blocked configuration:** permission accepts only `read_only` or `autonomous`. Forbidden tools are validation errors, not availability warnings. Core tools are governed by permission rather than profile toggles; runtime restrictions always apply.

## Agent interface

Three tools in the `subagents` capability group: `subagent_prompt`, `subagent_status` and `subagent_stop`. The catalog owns their definitions; core owns the handlers (`createDelegationTools`). Results are plain text, one line per assignment or sub-agent, and never echo the prompt.

### Profile enum per turn

Each turn, turn resources rewrite the `subagent_prompt` definition so `profile` is an enum of the currently usable profiles with their one-line descriptions (`withSubagentProfiles`). With no usable profiles but existing children, all three tools remain available for follow-ups, status and stop; the prompt schema omits `profile`, and attempts to create a new child fail. Disabling or deleting the last usable profile therefore affects future creations only, not controls for existing children. With neither usable profiles nor existing children, all three tools are removed. Turning the master `subagents` capability off removes the entire group regardless of existing children. Descriptions are paid for on every lead turn, which is why they are capped at 200 characters.

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
| `instructions`      | `conversation_config.instructions`                                                                                                  |
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
- **Sub-agent view:** a sub-agent opens in the main view with the lead's transcript and composer components. The composer editor is covered by "Sub-agents take prompts only from their lead." with a way back; the toolbar controls (permission within the two rule sets, model, Capabilities popover for tools and skills, context popover) stay usable.
- **Context popover:** usage and compaction, per-conversation compaction override and instructions, and session details. It replaces the former Context dock panel.
- **Settings → Sub-agents:** full user/project editor for label, description, instructions, enabled state, model, thinking, permission, tools, skills and compaction; copy-to-scope, duplicate, field origins, resets, trust and diagnostics. Project edits write project configuration.
- **Conversation profiles:** the composer’s **Capabilities → Sub-agents** tab, alongside **Tools** and **Skills**, provides per-profile enabled, model and thinking controls with inherited values, per-field reset and diagnostics. The master delegation capability toggle is distinct from these profile controls. Profile overrides affect new children only; existing children retain their creation-time configuration and any direct edits. To switch an existing child after model usage limits, open that child and edit its own model/thinking controls; a follow-up retains those edits.

## Legacy

The `explore` tool, `subagent_new` and `subagent_list`, the `exploreAgent` and `asyncSubagent` settings, and `data/reports/` are gone. The unreleased step 0001 of the [storage migrations](../migrations.md) converts customized user settings and legacy Markdown profiles/enablement for user scope and registered projects into versioned scoped `config/subagents.json` documents, and moves existing reports into the owning child's `reports/` directory. Preserve explicit toggles and instructions, reassess project trust, and avoid permanent dual loading. Conflicts, malformed documents and incompatible whole-map legacy capability shadowing stop conversion with an actionable error, preserving sources until explicitly resolved; sparse merges must not guess enabled state for extra inherited keys. Unregistered old projects opened later require canonical `.nerve/config/subagents.json` conversion; migration does not discover every directory and there is no runtime legacy loader. Dev-only homes with an earlier draft of step 0001 already applied need a baseline rebuild/copy, because extending the step does not rerun an applied ledger entry. Old transcripts keep rendering; the app derives `explore` or `developer` for legacy children from the legacy tool name.
