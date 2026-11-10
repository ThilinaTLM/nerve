import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { describe, it } from "node:test";
import { executeEdit } from "../../src/execution/filesystem/edit.js";
import { executeFind } from "../../src/execution/filesystem/find.js";
import { executeLs } from "../../src/execution/filesystem/list.js";
import { executeRead } from "../../src/execution/filesystem/read.js";
import { executeGrep } from "../../src/execution/filesystem/search.js";
import { projectAgentResult } from "../../src/result-projection/index.js";
import { createTempProject } from "../support/project-fixtures.js";

async function message(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected rejection");
}

describe("not-found directory listing", () => {
  it("lists the nearest existing ancestor, ordered by shared prefix", async () => {
    const project = await createTempProject();
    await mkdir(join(project.root, "src/domains/tools"), { recursive: true });
    await mkdir(join(project.root, "src/domains/core"));
    await project.write("src/domains/index.ts", "");
    const cwd = { cwd: project.root };
    const expected =
      "path not found: src/domains/tool/results.ts\nNearest existing directory src/domains/ contains: tools/ core/ index.ts";
    assert.equal(
      await message(executeRead({ path: "src/domains/tool/results.ts" }, cwd)),
      expected,
    );
    assert.equal(
      await message(executeLs({ path: "src/domains/tool/results.ts" }, cwd)),
      expected,
    );
    assert.equal(
      await message(
        executeFind({ pattern: "x", path: "src/domains/tool/results.ts" }, cwd),
      ),
      expected,
    );
    assert.equal(
      await message(
        executeGrep(
          {
            pattern: "x",
            paths: ["src/domains/index.ts", "src/domains/tool/r.ts"],
          },
          cwd,
        ),
      ),
      expected.replace("results.ts", "r.ts"),
    );
  });

  it("keeps absolute paths absolute and caps long listings", async () => {
    const project = await createTempProject();
    for (let i = 0; i < 35; i++)
      await project.write(`f${String(i).padStart(2, "0")}`, "");
    const missing = join(project.root, "x", "y.ts");
    const text = await message(executeRead({ path: missing }, { cwd: "/" }));
    const [first, second] = text.split("\n");
    assert.equal(first, `path not found: ${missing}`);
    assert.ok(
      second.startsWith(
        `Nearest existing directory ${project.root}${sep} contains: f00 `,
      ),
    );
    assert.ok(second.endsWith(" … 5 more"));
    assert.equal(second.split(" f").length - 1, 30);
  });

  it("is not added for edit", async () => {
    const project = await createTempProject();
    const text = await message(
      executeEdit(
        { path: "nope/a.ts", edits: [{ oldText: "a", newText: "b" }] },
        { cwd: project.root },
      ),
    );
    assert.doesNotMatch(text, /Nearest existing directory/);
  });

  it("survives projection without a duplicated tool name", () => {
    const projected = projectAgentResult({
      toolName: "read",
      args: { path: "a/b.ts" },
      result: undefined,
      status: "failed",
      phase: "completed",
      validatedArtifacts: [],
      error:
        "path not found: a/b.ts\nNearest existing directory ./ contains: a/",
    });
    assert.deepEqual(projected.blocks, [
      {
        type: "text",
        text: "read: path not found: a/b.ts\nNearest existing directory ./ contains: a/",
      },
    ]);
  });
});

describe("not-a-directory", () => {
  it("find names the path and suggests read for files", async () => {
    const project = await createTempProject();
    await project.write("src/a.ts", "");
    assert.equal(
      await message(
        executeFind({ pattern: "x", path: "src/a.ts" }, { cwd: project.root }),
      ),
      "not a directory: src/a.ts is a file. Use read.",
    );
  });
});
