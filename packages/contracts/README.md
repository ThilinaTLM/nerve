# `@nervekit/contracts`

Transport-neutral runtime and product contracts.

- `identity/`, `errors/`: shared IDs and API failures.
- `events/`: event envelopes, definitions, routing, lifecycle, and catalog.
- `wire/`: protocol message/session/RPC/stream wire shapes.
- `operations/`: operation definitions and the verified catalog.
- `snapshots/`: aggregate runtime read models.
- `domains/<domain>/`: domain records, operations, events, and policies.

Schema symbols retain `Schema` names; filenames name the represented concept. Host helpers, transport mechanics, persistence, and UI state do not belong here. The package root intentionally exports only IDs and API errors; import domain contracts, events, wire shapes, operations, and snapshots from their explicit subpaths.
