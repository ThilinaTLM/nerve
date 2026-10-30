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

### Released-source scope audit

Conversation sources must be checked with the same frozen shapes used by `convertConversationV037`, not with `convertPreferencesV037`'s user-level schemas. In tag `v0.37.0`, `contracts/.../core/harness-settings.ts` declares a strict `{ compaction? }` document and `core-host/conversation-harness.service.ts` writes `{ compaction }` without `version`. The pre-set-aside converter accepted that same sparse shape. All 159 pristine 0.37.0 harness overrides belong to child conversations and must survive in `agent.json`'s `frozenDefaults.compaction`.

The audit also checked the release's sparse subagent writer (`domains/subagents/subagent-profile.service.ts` and `contracts/.../subagents/subagent-configuration.ts`): conversation catalogs contain launch overrides, not complete authored user profiles. Conversation validation now uses that scope too. Integration account files are not conversation-conversion inputs and are not inspected there. User harness documents still require version 3; project preferences and user catalogs retain their separate validation semantics.

Read-only checks against the pristine datasets found:

| Source / boundary                          | Documents checked                                                                                  | Result                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 0.34.1 / 0001 home preflight               | Six home documents: daemon, harness, UI, permissions, providers, integrations                      | Accepted; no failures or queued quarantine |
| 0.34.1 / 0001 conversation overlays        | 72 capabilities documents: 34 v1 and 38 v2                                                         | Accepted by the frozen v1/v2 converter     |
| 0.37.0 / 0002 home preferences and catalog | Harness v3, integrations v1, subagents schema v1                                                   | Accepted                                   |
| 0.37.0 / 0002 conversation overrides       | 680 capabilities v2, 159 version-less compaction-only harness files, five sparse subagent catalogs | Accepted with conversation semantics       |
| Both / policy metadata readers             | One home permissions document per dataset; no rule-set or conversation permissions files present   | JSON and metadata conversion accepted      |

0001's other validators were compared with the released writers and their owning converters. In v0.34.1, prompt-suggestion enablement was SQL-backed; 0001 produces the v1 file with an enabled map. Subagent configuration accepts old enabled preferences or the consolidated schema-v1 output catalog; capabilities accept both released versions; conversation permissions use the frozen origin-specific overlay converter. Optional pre-existing prompt/subagent files, home capabilities, and conversation permissions are absent from the pristine 0.34.1 dataset. Runtime-owned home documents receive only the existing JSON-object preflight, not a newer runtime schema. The 0.34.1 harness's `exploreAgent` and `asyncSubagent` fields are converted by 0001 before 0002 validates its outputs. Applied-draft current profile documents are not inputs in either pristine released home. No additional false rejection was found in 0001, and its code/checksum did not need changing. Neither step takes ownership of `config/mcp.json`; 0002 does not re-read the 74 old pre-core capability overlays left outside `config/` in the 0.37.0 home.

History-schema validation alone cannot detect lost settings. Rehearsals must also inspect **every** report's set-aside list and compare all 159 released child compaction overrides with the migrated frozen defaults, not merely confirm that history parses.

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

Fresh stopped copies were recreated from `data/storage-0-34-1` into slot 5 and `data/storage-0-37-0` into slot 6, then migrated offline and checked with the commands above. Both homes recorded 0002 checksum `15b23510e159c4d2530ecda888a3528d51fba1a005f533c1aa0d65e6c4881504`. All reports were checked: **zero set-aside items in either home**, with no set-aside reasons. All **159** released child compaction overrides were compared directly with their migrated `frozenDefaults.compaction` values and matched exactly; the 0.34.1 source has no such harness files.

| Source          | Approval-confirmation event rows fixed | Affected conversations | Events validated | Tool-call rows validated | Schema failures |
| --------------- | -------------------------------------: | ---------------------: | ---------------: | -----------------------: | --------------: |
| 0.34.1 / slot 5 |                                    105 |                     98 |           116329 |                        0 |               0 |
| 0.37.0 / slot 6 |                                     88 |                     82 |           158611 |                        0 |               0 |

Missing approval confirmations were the only current-contract mismatch class found. Both datasets contain no active tool-call rows, so their request-binding and embedded-resolution fix counts are zero; fixtures cover those columns, matching confirmations across event/call storage, current captured evidence, authored profile names, rejections, and idempotency. Aggregated fix counts are retained in each home's `migrations/reports/0002-agent-profiles.json`. No daemons were started and neither original dataset was modified.

Aggregated loss counts across all step reports (conversion occurrences, not distinct conversations):

| Reason                                                                                 | 0.34.1 / slot 5 | 0.37.0 / slot 6 |
| -------------------------------------------------------------------------------------- | --------------: | --------------: |
| Assistant tool-call block without durable result settled as indeterminate              |              27 |               0 |
| Dropped legacy compaction field customKeepRecentPercent                                |             828 |               0 |
| Legacy interaction retained in result details rather than typed resolution             |               2 |               0 |
| Missing legacy assets                                                                  |               7 |               0 |
| Reconstructed archival plan-review approval confirmation in conversation_event.payload |             105 |              88 |
| Removed bundled Explore/Developer parent-copy model and reasoning behavior             |               1 |               1 |
| Renamed historical planning tool metadata in conversation_event.payload                |             254 |             220 |
| Selected branch lacked a result recorded elsewhere; result copied onto selected branch |               4 |               0 |

Reports are in `data/storage-{5,6}/migrations/reports/`. Both full history scans passed with zero schema failures. Validation also passed 115 step unit tests, `pnpm fix:focused`, `pnpm check:focused`, and `pnpm exec tsx scripts/storage-migrations/check.ts`.

## Framework and reporting

- Manifest/ledger admission, database integrity, unsupported SQL layouts/dependencies, inability to preserve quarantine, and failed durable commit/bookkeeping remain blocking. Retrying an already excluded item that still fails also blocks rather than looping forever.
- Losses are aggregated by path-independent reason. Reports retain individual quarantine receipts for recovery and add an aggregated set-aside summary. Activity details group set-aside reasons with counts and at most three example quarantine locations.
- The existing report HTTP API persists dismissal in home report files. The workbench loads reports after connection and presents one header activity notice; details never open automatically.
