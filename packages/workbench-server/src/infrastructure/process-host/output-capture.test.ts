import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureProcessOutput,
  PROCESS_OUTPUT_LIMIT_BYTES,
} from "./output-capture.js";

for (const capped of [false, true]) {
  void test(`capture drains child output before diagnostic and bounds artifacts (capped=${capped})`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "nerve-capture-"));
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const files = {
      stdout: join(dir, "stdout"),
      stderr: join(dir, "stderr"),
      combined: join(dir, "combined"),
    };
    const progress: { stream: string; chunk: string }[] = [];
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const diagnostic =
      "\n[Nerve diagnostic: activation or submitted command may have failed]\n";
    try {
      const drained = captureProcessOutput(
        { stdout, stderr },
        files,
        (update) => progress.push(update),
        async () => {
          await closed;
          return diagnostic;
        },
      );
      stdout.end("PROBE\n");
      stderr.end(
        capped
          ? Buffer.alloc(PROCESS_OUTPUT_LIMIT_BYTES + 1024, 120)
          : "child error\n",
      );
      close();
      await drained;
      assert.equal(await readFile(files.stdout, "utf8"), "PROBE\n");
      const error = await readFile(files.stderr, "utf8");
      const combined = await readFile(files.combined, "utf8");
      assert.ok(error.endsWith(diagnostic));
      assert.ok(combined.endsWith(diagnostic));
      assert.equal(error.split(diagnostic).length, 2);
      assert.equal(
        progress.filter(
          (update) => update.chunk === diagnostic && update.stream === "stderr",
        ).length,
        1,
      );
      if (capped) assert.match(error, /Nerve: process output truncated/);
      else assert.equal(error, `child error\n${diagnostic}`);
      for (const path of Object.values(files))
        assert.ok((await stat(path)).size <= PROCESS_OUTPUT_LIMIT_BYTES);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

void test("successful capped capture reports truncation without a failure diagnostic", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-capture-success-"));
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const files = {
    stdout: join(dir, "stdout"),
    stderr: join(dir, "stderr"),
    combined: join(dir, "combined"),
  };
  try {
    const drained = captureProcessOutput({ stdout, stderr }, files);
    stdout.end(Buffer.alloc(PROCESS_OUTPUT_LIMIT_BYTES + 1024, 120));
    stderr.end();
    await drained;
    assert.match(
      await readFile(files.stderr, "utf8"),
      /Nerve: process output truncated/,
    );
    assert.ok((await stat(files.combined)).size <= PROCESS_OUTPUT_LIMIT_BYTES);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("capture rejects writer errors and settles pending writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-capture-error-"));
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  try {
    const drained = captureProcessOutput(
      { stdout, stderr },
      {
        stdout: dir,
        stderr: join(dir, "stderr"),
        combined: join(dir, "combined"),
      },
    );
    stdout.end("pending stdout");
    stderr.end("pending stderr");
    await assert.rejects(drained, /EISDIR/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
