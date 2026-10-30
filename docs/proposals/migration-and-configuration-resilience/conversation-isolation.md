# Conversation isolation

Part of [Migration and configuration resilience](./README.md). **Investigated and rechecked on 2026-10-30. Recovery/stream containment, unreadable-conversation activity with Delete, and missing-asset handling are implemented.**

Home migration already sets aside conversations it cannot convert. Corruption can also appear later, for example from a partial write, disk trouble, or a bug in a newer version. The same principle applies: one unreadable conversation must not break startup, the conversation list, or other conversations.

## Intended behaviour

- One header activity item lists conversations that could not be loaded, with each raw title (or ID), project and error summary.
- Each entry offers **Delete** with confirmation. It removes that conversation, its descendants and their files from raw identity.
- There is no Unavailable conversation-list entry, conversation contract change, or export action; these were dropped in the [follow-up plan](./follow-up-plan.md).
- Projection or replay failures are contained to that conversation. A missing image returns a typed, path-free 404 and renders a placeholder; wrong ownership remains a different error.

## Investigation

### Setup and limits

Used `data/storage-8`, created with `cp -a data/storage-6 data/storage-8`. The source was an already-migrated 0.37.0 home (both current home migrations applied). Before daemon startup, rewrote all 14 `project.directory` values and all 1,012 original conversation working directories to nonexistent paths under `/tmp/nerve-conv-iso-missing/`. Checked `config/` for absolute project paths; none were found. All explicit database/file fault operations targeted slot 8. Safety caveat: an initial `dev:ui` attempt inherited `NERVE_HOME` pointing at the protected default home. It was stopped before browser navigation, but Vite startup can read that home's daemon lease/token. No protected database was deliberately opened or modified, and it was not inspected afterward to verify side effects. Subsequent launches explicitly cleared both inherited home/target variables.

Added two controlled root conversations in the copied database: `conv_iso_bad` (title **ISO BAD**) and `conv_iso_healthy` (**ISO HEALTHY**), under the sanitized Nerve project. Each initially had one valid user event and a copied conversation `config/agent.json`. The copied home had no open tool calls or running async jobs; its one queued input belonged to a paused conversation and remained queued.

Restored a SQLite backup of this seeded baseline and the affected configuration file between cases, with the daemon stopped. Faults deliberately bypassed SQLite CHECK constraints (`PRAGMA ignore_check_constraints=ON`); ordinary writes reject malformed JSON, unknown event types and invalid statuses. These are post-write corruption tests, not claims about normal write admission. No schema changes were made.

Ran `env -u NERVE_HOME -u NERVE_API_TARGET pnpm dev --slot 8`: daemon HTTP `43981`, HTTPS `43982`, UI `5180`. This command already starts Vite. An explicit `pnpm dev:ui --slot 8` attempt correctly refused the occupied UI port; observations used the UI owned by `pnpm dev`. Removed only slot 8's stale root `daemon.json` lease before launches, not `config/daemon.json`. Used a dedicated browser session. The earlier RPC-registry startup blocker was fixed separately before these experiments.

For each successful startup, opened the affected conversation, then the unrelated conversation, typed an unsent draft in its composer, and confirmed **Send prompt** was available. No test prompt was submitted and no model response was required. Also exercised snapshot/history/configuration RPCs and read-only repository probes. Startup failures make all UI/composer checks unavailable, rather than independent passes.

### Original results (before containment fixes)

Locations below refer to the investigation snapshot, before the fixes; `CC` below means `packages/conversation-core/src/` and `WS` means `packages/workbench-server/src/`.

| Case and injected fault                                    | Startup / conversation list                    | Opening affected conversation                                                                                                                                                                                                                                                        | Unrelated conversation / composer       | Isolated?                                                                          | Throwing or containing location                                                                                                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. User-event `payload = '{'`                              | Daemon exits during recovery; list unavailable | Cannot open: daemon is down                                                                                                                                                                                                                                                          | Cannot open or compose                  | **No**                                                                             | SQLite `malformed JSON` in `CC/storage/conversation.repository.ts:131`; recovery → status refresh → summary publication                                                                                  |
| 1a. Same malformed JSON, on an assistant event             | Starts; list shows ordinary **ISO BAD**        | Snapshot succeeds, history fails; UI shows raw `RpcError: Expected property name or '}'…`, without recovery actions                                                                                                                                                                  | Opens; draft entry and Send prompt work | **History RPC: yes; intended UX: no.** Replay also fails across streams; see below | `JSON.parse` in `CC/storage/conversation-event.repository.ts:285`                                                                                                                                        |
| 2a. Event type `unknown_iso_type`, otherwise valid JSON    | Starts; ordinary list entry                    | History validation fails; raw `RpcError` with discriminator/type error                                                                                                                                                                                                               | Opens; draft entry and Send prompt work | **RPC: yes; intended UX: no**                                                      | `conversationEventSchema.parse` in `CC/storage/conversation-event.repository.ts:276`                                                                                                                     |
| 2b. User-event payload `{}` (required fields absent)       | Starts; ordinary list entry                    | History validation fails; raw `RpcError` lists missing `text`, `originalText`, `source`, etc.                                                                                                                                                                                        | Opens; draft entry and Send prompt work | **RPC: yes; intended UX: no**                                                      | Same schema parse, `CC/storage/conversation-event.repository.ts:276`                                                                                                                                     |
| 3a. Image asset row retained, backing image file deleted   | Starts; list works                             | Transcript and tool-details dialog open. Image is broken; asset request returns HTTP 500 with `ENOENT`. Full tool-result JSON still loads                                                                                                                                            | Opens; draft entry and Send prompt work | **Yes**, at request/rendering boundary; poor missing-asset presentation            | `lstat` in `CC/assets/asset-store.ts:232`, via `readImage` at `:153` and `WS/adapters/http/routes/conversation-asset-routes.ts:17`                                                                       |
| 3b. Tool event references image asset ID with no asset row | Starts; list works                             | Transcript opens with broken image (HTTP 404). Tool-details dialog contains “Image asset does not belong to tool call” and **Retry**                                                                                                                                                 | Opens; draft entry and Send prompt work | **Yes**, including details failure                                                 | Image route returns 404 (`WS/adapters/http/routes/conversation-asset-routes.ts:18`); details throws in `CC/core.ts:372`                                                                                  |
| 4. Conversation `status = 'broken_iso_status'`             | Daemon exits during recovery; list unavailable | Cannot open: daemon is down                                                                                                                                                                                                                                                          | Cannot open or compose                  | **No**                                                                             | `conversationSchema.parse` in `CC/storage/conversation.repository.ts:216`, called by `listAll` at `:151`, before recovery's per-conversation work                                                        |
| 5. Conversation `config/agent.json` contains `{`           | Starts; list works                             | History remains readable. Configuration RPC reports `status: unavailable`, `code: malformed-json`, capability `agent-execution`, recovery choices `reload`, `repair`, `reset`. Composer shows Select model rather than the corrupt document's model; no conversation-wide error view | Opens; draft entry and Send prompt work | **Yes**, at configuration-scope boundary                                           | Parse is caught at `WS/infrastructure/configuration/scoped-store/scoped-document-store.ts:374–381`; context loader returns no validated context at `…/agent-configuration/conversation-context.ts:17–32` |

The malformed user-event startup failure depends on recovery needing to publish the affected summary (the seeded row's status sequence was 0 and its event sequence was 1). It is not a claim that every malformed event always stops startup. Independently, the same corrupt user event makes the project's list query fail at `conversation.repository.ts:143`: summary SQL uses unguarded `json_extract` in `LAST_PARENT_PROMPT` (`:14–20`). A catch around row mapping alone would not fix that query.

For asset cases, used a valid `read` tool-response event referencing an image and a valid full-result JSON asset. Case 3a deleted only the image file; case 3b omitted only its row. This tests missing image dependencies, not every payload/report asset consumer. Neither case justifies disabling an otherwise readable transcript.

### Original replay failure (now contained)

On case 1a, a separate authenticated conversation-channel client first read the healthy snapshot/history successfully. It then subscribed to `conv/conv_iso_bad` from `processedSeq: 0`:

```text
subscribe accepted: true; stream mode: replay; latestSeq: 1
socket close: 1011 conversation_channel_error
healthy snapshot on the same connection: FAIL socket closed 1011
```

The daemon stays up and another connection can still open the healthy conversation, but every stream/RPC sharing the failed conversation connection is disrupted. This is distinct from the successfully contained history RPC error seen when opening the conversation normally.

Replay calls `core.getEventsSince` in `WS/adapters/protocol/conversation-channel.ts:426–435`; malformed-event decoding throws at `CC/storage/conversation-event.repository.ts:285`. The connection's `onError: failed` (`conversation-channel.ts:448`) reaches the shared close at `:116–123`. Bounds resolution already omits unknown/deleted conversations independently (`:386–395`); replay/projection exceptions do not receive equivalent per-conversation treatment. Activation also reads events and projections without a per-stream catch (`:398–423`).

### Evidence and logs

Recorded fault runs were approximately 13:34–13:46 UTC on 2026-10-30. Local evidence is under `/tmp/nerve-conv-iso-evidence/` (not committed; may be removed by temporary-file cleanup). Source line numbers refer to the shared worktree at report time; concurrent edits may move them:

- `case1-daemon.log`: `Error: malformed JSON` → `ConversationRepository.getSummary:131` → `publishSummary:17` → `StatusService.refresh:86` → `recoverCore:27`; process exit 1.
- `case4-daemon.log`: `ZodError`, path `status` → `mapConversation:216` → `ConversationRepository.listAll:151` → `recoverCore:19`; process exit 1. `case4-ui.log` records connection refused.
- `case1a-rpc.log`, `case1a-bad.txt`, `case1a-replay.log`: contained history RPC error, displayed error, and cross-stream socket failure respectively.
- `case2a-probe.log` / `case2b-probe.log` and `case2a-bad.txt` / `case2b-bad.txt`: exact schema errors and read stacks. Successful startups do not necessarily log handled RPC errors; the UI/probe output is the evidence for those errors.
- `case3a-asset-http.log`: HTTP 500, `ENOENT` on the slot-8 image path. `case3b-asset-http.log`: HTTP 404. `case3b-rpc.log` and `case3b-details.txt`: contained details error.
- `case5-rpc.log`: structured unavailable configuration diagnostics; this parse failure is caught, not an unhandled daemon exception.
- `case*-composer.snapshot`: unrelated transcript/composer checks for successful-startup cases. `case*-daemon.log` and slot-8 `logs/startup.jsonl` record the launches.
- `relevant-application.jsonl`: selected asset-request errors and the replay warning, including `Conversation channel failed` with the malformed-JSON message. Asset errors include stacks through `AssetStore.read:232`; the replay warning retains the message but not a stack.

The first attempted controlled seed had a SQL placeholder-count error; that empty-home launch was discarded, the sanitized backup restored, and the seed corrected before recording the cases above. No observations from that failed setup are used as fault evidence.

### Decisions after the investigation

Startup/list and replay/activation/live containment were implemented first. The original Unavailable list/view and raw-export proposal was subsequently replaced by the simpler header activity item and confirmed raw Delete. Missing-asset response/presentation fixes are also delivered below. Scoped configuration isolation remains as investigated; this work does not change its presentation or repair historical data.

## Implemented containment and post-fix verification

### Delivered boundaries

- **Raw identity enumeration and per-conversation recovery:** `ConversationRepository.identities()` does not validate execution state. Recovery validates each row and its event records before recovering that conversation's tools, inputs and async jobs. A failure logs its conversation ID, operation and error, skips that conversation, and does not wake it. Status refresh also catches and reports a failure for its own conversation without rewriting invalid state. This does not repair persisted data or invent a valid status/payload.
- **List and summary reads:** summary JSON extraction uses `CASE WHEN json_valid(...)` for event payloads and tool interactions. Invalid conversation/summary rows are skipped individually with a diagnostic, not returned with coerced fields. Raw ancestor IDs let summary publication skip an invalid ancestor and still publish healthy ancestors. There is deliberately no Unavailable list entry: an invalid status row is omitted; a valid row with unreadable history can still appear normally.
- **Stream projection boundary:** the conversation channel validates event data and envelopes before queuing them. Initial unreadable replay uses the existing per-stream `mode: unavailable` reply. Activation, later replay pages and live event/delta projection failures log a diagnostic and remove only that stream; healthy streams and RPCs on the same connection remain usable. A later subscription can retry a repaired stream.
- **Minimal transport-neutral protocol change:** durable stream readers can return `null` for an unavailable stream. Replay removes that stream rather than interpreting it as an empty-page continuity failure and closing the connection. The replay loop also honors streams removed during activation. No wire schema or persisted schema was added. Later failures remove the server-side stream; a new unsolicited Unavailable UI notification is not part of this change. Genuine malformed protocol frames and transport/send failures retain their connection-wide handling.

Implementation owners are `packages/conversation-core/src/storage/conversation.repository.ts`, `storage/conversation-event.repository.ts`, `runtime/recovery.ts`, `runtime/status.ts`, `runtime/publish-summary.ts`, the three scoped service recovery methods, `packages/protocol/src/runtime/ports.ts` / `sessions/server-session.ts`, and `packages/workbench-server/src/adapters/protocol/conversation-channel.ts`. Daemon composition supplies the diagnostic logger in `app/bootstrap/create-conversation-core.ts`.

### Slot-8 recheck

Restored the same sanitized seeded database/configuration between each requested case with the daemon stopped. Every launch used `env -u NERVE_HOME -u NERVE_API_TARGET pnpm dev --slot 8`; its owned UI was used at port 5180. Rechecked all project/working-directory paths before launching. No test prompt was submitted to a provider.

| Case                               | Daemon and list after fixes                                     | Affected conversation                                                                                                       | Unrelated conversation and shared connection                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: malformed user-event JSON       | Starts; project list returns 161 entries                        | Recovery logs/skips corrupt history; opening history still shows a local raw error (UI follow-up)                           | Healthy transcript/composer work. Bad stream is unavailable; healthy event replay, snapshot RPC and live config notification all arrive on the same connection |
| 1a: malformed assistant-event JSON | Starts; list returns 161 entries                                | Same local history error; no shared socket close                                                                            | Same healthy transcript/composer and shared replay/RPC/live-notification checks pass                                                                           |
| 2a: unknown event type             | Starts; list returns 161 entries                                | Recovery logs/skips invalid event; history returns `DOMAIN_VALIDATION_FAILED` locally                                       | Same healthy transcript/composer and shared replay/RPC/live-notification checks pass                                                                           |
| 4: invalid conversation status     | Starts; list returns 160 entries, omitting only the invalid row | Direct snapshot/configuration RPCs reject that row. SQL confirms `broken_iso_status` and status sequence 0 remain unchanged | Healthy entry remains selectable; transcript/composer work. Bad stream is unavailable; shared healthy replay/RPC/live-notification checks pass                 |

For every case, a single authenticated client subscribed to both bad and healthy streams from sequence 0, received the healthy durable event, successfully read the healthy snapshot, then received a stream-scoped `conversation.config` notification after a non-executing working-directory configuration call. This checks continuing live delivery, not just the absence of a disconnect. The connection was closed intentionally only after these checks. Browser verification typed an unsent draft and observed the enabled Send prompt control in the healthy conversation.

The copied home also contains pre-existing histories that fail the current event schema (for example, missing `interactionResolution.confirmation`). Recovery now logs/skips those too; these fixes do not repair or coerce their historical data.

Post-fix evidence remains under `/tmp/nerve-conv-iso-evidence/`: `fixed-case{1,1a,2a,4}-daemon.log`, matching `-rpc.log` and `-composer.snapshot`, and `fixed-application.jsonl`. The latter contains conversation-scoped skip diagnostics and stream-unavailable warnings; healthy replay/live evidence is in each RPC log. Initial malformed-JSON errors and invalid-status errors no longer reach the daemon startup failure path.

### Regression validation and remaining work

Owning-layer unit coverage:

- `packages/conversation-core/src/storage/conversation-isolation.test.ts`: malformed JSON/interaction summary reads, invalid-row omission without coercion, ancestor publication/status containment, and independent recovery/wake failure handling.
- `packages/workbench-server/src/adapters/protocol/conversation-channel.test.ts`: independent resolver, activation and later replay failures; live payload/envelope/delta failures; healthy shared RPC and stream delivery; genuine malformed-frame and transport-write connection closure.
- `packages/protocol/test/streams/subscription-recovery.test.ts`: unavailable reader results and activation-time stream removal do not silence healthy replay/live delivery.

At the first containment checkpoint, all 65 relevant unit tests passed (42 conversation-core, 15 protocol, 8 conversation-channel), as did `pnpm fix:focused --base HEAD` and `pnpm check:focused --base HEAD`. No broad test suites were run. Servers/browser sessions were stopped and slot 8 restored to the seeded baseline at that checkpoint. The follow-up below recreated slot 8 from the specified pristine dataset.

## Follow-up plan sections 3 and 4: delivered

### Design and ownership

- `ConversationRepository`'s failure reporter now covers later row/history reads as well as startup recovery. `UnreadableConversationActivity` deduplicates failed IDs in memory and publishes one producer-owned, non-dismissable/non-evictable activity. It reads title/project metadata through `rawIdentity`, not the failing projection, and reduces schema failures to a concise first-issue summary.
- The existing activity service, snapshot/event transport and activity popover carry/render the item. Activity metadata has an optional `unreadableConversations` collection; the **conversation schemas/list contracts are unchanged**. `activity.deleteConversation` is the only new operation, and accepts deletion only for a reported ID. The existing ConfirmDialog is used; the popover closes before the confirmation opens.
- Conversation deletion now has one raw-identity path for regular and unreadable conversations. It enumerates descendants with duplicate-safe SQL, fences/aborts runners and tool workers, cancels queued preparation and owned async processes, removes the conversation directories, and lets SQLite cascade the raw rows. It does not decode corrupt event, queue or tool-argument payloads or validate the broken conversation row. Completed/unverifiable process references are never blindly cancelled. Existing asset-path safety checks remain intact. Redundant per-asset row deletion and the second recursive file-removal loop were removed. No database schema or persistent dismissal state was added.
- A public-catalog regression test scans qualified literal server publications and all declared server event definitions (including callback-published names). Project configuration publication failures now log at **error**, not warning.
- `MissingAssetError` distinguishes missing rows/backing files from ownership/integrity errors. The image route returns `404 { error: { code: "ASSET_NOT_FOUND", message: "Asset not found." } }`, without an absolute path. Conversation-channel result reads map missing assets to `RESOURCE_NOT_FOUND`; another tool/conversation's image still produces the distinct ownership error. Read-card and agent-preview images reuse `ToolImage` and show **Image unavailable** on load failure.

### Fresh slot-8 live verification

Created the assigned slot with the requested commands:

```sh
env -u NERVE_HOME -u NERVE_API_TARGET pnpm storage:copy --from data/storage-0-37-0 --slot 8
env -u NERVE_HOME -u NERVE_API_TARGET pnpm storage:migrate --home data/storage-8
```

Rewrote every copied project directory and conversation working directory to nonexistent `/tmp/conv-resilience-missing-*` paths before any daemon launch. Checked configuration paths. Opened only the copied database to apply the core SQL upgrade, then re-sanitized its new working-directory column. Removed the copied queued input as an additional safety measure; there were no open tool calls or running async jobs. Pristine datasets and protected homes were not used as runnable homes.

Started and restarted only with `env -u NERVE_HOME -u NERVE_API_TARGET pnpm dev --slot 8` (HTTP 43981, UI 5180). No real provider request was made. Injected controlled faults after migration, each with a child and deletion-marker/config files:

| Check                                            | Observed result                                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fault 1, `conv_000_fault1`: malformed event JSON | Daemon starts; the single activity item shows **Fault 1: unreadable JSON**, project **nerve**, and the JSON parse summary                                                              |
| Fault 4, `conv_000_fault4`: invalid status       | Daemon starts; the same item shows **Fault 4: invalid row**, project **nerve**, and the status validation summary                                                                      |
| Cancel                                           | Confirmation appears; Cancel preserves the row, child and files. Repeated with the final popover/confirmation flow                                                                     |
| Confirmed Delete for both faults                 | Both parents, both descendants and all four directories disappear, without validating the invalid status or replaying corrupt history                                                  |
| Restart                                          | Both fault families remain absent from SQL, files and the activity payload                                                                                                             |
| Later read failure                               | Corrupted the disposable healthy probe after startup; a history RPC immediately added it to the existing activity item. Cancel preserved it; confirmed Delete removed it and its files |
| Missing backing image                            | HTTP 404 with `ASSET_NOT_FOUND`, no absolute path; transcript displays an accessible **Image unavailable** placeholder rather than a broken image                                      |
| Healthy conversation                             | Transcript opens and the composer accepts an unsent draft with Send prompt available before the later-read corruption test                                                             |

The copied dataset independently contains 82 schema-invalid historical conversations. They were not repaired or deleted. Thus the one notice counted **84 → 83 → 82** as the two controlled faults were deleted; its ID stayed stable within that daemon. Restart rebuilt one notice for the same 82 pre-existing failures, with neither controlled fault present. The later-read test temporarily changed it to 83 and deletion returned it to 82.

Evidence is local under `/tmp/nerve-conv-iso-evidence/`: `followup-copy.log`, `followup-migrate.log`, `followup-live.log`, `followup-restart.log`, `followup-activity-before.json`, `followup-after-delete1.json`, `followup-after-delete-both.json`, `followup-after-restart.json`, `followup-later-read.log`, `followup-later-activity.json`, `followup-after-later-delete.json`, `followup-delete-confirm.snapshot`, `followup-missing-asset-http.log`, `followup-missing-image.png`, `followup-healthy-composer.snapshot`, and filtered `followup-application.jsonl`.

All task-owned daemon/UI/browser processes were stopped. Slot 8 is retained, migrated and sanitized, with the controlled deletions preserved and the missing-image probe available for inspection; it was not restored in a way that would resurrect deleted rows.

### Follow-up regression coverage

Owning-layer tests cover raw recursive deletion of invalid status/history and malformed queued/tool payloads, active-worker abortion/fencing, safe async-process handling, later-read reporting, aggregation/retention/deletion failure handling, notification mapping, typed missing-asset responses and distinct ownership errors, plus server event-catalog membership. Existing lifecycle, activity reconciliation and conversation-channel tests were also run. The selected unit runs passed: 6 contracts, 43 conversation-core, 19 server and 29 application tests (97 total). Owning-file formatting/lint, selected package/type checks, repository policy checks and migration integrity passed. `pnpm check:focused --base HEAD` currently stops on formatting in the concurrently edited proposal `README.md`; that out-of-scope file was left untouched. The focused autofix plan was previewed, but repository-wide/shared-file autofix was not used to rewrite another agent's changes. The lead must format that file and rerun `pnpm fix:focused && pnpm check:focused`. Exact commands/results are in the task handoff; no full or browser test suites were run.
