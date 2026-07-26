# Prompt suggestions

Nerve shows reusable prompt chips above the composer. Manage all suggestions in **Settings → Suggestions → Prompt suggestions**.

## Built-in suggestions

Nerve includes three contextual Git suggestions:

- **Commit changes** when a repository has uncommitted changes.
- **Commit on a feature branch** when changes are on a base branch.
- **Create a PR** when a relevant GitHub repository is ready and GitHub CLI is authenticated.

The settings page always lists these built-ins, even when their runtime conditions are not currently met. Each can be disabled independently without changing project files.

## Custom suggestions

Create a suggestion from Settings with a name, composer label, optional description, prompt, and scope:

- User suggestions: `~/.nerve/suggestions/*.md` (or `$NERVE_HOME/suggestions/*.md`)
- Project suggestions: `<project>/.nerve/suggestions/*.md`

The dialog creates a working Markdown file that can be edited later. Custom suggestions and built-ins are all toggleable in Settings; toggling stores a user preference and does not edit the Markdown file.

When definitions have the same `name`, project suggestions take precedence over user suggestions, and user suggestions take precedence over built-ins. A disabled higher-precedence definition remains authoritative rather than revealing a lower-precedence suggestion. Settings lists shadowed definitions and identifies the overriding scope.

## Format

Each file is Markdown with optional YAML frontmatter. The Markdown body is the prompt inserted or sent by the chip.

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

Review the current git diff. Call out correctness risks, missing tests, and cleanup needed before committing.
```

Fields:

- `name`: optional; defaults to the filename stem. Use lowercase letters, digits, and single hyphens.
- `label`: optional chip label; defaults to a title-cased name.
- `description`: optional Settings/dialog description.
- `order`: optional number; lower values appear first.
- `enabled`: file-defined default state. A Settings toggle overrides this value without editing the file.
- `when`: optional declarative conditions:
  - `gitDirty: boolean`
  - `hasRepos: boolean`
  - `githubAuthenticated: boolean`
  - `modes: [planning|coding]`
  - `permissionLevels: [autonomous|supervised|read_only]`
- `enable-js` or `enable.js`: optional JavaScript predicate.

## JavaScript predicates

`enable-js` must define a synchronous function:

```js
function enable(context) {
  return true;
}
```

The predicate gets a JSON-safe context with project, Git, conversation, and agent state. It must return `true` to show the suggestion.

JavaScript predicates are not executed until approved. Nerve shows a warning dialog the first time a predicate is discovered. You can allow, deny, or reset trust later in **Settings → Suggestions → Prompt suggestions**. Trust is tied to the predicate content hash, so editing the JavaScript requires approval again.
