# Sandbox security

The reference agent image runs as `sandbox:sandbox` (UID/GID 10001 by default), with immutable `/agent`, writable `/workspace`, `/state`, and `/tmp`, and protected `/state`/credentials. Runtime launch applies non-root execution, no-new-privileges, dropped capabilities, resource/PID limits, and read-only root when the selected profile enables it.

Secrets remain in manager stores, mounted protected files, or narrowly scoped process environments. They are excluded from snapshots, events, task metadata, errors, diagnostics, and logs. PostgreSQL secret storage requires an encryption key unless explicit development cleartext mode is enabled.

All manager APIs and protocol transports authenticate; operation authorization checks role, target, sandbox ownership, capability, and policy. Paths are normalized beneath allowed roots. Remote manager binding is explicit. Container runtime sockets are privileged infrastructure and must not be mounted into the sandbox agent.

Images contain production dependencies and static assets, not repository history, local state, credentials, release tarballs, tests, or caches.
