# Agent profiles and settings templates (unreleased home step 0002)

This step extends the unreleased upgrade; released 0001 and core SQL v1 are
immutable. The order remains **0001 → 0002 → core v2** (or **0002 → core v2** for
an already-upgraded home). There are no SQL schema changes here. A fresh home
starts with the current formats without running historical conversions.

## Canonical formats

- User harness v4 stores typed tool payloads. Detached Python/shell execution
  fields, bash limits, image/Kroki configuration and integration account choices
  move into the canonical tool entries. User integrations v2 stores accounts only.
- Project harness files retain general agent settings, not tools or skills.
  Detached selections/configuration move to capability documents. Capability v3
  embeds typed settings inside each tool payload; detached `toolSettings` is gone.
  Changed project capability bytes require normal exact-byte trust review.
- User profiles become `data/agent-profiles/<name>.json`; project profiles become
  `.nerve/agent-profiles/<name>.json`. Each v2 file is a complete template. Sparse
  legacy entries are resolved against their old builtin/user/project layers before
  splitting, so omission does not accidentally become new field inheritance.
  Project files receive **no blanket trust transfer**. Old aggregate approvals
  are rejected and cannot authorize the newly generated files.
- Old scalar modes become omission (Use settings), explicit `lead`, Set or Lock.
  Defaults are resolved to concrete scoped values. Model and thinking convert independently, including inherited model with
  explicit thinking and differing lock modes. Only genuinely unresolvable input
  (e.g. a missing concrete default model or ambiguous both-scope inheritance)
  requires repair.
  Unknown portable tool names that cannot fit the new typed schema also require
  review rather than silently losing their preferences.
- Existing conversations receive ordinary capability/compaction values and an
  `applied-agent-profile.json` snapshot. Only old live scalar Locks are applied
  over stored lead values; Sets do not erase later user choices. Existing child
  values/instructions are already materialized and are not taken from an edited
  template a second time. Their existing values supply any captured Lock values.
  Conversation-local template catalogs are retained as inert
  `retired-agent-profiles.json` after the applied state is captured; there is no
  runtime reader or conversation definition scope.
- Outstanding plan reviews capture their effective migrated `plan_present`
  approval target (normally coding), never the conversation start-profile setting.

## Safety and recovery

`profile-format.ts`, `legacy-builtins.json`, `phase5-defaults.json` and the
phase-5 validators/converters are frozen storage-boundary inputs. Migration code
never imports evolving runtime contracts. Existing plan tool/projection renames,
mode cleanup and custom-rule-set cleanup remain part of this same step. Agent
instruction text, arbitrary arguments, credential stores and profile IDs are not
rewritten.

Every batch binds original source hashes and expected target contents before
writing. Collisions and later edits are rejected. Sources are removed only after
all targets verify. File units use the framework journal and quarantine/repair
reporting; symlinked paths are rejected. Conversation file plans are durable
before writes. Shared DB updates happen transactionally only after those units
commit, and the original database is checkpointed and journaled for whole-step
rollback. Retry verifies receipts rather than reapplying already-captured child
instructions. Verification checks canonical outputs against receipts before the
step is recorded.

Project-owned account/provider definitions are not silently imported into the
user catalog. Such definitions, disabled/untrusted active lead templates, and
unresolvable mixed/default settings produce repair reports. Roll back the draft
step before editing inputs whose conversion receipts were already established.
Project UI/provider files are no longer runtime settings sources; their original
bytes are not deleted by this upgrade.

Developer homes that already recorded an older draft of 0002 must be recopied
from a released-format source for rehearsal; the migration ledger does not rerun
recorded steps. Do not add a second unreleased step or a runtime dual reader.
