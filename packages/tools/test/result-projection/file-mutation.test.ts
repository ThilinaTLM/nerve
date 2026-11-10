import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeEdit } from "../../src/execution/filesystem/edit.js";
import { executeWrite } from "../../src/execution/filesystem/write.js";
import {
  agentResultPolicyForTool,
  projectAgentResult,
} from "../../src/result-projection/index.js";
import { createTempProject } from "../support/project-fixtures.js";

function agentText(toolName: string, result: unknown): string {
  const projected = projectAgentResult(
    {
      toolName,
      args: {},
      result,
      status: "completed",
      phase: "completed",
      validatedArtifacts: [],
    },
    agentResultPolicyForTool(toolName),
  );
  return projected.blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

describe("file mutation agent result", () => {
  it("gives the agent exactly the executor one-liner for edit and write", async () => {
    const project = await createTempProject();
    const cwd = { cwd: project.root };
    const created = await executeWrite(
      { path: "a.txt", content: "x\ny\n" },
      cwd,
    );
    assert.equal(agentText("write", created), "Created a.txt (4 B).");
    const overwrote = await executeWrite({ path: "a.txt", content: "x" }, cwd);
    assert.equal(agentText("write", overwrote), "Overwrote a.txt (1 B).");
    const edited = await executeEdit(
      { path: "a.txt", edits: [{ oldText: "x", newText: "z" }] },
      cwd,
    );
    assert.equal(
      agentText("edit", edited),
      "Edited a.txt: 1 replacement, line 1.",
    );
  });

  it("keeps warnings and non-success outcomes visible", () => {
    const text = agentText("edit", {
      content: "Edited a.txt: 1 replacement, line 1.",
      contentBlocks: [
        { type: "text", text: "Edited a.txt: 1 replacement, line 1." },
      ],
      details: {
        mutationSummary: {
          operation: "edit",
          outcome: "partial",
          resources: [],
          warnings: ["careful"],
        },
      },
    });
    assert.equal(
      text,
      "Edited a.txt: 1 replacement, line 1.\nOutcome: partially succeeded\nWarning: careful",
    );
  });
});
