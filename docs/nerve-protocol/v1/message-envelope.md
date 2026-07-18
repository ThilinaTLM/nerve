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
  meta?: Record<string, string | number | boolean | null>;
  data: T;
};
```

Unknown top-level fields are rejected. IDs, kinds, metadata, and error details are bounded. Secret-like metadata keys are rejected.

`request` carries `{ method, params, idempotencyKey?, timeoutMs?, expect? }`; `response` and `error` reply through `replyTo`. Operations are parsed with the contract catalog.

Sequenced delivery uses `event.batch`; each contained envelope is `{ id, seq, type, ts, data }`. Ephemeral delivery uses `event.notify`; each notification is `{ id, type, ts, data }` and deliberately has no sequence.

The peer role exists only in the envelope descriptors, not in `hello.data`.
