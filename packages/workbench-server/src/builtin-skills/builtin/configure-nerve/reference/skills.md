# Skills

A skill is a folder with a `SKILL.md`: a name and description in frontmatter, then instructions. The agent sees only the name and description of each enabled skill and reads the file when the task matches, so a skill costs little until it is used.

## Procedure

1. Settle the trigger: what task should make the agent reach for the skill, and what it should do differently from today.
2. Choose the scope: `<home>/agent/skills/<name>/` for a personal skill, `<project>/.nerve/skills/<name>/` for a team skill. The user approves either first.
3. `configuration.list({ kind: "skill" })`: if the name exists, read that skill and confirm before replacing it.
4. Write `SKILL.md` and any linked files. Read the description as the agent would: does it alone tell when to load the skill?
5. `configuration.check(scope)`; fix what it reports. Hand over with the approval the skill needs (Settings → Skills).

## Locations

Discovery is first-name-wins in this order:

1. `<project>/.nerve/skills/` — Nerve-specific project skills. Default for new project skills.
2. `.agents/skills/` in the project and its ancestors — portable project skills other agent tools also read. Use only when the user wants portability.
3. `<home>/agent/skills/` — the user's Nerve skills.
4. `~/.agents/skills/` — the user's portable skills.
5. Built-in Nerve skills.
6. Agent Browser guidance.

Within a root, Nerve finds `SKILL.md` files recursively and also accepts plain `.md` files directly in the root. It honors `.gitignore`, `.ignore` and `.fdignore`.

## Frontmatter

```markdown
---
name: release-notes
description: Use when writing or updating release notes for this repository.
---
```

- `name`: equals the folder name. Lowercase letters, digits and single hyphens; no leading or trailing hyphen; at most 64 characters.
- `description`: required, at most 1024 characters. Say when to use the skill ("Use when …"), not what it is called. The agent decides from this line alone whether to open the skill, so name the trigger precisely and say when not to use it if it overlaps with something else.
- `disable-model-invocation: true` (optional): the skill is not advertised to the agent; it is used only when applied explicitly.

A skill with an invalid frontmatter is skipped. `configuration.check(scope)` reports it, and a skill hidden by another of the same name (`skill-shadowed`).

## Approval of skills

A skill is not used until the user approves the exact content of its folder in Settings → Skills (the project's skills in the project column); any change to any file in the folder asks again. You cannot approve it. So:

- A skill you write, at either scope, does not work until the user approves it. Say so when you hand over, and name the page.
- Prefer user scope (`<home>/agent/skills/`) for a skill that is personal rather than part of the repository.
- After editing an approved skill, tell the user it waits for approval again.

`configuration.list({ kind: "skill", state: "needs_review" })` lists the skills that wait.

## Writing the body

Follow `reference/writing-for-agents.md`. For a skill in particular:

- Keep `SKILL.md` short and procedural: steps, decision points (what to ask the user, what to choose alone), safety constraints and how to verify the result. Leave out background the agent does not need to act.
- Put long material (templates, references, examples, scripts) in files beside `SKILL.md` and link them with relative paths; they resolve from the skill directory. List them in `SKILL.md` with when to read each, so the agent loads only what it needs.
- Before writing, read applicable `AGENTS.md` files and nearby skills so the new skill fits and does not duplicate them.

## Changing an existing skill

Never overwrite an existing skill without the user's confirmation. When improving one, keep what works and tell the user what changed materially.

## On and off

Skills written by the user are on by default. Built-in Nerve skills (other than this one) and Agent Browser guidance are off by default. Toggles live in `agent.json` (`reference/agent-profiles.md`) under `overrides.skills`:

```json
{
  "skills": {
    "file": { "release-notes": false },
    "nerve": { "engineering-docs": true }
  }
}
```

`file` covers skills from files, `nerve` built-in skills, `agentBrowser` Agent Browser guidance. `skills.defaults` (`{ "file": true, "nerve": false, "agentBrowser": false }`) sets the default per source. A profile can turn single skills on or off but cannot set `defaults`. Users usually toggle skills in Settings → Skills.
