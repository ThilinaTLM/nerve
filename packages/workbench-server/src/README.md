# Workbench server

The composition root in `app/bootstrap` combines the portable conversation core
with environment host ports and workbench services.

- `core-host/` resolves models, resources, permissions, local tools and processes.
- `conversation-core` owns projects, trusted resources, conversations and history
  in `data/core.sqlite`. The legacy `data/nerve.sqlite` is never opened by runtime.
- `domains/tasks/application/launch.service.ts` owns in-memory workbench launches;
  saved definitions remain project files. Launches are not recovered after restart.
- `infrastructure/events/` publishes best-effort workbench notices with no durable
  event log or retained payloads.
- `infrastructure/core-import/` is the explicit, independent legacy import path.

`/ws/workbench` serves workbench RPC and ephemeral notices. Conversation channel
endpoint integration is separate from the removed legacy `/ws` endpoint.
