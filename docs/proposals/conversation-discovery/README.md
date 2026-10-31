# Conversation discovery

Status: final proposal, ready for implementation.

## Problem

Rows in the conversation list are hard to scan. Titles often start with filler ("Please check…"), long file paths, or generic instructions. Truncation hides the identifiers that matter. Child counts and timestamps compete with the title. Rows that need the user look much like rows that don't. You also can't find a conversation from the PR it reviewed or created.

## Goals

The list answers three questions at a glance:

1. **Which conversation is this?** Better titles: an instant local title, optionally improved in the background by a small AI model the user picks.
2. **Does it need me?** Sections you can predict (Pinned → Needs you, which includes unseen "Finished" results → Today / Yesterday / Previous 7 days / Older), built on the existing attention state.
3. **Where is the work?** PR/issue tags that show whether the user *referenced* a resource or the conversation *created* it, plus one smart search input over titles, statuses, and references.

It also follows two rules:

- **Clear row hierarchy:** a title of up to two lines, then a status only when there's something to act on, then one metadata line.
- **Stable order:** title and metadata updates never reorder rows or count as new activity.

## Solution overview

| Area | Decision | Doc |
| --- | --- | --- |
| List UX | Sections, one card per conversation: a two-line title, then one meta line (short status, up to 2 references + `+N`, time). Context menu for actions. Inline smart search with lazy matching | [list-ux.md](list-ux.md) |
| Recency | Keep the existing client ordering by `last_user_message_at` (actual user prompts only) | [list-ux.md](list-ux.md#ordering-and-stability) |
| References | GitHub PR/issue references from user prompts. "Created" comes from successful `gh pr create` / `gh issue create`. The model is provider-neutral for later Jira/Linear support | [references.md](references.md) |
| Storage | One new table, `conversation_reference`, added to the unreleased schema v2 step. No other schema changes | [storage.md](storage.md) |
| Titles | The rule-based title stays instant and gains an inline image marker. Opt-in background AI title runs once per new conversation, guarded against manual renames | [title-generation.md](title-generation.md) |
| Settings | New user-level "Titles" settings page (App group, no project override): opt-in switch, existing `ModelPicker`, disclosure, test | [title-settings.md](title-settings.md) |

Wireframes (local and mock-only, served in dev):

- `/dev/wireframes/conversation-list`: cards, context menu, inline smart search
- `/dev/wireframes/conversation-title-settings`

## Non-goals

- Live GitHub state (open/merged/closed), GitHub API calls, or new GitHub authorization.
- Jira/Linear/other trackers in v1 (the data model allows them later).
- Backfilling references or titles for existing conversations.
- Persisted or cross-client "seen" state, scroll-based seen detection, or unread counts. The existing session-local unseen marker is reused as is.
- AI importance scoring, generated summaries/tags, a new archive concept.
- Automatic re-titling after the first generation, bulk retitling, bundled model weights.
- Manual correction of references.
- Full-text transcript search.
- The mobile inbox (`presentation/shell/mobile/`); it keeps its own grouping for now.

## Delivery

One PR, built in this order so each step leaves the app working:

1. **List redesign:** sections, cards, short status labels, context menu, smart search over title and status. Uses existing data only.
2. **References:** `conversation_reference` table, extraction, reference tags, "Open on GitHub" menu, reference terms in search.
3. **Titles:** image marker in the rule-based title, settings page, background AI title.

## Validation

Per repository policy: `pnpm fix:focused && pnpm check:focused`, plus unit tests for the touched modules. Each doc lists the behavior that needs tests. Test schema work on a copied slot (`pnpm storage:copy --slot N`), never slot 1.
