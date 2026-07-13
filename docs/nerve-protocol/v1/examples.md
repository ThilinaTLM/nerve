# Protocol examples

## Hello

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01",
  "kind": "hello",
  "ts": "2026-07-13T12:00:00.000Z",
  "source": { "role": "ui", "id": "cli_01", "instanceId": "tab_01" },
  "target": { "role": "sandbox_manager", "id": "sandbox-manager" },
  "data": {
    "requestedVersion": 1,
    "capabilities": [
      "encoding.json",
      "event.batch",
      "event.replay",
      "event.ack.processed"
    ],
    "encodings": ["json"],
    "resume": {
      "streams": [
        { "stream": "manager", "processedSeq": 18 },
        { "stream": "sandbox:sbx_demo", "processedSeq": 42 }
      ]
    }
  }
}
```

## Targeted RPC

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_02",
  "kind": "request",
  "ts": "2026-07-13T12:00:01.000Z",
  "source": { "role": "ui", "id": "cli_01" },
  "target": { "role": "sandbox_agent", "id": "sbx_demo" },
  "correlationId": "corr_01",
  "data": {
    "method": "task.list",
    "params": {},
    "timeoutMs": 30000
  }
}
```

## Processed ACK

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_03",
  "kind": "event.ack",
  "ts": "2026-07-13T12:00:02.000Z",
  "source": { "role": "ui", "id": "cli_01" },
  "target": { "role": "sandbox_manager", "id": "sandbox-manager" },
  "data": {
    "sessionId": "session_01",
    "ackId": "ack_01",
    "streams": [{ "stream": "sandbox:sbx_demo", "processedSeq": 43 }]
  }
}
```

Concrete methods and params must be taken from `allOperationDefinitions`; examples are not an alternate schema.
