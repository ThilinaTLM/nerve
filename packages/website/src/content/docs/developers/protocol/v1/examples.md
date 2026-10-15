---
title: Protocol examples
description: Follow concrete Protocol v1 session, RPC, subscription, replay, and recovery messages.
sidebar:
  order: 11
---

## Hello

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01",
  "kind": "hello",
  "ts": "2026-07-18T12:00:00.000Z",
  "source": { "role": "ui", "id": "client_01", "instanceId": "tab_01" },
  "target": { "role": "workbench_server" },
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

Send this on `/ws/conversations`; the workbench connection has no durable workspace stream.

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_02",
  "kind": "stream.subscription.set",
  "ts": "2026-07-18T12:00:01.000Z",
  "source": { "role": "ui", "id": "client_01", "instanceId": "tab_01" },
  "target": { "role": "workbench_server" },
  "data": {
    "sessionId": "session_01",
    "subscriptionId": "sub_01",
    "streams": [{ "stream": "conv/conv_1", "processedSeq": 42 }]
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
  "source": { "role": "workbench_server" },
  "target": { "role": "ui", "id": "client_01", "instanceId": "tab_01" },
  "data": {
    "stream": "conv/conv_1",
    "batchId": "batch_01",
    "reason": "live",
    "firstSeq": 43,
    "lastSeq": 43,
    "events": [
      {
        "id": "evt_43",
        "seq": 43,
        "type": "conversation.event",
        "ts": "2026-07-18T12:00:02.000Z",
        "data": {
          "id": "evt_43",
          "conversationId": "conv_1",
          "sequence": 43,
          "previousEventId": "evt_42",
          "turnId": null,
          "inputId": "input_1",
          "createdAt": "2026-07-18T12:00:02.000Z",
          "type": "user_message",
          "llmRepresentation": "user",
          "payload": {
            "text": "Inspect the project",
            "originalText": "Inspect the project",
            "source": "user",
            "senderConversationId": null,
            "commandPreparation": null
          }
        }
      }
    ]
  }
}
```

## Ephemeral notification

This launch notice is sent on `/ws/workbench`, independently of the conversation stream above.

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_04",
  "kind": "event.notify",
  "ts": "2026-07-18T12:00:03.000Z",
  "source": { "role": "workbench_server" },
  "target": { "role": "ui", "id": "client_01", "instanceId": "tab_01" },
  "data": {
    "events": [
      {
        "id": "notify_01",
        "type": "launch.output",
        "ts": "2026-07-18T12:00:03.000Z",
        "data": {
          "launchId": "launch_1",
          "stream": "stdout",
          "text": "server ready\n"
        }
      }
    ]
  }
}
```

Concrete operation methods and event payloads must come from the contract catalogs; examples are not alternate schemas.
