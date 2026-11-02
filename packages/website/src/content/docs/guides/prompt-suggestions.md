---
title: Use prompt suggestions
description: Turn reusable prompts into chips above the composer, and control which ones appear.
sidebar:
  order: 11
---

Prompt suggestions are one-click chips above the composer for prompts you use often, such as committing changes or opening a pull request.

## Turn suggestions on or off

1. Open **Settings → Suggestions**.
2. Switch individual suggestions on or off.

Nerve includes Git suggestions that appear only when they apply:

- **Commit changes** and **Commit on a new branch**
- **Create a PR** and **Update PR #N**
- **Fix failing checks** when the open PR's checks fail
- **Push commits** and **Pull upstream**

Three more are off by default. Turn them on in Settings if you want them: **Review my changes**, **Clean up merged branch**, and **Continue** (after a failed or interrupted turn).

Labels show counts where useful, such as **Commit 3 changes**. Each prompt reads like a request you'd type, and ends with a short **Last known state** line (branch, relevant counts, PR). It says "last known" because a queued prompt may run after the state has changed. Settings lists every suggestion even when it isn't applicable right now. Expand one to see when it appears and a preview of its prompt.

## Click a suggestion while the agent is running

Suggestions stay available while the agent works. Clicking one queues its prompt, and it is sent when the agent finishes. Your composer text is kept. Right-click a suggestion to add its prompt to the composer instead.

## Add your own

1. In **Settings → Suggestions**, create a suggestion with a label and the prompt to send. Use your user settings for all projects, or project settings to share it with your team.
2. Optionally choose when it should appear, such as only when the repository has uncommitted changes.

You can also write suggestions as Markdown files. A project suggestion overrides a user suggestion of the same name, and a user suggestion overrides a built-in one. See the [format reference](/reference/prompt-suggestions/) for fields and file locations.

## Approve JavaScript conditions

A suggestion can use a small JavaScript check to decide when it appears. Nerve doesn't run it until you approve it, and approval applies only to that exact code, so editing it asks again.

:::danger
A project suggestion's JavaScript comes from the repository. Review it as code, and deny it if you don't recognize its origin.
:::

You can deny or reset approval under **Settings → Suggestions** or in the project's **Trust** page.

## Next steps

- [Prompt suggestion format](/reference/prompt-suggestions/)
- [Skills and project resources](/guides/skills-and-resources/)
