---
title: Use prompt suggestions
description: Manage reusable contextual prompt chips and their trust settings.
sidebar:
  order: 11
---

Nerve shows reusable prompt chips above the composer. Manage them in **Settings → Suggestions → Prompt suggestions**.

## Built-in suggestions

Three contextual Git suggestions are included:

- **Commit changes** when a repository has uncommitted changes.
- **Commit on a feature branch** when changes are on a base branch.
- **Create a PR** when a relevant GitHub repository is ready and GitHub CLI is authenticated.

Settings lists built-ins even when their runtime condition is false. Each can be disabled independently.

## User and project definitions

Create suggestions in Settings or edit Markdown files:

- User: `<NERVE_HOME>/agent/suggestions/*.md` (normally `~/.nerve/agent/suggestions/*.md`)
- Project: `<project>/.nerve/suggestions/*.md`

Project definitions override user definitions with the same name; user definitions override built-ins. A disabled higher-precedence definition remains authoritative instead of revealing the lower one. Settings identifies shadowed definitions.

A definition can set label, description, order, default enabled state, prompt body, and declarative conditions for Git state, mode, and permission. See the [format reference](/reference/prompt-suggestions/).

## JavaScript predicates

An `enable-js` predicate, or the compatible nested `enable: { js: ... }` form, can synchronously inspect JSON-safe project, Git, conversation, and agent context. Nerve does not run it until you approve the warning. Trust is tied to a hash of the predicate; editing code requires approval again.

:::danger
A project suggestion predicate is executable JavaScript from the project. Review it as code. Deny or reset trust in Settings if its origin or behavior is unclear.
:::

## Next steps

- [Prompt suggestion format](/reference/prompt-suggestions/)
- [Skills and resources](/guides/skills-and-resources/)
