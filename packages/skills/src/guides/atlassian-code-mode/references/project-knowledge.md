# Saving project knowledge as a skill

After you have explored a Jira project or Confluence space (issue types, workflows, required fields, conventions), later conversations would otherwise repeat the exploration. Offer to save what you learned as a skill.

**First step, before writing anything: read the built-in `skill-creator` skill.** Every skill you save must follow it.

## When and how to offer

1. Only after a discovery pass that produced durable conventions, and only once per project per conversation.
2. Ask the user, in one message: whether to save it, and where. Recommend the project-level `./.nerve/skills/<name>/SKILL.md` (shared with the repository); the alternative is a user skill under `${NERVE_HOME:-$HOME/.nerve}/agent/skills/<name>/`. Write nothing until the user agrees.
3. Create it following `skill-creator` (read first, see above): the directory name equals the frontmatter `name` (lowercase letters, digits, single hyphens, e.g. `jira-app-conventions`), a task-focused `description` saying when to use it ("Use when creating or updating APP Jira tickets or Confluence pages"), and a short `SKILL.md`. Put longer lists in files beside it and link them with relative paths. Do not overwrite an existing skill without confirmation.

## What to record

Keep it short and factual, only what you verified in the data:

- Jira: project keys; issue types and what each is for; workflow status names per issue type and the transitions that need a field; required and commonly used custom fields (name and accepted values); naming and labelling conventions; components; sprint cadence and board; versioning and release naming; epic usage.
- Confluence: spaces and the parent pages for each kind of page; page templates and title patterns; labels in use.
- How to find things: the JQL/CQL that worked for common questions.

Do not record secrets, personal data, or volatile data (current assignees, sprint contents).

## Updating

When a later conversation finds the saved skill out of date (a status was renamed, a field is gone), tell the user what changed and, with their agreement, edit the skill in place instead of creating another one.
