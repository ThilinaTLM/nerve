# Agent profiles (home step 0002)

Runs for both already-upgraded homes and legacy homes after the released 0001.
The released 0001 folder and core SQL v1 are immutable: 0001 uses its own frozen
v1 writer, not `openCoreStorage`. This step likewise opens SQLite directly and
leaves the SQL ledger alone. Startup subsequently opens core storage and applies
core v2. The ordering is **0001 → 0002 → core v2** (or **0002 → core v2** on an
already-upgraded home). Fresh homes initialize at the latest format.

- Rename user and registered-project `config/subagents.json` to
  `config/agent-profiles.json`. Existing entries gain `usableBy: "subagent"`;
  model/thinking `lead` becomes `inherit`; removed compaction retention is dropped.
- Preserve explicit selections and text. Normalize plan tool keys, not arbitrary
  prose/arguments. Drop mode from stored selections/harness configuration and
  `compatibleModes` from custom rule sets. Convert capability files and historical
  plan call/projection metadata to `plan_present`. Add the new tool to persisted
  harness disabled lists; the Planning profile opts it in per turn.
- Profile file replacements use checked canonical output, collision rejection,
  original source hashes and receipts. Source removal follows output verification.
  Symlinked paths are rejected. The migration filesystem journals each file unit.
- Renamed profile trust paths are marked rejected; old approval cannot authorize
  changed bytes. Core v2 changes the trusted-resource kind CHECK and stored kind.
- Shared DB updates are transactional, after all document units succeed. An
  offline checkpoint and rollback-journal snapshot preserve the pre-step database.
  Retries are idempotent; rollback restores both documents and database metadata.

Legacy Markdown conversion remains exclusively in released 0001. No runtime
fallback loader or old contract aliases are introduced.
