---
title: Work with Git and pull requests
description: Inspect repositories, manage changes and branches, and review GitHub pull requests.
sidebar:
  order: 9
---

## Git panel

Nerve discovers repositories in the project and shows branch, working-tree changes, and recent commits. Available UI operations include branch creation and switching, stage/unstage, discard, fetch, pull, push, and sync. Destructive discard asks for confirmation.

These Workbench operations are server routes, not agent tools. An agent uses Git indirectly through finite Bash commands, subject to its mode and permission policy.

## GitHub pull requests

GitHub support requires:

1. a Git repository with a GitHub remote;
2. the `gh` CLI installed;
3. `gh auth login` completed for the relevant host.

The Pull Requests panel shows status and lists. A PR tab can display the conversation, commits, checks, and changed files; it can check out or merge when the repository state permits.

Checkout and merge can modify local or remote state. Read the confirmation, working-tree status, target/base branch, and check results before proceeding.

## Agent follow-ups

Contextual built-in suggestions can appear when Git state calls for committing changes, moving work off a base branch, or creating a PR. They insert agent instructions; they do not bypass Git review or tool approvals.

## Next steps

- [Prompt suggestions](/guides/prompt-suggestions/)
- [GitHub troubleshooting](/troubleshooting/providers/)
