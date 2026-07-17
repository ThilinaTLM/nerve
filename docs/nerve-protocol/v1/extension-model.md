# Extension model

Protocol v1 extends through contracts, not ad-hoc frames.

1. Add an operation or event schema in `packages/contracts`.
2. Register it in the operation/event catalog with target roles, capability, idempotency, durability, and bounds.
3. Add typed handlers/reducers and conformance tests.
4. Advertise and negotiate the required capability.

Unknown envelope fields, uncataloged methods, uncataloged events, unsupported targets, and missing required capabilities are rejected. Optional capabilities may disable a feature without changing envelope semantics. New transports must map to the same transport-neutral message, catalog, session, replay, and snapshot interfaces.

`stream.subscription.v1` is an optional v1 extension for exact-set live subscriptions. It requires a duplex or stream-capable transport and does not change the transport-neutral cursor, replay, ACK, snapshot, authorization, or flow-control contracts. Fixed-stream workbench hosts do not advertise it.

Breaking envelope or lifecycle changes require a new protocol version. There is no alternate raw-frame mode or method-alias mechanism in v1.
