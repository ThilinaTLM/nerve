---
title: Prompt suggestion format
description: Built-in suggestions, Markdown frontmatter, conditions, precedence, and JavaScript trust.
sidebar:
  order: 5
---

To turn suggestions on or off, add your own, or approve scripts, see the [prompt suggestions guide](/guides/prompt-suggestions/).

## Built-in suggestions

Built-in prompts are plain text: a one-line request, numbered steps, and a closing `Last known state:` line with the branch and only the facts the task needs (uncommitted changes, unpushed or behind commits, PR number and failing checks). Zero counts are omitted. With several repositories the state becomes a list, one line per repository. The state is labelled "last known" because a queued prompt may run later. Labels include counts where useful.

| Name                       | Appears when                                                                                                                | Default |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| `commit-changes`           | A repository has uncommitted changes on a feature branch, or on its base branch with no remote.                             | On      |
| `commit-on-feature-branch` | A repository with a remote has uncommitted changes on its base branch.                                                      | On      |
| `create-pull-request`      | GitHub CLI is authenticated and a GitHub repository has an unmerged feature branch or uncommitted changes, with no open PR. | On      |
| `update-pull-request`      | The current branch has an open PR and there are uncommitted changes or unpushed commits.                                    | On      |
| `fix-failing-checks`       | The current branch's open PR has failing checks.                                                                            | On      |
| `push-commits`             | A clean repository has unpushed commits and no PR applies.                                                                  | On      |
| `pull-upstream`            | A repository is behind its upstream.                                                                                        | On      |
| `review-changes`           | A repository has uncommitted changes or an unmerged feature branch. Read-only review.                                       | Off     |
| `cleanup-merged-branch`    | A clean feature branch is merged into its base and has no open PR.                                                          | Off     |
| `continue-after-failure`   | The conversation failed or was interrupted.                                                                                 | Off     |

At most one of update PR, create PR, and push appears per repository.

Settings lists built-ins even when their condition is false, with a description, an "Appears when" summary, and a prompt preview. Each can be enabled or disabled independently.

## Files

User files live in `<NERVE_HOME>/agent/suggestions/*.md` (normally `~/.nerve/agent/suggestions/*.md`); project files live in `<project>/.nerve/suggestions/*.md`. Internal enablement/trust state is created lazily on first use, so a fresh Nerve home does not contain an empty prompt-suggestion state directory.

```md
---
name: review-diff
label: Review diff
description: Review the current diff before committing.
order: 20
when:
  gitDirty: true
enable-js: |
  function enable(context) {
    return context.git.repos.some((repo) => repo.dirty);
  }
---

Review the current git diff. Call out correctness risks and missing tests.
```

## Fields

- `name`: optional filename-derived lowercase letters, digits, and single hyphens; maximum 64 characters.
- `label`: optional chip label; defaults from name and is limited to 80 characters.
- `description`: optional Settings description, limited to 1,024 characters.
- `order`: lower appears first; defaults to `100`.
- `enabled`: file default, enabled unless explicitly `false`; Settings preference overrides without editing.
- `when`: declarative conditions; all that are set must hold.
  - `gitDirty`: any repository has uncommitted changes.
  - `hasRepos`: the project has Git repositories.
  - `githubAuthenticated`: GitHub CLI is available and signed in.
  - `gitAhead`: any repository has commits ahead of its upstream.
  - `gitBehind`: any repository is behind its upstream.
  - `onBaseBranch`: any repository is on its base branch.
  - `hasPullRequest`: the current branch of any repository has an open pull request.
  - `permissionRuleSets`: list of permission rule set IDs; the conversation must use one of them.
- `enable-js`: optional synchronous JavaScript predicate. The nested form `enable: { js: ... }` is also accepted for compatible definitions.

The trimmed prompt body is required and is limited to 100,000 characters. Invalid files are omitted and reported as diagnostics rather than partially loaded.

The Markdown body is the prompt inserted or sent by the chip.

## Precedence

Project overrides user; user overrides built-in. First definition by name remains authoritative even when disabled, so a lower definition does not reappear. Settings identifies shadowed entries.

## JavaScript

Define `function enable(context) { return true; }`. The read-only `context` contains `timestamp`, `platform`, `project` (`id`, `name`, `dir`), `git`, and `conversation` (`id`, `title`, `status`, `permissionRuleSetId`, `reasoningLevel`; absent outside a conversation). Agent state is not included.

`git.repos[]` entries include `relativePath`, `currentBranch`, `detached`, `dirty`, `changeCount`, `ahead`, `behind` (both `null` without an upstream), `hasUpstream`, `hasRemote`, `hasGithubRemote`, `baseBranch`, `onBaseBranch`, `mergedToBase`, and `pullRequest`. `pullRequest` is the open PR for the current branch as `{ number, url, isDraft, checks, checksRunning, reviewRequested }`, where `checks` is the outcome so far (`pending`, `passing`, `failing`, or `none`; one failure makes it `failing` even while others run) and `checksRunning` is `true` while any check is still running or queued. It is `null` when there is no open PR and `undefined` when unknown (not a GitHub repository, GitHub unavailable, or not yet synced). It comes from Nerve's PR cache, so it can lag slightly. `git.github` has `available` and `authenticated`.

Nerve requires explicit approval before execution and binds trust to the predicate content hash. Editing it requires approval again.

:::danger
Treat suggestion JavaScript as project code, not passive Markdown.
:::
