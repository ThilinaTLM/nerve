# Extension model

Protocol v1 extends through shared contracts, not ad-hoc frames.

1. Add an operation or event schema in `packages/contracts`.
2. Register catalog target/source roles, required capability, idempotency policy, event delivery, coalescing, scope, and bounds.
3. Add typed handlers or reducers and focused tests.
4. Advertise and negotiate the required capability.

Unknown envelope fields, uncataloged operations/events, unsupported targets, and missing required capabilities are rejected. New transports must map to the same transport-neutral envelope, catalog, subscription, snapshot, and notification interfaces.

`stream.subscription.v1` is required by shared v1 sessions. Hosts authorize exact stream sets and expose retained bounds; they do not define private cursor or recovery frames.

Breaking envelope or lifecycle changes require a new protocol version. There is no raw-frame mode, event delivery override, or method-alias mechanism in v1.
