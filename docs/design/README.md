# Transcript activity island study

Open `transcript-activity-island.html` directly in a browser. It is self-contained, works offline, and uses mock data. No application code or state is connected.

## Selected direction: segmented dock (option A)

A compact rectangular island, alongside suggestions just above the composer:

`[←] [◌ Agents 2/3] [◌ Commands 1/3] [↓]`

Options B and C have been removed. Back and Latest are icon-only, with accessible labels and hover titles. While work runs, counts show **running / total**. After completion they show retained totals, without a spinner: `[Agents 3] [Commands 3]`.

Each segment exists whenever it has active **or retained** items. Clicking Agents or Commands expands the same island upward into a joined surface, keeping its bottom-right anchor and composer gap fixed. The dock becomes the category switcher below the list. Back returns to the parent conversation; Latest scrolls the current transcript. The dock is not one giant click target: navigation and inspecting work are different intentions.

## Original expanded-list study

These two-line rows describe the initial HTML mockup; production now uses the single-line rows described below.

- Around 360px wide, constrained to the conversation pane. Width and upward reveal animate over 220ms; there is no detached popup or gap between list and dock.
- A compact header shows the category and running/total counts, with an icon-only collapse button.
- **Running** rows come first; **Recent** rows follow, newest completions first. Running rows have spinners; completed rows have checks. Accessible status text remains available when visible text is compact.
- Agent top line: name, profile chip, and right-aligned elapsed/total duration. The second line is reserved for the prompt, with no time column taking its width.
- Command top line: the command itself, in monospace, with no invented label. The second line shows elapsed/total duration and, for completed commands, relative completion time. Long commands truncate with a hover title; the log tab shows the full command.
- Both row types keep a single 24px icon action at the right.
- Agent action: arrow, “Open [name] transcript.” Completed agents are still openable; completion does not discard them.
- Command action: open-in-tab icon, “Open [name] logs in a new tab.” Recent completed commands remain openable too. No output preview or inline terminal in the island.
- Lists have a bounded scroll area. Escape and the collapse icon fold the island back into its dock; they do not remove history.

The wireframe includes three agents and three commands to demonstrate running and completed rows. “Simulate work finishing” moves running rows into Recent and leaves the island accessible, including when reading the latest message. “Empty conversation” models a genuinely empty conversation, not ordinary completion.

A command's icon opens a sample workspace logs tab with the selected command's output. Returning preserves conversation scroll position. This prototype reuses one sample log tab; production should key run tabs by command/run identity so reopening selects an existing tab while different commands can have separate tabs.

## Retention and eventual implementation

- Keep all conversation subagents accessible after completion. If there are many, scroll the list or page it; do not remove completed agents just to shrink the island.
- Show all active commands plus a bounded recent completed-command history (suggested starting point: five most recent). Keep older commands accessible through existing task/run history. The prototype shows three, not a persistence policy.
- Completion changes status and ordering, not availability. Never automatically switch to an empty dock or remove the category just because its running count reaches zero.
- Hide a category only when it has neither active nor retained items. Hide the whole island only when both categories are genuinely empty and neither Back nor Latest applies.
- Latest follows the existing transcript scroll controller. Expanding the island must not scroll the transcript. Back should restore the parent's scroll position.
- Respect reduced motion. Do not steal focus for background updates; preserve focus through status/order changes. Escape restores the trigger. Production should use official ui-kit Button/Popover primitives and Lucide icons, not copy this prototype's DOM/CSS.
- Reserve space beside suggestions, including the small gap above composer metadata. Expanding upward must not cover the composer. Long lists and menus must remain bounded by the conversation pane.
- Use existing conversation work projections and retained task/run data, not new polling or a new source of lifecycle truth. Workspace tab commands should open async bash output, following the launch-runs pattern. No schema change is proposed.

## Still worth reviewing

1. **Work scope inside a subagent:** the study keeps parent-conversation work visible while browsing a child. Confirm navigation ownership and label scope if necessary so siblings are not mistaken for the child's own work.
2. **Attention states:** failures and approval/question waits need persistent warning/destructive cues and explicit actions, not a success check or an indefinitely spinning count. They are not mocked in this study.
3. **Recent-command limit and older-history entry point:** agree the number and reuse the existing task/run history navigation during implementation.

## Implemented single-line lists

The HTML file remains a standalone design study. The implemented island lives in `src/lib/features/conversations/agents/ConversationActivityIsland.svelte` in the workbench app; async bash logs use a dedicated workspace tab and a bounded core log-read operation.

- Agent rows show only status, a compact regular-weight name, and profile—no prompt or age.
- Command rows show only status and the first command line—no duration or relative completion time. The full command remains available in the hover title and log tab.
- The whole row is a keyboard-accessible button: agents open their transcript, commands open their log tab. No trailing action icons or nested buttons.
- Circular status icons match the rest of the application. The suggestions and activity dock align with the composer toolbar’s horizontal inset; list rows retain the shared Button control sizing.
- Row activation collapses the island; Escape and keyboard-open focus behavior remain unchanged. Command durations remain available in the log tab.
