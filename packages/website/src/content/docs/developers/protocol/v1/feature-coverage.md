---
title: Feature coverage
sidebar:
  order: 14
---

| Area                                    | Mechanical evidence                                              |
| --------------------------------------- | ---------------------------------------------------------------- |
| Envelope, roles, targets, message kinds | contract schema tests and protocol session tests                 |
| Catalog RPC and event routing           | contract catalog/routing tests; workbench handler tests          |
| hello/welcome/ready, heartbeat, goodbye | protocol client/server and connection tests                      |
| Idempotency and retry restrictions      | dispatcher and persisted idempotency tests                       |
| Dense replay/live interleaving          | protocol dense-stream and subscription-recovery tests            |
| Exact-set subscriptions and snapshots   | protocol tests plus workbench recovery tests                     |
| Notify delivery and coalescing          | protocol and host relay tests                                    |
| Queue bounds and resync close           | protocol overflow tests                                          |
| `workspace` and `conv/<id>` ownership   | workbench StreamLog/registry/protocol tests                      |
| Producer and reducer lifecycle guards   | contract lifecycle, workbench tool service, and UI reducer tests |
| HTTP/WebSocket parity                   | workbench dispatcher and release smoke tests                     |
| Cross-platform host semantics           | shared real-host parity matrix                                   |

Run `pnpm fix && pnpm check && pnpm run test:full` for the complete repository gate.
