---
title: Complete a safe first task
description: Use planning, approvals, Git review, and validation on a small change.
sidebar:
  order: 5
---

Use a clean or disposable Git workspace for your first modifying task. Supervised permission makes the review points visible without assuming that every read needs confirmation.

## 1. Establish the current state

Open the Git panel and confirm the working tree. Commit or stash unrelated work. Ask the agent to inspect the relevant code and tests before changing anything.

## 2. Plan when the change is uncertain

Switch the composer to **Planning** mode and describe the desired outcome. Planning mode allows research and constrains plan writes to Nerve's plan directory. When the agent presents a plan, review it in the transcript.

You can accept implementation in the same conversation, compact context before implementing, or optionally start implementation in a new conversation and select its model.

Planning shell restrictions are guardrails, not a security sandbox. Keep supervised permission for unfamiliar repositories.

## 3. Review actions as they happen

In Coding mode, the agent can request an edit, command, Python run, network call, or other action. An approval card describes the request and remains the active interaction; the main composer is disabled until you approve, deny, or otherwise resolve the gate.

Use the transcript to inspect:

- exact tool arguments;
- file edit diffs and bounded output;
- command output and exit state;
- questions where the agent needs a decision;
- failures, retries, and recovery actions.

## 4. Redirect or stop

Send another normal prompt while a run is active to queue a steering message. It appears in the transcript and can be discarded or **Cancel & Edit**-ed back into the composer. Inline command prompts cannot be queued.

Stop the run if it heads in the wrong direction. Nerve targets the active run and guards against duplicate stop actions and late events.

## 5. Validate and inspect Git

Ask the agent to run the project's focused checks. Review the final Git changes yourself. The Git panel can stage/unstage, create or switch branches, fetch, pull, push, and sync; destructive discard requires confirmation.

GitHub pull request views require a GitHub remote plus the `gh` CLI authenticated with `gh auth login`.

:::caution
Autonomous permission removes normal approval pauses for allowed actions. Use it only when you trust the model, project instructions, enabled integrations, and the scope of the task.
:::

## Next steps

- [Agent controls and permissions](/guides/agent-controls/)
- [Approvals, questions, and plans](/guides/reviews/)
- [Git and pull requests](/guides/git-and-pull-requests/)
