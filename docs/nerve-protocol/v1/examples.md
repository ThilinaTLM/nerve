# Examples

This document provides concrete JSON examples for Nerve Protocol v1. IDs and timestamps are illustrative.

All examples use the baseline JSON envelope:

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_...",
  "kind": "...",
  "ts": "2026-06-26T12:00:00.000Z",
  "data": {}
}
```

## 1. WebSocket handshake with resume cursor

### Client sends `hello`

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ9000A0P4EK0DGB6HH57YB7",
  "kind": "hello",
  "ts": "2026-06-26T12:00:00.000Z",
  "source": {
    "role": "ui",
    "id": "cli_01JZ8ZZV9D5MZ7F3KQN63G4AMN",
    "instanceId": "tab_01JZ90005Q1QVJ1Y6QZK5EZG9K",
    "name": "Nerve Web UI"
  },
  "data": {
    "role": "ui",
    "client": {
      "id": "cli_01JZ8ZZV9D5MZ7F3KQN63G4AMN",
      "instanceId": "tab_01JZ90005Q1QVJ1Y6QZK5EZG9K",
      "name": "Nerve Web UI",
      "version": "0.1.0",
      "platform": "browser"
    },
    "requestedVersion": 1,
    "capabilities": [
      "encoding.json",
      "event.batch",
      "event.replay",
      "event.ack.processed",
      "flow.backpressure",
      "snapshot.workspace"
    ],
    "encodings": ["json"],
    "resume": {
      "streams": [{ "stream": "global", "processedSeq": 12000 }]
    },
    "preferences": {
      "batch": {
        "maxEvents": 500,
        "maxBytes": 1048576,
        "maxDelayMs": 16
      },
      "heartbeatIntervalMs": 30000,
      "replay": {
        "preferSnapshot": false,
        "maxReplayEvents": 10000
      }
    }
  }
}
```

### Orchestrator sends `welcome`

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ9001GCB7SG6QEVSAWKD4AT",
  "kind": "welcome",
  "ts": "2026-06-26T12:00:00.050Z",
  "source": {
    "role": "orchestrator",
    "id": "orc_01JZ8ZYZQ6YF2GS8FJWPY5RAAH",
    "name": "Nerve Orchestrator"
  },
  "correlationId": "msg_01JZ9000A0P4EK0DGB6HH57YB7",
  "replyTo": "msg_01JZ9000A0P4EK0DGB6HH57YB7",
  "data": {
    "sessionId": "ses_01JZ9001G0S7746NP5BBK7E8M4",
    "orchestrator": {
      "id": "orc_01JZ8ZYZQ6YF2GS8FJWPY5RAAH",
      "version": "0.1.0",
      "startedAt": "2026-06-26T11:58:10.000Z"
    },
    "acceptedVersion": 1,
    "capabilities": [
      "encoding.json",
      "event.batch",
      "event.replay",
      "event.ack.processed",
      "flow.backpressure",
      "snapshot.workspace"
    ],
    "encoding": "json",
    "streams": [
      {
        "stream": "global",
        "latestSeq": 12010,
        "durableSeq": 12008,
        "replayFromSeq": 12000,
        "replayAvailableFromSeq": 8000
      }
    ],
    "limits": {
      "maxMessageBytes": 4194304,
      "maxBatchEvents": 500,
      "maxBatchBytes": 1048576,
      "maxInflightBatches": 8,
      "maxUnackedDurableEvents": 5000
    },
    "heartbeat": {
      "intervalMs": 30000,
      "timeoutMs": 70000
    },
    "resume": {
      "accepted": true,
      "mode": "replay",
      "reason": "Client cursor is behind latest event sequence"
    }
  }
}
```

### Client sends `ready`

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ9002AF9ZXAQ3WRXH9GZ1HP",
  "kind": "ready",
  "ts": "2026-06-26T12:00:00.100Z",
  "data": {
    "sessionId": "ses_01JZ9001G0S7746NP5BBK7E8M4",
    "streams": [{ "stream": "global", "processedSeq": 12000 }]
  }
}
```

## 2. Live event batch

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ901KSG2T6JPPQ2V5K4SYD0",
  "kind": "event.batch",
  "ts": "2026-06-26T12:01:00.000Z",
  "data": {
    "stream": "global",
    "batchId": "bat_01JZ901KRWX18HX5FP6HX87F14",
    "reason": "live",
    "events": [
      {
        "seq": 12011,
        "id": "evt_01JZ901KQSF42XB2GK5F1Y1S5N",
        "ts": "2026-06-26T12:00:59.990Z",
        "type": "conversation.run.started",
        "durability": "durable",
        "data": {
          "conversationId": "conv_123",
          "runId": "run_456",
          "agentId": "agent_789"
        }
      },
      {
        "seq": 12012,
        "id": "evt_01JZ901KR7TVBCM16ETR4FHXS1",
        "ts": "2026-06-26T12:00:59.995Z",
        "type": "conversation.live.content.delta",
        "durability": "transient",
        "data": {
          "conversationId": "conv_123",
          "runId": "run_456",
          "messageKey": "assistant:run_456",
          "index": 0,
          "text": "Hello"
        }
      }
    ],
    "range": {
      "firstSeq": 12011,
      "lastSeq": 12012,
      "durableFirstSeq": 12011,
      "durableLastSeq": 12011,
      "durableCount": 1,
      "transientCount": 1,
      "previousDurableSeq": 12010,
      "durableCompleteThroughSeq": 12011
    }
  }
}
```

## 3. Acknowledgement after processing

After applying durable event `12011`, the client acknowledges its processed cursor.

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ901N1C80VX4J3ED6VTE2PR",
  "kind": "ack",
  "ts": "2026-06-26T12:01:00.120Z",
  "data": {
    "sessionId": "ses_01JZ9001G0S7746NP5BBK7E8M4",
    "ackId": "ack_01JZ901N0YCXMYQPHHQ0JQ2HY6",
    "streams": [{ "stream": "global", "processedSeq": 12011 }],
    "received": [{ "stream": "global", "highestSeq": 12012 }],
    "stats": {
      "appliedEvents": 1,
      "duplicateEvents": 0,
      "pendingEvents": 0,
      "processingLatencyMs": 12
    }
  }
}
```

## 4. Explicit replay request after gap detection

During the initial WebSocket resume handshake, `resume.mode: "replay"` causes the server to start replay after `ready`. A client sends `replay.request` explicitly for in-session gap recovery, manual refresh, or snapshot-delta recovery.

### Client requests replay

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ905T8TK7K10N6Q4T89GJ2G",
  "kind": "replay.request",
  "ts": "2026-06-26T12:03:00.000Z",
  "data": {
    "sessionId": "ses_01JZ905PX86A7JVAETQWKC4PZ9",
    "replayId": "rpl_01JZ905T89TE9WHVV2EJGR8B15",
    "streams": [{ "stream": "global", "fromSeq": 12011 }],
    "reason": "gap_detected",
    "preferences": {
      "maxEvents": 10000,
      "maxBytes": 4194304,
      "preferSnapshot": false,
      "includeTransientIfAvailable": true
    }
  }
}
```

### Orchestrator starts replay

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ905V6YXKTAWA4VCDBXWS1D",
  "kind": "replay.started",
  "ts": "2026-06-26T12:03:00.040Z",
  "correlationId": "msg_01JZ905T8TK7K10N6Q4T89GJ2G",
  "data": {
    "sessionId": "ses_01JZ905PX86A7JVAETQWKC4PZ9",
    "replayId": "rpl_01JZ905T89TE9WHVV2EJGR8B15",
    "streams": [
      {
        "stream": "global",
        "fromSeq": 12011,
        "toSeq": 12020,
        "latestSeq": 12020,
        "durableFromSeq": 12013,
        "durableToSeq": 12020,
        "estimatedEvents": 9,
        "source": "memory",
        "transientPolicy": "included_if_available"
      }
    ]
  }
}
```

### Orchestrator sends replay batch

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ905W3A0XFT8K2TQ7MWER79",
  "kind": "event.batch",
  "ts": "2026-06-26T12:03:00.060Z",
  "data": {
    "stream": "global",
    "batchId": "bat_01JZ905W2YJN7QA34AJBPJYVAP",
    "reason": "replay",
    "events": [
      {
        "seq": 12013,
        "id": "evt_01JZ905W2N7NBCA04XHDJ3TG0F",
        "ts": "2026-06-26T12:01:05.000Z",
        "type": "conversation.entry.appended",
        "durability": "durable",
        "data": {
          "conversationId": "conv_123",
          "entry": {
            "id": "entry_abc",
            "role": "assistant",
            "content": "Hello, how can I help?"
          }
        }
      },
      {
        "seq": 12014,
        "id": "evt_01JZ905W2VWM1ZEJ1VAWM7F6H3",
        "ts": "2026-06-26T12:01:05.100Z",
        "type": "conversation.run.completed",
        "durability": "durable",
        "data": {
          "conversationId": "conv_123",
          "runId": "run_456"
        }
      }
    ],
    "range": {
      "firstSeq": 12013,
      "lastSeq": 12014,
      "durableFirstSeq": 12013,
      "durableLastSeq": 12014,
      "durableCount": 2,
      "transientCount": 0,
      "previousDurableSeq": 12011,
      "durableCompleteThroughSeq": 12014,
      "skippedNonDurableRanges": [
        {
          "fromSeq": 12012,
          "toSeq": 12012,
          "reason": "transient_unavailable"
        }
      ]
    },
    "replay": {
      "replayId": "rpl_01JZ905T89TE9WHVV2EJGR8B15",
      "fromSeq": 12011,
      "toSeq": 12020
    }
  }
}
```

### Orchestrator completes replay

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ905X1QS787YC2VJPX2FGFP",
  "kind": "replay.complete",
  "ts": "2026-06-26T12:03:00.120Z",
  "data": {
    "sessionId": "ses_01JZ905PX86A7JVAETQWKC4PZ9",
    "replayId": "rpl_01JZ905T89TE9WHVV2EJGR8B15",
    "streams": [
      {
        "stream": "global",
        "fromSeq": 12011,
        "toSeq": 12020,
        "latestSeq": 12020,
        "durableCompleteThroughSeq": 12020,
        "sentEvents": 9,
        "sentDurableEvents": 4,
        "sentTransientEvents": 5
      }
    ],
    "liveDelivery": "resuming"
  }
}
```

## 5. Replay unavailable; snapshot required

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90A3Q8FK0CE5EPH4PM3896",
  "kind": "replay.unavailable",
  "ts": "2026-06-26T12:05:00.000Z",
  "data": {
    "sessionId": "ses_01JZ90A1WTV2CW2XDDDE4M7MPA",
    "replayId": "rpl_01JZ90A35GZBZ9SPQYT2BTA772",
    "streams": [
      {
        "stream": "global",
        "requestedFromSeq": 100,
        "earliestAvailableSeq": 8000,
        "latestSeq": 12200,
        "reason": "cursor_too_old"
      }
    ],
    "recovery": {
      "action": "load_snapshot",
      "snapshotMethod": "snapshot.workspace.get"
    }
  }
}
```

## 6. Backpressure degradation

The orchestrator tells the client that transient events are being coalesced/dropped while durable delivery remains valid.

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90DRV2SGFMAF8K11P5SE2D",
  "kind": "flow.update",
  "ts": "2026-06-26T12:07:00.000Z",
  "data": {
    "sessionId": "ses_01JZ9001G0S7746NP5BBK7E8M4",
    "scope": { "stream": "global" },
    "mode": "degraded",
    "reason": "transient_events_dropped",
    "stats": {
      "serverQueueEvents": 1500,
      "serverQueueBytes": 6291456,
      "unackedDurableEvents": 250,
      "droppedTransientEvents": 900,
      "coalescedTransientEvents": 300,
      "oldestUnackedSeq": 12100,
      "latestSeq": 12500,
      "processedSeq": 12250
    },
    "action": {
      "type": "pause_transient",
      "message": "Live transient updates are reduced until the client catches up"
    }
  }
}
```

## 7. Resync required

The orchestrator cannot guarantee continuity for this session and instructs the client to load a snapshot.

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90FES8A7GMRG5HWN8FNBT8",
  "kind": "flow.update",
  "ts": "2026-06-26T12:08:00.000Z",
  "data": {
    "sessionId": "ses_01JZ9001G0S7746NP5BBK7E8M4",
    "scope": { "stream": "global" },
    "mode": "resync_required",
    "reason": "queue_limit_exceeded",
    "stats": {
      "serverQueueEvents": 12000,
      "serverQueueBytes": 50331648,
      "unackedDurableEvents": 11000,
      "latestSeq": 23000,
      "processedSeq": 12000
    },
    "action": {
      "type": "load_snapshot",
      "message": "Client is too far behind for bounded replay"
    }
  }
}
```

## 8. Heartbeat

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90H2BF66YZBGHZ0VSNTEXB",
  "kind": "heartbeat",
  "ts": "2026-06-26T12:09:00.000Z",
  "data": {
    "sessionId": "ses_01JZ9001G0S7746NP5BBK7E8M4",
    "sentAt": "2026-06-26T12:09:00.000Z",
    "latestSeq": 12550,
    "serverLoad": {
      "eventQueueDepth": 0,
      "replayQueueDepth": 0
    }
  }
}
```

Client heartbeat with processed cursor:

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90H57VQJPYT05HYEW8VT35",
  "kind": "heartbeat",
  "ts": "2026-06-26T12:09:00.100Z",
  "data": {
    "sessionId": "ses_01JZ9001G0S7746NP5BBK7E8M4",
    "sentAt": "2026-06-26T12:09:00.100Z",
    "processed": [{ "stream": "global", "processedSeq": 12550 }]
  }
}
```

## 9. Protocol HTTP request/response

### Request

```http
POST /api/protocol/v1 HTTP/1.1
Content-Type: application/vnd.nerve.protocol.v1+json
Accept: application/vnd.nerve.protocol.v1+json
```

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90KQXRYQ6GEZB1PZSNBT55",
  "kind": "request",
  "ts": "2026-06-26T12:10:00.000Z",
  "traceId": "trc_01JZ90KQS8JYDYR4E3QH8C984P",
  "data": {
    "method": "conversation.create",
    "params": {
      "projectId": "proj_123",
      "title": "Protocol design"
    },
    "idempotencyKey": "idem_cli_01JZ8ZZV9D5MZ7F3KQN63G4AMN_create_conv_001",
    "expect": {
      "response": "single",
      "events": true
    }
  }
}
```

### Response

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90KS70GTB41D0Z9R9Q8Q2W",
  "kind": "response",
  "ts": "2026-06-26T12:10:00.050Z",
  "replyTo": "msg_01JZ90KQXRYQ6GEZB1PZSNBT55",
  "correlationId": "msg_01JZ90KQXRYQ6GEZB1PZSNBT55",
  "traceId": "trc_01JZ90KQS8JYDYR4E3QH8C984P",
  "data": {
    "ok": true,
    "method": "conversation.create",
    "result": {
      "conversation": {
        "id": "conv_456",
        "projectId": "proj_123",
        "title": "Protocol design"
      }
    },
    "cursor": {
      "streams": [{ "stream": "global", "processedSeq": 12560 }]
    }
  }
}
```

A WebSocket `event.batch` may also deliver the corresponding `conversation.created` event. The client deduplicates by event sequence and conversation ID.

## 10. Protocol error

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90MFD8ZRG8GF59A1THGYZB",
  "kind": "error",
  "ts": "2026-06-26T12:11:00.000Z",
  "replyTo": "msg_01JZ90MEY69W18X2XBYTPB8KHE",
  "correlationId": "msg_01JZ90MEY69W18X2XBYTPB8KHE",
  "data": {
    "code": "VALIDATION_FAILED",
    "message": "conversationId is required",
    "retryable": false,
    "details": {
      "field": "conversationId"
    },
    "recovery": {
      "action": "none"
    }
  }
}
```

## 11. Graceful shutdown

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90P75N64EEZXFR3K56GZMD",
  "kind": "goodbye",
  "ts": "2026-06-26T12:12:00.000Z",
  "data": {
    "sessionId": "ses_01JZ9001G0S7746NP5BBK7E8M4",
    "reason": "server_shutdown",
    "message": "Nerve orchestrator is shutting down",
    "retryAfterMs": 1000
  }
}
```

Client may send a final ack or final cursors:

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90P8GVPBMMG4N9XPFYG4FH",
  "kind": "goodbye",
  "ts": "2026-06-26T12:12:00.050Z",
  "data": {
    "sessionId": "ses_01JZ9001G0S7746NP5BBK7E8M4",
    "reason": "client_closing",
    "finalCursors": [{ "stream": "global", "processedSeq": 12560 }]
  }
}
```

## 12. Protocol-compatible REST snapshot with cursor metadata

A REST/resource endpoint can participate in protocol recovery without wrapping its body in `NerveMessage`. The important part is the cursor contract.

```http
GET /api/conversations/conv_123/snapshot HTTP/1.1
Accept: application/json
```

```json
{
  "snapshot": {
    "conversation": {
      "id": "conv_123",
      "projectId": "proj_123",
      "title": "Protocol implementation"
    },
    "entries": [
      {
        "id": "entry_1",
        "conversationId": "conv_123",
        "role": "user",
        "createdAt": "2026-06-26T12:12:30.000Z"
      }
    ],
    "queuedPrompts": []
  },
  "cursor": {
    "streams": [{ "stream": "global", "processedSeq": 12600 }]
  }
}
```

After applying this snapshot, the client treats durable state as complete through `12600` and applies only later deltas.

## 13. Out-of-band binary flow with protocol-visible state

Audio upload remains a multipart REST operation in v1. The protocol stream may carry safe progress/result metadata, but not the audio bytes.

```http
POST /api/transcription/audio HTTP/1.1
Content-Type: multipart/form-data; boundary=...
```

```json
{
  "text": "Please summarize the latest task logs."
}
```

If transcription becomes asynchronous later, the HTTP response can return an operation ID and the event stream can publish a safe event:

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90Q4Q8JVA2KAG6T2WHZD5E",
  "kind": "event.batch",
  "ts": "2026-06-26T12:13:00.000Z",
  "data": {
    "stream": "global",
    "batchId": "bat_01JZ90Q4NGW5N3A3V6HE9B2G5Q",
    "reason": "live",
    "events": [
      {
        "seq": 12601,
        "id": "evt_01JZ90Q4MZ7R9DE8G4VD6DBFZF",
        "ts": "2026-06-26T12:13:00.000Z",
        "type": "transcription.completed",
        "durability": "durable",
        "data": {
          "operationId": "op_123",
          "textLength": 39
        }
      }
    ],
    "range": {
      "firstSeq": 12601,
      "lastSeq": 12601,
      "durableFirstSeq": 12601,
      "durableLastSeq": 12601,
      "durableCount": 1,
      "transientCount": 0,
      "previousDurableSeq": 12600,
      "durableCompleteThroughSeq": 12601
    }
  }
}
```

## 14. Current underscore-named event family

Current domain event names such as `user_question.*`, `plan_review.*`, and `prompt_suggestions.*` remain valid. They are carried like any other domain event.

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90R54A8G6P5H4B7Z8JKN3Q",
  "kind": "event.batch",
  "ts": "2026-06-26T12:14:00.000Z",
  "data": {
    "stream": "global",
    "batchId": "bat_01JZ90R50KWXHYSMXHPP2YB1V1",
    "reason": "live",
    "events": [
      {
        "seq": 12602,
        "id": "evt_01JZ90R4YQAH0HYK2RJ5ZFWXSS",
        "ts": "2026-06-26T12:14:00.000Z",
        "type": "user_question.requested",
        "durability": "durable",
        "data": {
          "question": {
            "id": "question_123",
            "conversationId": "conv_123",
            "status": "pending",
            "question": "Which branch should I target?"
          }
        }
      }
    ],
    "range": {
      "firstSeq": 12602,
      "lastSeq": 12602,
      "durableFirstSeq": 12602,
      "durableLastSeq": 12602,
      "durableCount": 1,
      "transientCount": 0,
      "previousDurableSeq": 12601,
      "durableCompleteThroughSeq": 12602
    }
  }
}
```

## 15. Optional RPC candidate for a small mutation

Approval decisions are good protocol RPC candidates because they are small, user-initiated mutations with clear events. The existing REST endpoint can remain canonical while this method is added later.

### Request

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90S8T0CRYQHGJH3A7RFGFZ",
  "kind": "request",
  "ts": "2026-06-26T12:15:00.000Z",
  "traceId": "trc_01JZ90S8MX3KGANV2T9B89V4R2",
  "data": {
    "method": "approval.grant",
    "params": {
      "approvalId": "apr_123",
      "note": "Approved for the current project directory."
    },
    "idempotencyKey": "idem_cli_approve_apr_123_001",
    "expect": {
      "response": "single",
      "events": true
    }
  }
}
```

### Response

```json
{
  "protocol": "nerve",
  "version": 1,
  "id": "msg_01JZ90SAG6E1RYT1AA60A7BCN0",
  "kind": "response",
  "ts": "2026-06-26T12:15:00.030Z",
  "replyTo": "msg_01JZ90S8T0CRYQHGJH3A7RFGFZ",
  "correlationId": "msg_01JZ90S8T0CRYQHGJH3A7RFGFZ",
  "traceId": "trc_01JZ90S8MX3KGANV2T9B89V4R2",
  "data": {
    "ok": true,
    "method": "approval.grant",
    "result": {
      "toolCall": {
        "id": "tool_123",
        "status": "approved"
      }
    }
  }
}
```

A later WebSocket `event.batch` should carry `approval.granted` and any related `conversation.tool_call.updated` event. The client deduplicates against any optimistic local update by entity ID and event sequence.

