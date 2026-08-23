import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSupervision } from "../src/index.js";

const supervised = {
  permissionLevel: "supervised" as const,
  mode: "coding" as const,
  autoApproveReadOnly: true,
};

describe("supervision engine", () => {
  it("auto-allows compound commands only when every segment is read-only", () => {
    const safe = evaluateSupervision({
      toolName: "bash",
      args: { command: "rg TODO src && git status --short" },
      agent: supervised,
    });
    assert.equal(safe.risk, "read");
    assert.equal(safe.decision, "allow");

    const mixed = evaluateSupervision({
      toolName: "bash",
      args: { command: "rg TODO src && pnpm fix" },
      agent: supervised,
    });
    assert.equal(mixed.risk, "command");
    assert.equal(mixed.decision, "approval");
    assert.deepEqual(mixed.suggestedGrants[0]?.tokens, ["pnpm", "fix"]);
  });

  it("matches command grants per non-read segment", () => {
    const allowed = evaluateSupervision({
      toolName: "bash",
      args: { command: "datadog logs read --service api | rg error" },
      agent: supervised,
      preferences: {
        grants: [
          {
            id: "grant_datadog",
            target: "command_prefix",
            tokens: ["datadog", "logs", "read"],
            risk: "command",
          },
        ],
      },
    });
    assert.equal(allowed.decision, "allow");
    assert.equal(allowed.matchedGrantId, "grant_datadog");

    const destructive = evaluateSupervision({
      toolName: "bash",
      args: { command: "datadog logs read && rm -rf build" },
      agent: supervised,
      preferences: {
        grants: [
          {
            id: "grant_datadog",
            target: "command_prefix",
            tokens: ["datadog", "logs", "read"],
            risk: "command",
          },
        ],
      },
    });
    assert.equal(destructive.risk, "destructive");
    assert.equal(destructive.decision, "approval");
    assert.deepEqual(destructive.suggestedGrants, []);
  });

  it("binds tool grants to assessed risk and never overrides hard denials", () => {
    const preferences = {
      grants: [
        {
          id: "grant_confluence",
          target: "tool" as const,
          toolName: "confluence_manage_page",
          risk: "command" as const,
        },
      ],
    };
    const normal = evaluateSupervision({
      toolName: "confluence_manage_page",
      args: { action: "archive" },
      agent: supervised,
      preferences,
    });
    assert.equal(normal.decision, "allow");

    const purge = evaluateSupervision({
      toolName: "confluence_manage_page",
      args: { action: "purge" },
      agent: supervised,
      preferences,
    });
    assert.equal(purge.risk, "destructive");
    assert.equal(purge.decision, "approval");

    const denied = evaluateSupervision({
      toolName: "confluence_manage_page",
      args: { action: "archive" },
      agent: supervised,
      preferences,
      constraints: [{ decision: "deny", reason: "Planning mode blocks it." }],
    });
    assert.equal(denied.decision, "deny");
  });
});
