# User interface

Part of the [sub-agent profiles proposal](README.md). Wireframes: [wireframes.html](wireframes.html) (open in a browser). Frame letters below refer to it.

## Direction

The conversation's own details move into the conversation area, so the dock panels show only project-level data.

| Today                                                                                         | Proposed                                                                                      |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Right-dock **Context** panel: usage and compaction, session fields, token metrics, agent list | Removed. Each part moves to the composer or the transcript area.                              |
| Sub-agent rows open `SubagentTranscriptDialog`, a separate, read-only, reduced renderer       | Sub-agents open in the main view with the same transcript and composer components as the lead |
| `awaiting_async` is visible only as an hourglass in the Context agent list                    | The transcript activity row stays visible and says what the conversation is waiting for       |
| Background commands have no list of their own                                                 | Listed in the Agents popover, with stop and output actions                                    |

This removes:

- the only mixed-scope dock panel, its layout state and tour step
- a second transcript renderer
- the mobile Context route, whose content now lives in the same popovers

## Conversation area

### Agents pill (frames A, B)

A floating pill at the top right of the transcript area. The bottom of the transcript is kept for activity that needs the user, such as `ask_user`, plan review and approvals, so the pill does not compete with it. The pill is shown when the conversation tree has sub-agents or the viewed conversation has background commands, and is hidden otherwise.

- **Collapsed, in the lead:** team size, how many are working, and the number of background commands, e.g. `👥 3 · 2 working | ⌁ 1 command`. A running or waiting state is marked with the usual dot colors.
- **Collapsed, in a sub-agent:** the pill also identifies the agent being viewed, e.g. `← test-harness [developer] | 👥 3 | ⌁ 1`. It is the only place on screen that says which agent this is, because there is no breadcrumb. The `←` goes back to the lead.
- **Expanded popover:**
  - **Agents:** the lead and its sub-agents as a two-level tree, with the viewed conversation highlighted.
    - Each row shows the name, profile badge, state, model and context usage.
    - Running and waiting rows come first, then the rest by last activity.
    - Selecting a row navigates the main view to that agent.
    - In a sub-agent view, the popover header has a **Back to lead** button.
    - **Folding finished sub-agents:** a sub-agent that has been idle, completed or stopped with no activity for **10 minutes** folds under an `N earlier` row at the bottom of the tree.
      - "Activity" means any assignment, execution, user configuration change or the user opening it.
      - A lead often reads a result and comes back to the same sub-agent, so a fresh idle state is kept visible.
      - A folded sub-agent that gets a new assignment unfolds.
      - Failed sub-agents never fold automatically.
      - The fold is computed from timestamps, so it is the same after a reload.
  - **Background commands of the viewed conversation:** command, run time, **Output** and **Stop**. Sub-agents' commands are listed inside each sub-agent, so the list matches the conversation the user is looking at.
- **Same tree everywhere:** the pill and popover are identical in lead and sub-agent views, so the user can move from any sub-agent to any other.

### Lead transcript (frame A)

- **`subagent_prompt` card:** one row per assignment, with the name, profile badge, live state and a short activity line, plus **Open**. It replaces the Explore task list and the teammate card. Shared `context` is collapsed.
- **Completion notices:** compact rows showing the name, profile and outcome, with the response expandable. A truncated response links to its report file.
- **`subagent_status` and `subagent_stop`:** compact lifecycle cards.
- **Legacy transcripts:** old `explore`, `subagent_new` and `subagent_list` calls use the generic tool card.

### Activity row and the waiting state (frame C)

The activity row at the bottom of the transcript has three states:

| Conversation state                                          | Row                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A turn is running                                           | Today's labels and spinner ("Thinking…", "Reading results…", …)                                                                                |
| Turn ended, sub-agents or background commands still pending | **Waiting:** ⏳ `Waiting for` followed by one chip per pending item (sub-agent name or command) and the time since the turn ended. No spinner. |
| Nothing pending                                             | Today's brief completion cue, then hidden                                                                                                      |

- **Chips:** they open the Agents popover. A sub-agent chip can also navigate straight to that sub-agent.
- **When an item finishes:** its chip disappears. When the notice wakes the agent, the row returns to the running state.
- **Composer while waiting:** the lead stays promptable. A new prompt simply starts a turn.
- **Conversation list:** waiting conversations show an hourglass instead of the running indicator, so "not finished, but not busy" is visible from the sidebar too.

The waiting state comes from the conversation snapshot (pending children and async bash). `deriveRunActivity` needs that input, which it does not have today.

### Sub-agent view (frame D)

A sub-agent opens **in the same center tab**, replacing the lead's transcript. The tab keeps the lead's title, because a sub-agent is part of the lead's work, not a separate conversation to manage. Going back returns to the lead at its previous scroll position.

- **Where am I:** no breadcrumb. The Agents pill shows the viewed sub-agent and has the back action. The composer overlay has **Back to lead** too.
- **Transcript:**
  - The full renderer, live.
  - Each assignment is shown as a message from the lead, labeled with the sender.
  - Shared context is collapsed.
- **Composer:**
  - **Editor:** covered by an overlay, "Sub-agents take prompts only from their lead.", with **Back to lead**.
  - **Toolbar controls stay usable:**
    - permission (Read-only or Autonomous only)
    - context popover (compaction, instructions)
    - tools and skills (human-in-the-loop and delegation tools locked)
    - model and thinking level
  - **Hidden:** the mode toggle, since sub-agents have no plan mode, and the todo chip if the sub-agent has no todos.
  - **Stop:** available while the sub-agent runs.
- **Server enforcement:** the input queue rejects user-sourced input for children, so the overlay cannot be bypassed by another client.

### Context popover (frame E)

The composer's context chip (`◔ 34%`) becomes the conversation's info and settings popover. It absorbs the Context panel:

1. **Context:** the usage meter, token figures (input, cached, output) and **Compact now**. This part exists today.
2. **This conversation:**
   - compaction (the inherited value with its source, or the override, with **Override** or **Reset**)
   - instructions (**Edit** opens a dialog)
   - for sub-agents, the profile it was created from
3. **Session:** project, directory, conversation ID, daemon and data path (the conversation's own directory), each with copy or open actions, plus **Copy all**.

Because the same popover appears in lead and sub-agent views, compaction and instructions are configurable per conversation everywhere.

## Settings → Sub-agents

A new settings page, registered after Tools, available in user and project scope.

- **Master switch:** the `subagents` capability, at the selected scope.
- **Profile list:** one row per profile.
  - The row shows the label, name, description, model and rule set summary, source (Built-in, User, Project) and an enabled switch.
  - Shadowed, invalid and untrusted profiles show their state. Untrusted project profiles have **Trust**.
  - Row actions: **Edit**, **Duplicate**, and **Delete** for user or project files or **Reset** for edited built-ins.
- **Add profile:** starts from a blank Developer-like draft.

Profile editor dialog:

| Section        | Controls                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| General        | Label, name (derived on create, fixed afterwards), description with a character count                                                          |
| Model          | `ModelSelectionField` with "Lead's model"; thinking level with "Lead's"                                                                        |
| Permissions    | Read-only or Autonomous                                                                                                                        |
| Context        | Compaction: Inherit, or a profile with custom thresholds                                                                                       |
| Tools & skills | The same components as the conversation tool settings, starting from "same as lead"; `ask_user`, `plan_mode_*` and `subagent_*` are locked off |
| Instructions   | Text area for the Markdown body                                                                                                                |

The Tools page's Explore and Async Subagents groups are replaced by one row linking here.

## Removed

- **The Context dock panel:**
  - `context` registry entry, `ContextWorkbenchPanel`, `ConversationContextPanel`
  - `ContextAgentsSection`, `ContextAgentDetailPopover`, `context-agent-rows`
  - the panel's tour step and reveal calls
  - Persisted layouts drop the unknown panel automatically when they are loaded.
- **`MobileContextHost`:** phones use the same pill and popovers, presented as sheets.
- **Transcript previews:** `SubagentTranscriptDialog` and `watchSubagentTranscript`.
- **Explore and teammate views:** `ExploreToolView`, `explore-progress` and the teammate/Explore role split.
- **Context panel sections that move:**
  - `ContextUsageStrip`, `ContextConversationUsage` and `ContextSessionSection` are reused inside the context popover, if they fit there.
  - Otherwise they are deleted.

## Decided

| Question            | Decision                                                                             |
| ------------------- | ------------------------------------------------------------------------------------ |
| Pill position       | Top right. The bottom stays free for `ask_user`, plan review and approvals.          |
| Breadcrumb          | None. Back is in the pill (collapsed and expanded) and in the composer overlay.      |
| Keyboard shortcuts  | Not now.                                                                             |
| Finished sub-agents | Fold after 10 minutes without activity; failed ones stay visible.                    |
| Mobile              | The same pill and popovers as sheets for now; a dedicated mobile design comes later. |
| Pill and first line | The transcript reserves top padding while the pill is shown, so nothing is covered.  |
| Fold delay          | A 10-minute constant, not a setting.                                                 |
