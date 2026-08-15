---
title: Prompt suggestion format
description: Markdown frontmatter, conditions, precedence, and JavaScript trust.
sidebar:
  order: 5
---

User files live in `$NERVE_HOME/suggestions/*.md`; project files live in `<project>/.nerve/suggestions/*.md`. Internal enablement/trust state is created lazily on first use, so a fresh Nerve home does not contain an empty prompt-suggestion state directory.

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

- `name`: optional filename-derived lowercase letters/digits/single hyphens.
- `label`: optional chip label; defaults from name.
- `description`: optional Settings description.
- `order`: lower appears first.
- `enabled`: file default; Settings preference overrides without editing.
- `when`: declarative `gitDirty`, `hasRepos`, `githubAuthenticated`, `modes`, and `permissionLevels` conditions.
- `enable-js` or `enable.js`: optional synchronous JavaScript predicate.

The Markdown body is the prompt inserted or sent by the chip.

## Precedence

Project overrides user; user overrides built-in. First definition by name remains authoritative even when disabled, so a lower definition does not reappear. Settings identifies shadowed entries.

## JavaScript

Define `function enable(context) { return true; }`. Context is JSON-safe project, Git, conversation, and agent state. Nerve requires explicit approval before execution and binds trust to the predicate content hash. Editing it requires approval again.

:::danger
Treat suggestion JavaScript as project code, not passive Markdown.
:::
