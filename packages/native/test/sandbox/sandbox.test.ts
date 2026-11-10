// Runs through the compiled addon, covering the N-API boundary and the TS
// façade (prelude, JSON transport, TypeScript stripping, abort).
import assert from "node:assert/strict";
import { test } from "node:test";
import { sandbox } from "../../src/index.js";

test("TypeScript script awaits async host calls and prints results", async () => {
  const outcome = await sandbox.runSandboxScript({
    typescript: true,
    code: `
      interface Issue { key: string; status: string }
      const issues: Issue[] = await host.call("jira.issues.search", { jql: "project = X" });
      const open = issues.filter((i) => i.status !== "Done").map((i) => i.key);
      console.log(open.join(","), { count: open.length });
    `,
    onHostCall: async (method, args) => {
      assert.equal(method, "jira.issues.search");
      assert.deepEqual(args, { jql: "project = X" });
      await new Promise((r) => setTimeout(r, 10));
      return [
        { key: "X-1", status: "Done" },
        { key: "X-2", status: "To Do" },
      ];
    },
  });
  assert.equal(outcome.status, "completed", outcome.error);
  assert.equal(outcome.output, 'X-2 {\n  "count": 1\n}\n');
  assert.equal(outcome.hostCalls.length, 1);
});

test("host errors reject in the script as HostError", async () => {
  const outcome = await sandbox.runSandboxScript({
    code: `
      try { await host.call("jira.issues.delete", { key: "X-1" }); }
      catch (e) { console.log(e.name, e.message); }
    `,
    onHostCall: () => Promise.reject(new Error("denied: read-only mode")),
  });
  assert.equal(outcome.status, "completed", outcome.error);
  assert.equal(outcome.output, "HostError denied: read-only mode\n");
  assert.equal(outcome.hostCalls[0]?.ok, false);
});

test("abort signal cancels a script waiting on a slow host call", async () => {
  const controller = new AbortController();
  const started = performance.now();
  const outcome = await sandbox.runSandboxScript({
    code: `await host.call("approval.wait", {});`,
    signal: controller.signal,
    onHostCall: () => {
      setTimeout(() => controller.abort(), 50);
      return new Promise(() => {});
    },
  });
  assert.equal(outcome.status, "cancelled");
  assert.ok(performance.now() - started < 2000);
});

test("unsupported TypeScript fails before the script starts", async () => {
  const outcome = await sandbox.runSandboxScript({
    typescript: true,
    code: "enum Color { Red }",
    onHostCall: () => Promise.resolve(null),
  });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error ?? "", /enum|TypeScript/i);
});
