# Errors and security

The canonical error registry is `nerveErrorCodeSchema` in `@nervekit/contracts`; it includes framing/version/auth/target/catalog failures, conflicts, rate/queue limits, replay/snapshot failures, `BOOTING`, service availability, timeout, and internal errors.

Errors expose a safe code, bounded message, retryability, and optional redacted details. They must not contain credentials, tokens, cookies, authorization headers, secret values, raw environment values, or unbounded command/log output. Envelope metadata rejects secret-like keys.

Security requirements:

- authenticate and authorize at the transport boundary and again by operation/target capability;
- validate every envelope and method params/result/event with contract schemas;
- cap message, batch, queue, replay, timeout, metadata, and error sizes;
- require catalog idempotency policy and keys before retrying mutations;
- use loopback by default for local services; remote binding is explicit and authenticated;
- redact structured logs and diagnostics;
- keep secrets in host secret stores or protected launch files, never protocol snapshots/events;
- reject cursor/stream identities the authenticated peer does not own.

Unexpected internal errors map to a bounded public error while full diagnostics remain in protected server logs.
