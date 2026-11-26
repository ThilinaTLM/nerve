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

Three more are off by default. Turn them on in Settings if you want them: **Review changes**, **Clean up merged branch**, and **Continue** (after a failed or interrupted turn).

Labels show counts where useful, such as **Commit 3 changes**. Each prompt is a short request like one you'd type, such as "Create a PR from the changes." The agent checks the current state itself, so a prompt queued while the agent runs still acts on the latest changes. Settings lists every suggestion even when it isn't applicable right now. Expand one to see when it appears and a preview of its prompt.

## Click a suggestion while the agent is running

Suggestions stay available while the agent works. Clicking one queues its prompt, and it is sent when the agent finishes. Your composer text is kept. Right-click a suggestion to add its prompt to the composer instead.

## Add your own

1. In **Settings → Suggestions**, create a suggestion with a label and the prompt to send. Use your user settings for all projects, or project settings to share it with your team.
2. Optionally choose when it should appear, such as only when the repository has uncommitted changes.

You can also write suggestions as Markdown files. A project suggestion overrides a user suggestion of the same name, and a user suggestion overrides a built-in one. See the [format reference](/reference/prompt-suggestions/) for fields and file locations.

## Review suggestions you didn't write in Settings

A suggestion file, in your user settings or the project, is used only after you trust it. The review covers the whole file: the prompt it offers, where it shows, and whether a JavaScript check decides when. Trust applies to that exact file, so editing it outside Nerve asks again. A suggestion you create or edit in Settings stays trusted. Built-in suggestions need no approval.

:::danger
A project suggestion's JavaScript comes from the repository. Review it as code, and decline it if you don't recognize its origin.
:::

Open the suggestion under **Settings → Suggestions** to review, trust, decline, or revoke it. The same page decides the project's `.nerve/config/prompt-suggestions.json`, which turns suggestions on or off for the project.

## Next steps

- [Prompt suggestion format](/reference/prompt-suggestions/)
- [Skills and project resources](/guides/skills-and-resources/)
