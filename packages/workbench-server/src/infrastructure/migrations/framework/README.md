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

## Framework and reporting

- Manifest/ledger admission, database integrity, unsupported SQL layouts/dependencies, inability to preserve quarantine, and failed durable commit/bookkeeping remain blocking. Retrying an already excluded item that still fails also blocks rather than looping forever.
- Losses are aggregated by path-independent reason. Reports retain individual quarantine receipts for recovery and add an aggregated set-aside summary. Activity details group set-aside reasons with counts and at most three example quarantine locations.
- The existing report HTTP API persists dismissal in home report files. The workbench loads reports after connection and presents one header activity notice; details never open automatically.
