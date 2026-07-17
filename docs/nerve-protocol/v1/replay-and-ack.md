# Replay, ACK, and snapshots

Clients resume with per-stream `{ stream, processedSeq }` cursors. The server compares each cursor with durable replay bounds.

- Valid missing ranges produce chunked `replay.started`, `event.batch`, and `replay.complete` messages.
- Live events arriving during replay are buffered and released after replay, preserving order.
- Too-old, ahead-of-server, missing, unavailable, or oversized ranges produce `replay.unavailable` with an explicit recovery action.
- Snapshot recovery loads a state snapshot with cursors, installs state first, then atomically resets all affected stream trackers and persists those exact cursors. Delta replay continues from cursor + 1.
- For a dynamic subscription, the client installs the snapshot cursor before requesting the new exact stream set. The server marks replay before acknowledging the update, so live events are buffered behind replay.

`event.ack` reports processed durable cursors. A sender treats a durable event as in flight after writing its batch and does not resend it on that connection before ACK; reconnect resets sent progress to the persisted ACK and replays the remaining durable journal. It may also report received high-water marks and bounded statistics, but received bytes are not equivalent to applied durable state. The server rejects an ACK beyond durable progress sent on that session.

The manager UI tracks `manager` independently from the selected `sandbox:<id>` cursor. Selecting another sandbox establishes the exact stream and snapshot cursor for that sandbox; it does not collapse all progress into one cursor.
