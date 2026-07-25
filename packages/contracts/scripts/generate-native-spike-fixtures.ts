import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  parseProtocolRequestData,
  protocolV1MessageSchema,
  streamSubscriptionUpdatedDataSchema,
} from "../src/index.js";

const outputPath = fileURLToPath(
  new URL("../schemas/native-spike-v1.fixtures.json", import.meta.url),
);
const timestamp = "2026-01-01T00:00:00.000Z";

const server = { role: "workbench_server" } as const;
const ui = {
  role: "ui",
  id: "native_fixture",
  name: "Nerve Native Fixture",
  instanceId: "instance_fixture",
} as const;

function message(
  id: string,
  kind: string,
  data: unknown,
  source: object = server,
  target: object = ui,
): Record<string, unknown> {
  return {
    protocol: "nerve",
    version: 1,
    id,
    kind,
    ts: timestamp,
    source,
    target,
    data,
  };
}

const mutationCapabilities = [
  "operation.conversation.create",
  "operation.agent.create",
  "operation.run.start",
] as const;

const validMessages = [
  message(
    "msg_hello",
    "hello",
    {
      requestedVersion: 1,
      capabilities: [
        "encoding.json",
        "event.batch",
        "event.notify",
        "stream.subscription.v1",
        "snapshot.workspace",
        "operation.snapshot.workspace.get",
        "operation.snapshot.conversation.get",
        ...mutationCapabilities,
      ],
      requiredCapabilities: [
        "encoding.json",
        "stream.subscription.v1",
        "operation.snapshot.workspace.get",
        "operation.snapshot.conversation.get",
        ...mutationCapabilities,
      ],
      encodings: ["json"],
    },
    ui,
    server,
  ),
  message("msg_welcome", "welcome", {
    sessionId: "ses_fixture",
    acceptingPeer: server,
    acceptedVersion: 1,
    capabilities: [
      "encoding.json",
      "event.batch",
      "event.notify",
      "stream.subscription.v1",
      "snapshot.workspace",
      "operation.snapshot.workspace.get",
      "operation.snapshot.conversation.get",
      ...mutationCapabilities,
    ],
    encoding: "json",
    limits: {
      maxMessageBytes: 1_048_576,
      maxBatchEvents: 256,
      maxBatchBytes: 524_288,
    },
    heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
  }),
  message("msg_ready", "ready", {
    sessionId: "ses_fixture",
    status: "ready",
  }),
  message("msg_heartbeat", "heartbeat", {
    sessionId: "ses_fixture",
    sentAt: timestamp,
  }),
  message(
    "msg_request",
    "request",
    { method: "snapshot.workspace.get", params: {} },
    ui,
    server,
  ),
  message("msg_response", "response", {
    ok: true,
    method: "snapshot.workspace.get",
    result: {
      snapshot: {
        projects: [],
        conversations: [],
        agents: [],
        tasks: [],
        approvals: [],
        userQuestions: [],
        planReviews: [],
        workers: [],
      },
      cursor: { streams: [{ stream: "workspace", processedSeq: 0 }] },
      generatedAt: timestamp,
    },
  }),
  message(
    "msg_conversation_create",
    "request",
    {
      method: "conversation.create",
      params: { projectId: "proj_fixture", title: "Inspect native chat" },
      idempotencyKey: "idem_conversation_fixture",
    },
    ui,
    server,
  ),
  message(
    "msg_agent_create",
    "request",
    {
      method: "agent.create",
      params: {
        projectId: "proj_fixture",
        conversationId: "conv_fixture",
      },
      idempotencyKey: "idem_agent_fixture",
    },
    ui,
    server,
  ),
  message(
    "msg_run_start",
    "request",
    {
      method: "run.start",
      params: { agentId: "agent_fixture", text: "Hello from native" },
      idempotencyKey: "idem_run_fixture",
    },
    ui,
    server,
  ),
  message("msg_run_accepted", "response", {
    ok: true,
    method: "run.start",
    result: {
      accepted: true,
      conversationId: "conv_fixture",
      agentId: "agent_fixture",
      runId: "run_fixture",
      status: "accepted",
    },
  }),
  message("msg_error", "error", {
    code: "RESYNC_REQUIRED",
    message: "Snapshot recovery required",
    retryable: true,
    recovery: { action: "load_snapshot" },
  }),
  message("msg_batch", "event.batch", {
    stream: "workspace",
    batchId: "batch_fixture",
    reason: "replay",
    events: [
      {
        seq: 1,
        id: "evt_fixture_1",
        ts: timestamp,
        type: "daemon.started",
        data: { daemonId: "daemon_fixture" },
      },
      {
        seq: 2,
        id: "evt_fixture_2",
        ts: timestamp,
        type: "native.fixture.unknown",
        data: { preserved: true },
      },
    ],
    firstSeq: 1,
    lastSeq: 2,
  }),
  message("msg_conversation_batch", "event.batch", {
    stream: "conv/conv_fixture",
    batchId: "batch_conversation_fixture",
    reason: "live",
    events: [
      {
        seq: 1,
        id: "evt_live_started",
        ts: timestamp,
        type: "conversation.live.message.started",
        data: {
          conversationId: "conv_fixture",
          agentId: "agent_fixture",
          projectId: "proj_fixture",
          runId: "run_fixture",
          turnId: "turn_fixture",
          liveMessageId: "msg_live_fixture",
          messageOrdinal: 0,
          startedAt: timestamp,
        },
      },
      {
        seq: 2,
        id: "evt_live_delta",
        ts: timestamp,
        type: "conversation.live.content.delta",
        data: {
          conversationId: "conv_fixture",
          agentId: "agent_fixture",
          projectId: "proj_fixture",
          runId: "run_fixture",
          turnId: "turn_fixture",
          liveMessageId: "msg_live_fixture",
          contentBlockId: "block_fixture",
          contentIndex: 0,
          kind: "text",
          offset: 0,
          delta: "Streaming reply",
        },
      },
    ],
    firstSeq: 1,
    lastSeq: 2,
  }),
  message("msg_notify", "event.notify", {
    events: [
      {
        id: "evt_notify_fixture",
        ts: timestamp,
        type: "conversation.output.delta",
        data: { conversationId: "conv_fixture", text: "stream" },
      },
    ],
  }),
  message(
    "msg_subscription_set",
    "stream.subscription.set",
    {
      sessionId: "ses_fixture",
      subscriptionId: "sub_fixture",
      streams: [
        { stream: "workspace", processedSeq: 2 },
        { stream: "conv/conv_fixture", processedSeq: 0 },
      ],
    },
    ui,
    server,
  ),
  message("msg_subscription_updated", "stream.subscription.updated", {
    sessionId: "ses_fixture",
    subscriptionId: "sub_fixture",
    accepted: true,
    streams: [
      {
        stream: "workspace",
        latestSeq: 2,
        earliestAvailableSeq: 1,
        mode: "live",
      },
      {
        stream: "conv/conv_fixture",
        latestSeq: 14,
        earliestAvailableSeq: 5,
        mode: "snapshot_required",
      },
      {
        stream: "conv/conv_deleted",
        latestSeq: 0,
        earliestAvailableSeq: 0,
        mode: "unavailable",
      },
    ],
  }),
];

for (const input of validMessages) protocolV1MessageSchema.parse(input);
for (const request of [
  { method: "snapshot.workspace.get", params: {} },
  {
    method: "conversation.create",
    params: { projectId: "proj_fixture", title: "Inspect native chat" },
  },
  {
    method: "agent.create",
    params: { projectId: "proj_fixture", conversationId: "conv_fixture" },
  },
  {
    method: "run.start",
    params: { agentId: "agent_fixture", text: "Hello from native" },
  },
]) {
  parseProtocolRequestData(request);
}
streamSubscriptionUpdatedDataSchema.parse(
  (validMessages.at(-1) as { data: unknown }).data,
);

const fixtures = {
  generatedBy: "packages/contracts/scripts/generate-native-spike-fixtures.ts",
  protocolVersion: 1,
  validMessages,
  invalidMessages: [
    {
      name: "unsupported protocol version",
      input: { ...validMessages[0], version: 2 },
    },
    {
      name: "duplicate subscription stream",
      input: message("msg_invalid_subscription", "stream.subscription.set", {
        sessionId: "ses_fixture",
        subscriptionId: "sub_fixture",
        streams: [
          { stream: "workspace", processedSeq: 0 },
          { stream: "workspace", processedSeq: 1 },
        ],
      }),
    },
    {
      name: "non-consecutive event batch",
      input: message("msg_invalid_batch", "event.batch", {
        stream: "workspace",
        batchId: "batch_invalid",
        reason: "replay",
        events: [
          { seq: 1, id: "evt_invalid_1", ts: timestamp, type: "one", data: {} },
          {
            seq: 3,
            id: "evt_invalid_3",
            ts: timestamp,
            type: "three",
            data: {},
          },
        ],
        firstSeq: 1,
        lastSeq: 3,
      }),
    },
  ],
};

const output = `${JSON.stringify(fixtures, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== output) {
    console.error(
      "Native spike protocol fixtures are stale. Run pnpm --filter @nervekit/contracts schema:native-spike:generate.",
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, output);
}
