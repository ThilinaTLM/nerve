import { toolNameSchema } from "@nervekit/contracts/tools";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isKnownToolName,
  presentToolArguments,
  toolLifecycleRegistry,
  toolLifecycleSpec,
  unknownToolLifecycleSpec,
} from "./registry";
describe("tool lifecycle registry", () => {
  it("has exactly one typed spec for every active tool", () => {
    assert.deepEqual(
      Object.keys(toolLifecycleRegistry).sort(),
      [...toolNameSchema.options].sort(),
    );
    for (const name of toolNameSchema.options) {
      const spec = toolLifecycleRegistry[name];
      assert.equal(spec.name, name);
      assert.ok(spec.completedView);
      assert.equal(isKnownToolName(name), true);
    }
  });

  it("encodes persistent, until-result, and header-only argument regions", () => {
    for (const name of ["bash", "python_exec"] as const) {
      assert.equal(toolLifecycleRegistry[name].argumentRegion, "persistent");
      assert.deepEqual(toolLifecycleRegistry[name].resultPlaceholder, {
        variant: "text",
        rows: 2,
      });
    }
    for (const name of [
      "write",
      "edit",
      "todos_set",
      "ask_user",
      "plan_mode_present",
      "task_start",
      "explore",
      "jira_create_issue",
      "confluence_update_page",
    ] as const) {
      assert.equal(
        toolLifecycleRegistry[name].argumentRegion,
        "until-result",
        name,
      );
    }
    for (const name of ["read", "grep", "find", "ls", "task_logs"] as const) {
      assert.equal(toolLifecycleRegistry[name].argumentRegion, "none", name);
      assert.equal(
        toolLifecycleRegistry[name].resultPlaceholder,
        undefined,
        name,
      );
    }
    for (const name of [
      "web_search",
      "web_fetch",
      "jira_get_issue",
      "confluence_search_pages",
    ] as const) {
      assert.equal(toolLifecycleRegistry[name].argumentRegion, "none", name);
      assert.ok(toolLifecycleRegistry[name].resultPlaceholder, name);
    }
  });

  it("keeps subagent assignments visible through completion with the appropriate prompt format", () => {
    const spec = toolLifecycleRegistry.subagent_prompt;
    assert.equal(spec.argumentRegion, "persistent");
    assert.equal(spec.resultPlaceholder, undefined);

    const multiline = "Implement the change.\nRun focused tests.";
    const long = "x".repeat(501);
    for (const stage of [
      "drafting",
      "approval",
      "executing",
      "failed",
      "completed",
    ] as const) {
      for (const prompt of [multiline, long]) {
        const presentation = presentToolArguments(
          "subagent_prompt",
          { args: { name: "worker", prompt } },
          stage,
        );
        assert.equal(presentation.primaryArg?.text, "worker");
        assert.deepEqual(presentation.body, {
          kind: "code",
          text: prompt,
          language: "text",
          label: "Assignment",
          tail: true,
        });
      }
    }

    const short = presentToolArguments(
      "subagent_prompt",
      { args: { name: "worker", prompt: "Fix the test" } },
      "completed",
    );
    assert.deepEqual(short.body, {
      kind: "text-summary",
      text: "Fix the test",
      label: "Assignment",
      mono: true,
    });
    assert.equal(
      presentToolArguments(
        "subagent_prompt",
        { args: { name: "worker" } },
        "drafting",
      ).body.kind,
      "none",
    );
  });

  it("hides failed file mutation previews but keeps executable input context", () => {
    const edit = presentToolArguments(
      "edit",
      {
        args: {
          path: "src/app.ts",
          edits: [{ oldText: "old", newText: "new" }],
        },
      },
      "failed",
    );
    const write = presentToolArguments(
      "write",
      { args: { path: "src/new.ts", content: "export const value = 1;" } },
      "failed",
    );
    const bash = presentToolArguments(
      "bash",
      { args: { command: "pnpm test\npnpm check" } },
      "failed",
    );
    const python = presentToolArguments(
      "python_exec",
      { args: { code: "print('start')\nraise RuntimeError('boom')" } },
      "failed",
    );

    assert.equal(edit.body.kind, "none");
    assert.equal(write.body.kind, "none");
    assert.equal(bash.body.kind, "code");
    assert.equal(python.body.kind, "code");
  });

  it("shows environment key names but never values in approvals", () => {
    const presentation = presentToolArguments(
      "task_start",
      {
        args: {
          name: "dev",
          command: "pnpm dev",
          env: { API_TOKEN: "super-secret-value", NODE_ENV: "development" },
          ready: { kind: "detected_url" },
        },
      },
      "approval",
    );
    const serialized = JSON.stringify(presentation);
    assert.match(serialized, /API_TOKEN/);
    assert.match(serialized, /NODE_ENV/);
    assert.doesNotMatch(serialized, /super-secret-value|development/);
  });

  it("uses a separate redacted fallback for unknown historical tools", () => {
    assert.equal(
      toolLifecycleSpec("removed_extension"),
      unknownToolLifecycleSpec,
    );
    const presentation = presentToolArguments(
      "removed_extension",
      {
        args: {
          target: "workspace",
          api_token: "secret-value",
          count: 3,
        },
      },
      "completed",
    );
    assert.equal(presentation.body.kind, "key-values");
    const serialized = JSON.stringify(presentation);
    assert.match(serialized, /workspace/);
    assert.match(serialized, /\[redacted\]/);
    assert.doesNotMatch(serialized, /secret-value/);
  });
});
