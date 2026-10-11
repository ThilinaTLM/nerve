import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackgroundProcess } from "@nervekit/conversation-core";
import { CoreProcessHost } from "./process.adapter.js";

void test("readiness matches combined stderr and does not stop a process on readiness timeout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-readiness-"));
  try {
    const stdout = join(dir, "stdout.txt");
    const stderr = join(dir, "stderr.txt");
    const combined = join(dir, "output.txt");
    await Promise.all([
      writeFile(stdout, ""),
      writeFile(stderr, "READY stderr"),
      writeFile(combined, "READY stderr"),
    ]);
    let cancelled = false;
    const process: BackgroundProcess = {
      ref: "process",
      outputFiles: { stdout, stderr, combined },
      wait: () => new Promise(() => {}),
      cancel: async () => {
        cancelled = true;
      },
    };
    const host = new CoreProcessHost("unused");
    host.spawn = async () => process;
    const input = {
      command: "unused",
      cwd: dir,
      artifactDir: dir,
      signal: new AbortController().signal,
    };
    assert.equal(
      (
        await host.start({
          ...input,
          ready: { kind: "pattern", pattern: "READY stderr" },
        })
      ).readiness?.status,
      "ready",
    );
    assert.equal(
      (
        await host.start({
          ...input,
          ready: { kind: "pattern", pattern: "never", timeoutMs: 0 },
        })
      ).readiness?.status,
      "timed_out",
    );
    assert.equal(cancelled, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
