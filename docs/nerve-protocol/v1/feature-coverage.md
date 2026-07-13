# Feature coverage

| Area                                         | Mechanical evidence                                         |
| -------------------------------------------- | ----------------------------------------------------------- |
| Envelope, roles, targets, message kinds      | contracts schema tests and protocol codec/conformance tests |
| Catalog RPC and events                       | contracts catalog tests; workbench/manager handler tests    |
| hello/welcome/ready, heartbeat, goodbye      | protocol session and connection tests                       |
| Idempotency and retry restrictions           | dispatcher/idempotency persistence tests                    |
| Replay, ACK, live interleaving               | protocol replay/ACK tests and three-link integration tests  |
| Queue bounds and flow updates                | protocol queue/backpressure tests                           |
| Snapshot cursor installation                 | workbench browser and manager UI recovery tests             |
| `local`, `manager`, `sandbox:<id>` ownership | server, manager, agent event-store/ingestion tests          |
| HTTP/WebSocket parity                        | workbench and manager protocol dispatcher tests             |
| Host semantics                               | local/sandbox host parity matrix                            |
| Shared Git/task UI                           | workbench-ui controller tests and both app checks/builds    |

Run `pnpm check`, `pnpm test`, and the release smoke commands in [release documentation](../../release.md) for the complete gate.
