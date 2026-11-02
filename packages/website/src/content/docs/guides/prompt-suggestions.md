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

Nerve includes three Git suggestions: **Commit changes**, **Commit on a feature branch**, and **Create a PR**. Each appears only when it applies, for example when the repository has uncommitted changes. Settings lists them even when they aren't applicable right now.

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
