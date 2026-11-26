# User consent for all agent configuration

Status: proposal, not started. Delete this file when implemented (see [docs/README.md](../README.md#where-documentation-belongs)).

## Problem

Nerve can configure itself: with the built-in `configure-nerve` skill (on in the Forge profile) the agent writes skills, profiles, permission rules, prompt suggestions, extensions and MCP entries, then activates them with `configuration.reload`. Only project files and a few user resources wait for the user's approval ([trust](../architecture/trust.md)). User-level profiles, skills, rule sets, the user permission overlay and the user `agent.json` take effect as soon as they are written.

So configuration can change what agents do without the user knowing:

- Writing the file is the only gate. Under Autonomous (`allow-all`), and always for the built-in Developer sub-agent, a file write needs no approval. Sub-agents skip user overlays, so user guardrails do not apply to them ([permissions](../architecture/permissions.md)). `bash` and `python_exec` writes carry no path target, so path rules never match them.
- `configuration.reload` is a `read`-risk call, allowed without asking; a restart activates the file anyway.
- A new sub-agent profile is `enabled` by default and offered to leads in every project. A user profile can require `autonomous` or a rule set the agent wrote itself. That undoes "turn off autonomous sub-agents" without an approval.
- Triggers are ordinary: the skill tells the agent to build when one mechanism clearly fits, injected text in a repository, web page or ticket can ask for it, and a helpful agent may "fix" approval prompts by editing `~/.nerve/config/permissions.json`.

## Principle

**Nerve uses no configuration that changes what agents do until the user has seen its exact content.** What decides is who made the change, not where the file lives:

- A change made through Nerve's own UI (Settings pages, "Always allow" on an approval, the MCP form) is the user's decision and stays trusted. This already holds for project files and MCP entries.
- Any other change (the agent, a script, `git pull`, the user's own editor) makes the item **Needs review** until the user decides.

The three states and their meaning stay as they are: **Needs review**, **Trusted**, **Declined** ([trust](../architecture/trust.md#the-three-states)). Built-in resources ship with the release and stay trusted.

## Goals

- Every item below needs consent at both user and project level.
- One review experience for every kind: what the item can do in plain language, and where its source is. No embedded source.
- The user learns about a pending item where they are: a floating review tray over whatever is open, and where the item would have been used.
- No new table or column.

## Non-goals

- Protection against a deliberately hostile agent with an unrestricted shell. Trust decisions are rows in `data/nerve.sqlite`; an Autonomous agent running `bash` can write that file. Consent catches accidents, the `configure-nerve` flow and casual prompt injection. Only an OS sandbox closes the rest.
- `AGENTS.md`, `APPEND_SYSTEM.md`, conversation defaults and launch definitions. They are project content or select only reviewed items.
- Sub-agents skipping user overlays. A follow-up should decide whether guardrails apply to children.

## Scope

| Item                                             | Today: project          | Today: user                                       | Change                                                                                |
| ------------------------------------------------ | ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| MCP server entries                               | Per entry               | Per entry                                         | None; the model for the rest                                                          |
| Extensions                                       | Any change              | New access only; a code-only change keeps consent | User: any change outside Nerve asks again (review says "code changed, no new access") |
| Skills (`agent/skills`, home `.agents/skills`)   | Folder content          | None                                              | User: same as project                                                                 |
| Agent and sub-agent profiles                     | File bytes              | None                                              | User: same as project                                                                 |
| Permission rule sets (`config/rule-sets/*.json`) | —                       | None                                              | User: per file                                                                        |
| Permission overlays (`config/permissions.json`)  | File bytes              | None                                              | User: per file                                                                        |
| Agent preferences (`config/agent.json`)          | File bytes              | None                                              | User: same as project                                                                 |
| Prompt suggestions                               | `enable-js` script only | `enable-js` script only                           | Both: the whole suggestion file                                                       |

Decisions behind the table (from review with the maintainer):

- Overlays are trusted **per file**, like rule sets and project overlays. "Always allow" saves through Nerve and keeps trust, so re-reviews stay rare.
- User extensions: **any change outside Nerve** asks again, because changed code can use every access already granted.
- Prompt suggestions: **whole file**, for one rule everywhere.
- `agent.json` is included: it selects a rule set and turns on tools, skills and sub-agents.

## Behavior while an item waits

| Item                                 | While Needs review or Declined                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Profile                              | Not selectable, not offered for delegation. Conversations keep a valid applied snapshot, as for project profiles today.                                                                                                                                                                                      |
| Skill                                | Not advertised to the agent.                                                                                                                                                                                                                                                                                 |
| User rule set or user overlay        | **The last trusted version stays in effect** until restart, with the same in-memory mechanism as an invalid file (`previousVersionActive`). After a restart with no trusted version, affected calls are configuration-blocked with a Review action. Ignoring the file would also drop the user's guardrails. |
| Profile requiring a pending rule set | Unavailable, with a diagnostic naming the rule set.                                                                                                                                                                                                                                                          |
| `agent.json` (user)                  | Last trusted version in effect, as for rule sets.                                                                                                                                                                                                                                                            |
| Suggestion                           | Not shown.                                                                                                                                                                                                                                                                                                   |
| Extension, MCP entry                 | As today: not loaded, not started.                                                                                                                                                                                                                                                                           |

A pending project item still falls back to the user item of the same name (as MCP entries do), so a teammate's change never breaks the user's own setup.

## Server design

### Trust kinds and storage

`trusted_resource` already stores user decisions (`project_id IS NULL`, `trusted_resource_user_path`), and kinds are validated in code, so no table rebuild is needed ([trust](../architecture/trust.md#the-table)).

- Kinds whose name is neutral get user rows: `agent_profile`, `prompt_suggestion`, `extension`, `mcp_server`.
- Kinds named for the project (`project_permissions`, `project_capabilities`, `project_skill`) are renamed to neutral names (`permissions`, `capabilities`, `skill`) in the release migration step, and a new `permission_rule_set` kind is added. Alternative: separate `user_*` kinds; rejected because every reader would branch on scope.
- `prompt_suggestion` changes what its digest covers (whole file instead of the predicate). The migration recomputes existing rows.
- `grants` stores the review items the user saw (below) for every kind, so the next review can show what is new.

### Changes through Nerve keep trust at user level

[`ProjectMigrationService.transact`](../../packages/workbench-server/src/infrastructure/configuration/project-migration/) moves a trusted row's digest to the bytes Nerve wrote. The same capture is needed for every user write Nerve makes: profile, rule set and overlay saves in Settings, "Always allow" into the user overlay, `agent.json` and suggestion edits, extension updates installed through the UI. One shared helper owns read-check-write-capture for both scopes.

### Gates

Each owner checks `TrustedResourceService.state` before use, at user scope as at project scope: the profile catalog, the resource loader (skills), the permission source (rule sets, user overlay), agent layers (`agent.json`), the suggestion evaluator and the extension catalog. `configuration.list` and `check` report `needs_review` with `approval.where` for user items too.

### Migration

In the single migration step since the last release:

- Every existing user item gets a `trusted` row for its current content, so nothing changes for the user on upgrade.
- Rename the kinds and recompute suggestion digests as above.

### Guard test

[`trust-surfaces.test.ts`](../../packages/workbench-server/src/core-host/trust-surfaces.test.ts) must list the new user-scope trust and capture operations, and keep asserting that no agent tool, `quick_script` method or extension bridge reaches them.

## Review experience

### One review contract

A new shared contract in `packages/contracts`, returned by one operation per item (`trust.review`):

| Field             | Meaning                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------ |
| kind, scope, name | What is reviewed: "Sub-agent profile · User · reviewer"                                    |
| state             | `needs_review`, `trusted`, `declined`, plus `changedSinceDecision`                         |
| items             | `{ text, broad, new }[]`: what it can do, in plain language. Broad items first.            |
| sources           | Files with absolute paths, sizes and a `script` flag (one for a profile, many for a skill) |
| digest            | What a decision applies to; `trust.decide` refuses a stale digest                          |

The server writes the items, as extension consent does today, so wording is shared with agent diagnostics and tested in one place. Extension consent and the MCP review snapshot become two producers of this contract; their decision operations (`extensions.grantConsent`, `trust.decide`) stay.

What each kind says:

| Kind              | Items                                                                                                                                 | Broad when                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Skill             | What the agent is told (name, description); scripts it may run                                                                        | It has scripts                                                                                        |
| Profile           | Who can use it; offered for delegation; required and recommended rule set, model, tools, skills, extensions; size of its instructions | It requires a rule set that runs commands or edits without asking; it turns on delegation             |
| Rule set, overlay | What is allowed, asked and refused, grouped by decision, in plain words ("Allows `pnpm test` without asking")                         | An allow with no condition, on `nerve_home`/`nerve_data`, on any shell command, or on external writes |
| `agent.json`      | The rule set it selects, tools, skills and sub-agents it turns on, the model                                                          | It selects a rule set that runs without asking, or turns on an autonomous sub-agent                   |
| Suggestion        | The prompt it offers (first line), where it shows, whether a script decides when                                                      | It has a script                                                                                       |
| Extension         | The consent items of today                                                                                                            | As today                                                                                              |
| MCP entry         | The command or URL, variables and secrets and where each value goes                                                                   | As today (flagged environment names)                                                                  |

For a change to a trusted item, items not in the stored `grants` are marked new and listed first; extensions and MCP already work this way.

### One dialog

```
┌ Trust "reviewer"? ─────────────── Sub-agent profile · User · Needs review ┐
│ Changed outside Nerve's settings                                           │
│                                                                            │
│ What it can do                                                             │
│ ⚠ Runs without asking: requires the "autonomous" rule set           New   │
│ • Offered to main agents in every project with delegation on               │
│ • Uses Claude Sonnet, thinking high                                        │
│ • 6 lines of instructions                                                  │
│                                                                            │
│ Source                                                                     │
│ ~/.nerve/agent/agent-profiles/reviewer.json                    [Open]      │
│                                                                            │
│ Trust covers this exact version. A change outside Nerve asks again.        │
│                         [Details]          [Not now] [Decline] [Trust]     │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Source, not code.** Paths with **Open** (Nerve's file viewer; Reveal on desktop). Multi-file items list their files with scripts marked, like the skill review page today. Raw JSON and digests leave the profile and `agent.json` dialogs.
- **Same words everywhere.** Badges: Needs review, Trusted, Declined. Row action: **Review**. Dialog: **Not now**, **Decline**, **Trust**; a trusted item offers **Revoke**. This replaces Allow, Approve, Reject, Trust this version, Trust file and Review and trust. `TrustDecisionActions` is the one implementation.
- **A queue.** Opened from the bell or the review tray with several items, the dialog steps through them ("2 of 4", Next), and closes when the last is decided.
- **Dialog and page.** Every kind keeps a detail page like Extensions and Skills, with the same "What it can do" and "Source" sections and a "Waiting for your review" callout at the top. **Trust** on the page opens the dialog as confirmation. The bell and the review tray open the dialog directly; **Details** goes to the page.
- **Phone.** The dialog works on the phone, which keeps "trust prompts raised by a conversation" ([mobile workbench](mobile-workbench.md)); **Details** and **Open** are hidden there.

Settings patterns are recorded in [Settings UI](../ui/settings.md); its profile, suggestion and permission sections are updated with the new review.

## Telling the user

| Surface                          | Today                          | Change                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Attention bell, Review group     | Project items, MCP, extensions | Includes user items. **Review** opens the dialog (queue for several).                                                                                                                                                                                              |
| Settings nav count               | Project items                  | Includes user items                                                                                                                                                                                                                                                |
| Conversation welcome line        | Project count                  | Counts user items too                                                                                                                                                                                                                                              |
| **Review tray** (new)            | —                              | An app-level floating item, bottom right above the status bar, shown whichever conversation or page is open. It appears when an item becomes Needs review, whoever made the change, and does not depend on the agent's hand-over. See [Review tray](#review-tray). |
| **Where it would be used** (new) | MCP `FORBIDDEN` only           | The profile picker and `/profile` show pending profiles disabled with **Review**; Settings → Sub-Agents marks them; a configuration-blocked call card offers **Review**.                                                                                           |

### Review tray

Wireframe: `/dev/wireframes/config-review-tray` (local, gitignored design-lab prototype).

- **Expanded:** "Waiting for your review" with a count; one row per item with its kind, name, scope, its most important broad item in warning tone, and "Changed outside Nerve's settings" with the time. Each row opens the review dialog; **Review all** opens it as a queue.
- **Collapsed:** a small pill ("3 waiting for review") that expands on click.
- **Later** hides the tray until another item becomes Needs review. The bell keeps counting.
- It lists the same items as the bell's Review group, so the two never disagree. Deciding an item in Settings removes it from the tray.
- It belongs to the shell, not a conversation, so items created by another conversation, a `git pull` or an editor show too.

Not added: desktop notifications and a dialog at startup. They nag, and the bell covers them. Declined items never ask for attention.

## Agent-facing changes

Follow [agent-facing content](../agent-facing.md).

- `configure-nerve/SKILL.md`: the scope table loses "works at once"; every row says the user approves. Hand-over always names what waits and where. The skill still says the agent cannot approve.
- Agent diagnostics: `needs_review` for user items carries `approval.where`. Delegating to a pending sub-agent profile fails with a message that it waits for the user's review in Settings → Sub-Agents and that the agent should not retry.
- `reference/agent-profiles.md`, `reference/permissions.md`, `reference/skills.md`, `reference/prompt-suggestions.md`: state that user files need approval too.

## Phases

| Phase | Outcome                                                                                                                                                     | Behavior change             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1     | Review contract, server summaries for every kind, the shared dialog, consistent labels; profiles and `agent.json` move off raw JSON                         | None (current kinds only)   |
| 2     | User-scope trust: kinds, gates, Nerve-made writes keep trust, last trusted permissions in effect, extension and suggestion rules, migration, skill and docs | Yes                         |
| 3     | Review tray, "where it would be used" markers, user counts in welcome line and nav                                                                          | None to trust; new surfaces |

Phase 1 first, so user items arrive in phase 2 with a readable review instead of the JSON dialogs.

## Documentation to update

- [Trust and consent](../architecture/trust.md): kinds table, the user rows, "edits made in Nerve keep trust" for both scopes, the threat-model note.
- [Permissions](../architecture/permissions.md): pending user rule sets and overlays.
- [Settings UI](../ui/settings.md): the review dialog and labels.
- Website: `guides/configure-by-chat.md` ("What only you can do" covers user scope), `reference/agent-profiles.md`, `guides/skills-and-resources.md`, `reference/prompt-suggestions.md`, `guides/settings.md`, `reference/extensions.md`.

## Testing

- Unit: per-kind summarizers (broad detection, new items against stored grants), state resolution for user rows, capture after Nerve-made writes (including "Always allow"), last-trusted fallback for permission files, migration (grandfathered rows, renamed kinds, recomputed suggestion digests).
- Guard: `trust-surfaces.test.ts` covers the new operations.
- QA on a copied slot: Forge creates a user sub-agent; it is not offered, the review tray and bell show it, the dialog trusts it, delegation works. Edit a trusted user overlay by hand: the old rules stay in effect until trusted.

## Settled questions

- **Items created elsewhere** (another conversation, `git pull`, an editor) show in the review tray too; it is app-level, not tied to a conversation.
- **Changes from other tools** (Claude Code and others share `~/.agents/skills`): Nerve cannot tell them from agent changes, so every surface says "Changed outside Nerve's settings".
