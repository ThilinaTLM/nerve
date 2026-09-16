import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalToolQueryService } from "../../../src/domains/tools/execution/canonical-tool-query.service.js";

test("completed canonical tool calls remain queryable after their wait group closes", async () => {
  const updatedAt = "2026-09-15T00:00:01.000Z";
  const service = new CanonicalToolQueryService({
    execution: {
      async listWaitGroups() {
        return [
          {
            schemaVersion: 1,
            waitGroupId: "wait_group_test",
            runId: "run_test",
            membershipManifestId: "manifest_wait_members_test",
            continuationEntryId: null,
            continuationConsumed: true,
            state: "closed",
            revision: 2,
            members: [
              {
                schemaVersion: 1,
                memberId: "member_test",
                memberKind: "tool_call",
                ownerId: "tool_test",
                executionState: "succeeded",
                attachmentDisposition: "attached",
                resultEntryId: "entry_tool_result_test",
                contributesToBarrier: true,
                revision: 2,
              },
            ],
          },
        ];
      },
      async readArtifactManifest(manifestId: string) {
        if (manifestId === "manifest_wait_proposals_test") {
          return {
            proposals: [
              {
                memberId: "member_test",
                suffix: "test",
                providerToolCallId: "provider_test",
                toolName: "read",
                normalizedInput: { path: "README.md" },
                cwd: "/tmp",
                risk: "read",
                admission: "authorized",
                authorizationEvidence: {},
                owner: {
                  agentId: "agent_test",
                  conversationId: "conv_test",
                  projectId: "proj_test",
                },
                policyObservation: {
                  observedAt: "2026-09-15T00:00:00.000Z",
                  selectedRuleSetId: "autonomous",
                },
              },
            ],
          };
        }
        if (manifestId === "manifest_tool_result_test") {
          return {
            result: {
              id: "tool_test",
              agentId: "agent_test",
              conversationId: "conv_test",
              projectId: "proj_test",
              toolName: "read",
              providerToolCallId: "provider_test",
              runId: "run_test",
              risk: "read",
              args: { path: "README.md" },
              cwd: "/tmp",
              status: "completed",
              phase: "completed",
              revision: 2,
              attempt: 1,
              interactions: [],
              result: { content: "hello" },
              createdAt: "2026-09-15T00:00:00.000Z",
              updatedAt,
            },
          };
        }
        return undefined;
      },
    },
  } as never);

  const result = await service.listToolCallPreviews({
    conversationId: "conv_test",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.status, "completed");
  assert.equal(result[0]?.settledAt, updatedAt);
});
