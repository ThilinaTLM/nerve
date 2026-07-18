# Errors and security

The canonical error registry is `nerveErrorCodeSchema` in `@nervekit/contracts`; it covers framing, version, authentication, target/catalog failures, conflicts, rate/queue limits, snapshot requirements, booting, service availability, timeout, and internal errors.

Errors expose a safe code, bounded message, retryability, and optional redacted details. They must not contain credentials, tokens, cookies, authorization headers, secret values, raw environment values, or unbounded command/log output. Envelope metadata rejects secret-like keys.

Security requirements:

- authenticate at the transport boundary and authorize each operation, target, and requested stream set;
- validate every envelope, operation parameter/result, sequenced event, and notification with contract schemas;
- cap messages, batches, buffers, stream reads, timeouts, metadata, and errors;
- require catalog idempotency policy and keys before retrying mutations;
- use loopback by default for local services; remote binding is explicit and authenticated;
- redact structured logs and diagnostics;
- keep secrets in host stores or protected launch files, never snapshots or events;
- reject cursor or stream identities the authenticated peer does not own.

Unexpected internal errors map to bounded public errors while full diagnostics remain in protected server logs.
