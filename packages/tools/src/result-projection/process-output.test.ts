import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processAgentResultPolicy } from "./policies/process.js";
import {
  projectProcessOutput,
  projectProcessOutputPage,
  projectProcessOutputResult,
} from "./process-output.js";
import { projectAgentResult } from "./projector.js";

void test("small process output stays inline without file locators", async () => {
  assert.equal(
    await projectProcessOutput({
      output: "hello\n",
      outputFiles: { combined: "/capture/output.txt" },
      status: "completed",
      exitCode: 0,
    }),
    "hello\nexit 0",
  );
});
void test("output up to the inline budget stays whole regardless of line count", async () => {
  const output = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(
    await projectProcessOutput({
      output,
      outputFiles: { combined: "/capture/output.txt" },
      status: "completed",
      exitCode: 0,
    }),
    `${output}\nexit 0`,
  );
});

void test("large captures show a tail-biased head/tail view with one recovery path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-projection-"));
  try {
    const path = join(dir, "output.txt");
    const lines = Array.from(
      { length: 2000 },
      (_, i) => `line ${i} ${"x".repeat(120)}`,
    );
    lines[1000] = "ERROR middle-file match";
    await writeFile(path, lines.join("\n"));
    const { text, snapshot } = await projectProcessOutputResult({
      outputFiles: {
        combined: path,
        stdout: join(dir, "stdout.txt"),
        stderr: join(dir, "stderr.txt"),
      },
      status: "failed",
      exitCode: 1,
      captureTruncated: true,
    });
    const shown = text.split("\n");
    assert.match(text, /^exit 1\nCapture truncated/);
    assert.ok(text.includes("line 0 "));
    assert.ok(text.includes("line 1999 "));
    assert.ok(!text.includes("ERROR middle-file match"));
    const notice = shown.at(-1) ?? "";
    const match =
      /^\[Showing lines 1-(\d+) and (\d+)-2000 of 2000; [\d.]+KB omitted\. Full output: (.+)\]$/.exec(
        notice,
      );
    assert.ok(match, notice);
    assert.equal(match[3], path);
    assert.equal(text.split(dir).length, 2, "only the combined path is listed");
    const head = Number(match[1]);
    const tail = 2000 - Number(match[2]) + 1;
    assert.ok(tail > head * 3, `tail ${tail} should dominate head ${head}`);
    assert.ok(Buffer.byteLength(text) <= 8_000);
    assert.ok(shown.length <= 200);
    assert.ok(Buffer.byteLength(text) > 6_000, "the preview uses its budget");
    assert.equal(snapshot?.strategy, "head_tail");
    assert.equal(snapshot?.originalTextLines, 2002);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("without a combined file the locator lists stdout and only non-empty stderr", async () => {
  const output = "y".repeat(100).concat("\n").repeat(200);
  const quiet = await projectProcessOutput({
    stdout: output,
    stderr: "",
    outputFiles: { stdout: "/o/stdout.txt", stderr: "/o/stderr.txt" },
    status: "completed",
    exitCode: 0,
  });
  assert.match(quiet, /Full output: stdout: \/o\/stdout\.txt\]$/);
  const noisy = await projectProcessOutput({
    stdout: output,
    stderr: "warning\n",
    outputFiles: { stdout: "/o/stdout.txt", stderr: "/o/stderr.txt" },
    status: "completed",
    exitCode: 0,
  });
  assert.match(
    noisy,
    /Full output: stdout: \/o\/stdout\.txt; stderr: \/o\/stderr\.txt\]$/,
  );
});

void test("the tool result pass leaves producer-projected bash output unchanged", async () => {
  for (const lines of [10, 300, 2000]) {
    const output = Array.from({ length: lines }, (_, i) => `row ${i}`).join(
      "\n",
    );
    const content = await projectProcessOutput({
      output,
      outputFiles: { combined: "/capture/output.txt" },
      status: "completed",
      exitCode: 0,
    });
    const projected = projectAgentResult(
      {
        toolName: "bash",
        args: {},
        status: "completed",
        validatedArtifacts: [],
        result: {
          stdout: output,
          stderr: "",
          content,
          details: { processStatusIncluded: true },
        },
      },
      processAgentResultPolicy,
    );
    assert.equal(projected.snapshot.fastPath, true);
    assert.deepEqual(projected.blocks, [{ type: "text", text: content }]);
  }
});

void test("pages keep zero-based offsets and hint only at cuts the tool made", async () => {
  const output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  const page = await projectProcessOutputPage({
    output,
    outputFiles: { combined: "/output.txt" },
    offset: 10,
    limit: 2,
    status: "running",
  });
  // The caller chose limit 2: no Next.
  assert.equal(
    page,
    "line 10\nline 11\nLines 11-12 of 200 (running).\nFile: /output.txt",
  );
  const defaultLimit = await projectProcessOutputPage({
    output,
    outputFiles: { combined: "/output.txt" },
    offset: 10,
    status: "running",
  });
  assert.match(
    defaultLimit,
    /\nLines 11-110 of 200 \(running\)\. Next: \{"offset":110\}\nFile:/,
  );
  const tail = await projectProcessOutputPage({
    output,
    outputFiles: { combined: "/output.txt" },
    status: "completed",
  });
  assert.match(
    tail,
    /\nLines 101-200 of 200 \(exit unknown\)\. Earlier: \{"offset":0\}\nFile:/,
  );
  assert.ok(tail.split("\n").length <= 104);
  const small = await projectProcessOutputPage({
    output: "one\ntwo",
    outputFiles: { combined: "/output.txt" },
  });
  assert.equal(small, "one\ntwo\nLines 1-2 of 2 (running).");
  assert.equal(
    await projectProcessOutputPage({
      output: "one\n\ntwo",
      offset: 0,
      limit: 3,
    }),
    "one\n\ntwo\nLines 1-3 of 3 (running).",
  );
  const cut = await projectProcessOutputPage({
    output: "x".repeat(3000),
    outputFiles: { combined: "/output.txt" },
  });
  assert.ok(cut.split("\n")[0].length <= 2000);
  assert.match(cut, /File:/);
  await assert.rejects(projectProcessOutputPage({ output, offset: -1 }));
  await assert.rejects(projectProcessOutputPage({ output, limit: 501 }));
});

void test("inline and empty process results always retain terminal exit codes", async () => {
  for (const exitCode of [0, 7]) {
    for (const output of ["", "some output\n"]) {
      const projected = await projectProcessOutput({
        output,
        status: exitCode === 0 ? "completed" : "failed",
        exitCode,
      });
      assert.match(projected, new RegExp(`exit ${exitCode}$`));
      assert.ok(projected.includes(output));
    }
  }
  assert.equal(
    await projectProcessOutput({ output: "", status: "lost", exitCode: null }),
    "lost",
  );
  assert.equal(
    await projectProcessOutput({ output: "", status: "running" }),
    "running",
  );
  assert.equal(
    await projectProcessOutput({ output: "", exitCode: 0 }),
    "exit 0",
  );
});

void test("overflow success and terminal log pages retain exit codes", async () => {
  const output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  assert.match(
    await projectProcessOutput({ output, status: "completed", exitCode: 0 }),
    /\nexit 0$/,
  );
  for (const exitCode of [0, 7, null]) {
    assert.equal(
      await projectProcessOutputPage({
        output: "one",
        status: "completed",
        exitCode,
      }),
      `one\nLines 1-1 of 1 (exit ${exitCode ?? "unknown"}).`,
    );
  }
});
