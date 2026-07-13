# Sandbox events

Event types and payloads come from the shared event catalog in `@nervekit/contracts`. Sandbox lifecycle, setup, conversation, interaction, run, tool, task, Git-related invalidation, and diagnostic events are typed before publication and again at manager ingestion.

Durability is catalog-defined. Durable transition events are written to the sandbox outbox before delivery and retain their sequence in manager storage. High-volume progress such as model/tool deltas and `task.output` is transient and bounded. Durable task output is the task log store queried through task log APIs, not the transient event.

Each envelope includes stream identity through its containing batch. Sandbox payloads include entity IDs needed by reducers but never credentials or raw launch environments. Manager lifecycle data is emitted on `manager`; daemon data is emitted on `sandbox:<id>`.
