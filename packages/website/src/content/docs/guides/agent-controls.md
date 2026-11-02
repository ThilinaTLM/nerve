---
title: Choose a profile, model, and permissions
description: Decide what role the agent plays, which model it uses, and how much it can do without asking.
sidebar:
  order: 4
---

Pick a profile, a model, and a permission level to set how the agent works. You can change all of them in the middle of a conversation.

## Choose a profile

A profile sets the agent's instructions and can also set its model, thinking level, permissions, tools, and skills. Nerve includes two for the main agent:

- **Coding** carries out the work.
- **Planning** researches, asks you questions, and presents a plan for you to review. It can't change your project.

You can add your own profiles, and set them for all projects or just one.

To switch, use the profile control in the composer, type `/plan` or `/profile <name>`, or press `Shift+Tab` to cycle. The agent can't switch its own profile.

Accepting a plan switches to your default profile for the implementation, and rejecting it keeps Planning. See [Approvals, questions, and plans](/guides/reviews/#review-a-plan).

A profile can **recommend** or **require** a setting. A conversation choice beats a recommendation, and a requirement locks the control until you leave that profile. If you change a profile later, a conversation keeps the version it started with until you choose **Apply updated profile**. Details are in [Agent profiles](/reference/agent-profiles/).

## Choose a permission level

| Level          | The agent can                                                        | Use it for                                     |
| -------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| **Read-only**  | Look around, and prompt or stop sub-agents. Nothing else.            | Investigating a codebase.                      |
| **Supervised** | Read freely. It asks before commands, file changes, and network use. | Most work, and your first runs.                |
| **Autonomous** | Act without asking, except where you've blocked something.           | Bounded tasks in a repository you can recover. |

Permissions are checked again right before an action runs, including after you approve it. If your permission configuration is invalid, the action waits as **configuration-blocked** with **Retry** and **Cancel**. Fix the cause, then choose Retry.

## Choose a model and thinking level

Pick any model you've connected, then one of the thinking levels it supports. Changing the model, thinking level, profile, or permission doesn't restart the conversation. During a run, a change applies from the next model request.

## Sub-agents have their own permissions

A sub-agent's profile sets its own permission level, and it doesn't inherit the main agent's. Developer works on its own without asking you, so enabling it gives more authority even when the main agent is read-only. To keep delegation inspection-only, turn off autonomous profiles. See [Sub-agents](/guides/agents-and-delegation/).

## Good to know

- Planning's restrictions are guardrails, not an operating-system sandbox.
- Cycle shortcuts for model, permission, and thinking are in [Keyboard shortcuts](/reference/shortcuts/).
- Set defaults for new conversations in **Settings**, or use the **Configure agent defaults** guide in Discover.

## Next steps

- [Approvals, questions, and plans](/guides/reviews/)
- [Sub-agents](/guides/agents-and-delegation/)
- [Security model](/operations/security/)
- [Tool reference](/reference/tools/)
