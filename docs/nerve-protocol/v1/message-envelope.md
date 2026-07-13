# Message envelope

Every WebSocket message validates against `nerveMessageSchema`:

```ts
type NerveMessage<T> = {
  protocol: "nerve";
  version: 1;
  id: string;
  kind: string;
  ts: string;
  source: PeerDescriptor;
  target: PeerDescriptor;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  replyTo?: string;
  requiresAck?: boolean;
  meta?: Record<string, string | number | boolean | null>;
  data: T;
};
```

Unknown top-level fields are rejected. IDs and kinds are bounded; kinds use lower-case dotted identifiers. Metadata is limited to 32 entries, keys to 64 characters, values to 1,024 characters, and secret-like keys are rejected.

`request` carries `{ method, params, idempotencyKey?, timeoutMs? }`; `response` and `error` reply through `replyTo`. Request methods and data are parsed with the contract operation catalog. Event batches carry catalog-valid event envelopes. Processed acknowledgements use message kind `event.ack`.

Canonical roles are listed in [overview](overview.md). The role is in the envelope peer descriptor, not duplicated in `hello.data`.
