# Sandbox persistence and recovery

The daemon uses version-4 file-first state under `/state`. It takes a single-writer lock and uses atomic JSON, fsynced JSONL, and protected secret/config files.

The layout contains sanitized config, controller connectivity, protected credentials and launch environments, setup status, idempotency records, the dense sequenced event outbox and high-water metadata, context/skills metadata, boot attempts, caches, and run/task journals and checkpoints.

Sequenced transitions are persisted before publication. Ephemeral notifications are never stored in the outbox. On reconnect, the daemon compares its high-water with the manager's authorized `sandbox:<id>` bounds, publishes the missing suffix, and truncates only manager-confirmed records. Recovery validates the marker, restores journals/checkpoints/tasks, reconciles incomplete work, and reconnects.

The manager persists its own dense `manager` stream and ingested sandbox streams in PostgreSQL. The browser installs cursor-bearing manager/sandbox snapshots before subscribing. Legacy sparse event tables and ACK-era outboxes are archived as a pre-dense epoch and reset; they are not translated by compatibility readers.
