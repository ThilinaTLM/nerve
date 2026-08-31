---
title: Nerve Protocol v1 reference
sidebar:
  order: 1
---

This directory documents the implemented Nerve Protocol v1. The wire envelopes, event catalog, and operation catalog in `packages/contracts/src/wire/`, `packages/contracts/src/events/`, and `packages/contracts/src/operations/`, together with the sessions in `packages/protocol/`, are authoritative.

Protocol v1 connects the workbench app (`ui`) with the local server (`workbench_server`). The desktop shell and CLI use their own wire roles where they participate in protocol messages.

The link uses a strict envelope, catalog-validated RPC, subscription-based stream recovery, unsequenced notifications, snapshots, and bounded delivery behavior. HTTP and WebSocket requests share the same operation catalog.

## Contents

- [Overview](overview.md)
- [Envelope](message-envelope.md)
- [Session lifecycle](session-lifecycle.md)
- [Events](event-stream.md), [subscriptions and recovery](subscription-and-recovery.md), and [backpressure](backpressure.md)
- [HTTP mapping](http-mapping.md)
- [Errors and security](errors-and-security.md)
- [Extensions](extension-model.md)
- [Examples](examples.md)
- [Implementation guide](implementation-guide.md), [status](implementation-status.md), and [coverage](feature-coverage.md)

The operation and event catalogs are exported by `@nervekit/contracts`; applications must not invent method aliases, event types, delivery classes, or stream routing.
