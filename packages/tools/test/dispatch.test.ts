import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolName } from "@nerve/shared";
import { executeTool } from "../src/execution/index.js";
import { createTempProject } from "./helpers.js";

describe("executeTool dispatch", () => {
  it("dispatches core local tool names", async () => {
    const project = await createTempProject();
    await project.write("input.txt", "alpha\nbeta\n");

    const context = { cwd: project.root };
    const cases: Array<[ToolName, Record<string, unknown>]> = [
      ["read", { path: "input.txt" }],
      ["write", { path: "out.txt", content: "ok" }],
      ["edit", { path: "input.txt", oldText: "beta", newText: "gamma" }],
      ["ls", { path: "." }],
      ["find", { path: ".", pattern: "*.txt" }],
      ["grep", { path: ".", pattern: "alpha" }],
      [
        "bash",
        {
          command: `${JSON.stringify(process.execPath)} -e "process.stdout.write('ok')"`,
        },
      ],
    ];

    for (const [name, args] of cases) {
      const result = await executeTool(name, args, context);
      assert.equal(typeof result, "object", name);
    }
  });

  it("rejects process tools because they are orchestrator-owned", async () => {
    const processTools = [
      "process_start",
      "process_stop",
      "process_restart",
      "process_list",
      "process_logs",
    ] as ToolName[];

    for (const name of processTools) {
      await assert.rejects(
        executeTool(name, {}, { cwd: process.cwd() }),
        /orchestrator process manager/,
        name,
      );
    }
  });

  it("rejects subagent execution because it is orchestrator-owned", async () => {
    await assert.rejects(
      executeTool("subagent_run", {}, { cwd: process.cwd() }),
      /orchestrator agent runtime/,
    );
  });
});
