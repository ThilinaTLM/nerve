---
name: skill-creator
description: Create or improve a project or user skill that follows Nerve's discovery, naming, and authoring rules.
---

# Create a Nerve skill

Use this workflow when the user asks to create or improve a reusable skill.

## Establish the destination

Determine the requested scope before writing. Ask one focused question only when the request does not establish it.

- Nerve-specific project skill: `.nerve/skills/<name>/SKILL.md`
- Portable project skill, only when portability is requested: `.agents/skills/<name>/SKILL.md`
- User skill: `${NERVE_HOME:-$HOME/.nerve}/agent/skills/<name>/SKILL.md`

For a user skill, honor the actual `NERVE_HOME` environment variable when set. Inspect applicable repository guidance and nearby skills before authoring.

## Validate the identity

The skill directory and frontmatter `name` must match. The name must:

- contain only lowercase letters, digits, and single hyphens;
- not start or end with a hyphen;
- not contain consecutive hyphens;
- contain at most 64 characters.

The frontmatter must include a nonempty, task-focused `description` of at most 1024 characters. Describe when the model should use the skill rather than merely restating its name.

## Author the instructions

Keep `SKILL.md` concise and procedural. Include only guidance that improves execution of the target task. Prefer clear steps, decision points, safety constraints, and verification over background explanation.

Put substantial examples, templates, or reference material in files beside `SKILL.md` and link them with relative paths. References are resolved from the skill directory.

Set `disable-model-invocation: true` only when the skill must remain available for explicit application use but should not be advertised to the model.

Do not overwrite an existing skill unless the user explicitly confirms replacement. When improving an existing skill, preserve useful behavior and explain material changes.

## Verify the result

Read the completed files back and verify the path, matching name, frontmatter, description, links, and instructions. Report the created location and any supporting files. Remind the user that skill discovery and toggle changes apply to subsequent agent runs.
