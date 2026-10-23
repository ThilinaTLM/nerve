# Scoped configuration and active agent profiles

> **Status:** Design finalized for implementation planning after user decisions, six read-only implementation reviews with four second passes, and a release-baseline review against v0.37.0. Runtime implementation has not started under this proposal. The exact destructive database migration must be reviewed before execution; no new SQLite settings/cache tables or columns are authorized.

## Goal

One explainable agent configuration model: defaults describe normal preferences, conversation overrides describe explicit choices, and the active profile contributes temporary recommendations/requirements without overwriting those choices.

This supersedes the materialized-template behavior in [System prompt, tool descriptions, and agent profiles](../system-prompt-and-agent-profiles.md). Historical implementation is not retroactively described as this design.

## Decisions

- User/project/conversation domain JSON files, with sparse `agent.json` preferences and one atomic conversation agent document.
- Use settings / Recommend / Require; explicit conversation choices beat recommendations, requirements win temporarily. No parent-copy mode.
- Applied profile snapshot remains until explicit switch/reapplication; catalog edits never silently rewrite an existing conversation.
- Lead/child shared value schemas, no child delegation, model/reasoning-only scoped child invocation overrides. Child preferences are captured once for future follow-ups.
- Tools have typed configuration; skills have boolean source defaults and individual toggles; credentials remain user-owned references.
- JSON is persisted authority. Remove conversation agent settings from SQLite. Optional conversation-list summaries use a disposable JSON cache, never SQLite.
- Preserve unrelated domain scopes/paths/semantics. Remove remember-last-selection; keep only creation/picker preferences.
- UI saves update validated in-memory generations. No file watchers/polling; manual edits require restart for guaranteed activation.
- Request resources apply at the next LLM preparation; permission changes apply at the next tool execution admission, including after approval waits.
- Lazy scoped validation, visible health and confirmed repairs. No persisted last-known-good settings store. Invalid policy blocks dependent execution; unrelated UI/history remain usable.
- Migrate from released v0.37.0 state only; unreleased intermediate formats are not inputs. Migrated per-conversation values become ordinary explicit choices.
- After restart, not-yet-started calls are re-captured from current configuration and re-admitted. A changed execution target invalidates an earlier approval.
- Invalid security configuration makes calls wait, configuration-blocked, with Retry/Cancel only. It is never an approval bypass.
- New documents are strict; any field addition bumps `schemaVersion`.

## Specification

| Document                                            | Responsibility                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Configuration model](configuration-model.md)       | Precedence, profile/child lifecycle and planning workflow                             |
| [Domain registry](domain-inventory.md)              | Complete target paths, changed/preserved domains and SQLite boundary                  |
| [Schemas](schemas.md)                               | Envelopes, exact fields, merge units, mutation restrictions and referenced validators |
| [Examples](examples/README.md)                      | Concrete partial documents and expected resolution                                    |
| [Activation and cache](activation-and-cache.md)     | Save/publication, request captures, execution admission and restart behavior          |
| [Migration and recovery](migration-and-recovery.md) | Conversion map, health/readiness, trust, repair and crash consistency                 |
| [Implementation plan](implementation-readiness.md)  | Delivery sequence, acceptance gates and validation                                    |
| [Audit findings](review-findings.md)                | Evidence, corrected assumptions and deliberately excluded work                        |

The schema document is normative for changed fields; existing referenced contracts remain normative for unchanged values/domains. Export JSON Schema from implemented contracts rather than maintaining a second independent validator here. Example model/account identities are illustrative, not installed resources.

## Scope limits

No redesign of permission composition/parent authority, suggestion scopes, launch catalogs, credentials, browser state or daemon resource-limit persistence. No global eager scan on routine startup. A one-time verified export before destructive SQLite migration is distinct from ongoing lazy validation. Storage-wide corruption/migration failure may still require startup recovery.

Documentation was reviewed against implementation; this is not a claim that future runtime code or migrations have been validated. Database migration execution requires exact-DDL review and copied-slot rehearsal under repository rules.
