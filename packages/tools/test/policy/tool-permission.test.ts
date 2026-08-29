import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateToolPermission } from "../../src/index.js";

const supervised = { permissionLevel: "supervised" as const };

describe("tool permission policy", () => {
  it("uses fixed permission-level baselines", () => {
    assert.equal(
      evaluateToolPermission({
        toolName: "read",
        args: { path: "a" },
        permissionLevel: "read_only",
      }).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPermission({
        toolName: "web_fetch",
        args: { url: "https://example.com" },
        permissionLevel: "read_only",
      }).decision,
      "deny",
    );
    assert.equal(
      evaluateToolPermission({
        toolName: "read",
        args: { path: "a" },
        ...supervised,
      }).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPermission({
        toolName: "write",
        args: { path: "a", content: "x" },
        ...supervised,
      }).decision,
      "approval",
    );
    assert.equal(
      evaluateToolPermission({
        toolName: "write",
        args: { path: "a", content: "x" },
        permissionLevel: "autonomous",
      }).decision,
      "allow",
    );
  });

  it("auto-allows compound commands only when every segment is read-only", () => {
    const safe = evaluateToolPermission({
      toolName: "bash",
      args: { command: "rg TODO src && git status --short" },
      ...supervised,
    });
    assert.equal(safe.risk, "read");
    assert.equal(safe.decision, "allow");
    const mixed = evaluateToolPermission({
      toolName: "bash",
      args: { command: "rg TODO src && pnpm fix" },
      ...supervised,
    });
    assert.equal(mixed.risk, "command");
    assert.equal(mixed.decision, "approval");
    assert.equal(mixed.suggestedExceptions[0]?.tool, "bash");
    assert.equal(mixed.suggestedExceptions[0]?.rule, "pnpm fix");
  });

  it("requires every mutating command segment to be covered", () => {
    const exception = {
      id: "exception_datadog",
      effect: "allow" as const,
      tool: "bash" as const,
      rule: "datadog logs read*",
    };
    const allowed = evaluateToolPermission({
      toolName: "bash",
      args: { command: "datadog logs read --service api | rg error" },
      ...supervised,
      exceptions: [exception],
    });
    assert.equal(allowed.decision, "allow");
    const partial = evaluateToolPermission({
      toolName: "bash",
      args: { command: "datadog logs read && pnpm fix" },
      ...supervised,
      exceptions: [exception],
    });
    assert.equal(partial.decision, "approval");
  });

  it("does not let command exceptions authorize destructive escalation", () => {
    const exception = {
      id: "exception_datadog",
      effect: "allow" as const,
      tool: "bash" as const,
      rule: "datadog logs read*",
    };
    const result = evaluateToolPermission({
      toolName: "bash",
      args: { command: "datadog logs read && rm -rf build" },
      ...supervised,
      exceptions: [exception],
    });
    assert.equal(result.risk, "destructive");
    assert.equal(result.decision, "approval");
    assert.deepEqual(result.suggestedExceptions, []);
  });

  it("applies blocks before Autonomous and never lets allows elevate Read only", () => {
    const block = {
      id: "exception_block",
      effect: "deny" as const,
      tool: "read" as const,
      rule: "secrets/**",
    };
    const context = { cwd: "/workspace", projectDir: "/workspace" };
    assert.equal(
      evaluateToolPermission({
        toolName: "read",
        args: { path: "secrets/key" },
        permissionLevel: "autonomous",
        exceptions: [block],
        context,
      }).decision,
      "deny",
    );
    assert.equal(
      evaluateToolPermission({
        toolName: "grep",
        args: { pattern: "token", path: "." },
        permissionLevel: "autonomous",
        exceptions: [{ ...block, id: "exception_grep", tool: "grep" }],
        context,
      }).decision,
      "deny",
      "recursive reads are blocked when their tool rule can include a denied path",
    );
    const allow = {
      id: "exception_write",
      effect: "allow" as const,
      tool: "write" as const,
      rule: "generated/**",
    };
    assert.equal(
      evaluateToolPermission({
        toolName: "write",
        args: { path: "generated/a", content: "x" },
        permissionLevel: "read_only",
        exceptions: [allow],
        context,
      }).decision,
      "deny",
    );
    assert.equal(
      evaluateToolPermission({
        toolName: "write",
        args: { path: "generated/a", content: "x" },
        ...supervised,
        exceptions: [allow],
        context,
      }).decision,
      "allow",
    );
  });

  it("matches website exceptions by normalized host", () => {
    const allow = {
      id: "exception_web",
      effect: "allow" as const,
      tool: "web_fetch" as const,
      rule: "https://*.example.com/**",
    };
    assert.equal(
      evaluateToolPermission({
        toolName: "web_fetch",
        args: { url: "https://docs.example.com/path" },
        ...supervised,
        exceptions: [allow],
      }).decision,
      "allow",
    );
    assert.equal(
      evaluateToolPermission({
        toolName: "web_fetch",
        args: { url: "https://example.com/path" },
        ...supervised,
        exceptions: [allow],
      }).decision,
      "approval",
    );
  });

  it("keeps hard constraints and opaque Python non-durable", () => {
    const denied = evaluateToolPermission({
      toolName: "write",
      args: { path: "a", content: "x" },
      permissionLevel: "autonomous",
      constraints: [{ decision: "deny", reason: "Planning mode blocks it." }],
    });
    assert.equal(denied.decision, "deny");
    const python = evaluateToolPermission({
      toolName: "python_exec",
      args: { code: "print(1)" },
      ...supervised,
    });
    assert.equal(python.decision, "approval");
    assert.deepEqual(python.suggestedExceptions, []);
  });
});
