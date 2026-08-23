---
title: Control the agent
description: Choose coding or planning mode, permissions, model, and thinking level.
sidebar:
  order: 4
---

## Coding and planning

**Coding mode** exposes the normal enabled tool set under the active permission policy.

**Planning mode** changes instructions, tool availability, and enforcement. Research remains available; edit and write are constrained to Nerve's plan directory; long-running task mutations and mutating Jira/Confluence operations are unavailable; shell commands pass a planning guard. A plan must be presented for review before implementation.

Planning restrictions reduce accidental mutation but are not an operating-system sandbox.

## Permission levels

- **Read-only:** permits local read tools. It blocks edit/write, Bash, Python, ordinary network calls, Jira/Confluence network reads, and Explore child spawning.
- **Supervised:** asks for approval on non-read risks. Selected reads can autoapprove, and risk-bound tool or command-prefix grants can skip repeated prompts without overriding hard constraints.
- **Autonomous:** executes allowed risks without normal approval pauses.

Policy is evaluated for every dispatch and recorded with the tool lifecycle.

## Model and thinking

Select an authenticated model and one of its declared thinking levels. Nerve knows seven possible levels from `off` through `max`, but the picker only presents supported choices and runtime resolution can clamp a stale request.

Changing model, thinking, mode, or permission on an active conversation does not recreate it. Changes made during a run apply to subsequent work—especially the next provider request—not the request already streaming.

## Choosing a baseline

Use read-only for investigation where no network or child agents are needed. Use supervised for unfamiliar work and most first runs. Reserve autonomous for bounded tasks in a trusted, recoverable workspace.

## Next steps

- [Approvals, questions, and plans](/guides/reviews/)
- [Security model](/operations/security/)
- [Tool reference](/reference/tools/)
