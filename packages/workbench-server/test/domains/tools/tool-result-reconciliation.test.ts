import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ToolCallRecord,
  ToolResultPayloadReference,
} from "@nervekit/contracts/tools";
import { reconcileToolResultPayloads } from "../../../src/domains/tools/artifacts/tool-result-reconciliation.js";

const reference: ToolResultPayloadReference = {
  version: 2,
  kind: "tool_result",
  conversationId: "conv_test",
  toolCallId: "tool_test",
  logicalPath: "conversations/conv_test/tool-calls/tool_test/result.json",
  digest: "0".repeat(64),
  byteLength: 2,
  mediaType: "application/json",
  encoding: "utf-8",
  completeness: "complete",
};
const record: ToolCallRecord = {
  id: "tool_test",
  agentId: "agent_test",
  conversationId: "conv_test",
  projectId: "proj_test",
  toolName: "read",
  risk: "read",
  args: {},
  cwd: "/tmp/project",
  status: "completed",
  revision: 1,
  attempt: 1,
  interactions: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  resultPayload: reference,
};

test("collects references across bounded pages before reconciling artifacts", async () => {
  const steps: string[] = [];
  await reconcileToolResultPayloads(
    {
      scanToolCalls: async (input) => {
        assert.equal(input?.maxRows, 256);
        assert.equal(input?.maxBytes, 8 * 1024 * 1024);
        steps.push(input?.afterId ?? "first");
        return input?.afterId
          ? {
              records: [{ ...record, resultPayload: undefined }],
              done: true,
              encodedBytes: 0,
            }
          : {
              records: [record],
              nextCursor: record.id,
              done: false,
              encodedBytes: 0,
            };
      },
    },
    {
      path: (value) => `/tmp/test-home/${value.logicalPath}`,
      reconcile: async (paths) => {
        steps.push("reconcile");
        assert.deepEqual(
          [...paths],
          [`/tmp/test-home/${reference.logicalPath}`],
        );
        return { removed: 0, skipped: 1 };
      },
    },
  );
  assert.deepEqual(steps, ["first", "tool_test", "reconcile"]);
});

test("does not garbage-collect payloads after a scan that cannot advance", async () => {
  await assert.rejects(
    reconcileToolResultPayloads(
      {
        scanToolCalls: async () => ({
          records: [],
          done: false,
          encodedBytes: 0,
        }),
      },
      {
        path: (value) => value.logicalPath,
        reconcile: async () => {
          assert.fail("incomplete scan must not reconcile");
        },
      },
    ),
    /did not advance/,
  );
});
