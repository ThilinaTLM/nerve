import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectProcessOutput,
  projectProcessOutputPage,
} from "./process-output.js";

void test("small process output stays inline without file locators", async () => {
  assert.equal(
    await projectProcessOutput({
      output: "hello\n",
      outputFiles: { combined: "/capture/output.txt" },
      status: "completed",
    }),
    "hello\n",
  );
});
void test("large captures retain diagnostics from the whole file and recovery paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-projection-"));
  try {
    const path = join(dir, "output.txt");
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    lines[80] = "ERROR middle-file diagnostic";
    await writeFile(path, lines.join("\n"));
    const projected = await projectProcessOutput({
      outputFiles: { combined: path },
      status: "failed",
      exitCode: 1,
      captureTruncated: true,
    });
    assert.match(projected, /ERROR middle-file diagnostic/);
    assert.match(projected, /line 0/);
    assert.match(projected, /line 199/);
    assert.ok(projected.includes(path));
    assert.match(projected, /Use read\/grep for details\./);
    assert.match(projected, /Capture truncated at 16 MiB/);
    assert.ok(projected.split("\n").length <= 16);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
void test("pages use zero-based offsets, continuation, defaults and inline bounds", async () => {
  const output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  const page = await projectProcessOutputPage({
    output,
    outputFiles: { combined: "/output.txt" },
    offset: 10,
    limit: 2,
    status: "running",
  });
  assert.equal(
    page,
    "Lines 10-11 of 200 (running).\nline 10\nline 11\nNext offset: 12\nFile: /output.txt",
  );
  const tail = await projectProcessOutputPage({
    output,
    outputFiles: { combined: "/output.txt" },
    status: "completed",
  });
  assert.match(tail, /^Lines 120-199/);
  assert.ok(tail.split("\n").length <= 84);
  const small = await projectProcessOutputPage({
    output: "one\ntwo",
    outputFiles: { combined: "/output.txt" },
  });
  assert.equal(small, "Lines 0-1 of 2 (running).\none\ntwo");
  assert.equal(
    await projectProcessOutputPage({
      output: "one\n\ntwo",
      offset: 0,
      limit: 3,
    }),
    "Lines 0-2 of 3 (running).\none\n\ntwo",
  );
  const cut = await projectProcessOutputPage({
    output: "x".repeat(3000),
    outputFiles: { combined: "/output.txt" },
  });
  assert.ok(cut.split("\n")[1].length <= 2000);
  assert.match(cut, /File:/);
  await assert.rejects(projectProcessOutputPage({ output, offset: -1 }));
  await assert.rejects(projectProcessOutputPage({ output, limit: 501 }));
});
