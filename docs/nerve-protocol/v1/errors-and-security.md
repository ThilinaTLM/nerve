# Errors and Security

Nerve Protocol v1 defines a stable error envelope and security requirements that apply across transport bindings. Transport-specific authentication and connection security remain defined by each binding, but protocol messages must be safe to parse, log, and evolve.

## `error`

Direction: either.

Purpose: report protocol, validation, authorization, replay, flow-control, or domain errors.

```ts
type ErrorData = {
  code: NerveErrorCode;
  message: string;
  retryable: boolean;
  close?: boolean;
  details?: Record<string, unknown>;
  recovery?: {
    action:
      | "none"
      | "retry"
      | "reconnect"
      | "reload"
      | "load_snapshot"
      | "reauthenticate"
      | "contact_support";
    retryAfterMs?: number;
    method?: string;
  };
};
```

Requirements:

- `code` MUST be stable and machine-readable.
- `message` SHOULD be human-readable but MUST NOT be required for program behavior.
- `message` MUST NOT contain secrets.
- `retryable` MUST indicate whether repeating the same operation later might succeed.
- `close: true` means the sender intends the session to close or become unusable after this error.
- `details` MUST contain only safe, bounded, structured data.
- `replyTo` SHOULD reference the message that caused the error when applicable.

## Error code registry

### Protocol and parsing

| Code | Retryable | Meaning |
| --- | --- | --- |
| `INVALID_JSON` | false | Frame/body could not be parsed as JSON. |
| `INVALID_MESSAGE` | false | Envelope or payload failed protocol validation. |
| `UNKNOWN_MESSAGE_KIND` | false | Receiver does not recognize `kind`. |
| `PROTOCOL_VERSION_UNSUPPORTED` | false | Unsupported `version`. |
| `CAPABILITY_REQUIRED` | false | Required capability is missing. |
| `CAPABILITY_NOT_NEGOTIATED` | false | Peer used an unaccepted capability. |
| `MESSAGE_TOO_LARGE` | false | Message exceeds configured size limits. |
| `RATE_LIMITED` | true | Peer is sending too many messages. |

### Session and transport

| Code | Retryable | Meaning |
| --- | --- | --- |
| `SESSION_REJECTED` | maybe | Server refused the protocol session. |
| `SESSION_EXPIRED` | true | Session is no longer valid; reconnect. |
| `SESSION_NOT_FOUND` | true | Referenced session is unknown or already closed. |
| `TRANSPORT_UNAVAILABLE` | true | Transport cannot currently carry the message. |
| `HEARTBEAT_TIMEOUT` | true | Liveness timeout occurred. |
| `SERVER_SHUTTING_DOWN` | true | Orchestrator is shutting down. |
| `SERVER_BUSY` | true | Orchestrator is overloaded. |

### Authentication and authorization

| Code | Retryable | Meaning |
| --- | --- | --- |
| `AUTH_REQUIRED` | maybe | Missing authentication. |
| `AUTH_INVALID` | maybe | Authentication material is invalid. |
| `AUTH_EXPIRED` | true | Authentication expired and can be refreshed. |
| `AUTH_FORBIDDEN` | false | Authenticated peer lacks permission. |
| `ORIGIN_FORBIDDEN` | false | Origin is not allowed. |
| `POLICY_DENIED` | false | Operation denied by Nerve policy. |

### Replay and event stream

| Code | Retryable | Meaning |
| --- | --- | --- |
| `REPLAY_UNAVAILABLE` | maybe | Requested replay cannot be served. |
| `CURSOR_TOO_OLD` | false | Cursor is older than retention; snapshot needed. |
| `CURSOR_AHEAD_OF_SERVER` | false | Client cursor is incompatible with server state. |
| `STREAM_NOT_FOUND` | false | Requested stream does not exist. |
| `EVENT_GAP_DETECTED` | true | Receiver detected a sequence gap. |
| `ACK_INVALID` | false | Ack cursor is invalid or malformed. |
| `RESYNC_REQUIRED` | true | Client must reload snapshot or reconnect. |

### Request/response and domain

| Code | Retryable | Meaning |
| --- | --- | --- |
| `METHOD_NOT_FOUND` | false | Protocol request method is unknown. |
| `VALIDATION_FAILED` | false | Request params failed validation. |
| `DOMAIN_VALIDATION_FAILED` | false | Domain-specific validation failed. |
| `RESOURCE_NOT_FOUND` | false | Requested resource does not exist. |
| `CONFLICT` | maybe | Operation conflicts with current state. |
| `IDEMPOTENCY_CONFLICT` | false | Idempotency key reused with different params. |
| `OPERATION_CANCELLED` | maybe | Operation was cancelled. |
| `OPERATION_TIMEOUT` | true | Operation timed out. |
| `INTERNAL_ERROR` | true | Unexpected server error. |
| `SERVICE_UNAVAILABLE` | true | Required service is unavailable. |

Implementations MAY add domain-specific codes, but common client behavior SHOULD be based on this registry where possible.

## Error handling rules

### Sender rules

A sender SHOULD include:

- stable `code`;
- concise `message`;
- `retryable` value;
- `recovery.action` when useful;
- `replyTo` or `correlationId` when the error responds to a message;
- redacted structured details.

A sender MUST NOT include:

- daemon tokens;
- provider API keys;
- OAuth credentials;
- raw secret values;
- full unredacted request headers;
- unbounded stack traces in protocol messages.

### Receiver rules

A receiver SHOULD:

- use `code` and `recovery` for behavior;
- show `message` to users only when appropriate;
- log error code, correlation, and safe details;
- close or reconnect when `close: true`;
- avoid retry loops when `retryable: false`.

A receiver MUST NOT assume `details` has a particular schema unless the error code defines it.

## Robust parsing

Protocol parsers are part of the security boundary.

Requirements:

- Reject non-object top-level JSON values.
- Enforce maximum frame/body size before or during parse where possible.
- Validate envelope before dispatch.
- Validate payload schema by `kind`.
- Reject unsupported protocol versions.
- Rate-limit repeated malformed messages.
- Close sessions after severe or repeated protocol violations.
- Treat unknown domain payloads as untrusted until validated.

Implementations SHOULD avoid throwing uncaught exceptions from message handlers. Unexpected handler failures SHOULD become `INTERNAL_ERROR` or local logs, depending on context.

## Authentication

Authentication is transport-binding specific.

### WebSocket binding

The WebSocket binding SHOULD authenticate during the HTTP upgrade using the existing daemon token mechanism.

Requirements:

- Unauthenticated upgrades MUST be rejected before a protocol session is established.
- Browser-origin checks SHOULD be enforced for remote/LAN access.
- Protocol `hello` identity fields MUST NOT be accepted as authentication proof by themselves.
- Auth failures SHOULD not reveal sensitive details.

### HTTP binding

HTTP protocol endpoints SHOULD use the same authentication policy as existing Nerve API routes.

Requirements:

- Secret-submission endpoints MUST use the existing credential encryption pattern where applicable.
- Protocol envelopes MUST NOT place auth tokens inside `data`, `meta`, or tracing fields.
- HTTP status codes SHOULD align with protocol error codes.

Existing REST/resource endpoints that are not wrapped in protocol envelopes SHOULD still use protocol-compatible error codes where practical. For example, a REST validation failure can remain an HTTP `400` while using an error body/code that maps to `VALIDATION_FAILED`; an authorization denial can map to `POLICY_DENIED`; an unavailable replay range can map to `REPLAY_UNAVAILABLE` or `CURSOR_TOO_OLD`.

## Authorization and policy

The orchestrator owns dangerous capabilities, secrets, tools, policies, and storage. UI clients are not trusted to enforce safety.

Requirements:

- Tool execution policy MUST be enforced in orchestrator/tool layers.
- Frontend code MUST NOT receive provider API keys or raw secrets.
- Protocol requests that trigger tools, file writes, shell commands, credentials, or agent actions MUST pass orchestrator policy checks.
- Client-advertised role/capabilities MAY influence UI behavior but MUST NOT bypass server policy.

## Secret handling

Protocol messages MUST be safe for routine structured logging after redaction.

Forbidden in protocol metadata and ordinary event payloads:

- daemon tokens;
- provider API keys;
- OAuth refresh/access tokens;
- passwords;
- private keys;
- raw credential envelopes after decryption;
- unredacted environment variables likely to contain secrets.

If a domain operation must submit a secret, it MUST use a dedicated secure API and documented encryption/handling path. The decrypted secret MUST remain in orchestrator/tool layers.

Current secret-sensitive examples:

- Provider API key submission MUST use the credential encryption/public-key path or another documented secure endpoint. The event stream may publish `secrets.provider_key_set` or `auth.providers_changed` metadata, never the key.
- OAuth flows may expose flow IDs, provider IDs, status, and user-facing instructions. Access tokens, refresh tokens, authorization codes, cookies, and provider headers MUST remain in auth/orchestrator internals.
- Tool execution requests may include user-supplied arguments, but policy checks and secret injection happen in the orchestrator/tool layer. Frontend code must not receive resolved provider credentials or dangerous hidden capability details.

## Redaction

Implementations SHOULD redact fields whose names match secret-like patterns before logging:

```text
authorization
cookie
token
apikey
api_key
password
passwd
secret
credential
private_key
private-key
```

Redaction SHOULD be recursive and bounded. Very large payloads SHOULD be summarized by size and schema name rather than logged.

Logs and client-submitted diagnostic logs MUST be bounded and redacted before storage or protocol forwarding. Protocol errors should reference log IDs, task IDs, artifact paths, or trace IDs rather than embedding large stack traces, command output, or file contents.

## Origin and remote access

For browser clients:

- local loopback access can use local daemon token policy;
- LAN/remote access SHOULD require explicit opt-in;
- HTTPS SHOULD be used for remote/mobile browser access where secure-context browser features are needed;
- origin checks SHOULD reject unexpected web origins;
- CORS policy SHOULD be narrow.

Protocol messages do not replace these transport/browser protections.

Feature-specific security examples:

- Filesystem reads and Git operations must be authorized and resolved by the orchestrator against known project roots or explicit policy. Protocol schemas do not make a path safe.
- Audio upload, clipboard images, conversation exports, and large file reads should remain resource endpoints with explicit size/content-type limits in v1.
- GitHub/OAuth operations may involve browser redirects or provider credentials; protocol messages should carry only safe status and correlation metadata.

## TLS and secure contexts

The protocol itself is encoding-agnostic and does not mandate TLS. Transport bindings SHOULD require or strongly recommend TLS when:

- access is not loopback-local;
- mobile browsers are used;
- microphone or other secure-context browser APIs are needed;
- traffic crosses untrusted networks.

Self-signed local CA flows are a transport/deployment concern and should not affect protocol message semantics.

## Denial-of-service protections

Implementations SHOULD protect against accidental or malicious overload:

- maximum message size;
- maximum batch size;
- maximum messages per second from a client;
- maximum replay range without snapshot;
- maximum concurrent replay operations per session;
- maximum queued bytes per session;
- heartbeat timeout;
- malformed-message strike limit;
- bounded error detail size.

When limits are exceeded, use errors such as `MESSAGE_TOO_LARGE`, `RATE_LIMITED`, `SERVER_BUSY`, or `RESYNC_REQUIRED`.

## Unknown clients and compatibility

A server MAY support legacy clients temporarily, but once a connection is identified as protocol v1:

- every frame/message MUST use the v1 envelope;
- legacy raw event frames MUST NOT be mixed with protocol messages;
- unsupported clients SHOULD receive a clear error or transport close reason when possible.

## Safe observability

Protocol logs SHOULD include:

- message `id`;
- `kind`;
- session ID;
- client ID/instance ID;
- stream and sequence ranges for batches;
- error code;
- flow mode transitions;
- replay IDs and ranges;
- counts and byte sizes.

Protocol logs SHOULD NOT include full event payloads by default. Payload logging MAY be enabled for development with redaction and size limits.

## Error examples

See [Examples](./examples.md) for validation, replay unavailable, and auth-related error examples.
