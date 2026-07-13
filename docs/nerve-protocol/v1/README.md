# Nerve Protocol v1

This directory documents the implemented Nerve Protocol v1. The contracts in `packages/contracts/src/domains/protocol/` and the lifecycle implementation in `packages/protocol/` are authoritative.

Protocol v1 is used on three links:

1. workbench app (`ui`) ↔ local server (`workbench_server`);
2. sandbox manager app (`ui`) ↔ manager (`sandbox_manager`);
3. sandbox daemon (`sandbox_agent`) ↔ manager (`sandbox_manager`).

All three links use the same strict envelope, catalog-validated RPC, `ProtocolClientSession`/`ProtocolServerSession` lifecycle, replay/ACK rules, flow control, and snapshot recovery ports. There is one WebSocket dialect.

## Contents

- [Overview](overview.md)
- [Envelope](message-envelope.md)
- [Session lifecycle](session-lifecycle.md)
- [Events](event-stream.md), [replay and ACK](replay-and-ack.md), and [backpressure](backpressure.md)
- [HTTP mapping](http-mapping.md)
- [Errors and security](errors-and-security.md)
- [Extensions](extension-model.md)
- [Examples](examples.md)
- [Implementation guide](implementation-guide.md), [status](implementation-status.md), and [coverage](feature-coverage.md)

The operation and event catalogs are exported by `@nervekit/contracts`; applications must not invent uncataloged method aliases or event types.
