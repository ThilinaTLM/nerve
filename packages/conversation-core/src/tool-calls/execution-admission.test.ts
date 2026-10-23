import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  ConfigurationBlockedRequest,
  ToolApprovalBinding,
} from "@nervekit/contracts/core";
import { AssetStore } from "../assets/asset-store.js";
import { ConversationCore } from "../core.js";
import {
  options,
  createConversation,
  waitUntil,
} from "../runtime/lifecycle-test-helpers.js";
import { ToolCallService, type ToolCallChange } from "./tool-call.service.js";

async function fixture(
  t: TestContext,
  executionOptions: { replaySafe?: boolean; holdExecutions?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "nerve-admission-"));
  const config = options(
    directory,
    join(directory, "core.sqlite"),
    {
      resolve: async () => {
        throw new Error("No model expected");
      },
    },
    {
      execute: async () => {
        throw new Error("Unprepared dispatch forbidden");
      },
      isReplaySafe: () => executionOptions.replaySafe ?? false,
    },
  );
  const core = new ConversationCore(config);
  await createConversation(core, "conv_admission");
  let policy: "allow" | "approval" | "deny" = "approval";
  let target = "a";
  let blocked = false;
  let executions = 0;
  let beforeDispatch: (() => void) | undefined;
  const pendingExecutions: (() => void)[] = [];
  const finishExecutions = () => {
    for (const finish of pendingExecutions.splice(0)) finish();
  };
  const diagnostics: ConfigurationBlockedRequest = {
    diagnostics: [
      {
        scope: "user",
        document: "permissions.json",
        path: "/config/permissions.json",
        code: "invalid",
        pointer: "",
        affectedCapability: "execution",
        recoveryChoices: ["reload"],
      },
    ],
  };
  config.toolHost.prepareExecution = async (input) => ({
    args: input.args,
    cwd: input.cwd,
    target: { shell: target },
    dispatch: async () => {
      executions++;
      if (executionOptions.holdExecutions)
        await new Promise<void>((resolve) => pendingExecutions.push(resolve));
      return { kind: "completed", result: { content: "done" } };
    },
  });
  config.permissions.prepareAdmission = async (input) => {
    const binding: ToolApprovalBinding = {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      argumentsDigest: "a".repeat(64),
      executionTargetDigest: target.repeat(64),
      policyAuthorityDigest: "b".repeat(64),
    };
    return {
      check: () =>
        blocked
          ? { kind: "blocked", request: diagnostics }
          : {
              kind: "policy",
              supervision: {
                decision: policy,
                suggestedRules: [],
                authority: null,
              },
              evidence: {
                binding,
                requestGenerations: {},
                policyGenerations: {},
              },
            },
    };
  };
  const serviceOptions = {
    storage: config.storage,
    assets: new AssetStore(directory, config.storage),
    permissions: config.permissions,
    host: config.toolHost,
    coreTools: new Map(),
    emit: (change: ToolCallChange) => {
      if (
        change.kind === "tool_call_changed" &&
        !("removed" in change.toolCall) &&
        change.toolCall.state === "running"
      )
        beforeDispatch?.();
    },
    asyncBash: {
      adopt: async (): Promise<never> => {
        throw new Error("No process expected");
      },
    },
    context: async () => ({
      projectDir: directory,
      config: config.storage.conversations.getConfig("conv_admission")!,
    }),
  };
  let service = new ToolCallService(serviceOptions);
  t.after(async () => {
    await service.close();
    finishExecutions();
    await core.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get service() {
      return service;
    },
    storage: config.storage,
    createChild: () =>
      core.createConversation({
        id: "conv_child",
        projectId: "proj_test",
        parentConversationId: "conv_admission",
        config: config.storage.conversations.getConfig("conv_admission")!,
        application: {
          config: {
            agentProfile: "coding",
            model: { provider: "test", modelId: "test" },
          },
          applied: {
            schemaVersion: 1,
            name: "coding",
            instructions: "",
            locked: {},
          },
        },
      }),
    setPolicy: (value: typeof policy) => {
      policy = value;
    },
    setTarget: (value: string) => {
      target = value;
    },
    setBlocked: (value: boolean) => {
      blocked = value;
    },
    executions: () => executions,
    finishExecutions,
    onRunning: (callback: () => void) => {
      beforeDispatch = callback;
    },
    restart: async () => {
      await service.close();
      service = new ToolCallService(serviceOptions);
      await service.recover();
    },
  };
}

test("later denial defeats approval without dispatch", async (t) => {
  const f = await fixture(t);
  const call = await f.service.runUserCommand("conv_admission", "echo hello");
  assert.notEqual(call, "delivered");
  if (call === "delivered") return;
  assert.equal(f.storage.toolCalls.get(call.id)?.state, "awaiting_approval");
  f.setPolicy("deny");
  await f.service.resolveInteraction({
    toolCallId: call.id,
    resolutionRequestId: "deny-after-approval",
    resolution: { kind: "approval", decision: "approve" },
  });
  await waitUntil(() => !f.storage.toolCalls.get(call.id));
  assert.equal(f.executions(), 0);
});

test("restart re-captures a changed target and requires fresh approval", async (t) => {
  const f = await fixture(t);
  const call = await f.service.runUserCommand("conv_admission", "echo hello");
  if (call === "delivered") throw new Error("Expected call");
  const row = f.storage.toolCalls.get(call.id)!;
  f.storage.toolCalls.update(call.id, {
    state: "ready",
    supervision: {
      ...row.supervision!,
      approval: {
        toolCallId: call.id,
        toolName: "bash",
        argumentsDigest: "a".repeat(64),
        executionTargetDigest: "a".repeat(64),
        policyAuthorityDigest: "b".repeat(64),
      },
    },
  });
  f.setTarget("c");
  await f.restart();
  assert.equal(f.storage.toolCalls.get(call.id)?.state, "awaiting_approval");
  assert.equal(
    f.storage.toolCalls.get(call.id)?.supervision?.approval,
    undefined,
  );
  assert.equal(f.executions(), 0);
});

test("configuration blocked Retry is never approval and Cancel is readable cancellation", async (t) => {
  const f = await fixture(t);
  f.setBlocked(true);
  const call = await f.service.runUserCommand("conv_admission", "echo hello");
  if (call === "delivered") throw new Error("Expected call");
  assert.equal(f.storage.toolCalls.get(call.id)?.state, "awaiting_input");
  await assert.rejects(
    f.service.resolveInteraction({
      toolCallId: call.id,
      resolutionRequestId: "invalid",
      resolution: { kind: "approval", decision: "approve" },
    }),
  );
  await f.service.resolveInteraction({
    toolCallId: call.id,
    resolutionRequestId: "retry",
    resolution: { kind: "configuration_blocked", decision: "retry" },
  });
  await waitUntil(
    () =>
      f.storage.toolCalls.get(call.id)?.interaction?.resolutionRequestId ===
      undefined,
  );
  assert.equal(
    f.storage.toolCalls.get(call.id)?.interaction?.kind,
    "configuration_blocked",
  );
  await f.service.resolveInteraction({
    toolCallId: call.id,
    resolutionRequestId: "cancel",
    resolution: { kind: "configuration_blocked", decision: "cancel" },
  });
  assert.equal(f.executions(), 0);
  const event = f.storage.events
    .since("conv_admission", 0)
    .find((event) => event.type === "tool_call_response");
  assert.equal(event?.type, "tool_call_response");
  if (event?.type === "tool_call_response")
    assert.match(JSON.stringify(event.payload), /configuration is blocked/);
});

test("approval grants presented binding, not a silently changed target", async (t) => {
  const f = await fixture(t);
  const call = await f.service.runUserCommand("conv_admission", "echo hello");
  if (call === "delivered") throw new Error("Expected call");
  f.setTarget("c");
  await f.service.resolveInteraction({
    toolCallId: call.id,
    resolutionRequestId: "approve-old",
    resolution: { kind: "approval", decision: "approve" },
  });
  await waitUntil(
    () =>
      f.storage.toolCalls.get(call.id)?.interaction?.resolutionRequestId ===
      undefined,
  );
  assert.equal(f.storage.toolCalls.get(call.id)?.state, "awaiting_approval");
  assert.equal(f.executions(), 0);
  await f.service.resolveInteraction({
    toolCallId: call.id,
    resolutionRequestId: "approve-new",
    resolution: { kind: "approval", decision: "approve" },
  });
  await waitUntil(() => !f.storage.toolCalls.get(call.id));
  assert.equal(f.executions(), 1);
  const event = f.storage.events
    .since("conv_admission", 0)
    .find((event) => event.type === "tool_call_response");
  if (event?.type !== "tool_call_response") throw new Error("Expected result");
  assert.equal(
    event.payload.supervision?.approval?.executionTargetDigest,
    "c".repeat(64),
  );
});

test("health recovery retries admission and still asks for approval", async (t) => {
  const f = await fixture(t);
  f.setBlocked(true);
  const call = await f.service.runUserCommand("conv_admission", "echo hello");
  if (call === "delivered") throw new Error("Expected call");
  f.setBlocked(false);
  await f.service.retryConfigurationBlocked();
  assert.equal(f.storage.toolCalls.get(call.id)?.state, "awaiting_approval");
  assert.equal(f.executions(), 0);
});

test("execution independently bans child management tools", async (t) => {
  const f = await fixture(t);
  await f.createChild();
  for (const toolName of [
    "ask_user",
    "plan_present",
    "subagent_prompt",
    "subagent_status",
  ]) {
    f.setBlocked(true);
    const call = await f.service.runUserCommand("conv_child", "echo hello");
    if (call === "delivered") throw new Error("Expected call");
    f.storage.toolCalls.update(call.id, {
      toolName,
      state: "ready",
      interaction: null,
    });
    f.setBlocked(false);
    f.setPolicy("allow");
    await f.service.start([call.id, call.id]);
    assert.equal(f.storage.toolCalls.get(call.id), null);
  }
  assert.equal(f.executions(), 0);
});

test("current permission change affects next fresh and queued execution", async (t) => {
  const f = await fixture(t);
  f.setPolicy("allow");
  await f.service.runUserCommand("conv_admission", "echo first");
  assert.equal(f.executions(), 1);
  f.setBlocked(true);
  const queued = await f.service.runUserCommand(
    "conv_admission",
    "echo queued",
  );
  if (queued === "delivered") throw new Error("Expected call");
  f.storage.toolCalls.update(queued.id, { state: "ready", interaction: null });
  f.setPolicy("deny");
  f.setBlocked(false);
  await f.service.start([queued.id, queued.id]);
  await f.service.runUserCommand("conv_admission", "echo fresh");
  assert.equal(f.executions(), 1);
});

test("synchronous publication cannot insert a policy-change gap before dispatch", async (t) => {
  const f = await fixture(t);
  f.setPolicy("allow");
  f.onRunning(() => f.setPolicy("deny"));
  const call = await f.service.runUserCommand("conv_admission", "echo hello");
  if (call === "delivered") throw new Error("Expected call");
  assert.equal(f.executions(), 0);
  assert.equal(f.storage.toolCalls.get(call.id), null);
});

test("parallel attempts for one queued call dispatch only once", async (t) => {
  const f = await fixture(t);
  f.setBlocked(true);
  const call = await f.service.runUserCommand("conv_admission", "echo hello");
  if (call === "delivered") throw new Error("Expected call");
  f.storage.toolCalls.update(call.id, { state: "ready", interaction: null });
  f.setBlocked(false);
  f.setPolicy("allow");
  await Promise.all([
    f.service.start([call.id, call.id]),
    f.service.start([call.id]),
  ]);
  assert.equal(f.executions(), 1);
});

test("approved running calls retain durable evidence through restart and readmission", async (t) => {
  const f = await fixture(t, { replaySafe: true, holdExecutions: true });
  const call = await f.service.runUserCommand("conv_admission", "echo hello");
  if (call === "delivered") throw new Error("Expected call");
  const resolution = { kind: "approval", decision: "approve" } as const;
  const resolutionRequestId = "approval-before-restart";
  await f.service.resolveInteraction({
    toolCallId: call.id,
    resolutionRequestId,
    resolution,
  });
  await waitUntil(() => f.executions() === 1);
  const running = f.storage.toolCalls.get(call.id)!;
  assert.equal(running.state, "running");
  assert.equal(running.interaction?.resolutionRequestId, resolutionRequestId);
  assert.deepEqual(running.interaction?.resolution, resolution);
  assert.ok(running.supervision?.approval);
  const approvedBinding = running.supervision.approval;

  const restarted = f.restart();
  await waitUntil(() => f.executions() === 2);
  const readmitted = f.storage.toolCalls.get(call.id)!;
  assert.equal(readmitted.state, "running");
  assert.notEqual(readmitted.executionClaim, running.executionClaim);
  assert.equal(
    readmitted.interaction?.resolutionRequestId,
    resolutionRequestId,
  );
  assert.deepEqual(readmitted.interaction?.resolution, resolution);
  assert.deepEqual(readmitted.supervision?.approval, approvedBinding);

  f.finishExecutions();
  await restarted;
  const responses = f.storage.events
    .since("conv_admission", 0)
    .filter((event) => event.type === "tool_call_response");
  assert.equal(responses.length, 1);
  const response = responses[0]!;
  assert.equal(response.payload.resolutionRequestId, resolutionRequestId);
  assert.deepEqual(response.payload.interactionResolution, resolution);
  assert.deepEqual(response.payload.supervision?.approval, approvedBinding);
  // The durable receipt still deduplicates a repeated confirmation after recovery.
  await f.service.resolveInteraction({
    toolCallId: call.id,
    resolutionRequestId,
    resolution,
  });
  assert.equal(f.executions(), 2);
});
