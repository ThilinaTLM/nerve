# HTTP Mapping

Nerve Protocol v1 can be mapped onto HTTP request/response APIs. This mapping is optional and incremental. Existing REST-style endpoints can continue to exist while new or migrated endpoints adopt the protocol envelope.

The HTTP mapping has two goals:

1. Reuse the same envelope, error model, tracing, idempotency, and schema strategy across streaming and request/response APIs.
2. Avoid forcing event-stream frames onto APIs where ordinary resource endpoints are clearer.

## Compatibility position

The protocol does **not** require rewriting all HTTP endpoints.

Recommended migration model:

- Keep existing resource-oriented HTTP endpoints where they are simple and stable.
- Add protocol-enveloped HTTP endpoints for APIs that benefit from correlation, idempotency, typed errors, streaming, or future transport portability.
- Reuse protocol error codes and metadata even in non-enveloped endpoints where practical.

## Content types

Baseline JSON mapping:

```http
Content-Type: application/json
Accept: application/json
```

Optional explicit protocol content type:

```http
Content-Type: application/vnd.nerve.protocol.v1+json
Accept: application/vnd.nerve.protocol.v1+json
```

Implementations MAY use the explicit content type for protocol-only endpoints. During migration, regular `application/json` is acceptable when the endpoint path clearly identifies protocol semantics.

## Endpoint styles

Three HTTP styles can coexist.

### 1. Existing REST/resource endpoints

Example:

```http
GET /api/status
POST /api/conversations
```

These endpoints do not need to wrap every body in `NerveMessage`. They SHOULD still use stable shared schemas and protocol-compatible error codes where feasible.

### 2. Protocol RPC endpoint

Example:

```http
POST /api/protocol/v1
```

The request body is a protocol `request` message. The response body is a protocol `response` or `error` message.

### 3. Protocol-specific resource endpoints

Example:

```http
POST /api/protocol/v1/replay
POST /api/protocol/v1/snapshot/workspace
```

These endpoints use protocol envelopes but keep resource-specific routing for clarity, caching, or streaming behavior.

## `request`

Direction: client → orchestrator or orchestrator → peer in future bindings.

Purpose: represent an RPC-style operation in the common protocol envelope.

```ts
type RequestData = {
  method: string;
  params?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
  expect?: {
    response?: "single" | "stream" | "accepted";
    events?: boolean;
  };
};
```

Requirements:

- `method` MUST be a non-empty dot-separated string.
- `params` MUST conform to the method schema.
- `idempotencyKey` SHOULD be provided for retryable mutation requests.
- `timeoutMs` is advisory; the server MAY enforce a different maximum.
- `expect.response` defaults to `single`.

Method naming examples:

```text
workspace.get
conversation.create
conversation.sendPrompt
task.cancel
settings.update
auth.provider.setKey
snapshot.workspace.get
```

HTTP method mapping:

- Protocol RPC requests SHOULD use HTTP `POST`, even for reads, because the envelope includes method dispatch and may carry complex params.
- Resource-specific protocol endpoints MAY use normal HTTP verbs.

## `response`

Direction: responder → requester.

Purpose: represent a successful response to a protocol `request`.

```ts
type ResponseData = {
  ok: true;
  method: string;
  result: unknown;
  cursor?: {
    streams: StreamCursor[];
  };
  events?: EventEnvelope[];
};
```

Requirements:

- `ok` MUST be `true`.
- `method` MUST match the request method.
- `result` MUST conform to the method response schema.
- `replyTo` SHOULD be set to the request message `id`.
- `correlationId` SHOULD match the request message `id` or operation correlation ID.

### Response cursors

If a response returns materialized state that corresponds to event stream state, it SHOULD include `cursor.streams`.

Example: a workspace snapshot response includes the stream sequence at which the snapshot is valid. The client then applies event deltas after that cursor.

### Response events

A response MAY include domain events that were produced by the request, but event streaming over WebSocket remains the preferred delivery path for live UI updates.

If events are included in an HTTP response:

- they MUST use the same `EventEnvelope` schema;
- they MUST be ordered;
- the client MUST deduplicate them against stream-delivered events;
- the response SHOULD include cursor metadata.

## Error responses

Protocol HTTP endpoints SHOULD return an `error` message body for protocol/application errors.

HTTP status code guidance:

| HTTP status | Protocol code examples |
| ---: | --- |
| 400 | `INVALID_MESSAGE`, `VALIDATION_FAILED` |
| 401 | `AUTH_REQUIRED`, `AUTH_INVALID` |
| 403 | `AUTH_FORBIDDEN`, `POLICY_DENIED` |
| 404 | `METHOD_NOT_FOUND`, `RESOURCE_NOT_FOUND` |
| 409 | `CONFLICT`, `IDEMPOTENCY_CONFLICT` |
| 413 | `MESSAGE_TOO_LARGE` |
| 422 | `DOMAIN_VALIDATION_FAILED` |
| 429 | `RATE_LIMITED`, `SERVER_BUSY` |
| 500 | `INTERNAL_ERROR` |
| 503 | `SERVICE_UNAVAILABLE`, `REPLAY_UNAVAILABLE` |

Transport-level status and protocol-level error codes should agree where possible. Clients SHOULD primarily use protocol error codes for application behavior.

## Idempotency

Retryable mutation requests SHOULD include `data.idempotencyKey`.

```ts
type IdempotencyKey = string;
```

Requirements:

- The key MUST be unique for the logical operation from the client's perspective.
- The server SHOULD cache the result or terminal error for a bounded period.
- If a request with the same key and equivalent params is repeated, the server SHOULD return the same result.
- If the same key is reused with different params, the server MUST reject with `IDEMPOTENCY_CONFLICT`.
- Idempotency state MUST be scoped by authenticated client/user context where applicable.

Recommended key format:

```text
idem_<clientId>_<operationId>
```

The key MUST NOT contain secrets.

## Long-running operations

For long-running operations, a protocol HTTP endpoint SHOULD return one of:

1. **Accepted response**

```ts
type AcceptedResult = {
  accepted: true;
  operationId: string;
  events?: {
    stream: string;
    expectedTypes?: string[];
  };
};
```

The client tracks progress through the event stream.

2. **Streaming HTTP response**

The endpoint returns newline-delimited protocol messages or another explicitly defined streaming format.

3. **Snapshot/event combination**

The endpoint returns a snapshot with cursor metadata; live updates continue over WebSocket.

For the Nerve UI, option 1 is usually preferred: command by HTTP, observe by WebSocket events.

## HTTP streaming profile

If an HTTP endpoint streams protocol messages, it SHOULD use newline-delimited JSON where each line is one complete `NerveMessage`:

```http
Content-Type: application/x-ndjson
```

Rules:

- Each line MUST contain exactly one protocol message.
- The stream SHOULD start with a `response` or control message indicating acceptance.
- Event messages SHOULD use `event.batch`.
- The stream MUST end by closing normally or sending a terminal `error`/`goodbye` style message if applicable.

HTTP streaming is useful for non-browser clients or environments where WebSocket is unavailable. It is not the primary browser UI transport in v1.

## Replay over HTTP

The existing `/api/events?since=N` endpoint can be treated as a compatibility replay API. A protocol-enveloped equivalent could be:

```http
POST /api/protocol/v1/replay
Content-Type: application/vnd.nerve.protocol.v1+json
```

Request body:

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ8DWD26PPHV65WJRF1YCV0G",
  "kind": "replay.request",
  "ts": "2026-06-26T12:20:00.000Z",
  "data": {
    "sessionId": "ses_http_01JZ8DWB86BT6YTKR7P3BWF95T",
    "replayId": "rpl_01JZ8DWCPZWSMMF0XGWKZPMRG8",
    "streams": [{ "stream": "global", "fromSeq": 12000 }],
    "reason": "manual_refresh"
  }
}
```

Response options:

- a single `response` containing events and cursor metadata for small ranges;
- NDJSON stream of `replay.started`, `event.batch`, and `replay.complete` messages for large ranges;
- `replay.unavailable` for unsatisfied ranges.

## Snapshot over HTTP

A snapshot endpoint SHOULD return materialized domain state and cursor metadata.

Example response body as a protocol `response`:

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ8E1J9HSJYRNF0ECR6CCFTD",
  "kind": "response",
  "ts": "2026-06-26T12:20:10.000Z",
  "replyTo": "msg_01JZ8E15MP7X0MHE9PZ55PWTGF",
  "data": {
    "ok": true,
    "method": "snapshot.workspace.get",
    "result": {
      "workspace": {},
      "conversations": [],
      "tasks": []
    },
    "cursor": {
      "streams": [{ "stream": "global", "processedSeq": 12500 }]
    }
  }
}
```

The client MUST apply only event deltas with `seq > snapshot cursor` after loading the snapshot.

## Eventual consistency between HTTP and WebSocket

Many operations are initiated over HTTP and observed over WebSocket.

Example:

1. Client sends HTTP request to create conversation.
2. Orchestrator writes durable state and publishes `conversation.created` event.
3. HTTP response returns the created conversation and/or operation result.
4. WebSocket event stream also sends `conversation.created`.
5. Client deduplicates by entity ID and event sequence.

Rules:

- HTTP responses MAY return immediate domain results for responsiveness.
- WebSocket events remain the canonical incremental sync path.
- Clients MUST tolerate seeing the event before or after the HTTP response.
- Domain reducers MUST be idempotent when an HTTP response already updated local optimistic state.

## Correlation between HTTP and events

When an HTTP request causes events, the orchestrator SHOULD correlate them:

- request `id` or generated operation ID;
- `traceId`;
- event metadata or domain payload operation ID where useful.

Events SHOULD NOT expose sensitive request details.

## Authentication

HTTP authentication remains transport-specific. The protocol envelope MUST NOT carry daemon tokens or provider secrets in metadata.

For browser UI APIs:

- use existing local token/cookie/header mechanisms;
- enforce origin restrictions;
- protect secret submission with the existing credential encryption design where applicable;
- keep secrets in orchestrator/tool layers, not frontend state.

## Caching

Protocol RPC endpoints using `POST` are generally not HTTP-cacheable.

Resource-specific snapshot endpoints MAY use caching only if:

- auth scope is respected;
- cursor/version metadata is included;
- stale snapshots are safe because event deltas are applied afterward;
- no secrets are cached in shared caches.

Local browser memory caching through query libraries is an application concern, not an HTTP protocol guarantee.

## Batch requests

A future capability MAY define `request.batch`. Until then, clients SHOULD send independent protocol requests. Implementations can batch at the HTTP/transport layer separately if needed.

## Migration guidance

Recommended sequence:

1. Keep existing REST APIs.
2. Introduce shared protocol envelope and error schemas.
3. Add protocol-enveloped replay/snapshot endpoints where beneficial.
4. Add protocol metadata/correlation to existing HTTP responses and emitted events.
5. Migrate selected complex mutation APIs to `request`/`response` if it reduces duplication.
6. Avoid wrapping simple stable endpoints solely for uniformity.

## HTTP examples

See [Examples](./examples.md) for request/response, error, snapshot, and replay examples.
