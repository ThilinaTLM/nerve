# Event streams

An `event.batch` contains an ordered range for one stream and catalog-valid event envelopes. Each event has a sequence, durability (`durable` or `transient`), type, timestamp, and typed data.

Implemented streams are:

- `local`, written by the workbench server;
- `manager`, written by sandbox-manager lifecycle/state services;
- one `sandbox:<id>` stream per sandbox, written by that sandbox daemon and ingested without sequence rewriting.

There is exactly one sequence writer per stream. Consumers deduplicate by stream and sequence. Durable events are reducer/state transitions and are recoverable. Transient events, including `task.output`, are bounded live signals; durable task logs are stored by the task service and queried with `task.logs` or the host's large-log HTTP surface.

A client applies each event in order. It advances the processed durable cursor only after the reducer and any required durable application complete. Reducer failure prevents ACK and triggers recovery rather than acknowledging lost state.
