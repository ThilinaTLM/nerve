# Implementation status

Protocol v1 is the only implemented wire protocol for the three production links.

- Strict contracts, operation/event catalogs, codec, message factory: complete.
- Shared client/server lifecycle, heartbeat, goodbye, reconnect: complete.
- Processed ACK, chunked replay, live buffering, flow control, queue bounds: complete.
- Snapshot recovery with exact cursor installation: complete.
- Workbench `local` stream and durable state recovery: complete.
- Manager `manager` and per-sandbox streams with independent cursors: complete.
- Manager-to-sandbox target forwarding and sequence preservation: complete.
- HTTP/WebSocket typed handler parity for shared RPC surfaces: complete.
- Conformance, link integration, host parity, persistence, and overflow coverage: present in package tests.

Large binary/file/log bodies, OAuth redirects, secrets, bootstrap configuration, health, and static assets intentionally remain outside protocol RPC as documented in [HTTP mapping](http-mapping.md).
