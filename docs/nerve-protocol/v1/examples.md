# Protocol examples

## Hello

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01",
  "kind": "hello",
  "ts": "2026-07-18T12:00:00.000Z",
  "source": { "role": "ui", "id": "cli_01", "instanceId": "tab_01" },
  "target": { "role": "sandbox_manager", "id": "sandbox-manager" },
  "data": {
    "requestedVersion": 1,
    "capabilities": [
      "encoding.json",
      "event.batch",
      "event.notify",
      "stream.subscription.v1"
    ],
    "requiredCapabilities": ["stream.subscription.v1"],
    "encodings": ["json"]
  }
}
```

## Exact stream subscription

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_02",
  "kind": "stream.subscription.set",
  "ts": "2026-07-18T12:00:01.000Z",
  "source": { "role": "ui", "id": "cli_01", "instanceId": "tab_01" },
  "target": { "role": "sandbox_manager", "id": "sandbox-manager" },
  "data": {
    "sessionId": "session_01",
    "subscriptionId": "sub_01",
    "streams": [
      { "stream": "manager", "processedSeq": 18 },
      { "stream": "sandbox:sbx_demo", "processedSeq": 42 }
    ]
  }
}
```

## Dense event batch

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_03",
  "kind": "event.batch",
  "ts": "2026-07-18T12:00:02.000Z",
  "source": { "role": "sandbox_manager", "id": "sandbox-manager" },
  "target": { "role": "ui", "id": "cli_01", "instanceId": "tab_01" },
  "data": {
    "stream": "sandbox:sbx_demo",
    "batchId": "batch_01",
    "reason": "live",
    "firstSeq": 43,
    "lastSeq": 43,
    "events": [
      {
        "id": "evt_43",
        "seq": 43,
        "type": "run.started",
        "ts": "2026-07-18T12:00:02.000Z",
        "data": {
          "conversationId": "conv_1",
          "agentId": "agent_1",
          "projectId": "project_1",
          "runId": "run_1",
          "startedAt": "2026-07-18T12:00:02.000Z"
        }
      }
    ]
  }
}
```

## Ephemeral notification

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_04",
  "kind": "event.notify",
  "ts": "2026-07-18T12:00:03.000Z",
  "source": { "role": "sandbox_manager", "id": "sandbox-manager" },
  "target": { "role": "ui", "id": "cli_01", "instanceId": "tab_01" },
  "data": {
    "events": [
      {
        "id": "notify_01",
        "type": "sandbox.activity.changed",
        "ts": "2026-07-18T12:00:03.000Z",
        "data": {
          "sandboxId": "sbx_demo",
          "updatedAt": "2026-07-18T12:00:03.000Z"
        }
      }
    ]
  }
}
```

Concrete operation methods and event payloads must come from the contract catalogs; examples are not alternate schemas.
