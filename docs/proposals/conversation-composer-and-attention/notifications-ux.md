# Notifications: user experience

How conversation activity reaches the user across every surface. The mechanics (summary fields, edges) are in [activity-and-attention.md](activity-and-attention.md). The wireframe is at `/dev/wireframes/conversation-attention`. It is a local, gitignored file under `packages/workbench-app/src/lib/app/design-lab/wireframes/`.

## Principles

1. **Interrupt only when the user is needed or the lead has truly finished.** That means input required, the lead finished, or the lead failed or was interrupted. Nothing else makes a sound.
2. **Sub-agents are the lead's business.** A sub-agent finishing or failing never notifies. A sub-agent that needs a human (approval, question, plan review) notifies, labelled with the sub-agent's name.
3. **Don't tell people what they're watching. Do reach them when they've stepped away.** Intrusive signals depend on presence, not on which tab happens to be open.
4. **Passive indicators always tell the truth.** Rows, tabs, project buttons, the bell list and the dock badge update regardless of presence, mute or settings.

## Signal ladder

From passive to intrusive. Each event uses the lowest rung that will reach the user.

| Rung | Surface                                   | Used for                                                                     |
| ---- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| 1    | Row / tab / project-button indicators     | Every state, always                                                          |
| 2    | Bell list (header) and dock/taskbar badge | Items that need you, unseen finished/failed results; badge = needs-you count |
| 3    | In-app toast with **Open**                | Attention event while you're active elsewhere in Nerve                       |
| 4    | Sound                                     | Attention event unless you're watching that conversation                     |
| 5    | System pop-up (desktop/browser)           | Attention event while you're away                                            |

## Presence rule

| Presence               | Definition                                                                                                                              | Delivery                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Watching it**        | Window focused, keyboard/pointer input in the last **1 min**, and the target conversation is the one in front (or its viewed sub-agent) | Indicators only                                               |
| **Elsewhere in Nerve** | Window focused, input in the last 1 min, different conversation/tab/project                                                             | Sound + toast                                                 |
| **Away**               | Window unfocused, minimized, hidden in the tray, or no input for ≥ 1 min                                                                | Sound + system pop-up (toast if system notifications are off) |

This covers the "transcript is open but I've left my desk" case: after a minute without input you count as away. It also stops a chime after every quick reply while you're typing in that conversation. Presence is client-local: input timestamps and `document.hasFocus()`. No server or schema involvement.

## Events and what they say

| Event (lead conversation unless noted) | Title                                                | Sound preference |
| -------------------------------------- | ---------------------------------------------------- | ---------------- |
| Tool approval (lead or sub-agent)      | "Approval needed" / "Researcher · approval needed"   | `approval`       |
| ask_user (lead or sub-agent)           | "Question for you" / "Researcher · question for you" | `question`       |
| Plan presented                         | "Plan ready for review"                              | `planReview`     |
| Lead finished, nothing pending         | "Agent finished"                                     | `completed`      |
| Lead failed                            | "Agent failed"                                       | `failed`         |
| Lead interrupted (unexpected)          | "Agent interrupted"                                  | `failed`         |

Body: `project · conversation title`. Clicking a toast or a browser notification opens the conversation (or the sub-agent with the request). The desktop bridge only focuses the window today.

**Never notifies:** starting to run; handing off to sub-agents or background commands; any sub-agent completion or failure; the user pressing Stop; a request being resolved; a status clear; a title edit; app start or reconnect (current state is shown, nothing replays as sound).

## Keeping it calm

- **Sound throttle:** at most one sound per 4 s per window. When events coincide, the most urgent tone plays (input > failure > finished).
- **One pop-up per conversation:** a newer system notification replaces the older one (`tag` = conversation ID).
- **Mute 1 h:** a button in the bell popover header. It silences sounds, toasts and pop-ups in this window; indicators, the bell list and the dock badge keep updating. The bell icon becomes `BellOff`, and the settings page shows "Muted until …, Unmute". Session-local, not persisted.
- **Multiple windows:** each may notify (accepted).

## Surfaces

### Conversation list (side panel)

The leading glyph uses the precedence in [activity-and-attention.md](activity-and-attention.md#end-state-row-activity). The second line explains states that matter:

| State                 | Glyph                                    | Second line                                                      |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| Needs you (lead)      | Bell, warning                            | "Approval needed" / "Question for you" / "Plan ready for review" |
| Needs you (sub-agent) | Bell, warning                            | "Researcher · approval needed"                                   |
| Failed                | Triangle, destructive                    | "Agent failed"                                                   |
| Interrupted           | Circle-stop, **destructive** (was muted) | "Interrupted"                                                    |
| Finished, not viewed  | **Solid green dot** (new)                | "Finished" (success)                                             |
| Running / background  | Pulsing blue dot / clock                 | —                                                                |
| Marked done           | Circle-check, muted                      | —                                                                |

The "N need you" header button also counts interrupted conversations.

### Tabs

The same glyph as the row, via `ConversationActivityIndicator`. The new `result-ready` state is a solid success dot, whether or not the tab is open.

### Project buttons (header)

- One count badge = waiting + failed/interrupted + running + background work, coloured by the most urgent (warning > destructive > info). Unchanged, except that interrupted now counts as failed.
- **New:** a small green dot (no number) when the project's only signal is an unseen finished result.
- **Removed:** the running background-launch counter on the buttons. Launch counts stay in the project popover rows (`ProjectActivityStatus`).

### Bell (header, right)

- Groups: **Needs attention** (input required, failed, interrupted), **Running** (generic activities, unchanged), **Finished** (unseen conversation results plus existing finished activities).
- Conversation items use the event titles above. Finished items clear when the conversation is opened, or with "Clear finished".
- Trigger: the number badge counts needs-you only (unchanged); the existing red dot covers unseen conversation failures too. No badge for finished results.
- Header actions: **Mute 1 h** (new) and **Clear finished** (existing).

### Dock / taskbar badge (desktop)

Shows the needs-you count on the app icon. It stays visible while Nerve is hidden in the tray, and clears at zero. No setting; it's a passive count like the bell badge. Implemented with a new desktop-shell IPC call that wraps Electron's `app.setBadgeCount`; the Windows overlay icon is best effort.

### Settings → Notifications

There are no new settings. The page uses the same fields (`systemEnabled`, `soundsEnabled`, five event tones). Copy changes:

- **System notifications:** "Show a desktop or browser notification when you're away from Nerve. While you're using Nerve, a toast appears in the app instead."
- **Notification sounds:** "Play a sound for the events below, unless you're already looking at that conversation."
- **Test** row (new button): "Send test notification" uses the real delivery path, and asks for browser permission when needed.
- Event rows are renamed: "Question for you", "Plan ready for review", "Approval needed", "Agent finished" ("…including its sub-agents and background commands"), and "Agent failed or interrupted".
- Footnote: "Sub-agents only notify you when they need your input. Their results and errors go to the lead agent."
- While muted: an inline banner "Notifications are muted in this window until 15:42", with an **Unmute** button.

## Change summary

| Area                   | Change                                                         | Schema impact             |
| ---------------------- | -------------------------------------------------------------- | ------------------------- |
| Conversation indicator | Add `result-ready`; interrupted becomes destructive tone       | None (client type)        |
| Row second line        | Specific input text, sub-agent name, "Finished", "Interrupted" | None                      |
| Project buttons        | Green unseen-result dot; launch counter removed                | None                      |
| Bell                   | Finished/failed/interrupted conversation items; Mute 1 h       | None                      |
| Toast / sound / pop-up | Presence rule, throttle, mute                                  | None                      |
| Dock / taskbar badge   | New                                                            | New desktop IPC call only |
| Settings page          | Copy changes, test button, mute banner                         | None                      |
