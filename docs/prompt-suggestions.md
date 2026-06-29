# Prompt suggestions

Nerve can load composer prompt suggestion chips from Markdown files in:

- User suggestions: `~/.nerve/suggestions/*.md` (or `$NERVE_HOME/suggestions/*.md`)
- Project suggestions: `<project>/.nerve/suggestions/*.md`

Project suggestions take precedence over user suggestions with the same `name`.

## Format

Each file is Markdown with optional YAML frontmatter. The Markdown body is the prompt inserted/sent by the chip.

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

- `name`: optional; defaults to the filename stem. Use lowercase letters, digits, and hyphens.
- `label`: optional chip label; defaults to a title-cased name.
- `description`: optional Settings/dialog description.
- `order`: optional number; lower values appear first.
- `enabled`: set to `false` to disable the suggestion.
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

The predicate gets a JSON-safe context with project, git, conversation, and agent state. It must return `true` to show the suggestion.

JavaScript predicates are not executed until approved. Nerve shows a warning dialog the first time a predicate is discovered. You can allow, deny, or reset trust later in **Settings → Agents → Prompt suggestions**. Trust is tied to the predicate content hash, so editing the JavaScript requires approval again.
