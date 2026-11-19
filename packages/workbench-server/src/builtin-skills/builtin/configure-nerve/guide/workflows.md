# Workflows

Each workflow assumes the approach in `guide/collaboration.md`: brainstorm when the user brings a goal, act directly when they bring a precise request. Look up formats in the linked reference before writing.

## Survey the current setup

Use this when the user asks what is configured or what is possible, and before proposing changes.

1. Read what exists at both scopes (`reference/overview.md`, "Where each thing lives"): skills folders, extensions folders, `.nerve/launches/definitions.json`, profile folders, rule sets, `permissions.json` files, `agent.json` files.
2. Summarize in the user's terms: what the agent does by default, which teammates exist, what runs without asking, what saved commands exist. Skip empty categories unless the user asked about them.
3. Suggest one or two improvements that fit what you saw (for example a launch for the dev server named in `package.json`), and ask before making them.

## Create or improve a skill

Reference: `reference/skills.md`.

1. Settle the trigger: what task should make the agent reach for this skill, and what it should do differently from what it does today.
2. Choose the location (project `.nerve/skills/` by default).
3. Check that the name is free in every discovery location; if it exists, read it and confirm before replacing.
4. Write `SKILL.md` and any linked files. Read it back once as the agent would: does the description alone tell when to load it?
5. The skill is available from the next agent run. Tell the user they can see it in Settings → Skills.

## Add or change a launch definition

Reference: `reference/launches.md`.

1. Find the right command from the project (`package.json` scripts, `Makefile`, docs) instead of guessing; ask when there are several candidates.
2. Read the catalog file; create it if missing. Add or change the entry, keep ids unique, renumber sibling `order` values.
3. Validate by starting it with the `launch` tool and reading its logs, then stop it unless the user wants it running.

## Create or change an agent profile

Reference: `reference/agent-profiles.md`.

1. Settle the role (lead, sub-agent or both), the job, and what it may do. For sub-agents, agree on `whenToUse` with the user; it decides when the lead uses it.
2. Choose settings: permission rule set first (what may it do without asking), then model and thinking if the user has a preference, then tools and skills. Recommend by default; require only what the purpose depends on.
3. If it needs a permission behavior no existing rule set provides, create the rule set first (next workflow).
4. Write the file, reload (`reference/overview.md`, "Apply changes") and fix every diagnostic.
5. Tell the user how to use it: a lead profile from the composer's profile picker or `/profile <name>`; a sub-agent profile becomes available to the lead when delegation is on. For project profiles, first approve them in Settings → This project → Trust. For an edited profile already in use, **Apply updated profile**.

## Change what runs without asking

Reference: `reference/permissions.md`.

1. Identify the exact calls: which tool, which command, path, URL or operation. If the user is reacting to a prompt they saw, start from that call.
2. Identify the rule set they work with (see "Explaining a decision"). Overlay rules apply only under that rule set; ask whether the rule should also apply under others.
3. Pick the mechanism from "Choosing the mechanism" and the scope: project overlay for a team rule, user overlay for a personal one.
4. Write the narrowest rule that covers the calls. State in one sentence what will happen afterwards unless the user dictated the rule.
5. Reload and fix every diagnostic; an invalid permission file blocks tool calls. For a project overlay, tell the user to approve it in Settings → This project → Trust; until then it is ignored.

## Create a rule set

Reference: `reference/permissions.md`, "Rule set file".

1. Agree on the behavior per category: reads, edits, shell, web, integrations, delegation. Decide what is allowed, asked and refused.
2. Start from the closest built-in rule set's rules, then adjust. End with a catch-all rule.
3. Write `<home>/config/rule-sets/<id>.json`, reload with user scope and fix every diagnostic.
4. Tell the user how to select it: the permission picker in the composer, or set it as `permissionRuleSetId` in a profile.

## Explain a permission decision

Follow "Explaining a decision" in `reference/permissions.md`. Answer the question first; offer a change only if the user wants a different outcome.

## Build or change an extension

Follow `guide/extensions.md`.
