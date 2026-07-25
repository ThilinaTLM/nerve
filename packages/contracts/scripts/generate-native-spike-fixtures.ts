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
      ],
      requiredCapabilities: ["encoding.json", "stream.subscription.v1"],
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
parseProtocolRequestData({ method: "snapshot.workspace.get", params: {} });
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
