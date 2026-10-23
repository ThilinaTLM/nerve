import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  productionAdmissionFixture,
  until,
} from "./production-admission-fixture.js";

type Fixture = Awaited<ReturnType<typeof productionAdmissionFixture>>;
function callId(call: Awaited<ReturnType<Fixture["command"]>>) {
  if (call === "delivered" || !("toolName" in call))
    throw new Error("Expected inline tool call");
  return call.id;
}

void test(
  "production wiring: current permission selection controls the next execution",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t);
    await f.command();
    assert.equal(f.spawns.length, 1);
    await f.save({ permissionRuleSetId: "read_only" });
    const id = callId(await f.command());
    assert.equal(f.spawns.length, 1);
    const response = f.runtime.storage.events
      .since("c", 0)
      .find(
        (event) =>
          event.type === "tool_call_response" &&
          event.payload.toolCallId === id,
      );
    assert.equal(response?.type, "tool_call_response");
    if (response?.type === "tool_call_response")
      assert.equal(response.payload.outcome, "denied");
  },
);

void test(
  "production wiring: approval cannot defeat a later policy denial",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t);
    await f.save({ permissionRuleSetId: "supervised" });
    const id = callId(await f.command());
    assert.equal(
      f.runtime.storage.toolCalls.get(id)?.state,
      "awaiting_approval",
    );
    await f.save({ permissionRuleSetId: "read_only" });
    await f.runtime.core.resolveInteraction({
      toolCallId: id,
      resolutionRequestId: "approve-stale-policy",
      resolution: { kind: "approval", decision: "approve" },
    });
    await until(() => !f.runtime.storage.toolCalls.get(id));
    assert.equal(f.spawns.length, 0);
    const response = f.runtime.storage.events
      .since("c", 0)
      .find(
        (event) =>
          event.type === "tool_call_response" &&
          event.payload.toolCallId === id,
      );
    if (response?.type !== "tool_call_response")
      assert.fail("Expected denied response");
    assert.equal(response.payload.outcome, "denied");
  },
);

for (const invalid of ["malformed", "unreadable"] as const) {
  void test(
    `production wiring: ${invalid} permissions block; Retry reevaluates and Cancel never approves`,
    { skip: process.platform === "win32" },
    async (t) => {
      const f = await productionAdmissionFixture(t);
      await f.save({ permissionRuleSetId: "supervised" });
      const path = join(f.paths.configPath, "permissions.json");
      // A directory is unreadable as a policy document even when tests run as root.
      const { rm } = await import("node:fs/promises");
      await rm(path, { force: true });
      if (invalid === "unreadable") await mkdir(path);
      else await writeFile(path, "{broken");
      f.runtime.admissionPolicy.invalidate();
      const id = callId(await f.command());
      const blocked = f.runtime.storage.toolCalls.get(id)!;
      assert.equal(blocked.state, "awaiting_input");
      assert.equal(blocked.interaction?.kind, "configuration_blocked");
      if (blocked.interaction?.kind === "configuration_blocked")
        assert.equal(blocked.interaction.request.diagnostics[0].path, path);
      await assert.rejects(
        f.runtime.core.resolveInteraction({
          toolCallId: id,
          resolutionRequestId: "not-approval",
          resolution: { kind: "approval", decision: "approve" },
        }),
      );
      await f.runtime.core.resolveInteraction({
        toolCallId: id,
        resolutionRequestId: "retry-invalid",
        resolution: { kind: "configuration_blocked", decision: "retry" },
      });
      await until(
        () =>
          f.runtime.storage.toolCalls.get(id)?.interaction
            ?.resolutionRequestId === undefined,
      );
      assert.equal(
        f.runtime.storage.toolCalls.get(id)?.interaction?.kind,
        "configuration_blocked",
      );
      assert.equal(f.spawns.length, 0);
      await f.runtime.core.resolveInteraction({
        toolCallId: id,
        resolutionRequestId: "cancel-invalid",
        resolution: { kind: "configuration_blocked", decision: "cancel" },
      });
      assert.equal(f.runtime.storage.toolCalls.get(id), null);
      const response = f.runtime.storage.events
        .since("c", 0)
        .find(
          (event) =>
            event.type === "tool_call_response" &&
            event.payload.toolCallId === id,
        );
      if (response?.type !== "tool_call_response")
        assert.fail("Expected cancellation");
      assert.equal(response.payload.outcome, "cancelled");
      assert.match(
        JSON.stringify(response.payload.agentProjection),
        /configuration is blocked/,
      );

      const repairId = callId(await f.command());
      await rm(path, { recursive: true, force: true });
      await writeFile(path, JSON.stringify({ schemaVersion: 2, overlays: [] }));
      f.runtime.admissionPolicy.invalidate();
      await f.runtime.core.resolveInteraction({
        toolCallId: repairId,
        resolutionRequestId: "retry-repaired",
        resolution: { kind: "configuration_blocked", decision: "retry" },
      });
      await until(
        () =>
          f.runtime.storage.toolCalls.get(repairId)?.state ===
          "awaiting_approval",
      );
      assert.equal(f.spawns.length, 0, "repair/Retry must not grant approval");
    },
  );
}

void test(
  "production wiring: restart re-captures a changed shell and requires fresh approval",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t);
    await f.save({ permissionRuleSetId: "supervised" });
    const id = callId(await f.command());
    await f.runtime.core.resolveInteraction({
      toolCallId: id,
      resolutionRequestId: "approve-before-restart",
      resolution: { kind: "approval", decision: "approve" },
    });
    // Resolution acknowledgement precedes async execution preparation; shutdown fences dispatch.
    assert.ok(f.runtime.storage.toolCalls.get(id)?.supervision?.approval);
    await f.runtime.core.close();
    await f.restartWithShell("/bin/bash");
    const refreshed = f.runtime.storage.toolCalls.get(id)!;
    assert.equal(refreshed.state, "awaiting_approval");
    assert.equal(refreshed.supervision?.approval, undefined);
    assert.equal(refreshed.interaction?.resolution, undefined);
    assert.equal(f.spawns.length, 0);
    await f.runtime.core.resolveInteraction({
      toolCallId: id,
      resolutionRequestId: "approve-new-shell",
      resolution: { kind: "approval", decision: "approve" },
    });
    await until(() => !f.runtime.storage.toolCalls.get(id));
    assert.equal(f.spawns.length, 1);
    assert.equal(
      f.spawns[0].preparedShell!.invocation.launch.shell,
      await realpath("/bin/bash"),
    );
  },
);

void test(
  "production wiring: children reject issued ask/plan/delegation calls despite registered handlers",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await productionAdmissionFixture(t);
    await f.createChild();
    const names = [
      "ask_user",
      "plan_present",
      "subagent_prompt",
      "subagent_status",
      "subagent_stop",
    ];
    const now = new Date().toISOString();
    const event = f.runtime.storage.events.append({
      id: "advertised-child-calls",
      conversationId: "child",
      turnId: "child-turn",
      inputId: null,
      createdAt: now,
      type: "assistant_message",
      llmRepresentation: "assistant",
      payload: {
        content: names.map((name) => ({
          type: "toolCall",
          id: `provider-${name}`,
          name,
          arguments: {},
        })),
        api: "test",
        provider: "test",
        model: "test",
        stopReason: "toolUse",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    });
    names.forEach((toolName, contentIndex) =>
      f.runtime.storage.toolCalls.insert({
        id: `child-${toolName}`,
        conversationId: "child",
        turnId: "child-turn",
        providerCallId: `provider-${toolName}`,
        assistantEventId: event.id,
        contentIndex,
        origin: "model",
        toolName,
        arguments: {},
        state: "ready",
        supervision: null,
        interaction: null,
        executionClaim: null,
        updatedAt: now,
      }),
    );
    await f.runtime.core.start();
    const responses = f.runtime.storage.events
      .since("child", 0)
      .filter((event) => event.type === "tool_call_response");
    assert.equal(responses.length, names.length);
    for (const response of responses) {
      assert.equal(response.payload.outcome, "denied");
      assert.match(response.payload.supervision?.reason ?? "", /Child agents/);
      assert.deepEqual(response.payload.supervision?.authority, {
        role: "child",
      });
    }
    assert.equal(f.spawns.length, 0);
  },
);
