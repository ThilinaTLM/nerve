---
title: Prompt suggestion format
description: Markdown frontmatter, conditions, precedence, and JavaScript trust.
sidebar:
  order: 5
---

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
- `when`: declarative `gitDirty`, `hasRepos`, `githubAuthenticated`, `modes`, and `permissionLevels` conditions.
- `enable-js`: optional synchronous JavaScript predicate. The nested form `enable: { js: ... }` is also accepted for compatible definitions.

The trimmed prompt body is required and is limited to 100,000 characters. Invalid files are omitted and reported as diagnostics rather than partially loaded.

The Markdown body is the prompt inserted or sent by the chip.

## Precedence

Project overrides user; user overrides built-in. First definition by name remains authoritative even when disabled, so a lower definition does not reappear. Settings identifies shadowed entries.

## JavaScript

Define `function enable(context) { return true; }`. Context is JSON-safe project, Git, conversation, and agent state. Nerve requires explicit approval before execution and binds trust to the predicate content hash. Editing it requires approval again.

:::danger
Treat suggestion JavaScript as project code, not passive Markdown.
:::
