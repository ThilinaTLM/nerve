# Delegation and agent profiles

Part of the [conversation core redesign](README.md).

> **Status:** Current implementation. Owning contracts, delegation handlers and host adapters are authoritative. See [profile customization](../agent-profiles.md) for scoped JSON configuration.

A lead delegates to **sub-agents** with three tools. A sub-agent is an ordinary child conversation. What kind of sub-agent it is (persona, model, permission rule set, tools, skills, compaction) comes from a **profile**, resolved from scoped JSON configuration and applied once, when the sub-agent is created.

## Principles

- **A child captures its own configuration.** Creation stores complete underlying preferences and an applied profile snapshot in conversation `config/agent.json`. Recommendations and requirements are distinct; catalog edits/deletion never silently reconfigure existing children.
- **A sub-agent is a conversation.** It has the same runtime, history, controls and per-conversation configuration as a lead. A small set of host-enforced rules is the only difference.
- **Profile policy belongs to the host.** Core delegates child creation through `SubagentHost` and lead profile transitions through `AgentProfilePort`. The host owns profile documents, trust and capability resolution; core owns history and lifecycle.
- **The lead's context is the scarce resource.** Tool definitions, arguments, results and notices are sized for long-running leads, and nobody polls: completion notices wake the lead.
- **Asynchronous only.** There is no blocking delegation tool; parallel research is several sub-agents in one batch.

## Layers

| Layer                                                                                                                                | Owns                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@nervekit/contracts/subagents`](../../../packages/contracts/src/domains/subagents/)                                                | Sub-agent limits and blocked tool names                                                                                                                                             |
| [`@nervekit/contracts/agent-profiles`](../../../packages/contracts/src/domains/agent-profiles/)                                      | Profile schemas, resolution, and the `agentProfiles.*` operations                                                                                                                   |
| [`conversation-core/delegation`](../../../packages/conversation-core/src/delegation/)                                                | The three tool handlers, batch validation, notices, report spill, status formatting, the [`SubagentHost`](../../../packages/conversation-core/src/delegation/subagent-host.ts) port |
| [`workbench-server/…/agent-configuration`](../../../packages/workbench-server/src/infrastructure/configuration/agent-configuration/) | Built-in profiles (`builtins/`, one module each), scoped profile documents, resolution, diagnostics, enablement and project trust                                                   |
| [`workbench-server/core-host`](../../../packages/workbench-server/src/core-host/)                                                    | `SubagentHost` implementation, tool filtering and profile enum per turn, instructions in the system prompt, captured scoped agent settings and child documents                      |

## Profiles

Reusable complete definitions live at `<NERVE_HOME>/data/agent-profiles/<name>.json` and `<project>/.nerve/agent-profiles/<name>.json`. Same-name project definitions shadow whole user/built-in definitions. There is no conversation catalog. Project definitions require exact-byte trust; malformed unused entries are isolated with diagnostics.

Use settings contributes nothing; Recommend yields to explicit choices; Require controls the effective value without overwriting underlying preferences. See [profile customization](../agent-profiles.md) and the [user reference](../../../packages/website/src/content/docs/reference/agent-profiles.md) for fields, source labels and reset semantics.

## Agent interface

Three tools in the `subagents` capability group: `subagent_prompt`, `subagent_status` and `subagent_stop`. The catalog owns their definitions; core owns the handlers (`createDelegationTools`). Results are plain text, one line per assignment or sub-agent, and never echo the prompt.

### Profile enum per turn

Each turn, turn resources list usable sub-agent/both profiles and their one-line descriptions in `<available_agent_profiles>`. The `subagent_prompt` schema constrains profile names to those currently usable; descriptions are not repeated in the tool schema. With no usable profiles but existing children, all three tools remain available for follow-ups, status and stop; the prompt schema omits `profile`, and attempts to create a new child fail. Disabling or deleting the last usable profile therefore affects future creations only, not controls for existing children. With neither usable profiles nor existing children, all three tools are removed. Turning the master `subagents` capability off removes the entire group regardless of existing children. Descriptions are paid for on every lead turn, which is why they are capped at 200 characters.

### `subagent_prompt`

A batch of 1–`SUBAGENT_BATCH_LIMIT` assignments, each `{ name, profile?, prompt }`, plus optional shared `context` that is written once and prepended to every prompt.

- **Validation is all-or-nothing.** The whole batch is checked before anything is created or queued. Duplicate names (case-insensitive), a missing or unusable profile for a new name, a profile that does not match an existing sub-agent, and empty names or prompts all fail the call with every reason listed.
- **New name:** the host resolves the child's own defaults/profile and the latest validated launch model/reasoning selection, without copying the lead's effective agent settings or prompt context. Launch choices beat recommendations, not requirements. The host captures frozen underlying preferences and the applied profile in the child's `agent.json`; working directory remains a conversation property. The assignment (`context`, a blank line, `prompt`) is submitted after initialization.
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

Creation stores `frozenDefaults` (resolved underlying preferences before requirements) and `appliedProfile` in `data/conversations/<id>/config/agent.json`. Follow-ups resolve captured requirements over that baseline; recommendations never reapply above launch choices. Later user/project defaults, catalog edits and lead invocation edits do not affect existing children. Supported direct child edits remain explicit overrides; profile switching/reapplication is unsupported.

Frozen preferences do not freeze credentials or authorization. Current ruleset definitions and execution guards remain authoritative. Children have no parent-permission ceiling and do not inherit the lead's tools, skills or permissions.

### Rules enforced for every sub-agent

They apply to any conversation with a parent, whatever its profile or later edits:

| Rule                                              | Enforced in                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| No `ask_user`, `plan_present`, `subagent_*`       | `createTurnResourcesPort` removes `subagentBlockedToolNames` from a child's tools                                 |
| Rule set is one of `subagentPermissionRuleSetIds` | `ConversationService` on create and every configuration change                                                    |
| No direct user prompts                            | `InputQueueService` and `ConversationCore.submitInput` reject user-sourced input for a conversation with a parent |

Neither allowed rule set contains "ask" rules and sub-agents skip the permission overlays, so a sub-agent never waits for a person. There is no authority cap relative to the lead. Everything else is editable per sub-agent in its transcript view.

### Instructions

Conversation-only instructions and custom system prompt live in `agent.json.context`, not SQL or profile preferences. They are never copied from the parent. Applied-profile instructions contribute separately on each captured turn, including with a custom base prompt. Profile switches preserve local context.

### Compaction settings

Compaction fields resolve through scoped `agent.json.overrides.compaction` and applied contributions; fields merge independently. Children use their frozen baseline plus captured requirements and supported explicit edits. Reset removes an editable override and inherits rather than writing a default. Each preparation/compaction captures current validated settings; compaction summaries remain history events.

## Async bash in sub-agents

Sub-agents keep `bash` background runs and `async_bash`. A sub-agent that ends its turn with background commands running finishes its execution normally; the lead gets the _waiting_ notice and `subagent_status` shows `waiting: N background commands`. A follow-up while waiting starts an execution immediately, since the sub-agent is not busy.

## Stop and recovery

Stopping a lead pauses it and cascades to its sub-agents and their background commands (see the stop semantics in the [README](README.md)). Sub-agents live as long as their lead and are deleted with it.

## User interface

The UI adds no behavior of its own; it renders the data above.

- **Transcript activity island** combines conversation navigation with Agents and Commands controls. Its expandable view presents the lead/sub-agent tree and background commands from current conversation state. It is presentation, not a separate execution or recovery store.
- **Waiting state:** the transcript activity row stays visible after a turn while sub-agents or background commands are pending, and names them.
- **Sub-agent view:** a sub-agent opens in the main view with the lead's transcript and composer components. The composer editor is covered by "Sub-agents take prompts only from their lead." with a way back; the toolbar controls (permission within the two rule sets, model, Capabilities popover for tools and skills, context popover) stay usable.
- **Context popover:** usage and compaction, per-conversation compaction override and instructions, and session details. It replaces the former Context dock panel.
- **Settings → Agent profiles:** full user/project editor for usability, label, description, instructions, enabled state, model, thinking, permission, tools, skills and compaction (Use settings/Recommend/Require); copy-to-scope, duplicate, field origins, resets, trust and diagnostics. Project edits write project configuration.
- **Conversation profiles:** the composer’s **Capabilities → Sub-agents** tab, alongside **Tools** and **Skills**, provides per-profile enabled, model and thinking controls with inherited values, per-field reset and diagnostics. The master delegation capability toggle is distinct from these profile controls. Launch overrides affect new children only; existing children retain their creation-time configuration and any direct edits. To switch an existing child after model usage limits, open that child and edit its own model/thinking controls; a follow-up retains those edits.

## Recovery and migration

UI saves publish validated settings directly. There are no file watchers: manual edits require restart for guaranteed activation or explicit Reload/Retry. Invalid required/security configuration blocks affected execution with Retry/Cancel, not an approval bypass. Confirmed repair previews preserve damaged sources; dismissal alone does not repair configuration.

Released v0.37.0 readers for retired configuration exist only in frozen migration step `0002-agent-profiles`; no runtime compatibility loader or parent-copy path remains. See [storage migrations](../migrations.md).
