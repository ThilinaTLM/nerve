# Sub-agent profiles

> **Status:** Proposal, under discussion. Nothing here is implemented. When it ships, the content moves to `docs/architecture/conversation-core/delegation.md` and this directory is deleted.

## Problem

Nerve has two delegation mechanisms with overlapping purposes:

- `explore`: a synchronous batch tool. It creates one read-only child per task, runs up to three at once, and blocks the lead until all reports return.
- `subagent_new`, `subagent_prompt`, `subagent_status`, `subagent_stop`, `subagent_list`: asynchronous, reusable developer teammates.

They are configured separately (`exploreAgent`, `asyncSubagent` in `harness.json` plus tool groups in Settings → Tools). Most of that configuration is never applied: children always inherit the lead's conversation config. The Explore read-only restriction is a special case in `CapabilityService.initializeChild`. Users cannot define their own kinds of sub-agent.

## Goal

One asynchronous sub-agent system:

- The lead creates and steers sub-agents with three small, token-efficient tools.
- What a sub-agent is (persona, model, permissions, tools, skills, compaction) comes from a **profile**: a Markdown file at user or project level, like prompt suggestions. Explore and Developer are built-in profiles.
- A sub-agent is an ordinary child conversation. Its configuration is copied from the profile at creation, and from then on the user configures it in the transcript view exactly like a lead.

## Non-goals

- Synchronous delegation. The `explore` tool is removed; parallel research means several sub-agents in one batch.
- Human-in-the-loop inside sub-agents: no questions, no plan review, no permission approvals.
- Nested delegation: sub-agents cannot create sub-agents.
- The user prompting a sub-agent directly.
- Budgets, depth or concurrency limits, and parent-to-child authority caps.

## Documents

| Document                                      | Covers                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Profiles](profiles.md)                       | Profile files, fields, built-ins, precedence, enablement, project trust                                                           |
| [Agent interface](agent-interface.md)         | Tools, completion notices, status, async bash in sub-agents, token budget                                                         |
| [Child configuration](child-configuration.md) | Creation flow, enforced sub-agent rules, instructions, layered compaction, report files                                           |
| [User interface](user-interface.md)           | Context panel removal, Agents pill, waiting state, sub-agent view, context popover, Settings page ([wireframes](wireframes.html)) |
| [Migration and cleanup](migration.md)         | Legacy settings, tools and files removed or converted; documentation updates                                                      |

## Principles

- **A profile is a template, not a policy.** It is applied once, at creation, through existing mechanisms: conversation config, the conversation `capabilities.json`, and the conversation `harness.json`. Nothing about the profile is stored on the child or looked up later. Editing or deleting a profile affects only sub-agents created afterwards.
- **A sub-agent is a conversation.** It has the same runtime, history, controls, views and per-conversation configuration as a lead. The only differences are a small set of host-enforced rules (see [child configuration](child-configuration.md#rules-enforced-for-every-sub-agent)).
- **The lead's context is the scarce resource.** Tool definitions, call arguments, results and notices are all sized for long-running leads.
- **No polling.** Completion notices wake the lead.

## Glossary

| Term         | Meaning                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| Lead         | The conversation that created a sub-agent (`parent_conversation_id` on the child)             |
| Sub-agent    | A child conversation created by `subagent_prompt`                                             |
| Profile      | A Markdown file describing the starting configuration and instructions of a kind of sub-agent |
| Name         | The lead-chosen handle for a sub-agent: unique per lead, case-insensitive, used as its title  |
| Assignment   | One prompt delivered to a sub-agent by its lead                                               |
| Instructions | Persona and working rules rendered as their own section of a conversation's system prompt     |

## Decisions so far

| Area                   | Decision                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution model        | Asynchronous only. `explore` is removed.                                                                                                                                                                                                       |
| Tools                  | `subagent_prompt` (create or follow up, batch of 1–10), `subagent_status`, `subagent_stop`.                                                                                                                                                    |
| Profiles               | Markdown files at user and project level, built-ins shipped with Nerve. Project overrides user overrides built-in, by name.                                                                                                                    |
| Configuration lifetime | Copied at creation, then fully editable per sub-agent. No live link to the profile.                                                                                                                                                            |
| Permission rule sets   | Sub-agents use only `read_only` or `autonomous`. No cap relative to the lead.                                                                                                                                                                  |
| Human-in-the-loop      | `ask_user` and `plan_mode_*` are removed for every sub-agent. The two allowed rule sets never ask.                                                                                                                                             |
| Nested delegation      | `subagent_*` tools are removed for every sub-agent.                                                                                                                                                                                            |
| Async bash             | Allowed. A sub-agent can end its turn while background commands run; the lead sees it as waiting and can still send follow-ups.                                                                                                                |
| Instructions           | New nullable `conversation_config.instructions` column, rendered as its own system prompt section. Any conversation can have it.                                                                                                               |
| Compaction             | Layered `user → project → conversation` settings in `harness.json`; the conversation layer is a new file.                                                                                                                                      |
| Direct user prompts    | Disabled for sub-agents. The composer shows an overlay with a way back to the lead.                                                                                                                                                            |
| Conversation UI        | The Context dock panel is removed. Agents and background commands move to a floating pill in the transcript area, session details to the context popover. Sub-agents open in the main view with the lead's transcript and composer components. |
| User interventions     | A user stop of a sub-agent is reported to the lead with a notice, which wakes it. User configuration changes are not reported; the lead sees them through `subagent_status`.                                                                   |
| Deleting sub-agents    | Not supported for now. Sub-agents live as long as their lead and are deleted with it; the Agents tree folds inactive ones.                                                                                                                     |
| Waiting state          | The transcript activity row stays visible while a conversation waits for sub-agents or background commands, and names them.                                                                                                                    |
| Reports                | Full final responses that exceed the notice cap are stored in the child's conversation directory. `data/reports/` is removed.                                                                                                                  |

## Open questions

Tracked at the end of each document.
