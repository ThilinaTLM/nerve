# Storage changes

Approved scope: one new table. No other columns or tables are added.

## `conversation_reference` (new)

Add this to the **unreleased schema v2 step** (`packages/conversation-core/src/storage/schema-v2.ts`). The latest release is v0.37.0, which doesn't include v2, so the table extends v2 rather than adding a migration version.

```sql
CREATE TABLE conversation_reference (
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK(relationship IN ('referenced','created')),
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, provider, resource_key)
) STRICT;
```

- `provider` and `kind` are open text, validated in contracts, so new trackers don't need a migration.
- `created_at` is the first time the reference was seen. It drives link order. Upgrades change `relationship`/`kind`/`source_event_id` but keep `created_at`.
- Upsert: `INSERT … ON CONFLICT DO UPDATE` with upgrade-only rules (`created` wins; a concrete `kind` wins over `unknown`).
- Delete: cascades with the conversation.
- No backfill: the table starts empty and fills from new events only.
- Reads are by conversation (primary-key prefix): summaries load references for the listed conversations. Search runs client-side over summaries, so no resource index is needed.

Repository: a new `conversation-reference.repository.ts` next to the existing repositories. Summary derivation in `conversation.repository.ts` loads the references for the listed conversations in one query.

## Recency

No schema change and no server change. The client already orders and groups by the existing `conversation.last_user_message_at` (`project-tree.ts`), which `conversation-event.repository.ts` sets only when a `user_message` event is appended. Assistant output, tool results, system events, title/pin/completion changes, and reference upserts don't touch it.

- `updated_at` keeps its current meaning (any mutation). The server's `updated_at` ordering is irrelevant to the list.

## Not stored

| Concern | Where it lives |
| --- | --- |
| AI title result | Existing `conversation.title` |
| Title job and ownership token | Daemon memory. In-flight jobs are dropped on restart and not retried |
| Title AI setting (enabled, provider/model) | Existing user settings mechanism |
| Unseen/"Finished" marker | Existing client-session `unseenResults` |

## Testing

Run migration tests (`migrations.test.ts`, `schema-v2-review.test.ts`) plus repository unit tests. Try it on a copied slot (`pnpm storage:copy --slot N`), not slot 1.
