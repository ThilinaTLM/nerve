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
    assert.equal(toolLifecycleRegistry.todos_set.argumentRegion, "persistent");
    for (const name of ["plan_mode_present"] as const) {
      assert.equal(
        toolLifecycleRegistry[name].argumentRegion,
        "until-result",
        name,
      );
    }
    for (const name of [
      "ask_user",
      "read",
      "grep",
      "find",
      "ls",
      "async_bash",
      "launch",
    ] as const) {
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

  it("lists sub-agent assignments by name until output or rejection takes over", () => {
    assert.equal(
      toolLifecycleRegistry.subagent_prompt.argumentRegion,
      "persistent",
    );
    const batch = presentToolArguments(
      "subagent_prompt",
      {
        args: {
          context: "shared",
          assignments: [
            { name: "auth", profile: "explore", prompt: "Look" },
            { name: "fix", prompt: "Fix it" },
          ],
        },
      },
      "executing",
    );
    assert.equal(batch.primaryArg?.text, "2 sub-agents");
    assert.equal(batch.body.kind, "entities");
    if (batch.body.kind === "entities") {
      assert.deepEqual(
        batch.body.items.map((item) => item.key),
        ["0", "1"],
      );
      assert.equal(batch.body.items[0].body, "Look");
      assert.equal(batch.body.context?.text, "shared");
    }
    const single = presentToolArguments(
      "subagent_prompt",
      { args: { assignments: [{ name: "auth", prompt: "Look" }] } },
      "drafting",
    );
    assert.equal(single.primaryArg?.text, "1 sub-agent");
    assert.equal(
      presentToolArguments(
        "subagent_stop",
        { args: { names: ["a", "b"] } },
        "completed",
      ).primaryArg?.text,
      "2 sub-agents",
    );
  });

  it("keeps launch names primary and execution selectors secondary throughout the lifecycle", () => {
    for (const stage of [
      "drafting",
      "approval",
      "executing",
      "failed",
      "completed",
    ] as const) {
      const presentation = presentToolArguments(
        "launch",
        {
          args: {
            action: "restart",
            name: "Web dev server",
            runId: "launch_previous",
            id: "launchdef_historical",
          },
        },
        stage,
      );
      assert.equal(presentation.primaryArg?.text, "restart Web dev server");
      assert.deepEqual(presentation.secondary, [
        { key: "run-id", text: "Run: launch_previous" },
      ]);
      assert.equal(presentation.body.kind, "none");
      assert.doesNotMatch(JSON.stringify(presentation), /launchdef_historical/);
    }
    assert.equal(
      presentToolArguments(
        "launch",
        { args: { action: "start", name: "pnpm dev" } },
        "executing",
      ).primaryArg?.text,
      "start pnpm dev",
    );
    const status = presentToolArguments(
      "launch",
      { args: { action: "status" } },
      "completed",
    );
    assert.equal(status.primaryArg?.text, "status");
    assert.deepEqual(status.secondary, []);
  });

  it("preserves ID-based launch history without changing async Bash presentation", () => {
    assert.equal(
      presentToolArguments(
        "launch",
        { args: { action: "stop", id: "launchdef_old" } },
        "completed",
      ).primaryArg?.text,
      "stop launchdef_old",
    );
    assert.equal(
      presentToolArguments(
        "async_bash",
        { args: { action: "logs", id: "bash_run" } },
        "completed",
      ).primaryArg?.text,
      "logs bash_run",
    );
  });

  it("treats removed tools as unknown recorded tools", () => {
    for (const name of [
      "explore",
      "subagent_new",
      "subagent_list",
      "plan_mode_enter",
      "plan_mode_force_exit",
    ]) {
      assert.equal(isKnownToolName(name), false);
      assert.equal(toolLifecycleSpec(name), unknownToolLifecycleSpec);
      assert.equal(toolLifecycleSpec(name).completedView, "generic");
    }
  });

  it("preserves file mutation and executable input context on failure", () => {
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

    assert.equal(edit.body.kind, "diff-sections");
    assert.equal(write.body.kind, "code");
    assert.equal(bash.body.kind, "code");
    assert.equal(python.body.kind, "code");
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
