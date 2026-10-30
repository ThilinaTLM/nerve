# Home migration failure handling

## 0001 conversation core

- Conversation decoding, ancillary agent/input/task records, missing owners, import transactions, and conversation verification previously surfaced discardable errors and stopped startup. The runner now persists those diagnoses as set-aside decisions and retries automatically. Existing owner/dependency attribution and quarantine exports are reused; unrelated conversations continue.
- Non-runtime home configuration and conversation overlays previously required a manual discard/retry. They now use the same automatic path.
- Runtime home configuration previously remained unreadable for Settings Health without appearing in the migration report. It now also receives a byte-preserving quarantine copy and a report entry. The original stays active for runtime diagnostics and fail-closed permissions.
- Event/message salvage already preserved bad records in quarantine and reported losses; its loss label is now reason-based rather than record-based. Unsafe/linked assets previously only incremented skip counters, and missing assets only incremented a loss counter. Their original descriptors now survive in quarantine; link targets are archived without following them. Other asset failures attributable to a conversation use that conversation's isolation boundary.

## 0002 agent profiles

- Malformed conversation settings previously escaped `inputs` as fatal JSON/conversion errors. Sources are now read independently using the existing scope validator, quarantined, reported, and omitted from the conversion contribution.
- Invalid user settings previously remained available for scoped repair but were only described in loss strings. They now also have quarantine copies and set-aside entries.
- Malformed policy JSON remains active for fail-closed runtime repair, with a quarantine copy and set-aside entry.
- Invalid applied-draft profile documents previously aborted the step. They now remain available for repair and are copied to quarantine.
- Conversation SQL contributions that cannot produce an agent document are preserved with their source settings in quarantine. A placeholder uses a deliberately unavailable permission policy so it cannot execute until repaired; it never silently substitutes a permissive policy. Export receipts still cover every SQL row before legacy columns are retired.

### Historical plan-review bindings

0002 also upgrades the typed review request and resolution locations:

- `conversation_event.payload.interactionResolution`
- `tool_call.interaction.request` and `tool_call.interaction.resolution` (the released table has no separate resolution column)

Confirmations use the migrated request's target profile and revision/digest. Settled responses with no surviving request use the released `coding` approval-profile default, or their explicit recorded approval-profile argument. Missing transition/CAS evidence is reconstructed as an **archival binding**, not live approval authority: revision zero, a deterministic archival source digest, and a `migration:0002-plan-review:` transition ID that cannot match a live transition capture. Existing captured evidence, explicit choices, rejections, and feedback are preserved. Bundled profile digests use frozen definition bytes; authored names without captured definition bytes use a clearly archival name identity rather than reading a possibly changed project file. Original SQL bytes remain in the migration's database backup. Reports count request/confirmation conversions separately by storage location.

### Current-contract rehearsal gate

After an offline migration, run:

```sh
pnpm exec tsx scripts/storage-migrations/validate-history.ts --home data/storage-5
pnpm exec tsx scripts/storage-migrations/validate-history.ts --home data/storage-6
```

This read-only gate parses **every** event (including unselected branches) and every tool-call row, decoding all their JSON columns, against the current contracts. It exits nonzero on failure and reports counts with bounded example IDs, without printing stored prompts or results. It stays outside the frozen steps so future contract changes are detected without reinterpreting old conversion code or adding a full-history contract scan to startup.

#### QA rehearsal, 2026-10-30

Fresh stopped copies were recreated from `data/storage-0-34-1` into slot 5 and `data/storage-0-37-0` into slot 6, then migrated offline and checked with the commands above. Both homes recorded the current 0002 checksum (`20ae70d4def3887f4e5afe9f5bd4671ea57849a1a8d4a28417c8b5169c0e97a0`).

| Source          | Approval-confirmation event rows fixed | Affected conversations | Events validated | Tool-call rows validated | Schema failures |
| --------------- | -------------------------------------: | ---------------------: | ---------------: | -----------------------: | --------------: |
| 0.34.1 / slot 5 |                                    105 |                     98 |           116329 |                        0 |               0 |
| 0.37.0 / slot 6 |                                     88 |                     82 |           158611 |                        0 |               0 |

Missing approval confirmations were the only current-contract mismatch class found. Both datasets contain no active tool-call rows, so their request-binding and embedded-resolution fix counts are zero; fixtures cover those columns, matching confirmations across event/call storage, current captured evidence, authored profile names, rejections, and idempotency. Aggregated fix counts are retained in each home's `migrations/reports/0002-agent-profiles.json`. No daemons were started and neither original dataset was modified.

## Framework and reporting

- Manifest/ledger admission, database integrity, unsupported SQL layouts/dependencies, inability to preserve quarantine, and failed durable commit/bookkeeping remain blocking. Retrying an already excluded item that still fails also blocks rather than looping forever.
- Losses are aggregated by path-independent reason. Reports retain individual quarantine receipts for recovery and add an aggregated set-aside summary. Activity details group set-aside reasons with counts and at most three example quarantine locations.
- The existing report HTTP API persists dismissal in home report files. The workbench loads reports after connection and presents one header activity notice; details never open automatically.
