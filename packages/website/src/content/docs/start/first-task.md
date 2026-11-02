---
title: Your first task
description: Make a small change with the agent while you review each step.
sidebar:
  order: 5
---

This walkthrough has you make a small change, approve what the agent does, and check the result in Git. Use a clean or disposable repository.

## 1. Check where you're starting

Open **Git Changes** and confirm the working tree is clean. Commit or stash anything unrelated. Then ask the agent to read the relevant code and tests before changing anything.

## 2. Plan if the change is unclear

Switch to the **Planning** profile (type `/plan`, or press `Shift+Tab`) and describe the outcome you want. The agent researches and presents a plan in the transcript. When you accept it, you can implement in the same conversation, compact the context first, or start a new conversation for the implementation.

Planning is a guardrail, not a sandbox. Use Supervised permission when you implement in an unfamiliar repository.

## 3. Approve actions as they come up

With the **Coding** profile, the agent asks before it edits a file, runs a command, or reaches the network. Each approval card shows what it wants to do. The composer stays disabled until you approve, deny, or answer. Read the card before approving, then check the file diffs and command output in the transcript.

## 4. Redirect or stop

Send another prompt while the agent is working to steer it. The message is queued, and you can discard it or edit it before it's sent. Press the stop button if the work is heading the wrong way.

## 5. Check the result

Ask the agent to run the project's focused checks. Then review the changes yourself in **Git Changes**. You can stage and unstage files, switch branches, and fetch, pull, or push from there. To commit, ask the agent. See [Git changes](/guides/git/).

## Good to know

- Autonomous permission removes the normal approval pauses. Use it only for bounded tasks in a repository you can recover.
- Pull request views need a GitHub remote and the `gh` command-line tool signed in with `gh auth login`.

## Next steps

- [Choose a profile, model, and permissions](/guides/agent-controls/)
- [Approvals, questions, and plans](/guides/reviews/)
- [Git changes](/guides/git/)
- [Pull requests](/guides/pull-requests/)
