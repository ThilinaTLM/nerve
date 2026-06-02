import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeBash } from "../src/execution/index.js";
import { createTempProject } from "./helpers.js";

const node = JSON.stringify(process.execPath);

describe("bash executor", () => {
  it("rejects empty commands", async () => {
    await assert.rejects(
      executeBash({ command: "   " }, { cwd: process.cwd() }),
      /command.*non-empty string/,
    );
  });

  it("returns stdout, stderr, and exitCode for successful commands", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "process.stdout.write('out'); process.stderr.write('err')"`,
      },
      { cwd: project.root },
    );

    assert.equal(result.stdout, "out");
    assert.equal(result.stderr, "err");
    assert.equal(result.exitCode, 0);
  });

  it("normalizes non-zero commands instead of throwing", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"`,
      },
      { cwd: project.root },
    );

    assert.equal(result.stdout, "out");
    assert.equal(result.stderr, "err");
    assert.equal(result.exitCode, 7);
  });
});
