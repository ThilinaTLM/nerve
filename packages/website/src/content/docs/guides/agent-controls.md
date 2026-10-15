---
title: Control the agent
description: Choose coding or planning mode, permissions, model, and thinking level.
sidebar:
  order: 4
---

## Coding and planning

**Coding mode** exposes the normal enabled tool set under the active permission policy.

**Planning mode** changes instructions, tool availability, and enforcement. Research remains available; edit and write are constrained to Nerve's plan directory; launch and background-process mutations and mutating Jira/Confluence operations are unavailable; shell commands pass a planning guard. A plan must be presented for review before implementation.

Select coding or planning mode in the agent controls; agents cannot change their own mode. In planning mode, the agent uses `plan_mode_present` to submit its plan. **Accept & Implement** approves the plan and transitions to coding mode; rejecting the plan keeps planning mode unchanged and leaves the agent idle until you send a follow-up prompt. You can also change mode directly with the user controls.

Planning restrictions reduce accidental mutation but are not an operating-system sandbox.

## Permission levels

- **Read-only:** permits local inspection and interaction, plus enabled sub-agent prompting and stopping. It denies other capabilities unless an applicable override changes that decision. It is not a restriction on a child's profile-selected authority.
- **Supervised:** automatically allows safe local reads and audited read-only integrations, then asks for commands, writes, opaque execution, and network access unless a matching permission rule allows the request.
- **Autonomous:** executes allowed risks without normal approval pauses, while explicit block exceptions and hard guardrails still apply.

Policy is evaluated for every dispatch and recorded with the tool lifecycle.

## Model and thinking

Select an authenticated model and one of its declared thinking levels. Nerve knows seven possible levels from `off` through `max`, but the picker only presents supported choices and runtime resolution can clamp a stale request.

Changing model, thinking, mode, or permission on an active conversation does not recreate it. Changes made during a run apply to subsequent work—especially the next provider request—not the request already streaming.

## Delegation and authority

The built-in Read only rule set explicitly permits `subagent_prompt` and `subagent_stop` when delegation is enabled. A sub-agent's profile selects its own rule set, either read-only or autonomous; the lead's selection is not inherited as a ceiling. Autonomous sub-agents (such as Developer) work in the shared worktree without asking you, so enabling them grants more authority even if the lead is read-only. Disable autonomous profiles when you want delegation to remain inspection-only. See [Agents and delegation](/guides/agents-and-delegation/) before assigning overlapping implementation work.

## Choosing a baseline

Use read-only for local investigation, with delegation disabled or limited to read-only profiles. Use supervised for unfamiliar work and most first runs. Reserve autonomous—and autonomous sub-agents—for bounded tasks in a trusted, recoverable workspace.

## Next steps

- [Approvals, questions, and plans](/guides/reviews/)
- [Agents and delegation](/guides/agents-and-delegation/)
- [Security model](/operations/security/)
- [Tool reference](/reference/tools/)
