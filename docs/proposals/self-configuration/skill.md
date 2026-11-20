# `configure-nerve` skill

Part of [self-configuration](README.md). Rules for this content: [agent-facing content](../../agent-facing.md). The skill lives in [`builtin-skills/builtin/configure-nerve/`](../../../packages/workbench-server/src/builtin-skills/builtin/configure-nerve/).

The skill changes after the code does ([work breakdown](README.md#work-breakdown), step 14), because several of its tables and procedures become calls.

## Current state

- A direct request such as "allow `pnpm test` under Supervise" needs four files and about 36 KB before the first write.
- Built-in tools, rule sets and profiles are hand-written tables kept honest by tests that parse the Markdown.
- Prompt suggestions and `AGENTS.md` are not covered.
- Nothing helps choose between mechanisms (`AGENTS.md`, skill, profile, rule, extension) for a goal.
- Statements disagree: the launch check, the default scope, what `status` does, and the sentence that extension tools are not matched by tool name (they are).
- The warning about invalid permission files appears about six times; trust rules live in four files.
- Eight generated schemas total 173 KB and the skill tells the agent to consult them for every field.

## Target structure

```
SKILL.md                    triage, mechanism chooser, the table below, the edit-check loop, user-only steps
guide/collaboration.md      brainstorming, read only when the mechanism is open
guide/extensions.md         build, check, reload, hand over
reference/<thing>.md        starts with "Procedure" (five lines), then format and rules
reference/permission-matchers.md   filter fields, target matchers, globs
reference/schemas/          generated; opened only for a diagnostic the agent cannot resolve
```

`guide/workflows.md` and `reference/overview.md` are removed; their content moves to `SKILL.md` (paths, the loop) and to the top of each reference (procedures). Trust and precedence get one home in `SKILL.md`.

Target: `SKILL.md` plus one file for a direct request.

## `SKILL.md` content

**Triage by uncertainty.** Act when one mechanism clearly fits and few details are missing. Brainstorm when the mechanism itself is open.

**Mechanism chooser.**

| The user says                                      | Candidates, cheapest first                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| "It keeps forgetting our conventions"              | `AGENTS.md`, a skill, profile instructions                                          |
| "It keeps asking before X"                         | An overlay rule                                                                     |
| "I keep typing the same request"                   | A prompt suggestion, a skill                                                        |
| "I want it to work with service X"                 | An allow rule for an existing CLI, a skill around the CLI, an integration extension |
| "I want a second opinion on changes"               | A sub-agent profile, a lead profile                                                 |
| "It should work differently for this kind of work" | A lead profile, a rule set                                                          |
| "I want to see or open X in Nerve"                 | A preview, page or panel extension                                                  |
| "Start my dev server"                              | A launch definition                                                                 |

One line per row says when each candidate wins.

**Things table** with a path per scope and the default scope per thing, replacing "project scope by default": rule sets are user-only, launches project-only, and a personal rule or skill belongs at user scope because it works without approval. Project scope is for what the team should share, and the hand-over then names the approval the user must give.

**The loop**, once: read the current state with `configuration.describe` and `list`; write; `configuration.check`; fix; `configuration.reload`; end by reporting what `list` shows as `needs_approval`. Before editing a file under the Nerve home, copy it next to itself and name the copy in the reply.

## What calls replace

| Today                                     | After                                   |
| ----------------------------------------- | --------------------------------------- |
| "What each tool exposes" table            | `configuration.tools()`                 |
| Built-in rule set and profile tables      | `configuration.list({ kind })`          |
| Step 1 of "Explaining a decision"         | `configuration.describe()`              |
| Walking the decision order by hand        | `configuration.explain({ tool, args })` |
| Hand-editing `definitions.json`           | `launches.*`                            |
| "Read `SKILL.md` back" as the skill check | `configuration.check`                   |
| Result shapes restated in prose           | `sdk.describe("configuration")`         |

## New references

- **Prompt suggestions**: file location per scope, frontmatter, the `enable-js` predicate and its approval.
- **`AGENTS.md`**: when project instructions beat a skill, and where the file goes.

## Generated content and tests

- `configure-nerve.test.ts` keeps only checks with no prose parsing (the skill loads, links resolve). The table checks go with the tables.
- `extension-sdk/test/skill.test.ts` keeps link checks; name checks move to the [public-surface snapshot](extension-contract.md#compatibility).
- Schemas: one per document, shared parts as `$defs`, minified. The project form's extra `version` property is a note in the reference, not a second file.

## From the extension try-out

Gaps recorded when extensions of every kind were built with the skill; not re-checked since:

- One table of icon names: the extension icon accepts a short list, pages and panels accept any lucide name.
- Say that a new or changed folder is picked up only after `extensions.reload`.
- A worked example of an account kind (`accounts`, `auth`, `origins`, `test`); the integration template has none.
- `backend.md` shows `parse` for the script form only; a method bound to a direct tool also receives the arguments object.
- `extensions.status` does not say which scope an id belongs to when a user and a project extension share it; the shared [resource shape](configuration-model.md#resource) carries the scope.

## Small defects to fix in passing

- Table rows broken by `|` inside code (`skills` in `agent-profiles.md`, `targets` in `permissions.md`).
- Examples show the project form (`"version": 3`); mark which lines to drop at user scope.
- "Keep the conversation light and encouraging" has no observable outcome; the rest of that bullet already says what to do.

## Validation

Run in a dev instance and read the traces, counting file reads before the first write and checking that the result does what was asked:

1. "Stop asking before `pnpm test`."
2. "I want a reviewer agent."
3. "Why was that prompted?"
4. "Add a suggestion for writing release notes."
5. "Upgrade my extensions" after raising a compatibility floor in the dev build.
6. Write an invalid permission file on purpose: `check` reports it, `reload` keeps the previous policy, and the agent can still edit.
