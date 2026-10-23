import assert from "node:assert/strict";
import test from "node:test";
import { toolApprovalBindingMatches } from "@nervekit/contracts/core";
import {
  canonicalDigest,
  createExecutionAdmission,
  type CurrentPolicy,
} from "./admission.js";

const input = {
  toolCallId: "call",
  conversationId: "conversation",
  projectDir: "/project",
  toolName: "bash",
  origin: "model" as const,
  args: { command: "echo hello" },
  cwd: "/project",
  target: {
    account: { id: "account", endpoint: "https://example.com" },
    shell: "/bin/sh",
  },
};
function fixture() {
  let decision: "allow" | "approval" | "deny" = "approval";
  let authority = "policy-v1";
  let child = false;
  let blocked = false;
  const prepare = createExecutionAdmission({
    invalidate: () => {},
    ensureLoaded: async () => {},
    requestGenerations: () => ({ request: 1 }),
    current: (): CurrentPolicy =>
      blocked
        ? {
            kind: "blocked",
            request: {
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
            },
          }
        : {
            kind: "available",
            authority,
            child,
            generations: { policy: 1 },
            evaluate: () => ({
              decision,
              suggestedRules: [],
              authority: { policy: authority },
            }),
          },
  });
  return {
    prepare,
    deny: () => {
      decision = "deny";
      authority = "policy-v2";
    },
    child: () => {
      child = true;
    },
    block: () => {
      blocked = true;
    },
  };
}

void test("canonical bindings ignore key order but bind account, interpreter and working directory", async () => {
  assert.equal(
    canonicalDigest({ b: 2, a: 1 }),
    canonicalDigest({ a: 1, b: 2 }),
  );
  const { prepare } = fixture();
  const first = (await prepare(input)).check();
  assert.equal(first.kind, "policy");
  if (first.kind !== "policy") return;
  for (const changed of [
    { ...input, cwd: "/other" },
    { ...input, target: { ...input.target, shell: "/bin/bash" } },
    {
      ...input,
      target: {
        ...input.target,
        account: { ...input.target.account, id: "other" },
      },
    },
  ]) {
    const second = (await prepare(changed)).check();
    assert.equal(second.kind, "policy");
    if (second.kind === "policy")
      assert.equal(
        toolApprovalBindingMatches(
          first.evidence.binding,
          second.evidence.binding,
        ),
        false,
      );
  }
});

void test("prepared and parallel gates evaluate CURRENT policy; a grant cannot defeat denial", async () => {
  const f = fixture();
  const gates = await Promise.all([
    f.prepare(input),
    f.prepare({ ...input, toolCallId: "second" }),
  ]);
  const earlier = gates[0].check();
  f.deny();
  for (const gate of gates) {
    const now = gate.check();
    assert.equal(now.kind, "policy");
    if (now.kind === "policy") {
      assert.equal(now.supervision.decision, "deny");
      if (earlier.kind === "policy")
        assert.equal(
          toolApprovalBindingMatches(
            earlier.evidence.binding,
            now.evidence.binding,
          ),
          false,
        );
    }
  }
});

void test("invalid security configuration blocks even already prepared calls", async () => {
  const f = fixture();
  const gate = await f.prepare(input);
  f.block();
  const result = gate.check();
  assert.equal(result.kind, "blocked");
  assert.equal("supervision" in result, false);
});

void test("children cannot execute advertised restricted tools", async () => {
  const f = fixture();
  f.child();
  for (const toolName of [
    "ask_user",
    "plan_present",
    "subagent_prompt",
    "subagent_status",
    "subagent_cancel",
  ]) {
    const result = (await f.prepare({ ...input, toolName })).check();
    assert.equal(result.kind, "policy");
    if (result.kind === "policy")
      assert.equal(result.supervision.decision, "deny");
  }
});

void test("non-JSON target identity fails closed rather than losing binding fields", () => {
  assert.throws(() => canonicalDigest({ shell: undefined }));
  assert.throws(() => canonicalDigest({ account: new Date() }));
  assert.throws(() => canonicalDigest({ value: NaN }));
});

void test("a generation changed during evaluation cannot publish admission", async () => {
  let generation = 1;
  const prepare = createExecutionAdmission({
    invalidate: () => {},
    ensureLoaded: async () => {},
    requestGenerations: () => ({}),
    current: () => ({
      kind: "available",
      generations: { policy: generation },
      authority: "authority",
      child: false,
      evaluate: () => {
        generation++;
        return { decision: "allow", suggestedRules: [], authority: null };
      },
    }),
  });
  const result = (await prepare(input)).check();
  assert.equal(result.kind, "stale");
});
