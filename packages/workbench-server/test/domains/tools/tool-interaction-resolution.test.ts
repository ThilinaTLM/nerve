import assert from "node:assert/strict";
import test from "node:test";
import type {
  PermissionOverlayOrigin,
  PermissionRule,
} from "@nervekit/contracts/permissions";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { ToolInteractionResolutionService } from "../../../src/domains/tools/orchestration/tool-interaction-resolution.service.js";

const suggestedRule: PermissionRule = {
  id: "allow-command",
  enabled: true,
  priority: 0,
  enforcement: "overridable",
  when: { toolNames: ["bash"] },
  decision: "allow",
};

function pendingToolCall(permissionRuleSetId?: string): ToolCallRecord {
  return {
    id: "tool_test",
    revision: 1,
    projectId: "proj_test",
    conversationId: "conv_test",
    interactions: [
      {
        ordinal: 0,
        kind: "approval",
        status: "pending",
        request: {
          risk: "command",
          reason: "Approval required.",
          offeredScopes: ["single_call", "always_project"],
          suggestedExceptions: [],
          suggestedRules: [suggestedRule],
          permissionRuleSetId,
        },
      },
    ],
  } as unknown as ToolCallRecord;
}

function service(input: {
  toolCall: ToolCallRecord;
  saveRule(...args: unknown[]): Promise<unknown>;
}) {
  return new ToolInteractionResolutionService(
    { getToolCall: () => input.toolCall } as never,
    {} as never,
    { resolveApproval: async () => input.toolCall } as never,
    { saveRule: input.saveRule } as never,
    {} as never,
  );
}

const durableProjectRequest = {
  toolCallId: "tool_test",
  interactionOrdinal: 0,
  expectedRevision: 1,
  resolutionRequestId: "resolution_test",
  resolution: {
    kind: "approval" as const,
    action: "allow" as const,
    scope: "always_project" as const,
  },
};

test("durable approvals persist to the evaluation-time permission rule set", async () => {
  const calls: Array<{
    origin: PermissionOverlayOrigin;
    ruleSetId: string;
    rule: PermissionRule;
    ownerId?: string;
  }> = [];
  const resolver = service({
    toolCall: pendingToolCall("planning"),
    saveRule: async (origin, ruleSetId, rule, ownerId) => {
      calls.push({
        origin: origin as PermissionOverlayOrigin,
        ruleSetId: ruleSetId as string,
        rule: rule as PermissionRule,
        ownerId: ownerId as string | undefined,
      });
      return undefined;
    },
  });

  await resolver.resolve(durableProjectRequest);
  assert.deepEqual(calls, [
    {
      origin: "project",
      ruleSetId: "planning",
      rule: suggestedRule,
      ownerId: "proj_test",
    },
  ]);
});

test("historical approvals without rule-set evidence cannot create durable rules", async () => {
  let saved = false;
  const resolver = service({
    toolCall: pendingToolCall(),
    saveRule: async () => {
      saved = true;
    },
  });

  await assert.rejects(
    resolver.resolve(durableProjectRequest),
    /historical approval cannot create a durable rule/,
  );
  assert.equal(saved, false);
});
