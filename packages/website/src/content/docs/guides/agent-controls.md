---
title: Control the agent
description: Choose agent profiles, permissions, model, and thinking level.
sidebar:
  order: 4
---

## Agent profiles

Choose a lead/both profile in the composer or use `/profile <name>`. `/plan` selects Planning. Agents cannot switch their own profiles.

**Coding** uses normal enabled capabilities and sets permission to your settings default. **Planning** loads the planning skill, locks permission to the Planning rule set, and enables `plan_present`. Research stays read-only outside plan storage; planning restrictions are guardrails, not an operating-system sandbox.

The agent researches, resolves requirement-dependent decisions with `ask_user`, writes a complete plan in plan storage, and submits it with `plan_present`. **Accept & Implement** switches to `defaultAgentProfile` (project → user → built-in Coding). Rejection leaves the profile unchanged and the agent idle until your next prompt.

Profiles can Inherit, Set, or Lock model, thinking, permission, and compaction. Only Lock disables a picker. Every enabled rule set remains available when permission is unlocked. Set values apply on switching; instructions, capability deltas, and Locks resolve each turn. See [Agent profiles](/reference/agent-profiles/) for switching rules and editing.

## Permission levels

- **Read-only:** permits local inspection and interaction, plus enabled sub-agent prompting and stopping. It denies other capabilities unless an applicable override changes that decision. It is not a restriction on a child's profile-selected authority.
- **Supervised:** automatically allows safe local reads and audited read-only integrations, then asks for commands, writes, opaque execution, and network access unless a matching permission rule allows the request.
- **Autonomous:** executes allowed risks without normal approval pauses, while explicit block exceptions and hard guardrails still apply.

Policy is evaluated for every dispatch and recorded with the tool lifecycle.

## Model and thinking

Select an authenticated model and one of its declared thinking levels. Nerve knows seven possible levels from `off` through `max`, but the picker only presents supported choices and runtime resolution can clamp a stale request.

Changing model, thinking, profile, or permission on an active conversation does not recreate it. Changes made during a run apply to subsequent work—especially the next provider request—not the request already streaming.

## Delegation and authority

The built-in Read only rule set explicitly permits `subagent_prompt` and `subagent_stop` when delegation is enabled. A sub-agent's profile selects its own rule set, either read-only or autonomous; the lead's selection is not inherited as a ceiling. Autonomous sub-agents (such as Developer) work in the shared worktree without asking you, so enabling them grants more authority even if the lead is read-only. Disable autonomous profiles when you want delegation to remain inspection-only. See [Agents and delegation](/guides/agents-and-delegation/) before assigning overlapping implementation work.

## Choosing a baseline

Use read-only for local investigation, with delegation disabled or limited to read-only profiles. Use supervised for unfamiliar work and most first runs. Reserve autonomous—and autonomous sub-agents—for bounded tasks in a trusted, recoverable workspace.

## Next steps

- [Approvals, questions, and plans](/guides/reviews/)
- [Agents and delegation](/guides/agents-and-delegation/)
- [Security model](/operations/security/)
- [Tool reference](/reference/tools/)
