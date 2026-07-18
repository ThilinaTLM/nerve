# Subscription and recovery

A `StreamCursor` is `{ stream, processedSeq }`. It means every sequenced event through `processedSeq` has been successfully applied for that stream.

## Resume

Reconnect does not carry cursors in `hello`. After ready, the client sends its current exact cursor set through `stream.subscription.set`. The server resolves each cursor against `{ latestSeq, earliestAvailableSeq }`:

- equal to `latestSeq`: `live`;
- behind but still retained: `replay`;
- ahead of `latestSeq`, or older than `earliestAvailableSeq - 1`: `snapshot_required`.

For replay, the server reads from `processedSeq + 1` in bounded dense pages. Events arriving while that stream replays are buffered and released afterward. Streams recover independently.

## Defensive gaps

The client validates dense continuity even after the server accepted a subscription. If a batch starts after the expected next sequence, the client does not advance its cursor and automatically reinstalls subscriptions from the last applied cursor.

## Snapshots

For `snapshot_required`, the application loads the authorized snapshot for that stream, installs snapshot state first, installs the snapshot cursor, and then resubscribes. Workbench recovery uses workspace or conversation snapshots; the manager UI uses manager/sandbox recovery snapshots.

Reducer lifecycle violations use the same recovery boundary: mark state corrupted, remove or suspend the affected stream, load a fresh snapshot, then subscribe from that snapshot cursor.

## Retention and migration

Stream readers expose their earliest retained sequence. A retention gap is never represented as a synthetic event or sparse sequence. Legacy sparse logs and manager event tables are archived into a pre-dense epoch and new streams begin from sequence 1.
