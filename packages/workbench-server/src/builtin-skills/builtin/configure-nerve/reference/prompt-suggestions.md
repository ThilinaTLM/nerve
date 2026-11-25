# Prompt suggestions

A prompt suggestion is a chip above the composer that inserts or sends a saved prompt. Use one for a request the user types often; when the request needs steps or files, write a skill instead.

## Procedure

1. Settle the prompt text, the chip label and when the chip should appear.
2. Choose the scope: `<project>/.nerve/suggestions/<name>.md` for the repository, `<home>/agent/suggestions/<name>.md` for every project.
3. `configuration.list({ kind: "prompt-suggestion" })`: a project file with the name of a user or built-in one replaces it.
4. Write the file. Prefer `when` conditions; add `enable-js` only when they cannot express the condition, because it needs the user's approval.
5. `configuration.check(scope)`. Hand over: the chip appears when its condition holds; a suggestion with `enable-js` first needs approval in Settings → Suggestions.

## File

```md
---
name: release-notes
label: Write release notes
description: Draft release notes from the commits since the last tag.
order: 20
when:
  hasRepos: true
---

Write release notes for the commits since the last tag. Group them by user-visible change and leave out refactors.
```

A project file also carries `schemaVersion: 2` in its frontmatter; a user file does not.

| Field         | Value                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| `name`        | Optional; defaults to the file name. Lowercase letters, digits, single hyphens; at most 64. |
| `label`       | Chip text, at most 80. Defaults from the name.                                              |
| `description` | Shown in Settings, at most 1024.                                                            |
| `order`       | Lower appears first; default `100`.                                                         |
| `enabled`     | `false` ships the suggestion switched off; the user can switch it on in Settings.           |
| `when`        | Conditions; all that are set must hold (below).                                             |
| `enable-js`   | A JavaScript predicate (below).                                                             |

The body is the prompt, required, at most 100,000 characters. An invalid file is left out and reported by `configuration.check`.

## Conditions (`when`)

`gitDirty` (a repository has uncommitted changes), `hasRepos`, `githubAuthenticated`, `gitAhead`, `gitBehind`, `onBaseBranch`, `hasPullRequest` (each `true` or `false`), and `permissionRuleSets` (a list of rule set ids; the conversation must use one).

## Predicate (`enable-js`)

```yaml
enable-js: |
  function enable(context) {
    return context.git.repos.some((repo) => repo.dirty && !repo.onBaseBranch);
  }
```

Define `function enable(context)` and return `true` to show the chip. It runs synchronously with no access to files, network or modules. `context` has `timestamp`, `platform`, `project` (`id`, `name`, `dir`), `git` (`repos[]` with `relativePath`, `currentBranch`, `dirty`, `changeCount`, `ahead`, `behind`, `hasUpstream`, `hasRemote`, `baseBranch`, `onBaseBranch`, `mergedToBase`, `pullRequest`; `github` with `available`, `authenticated`) and `conversation` (`id`, `title`, `status`, `permissionRuleSetId`, `reasoningLevel`; absent outside a conversation).

The predicate is code, so it runs only after the user approves it in Settings → Suggestions, and any edit of it asks again. `configuration.check` shows the suggestion as `needs_review` until then. You cannot approve it.
