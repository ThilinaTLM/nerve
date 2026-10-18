import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitCommandError, runGitCommand } from "../../src/git/git-command.js";

describe("Rust-hosted Git command execution", () => {
  it("captures successful UTF-8 output", async () => {
    const result = await runGitCommand("git", process.cwd(), [
      "-c",
      "alias.nerve-echo=!printf 'héllo\\n'",
      "nerve-echo",
    ]);
    assert.equal(result.stdout, "héllo\n");
    assert.equal(result.stderr, "");
  });

  it("preserves stdout and stderr for non-zero exits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nerve-git-command-"));
    try {
      await writeFile(join(dir, "left"), "left\n");
      await writeFile(join(dir, "right"), "right\n");
      await assert.rejects(
        runGitCommand("git", dir, ["diff", "--no-index", "left", "right"]),
        (error: unknown) => {
          assert.ok(error instanceof GitCommandError);
          assert.equal(error.code, 1);
          assert.match(error.stdout, /^diff --git /);
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it(
    "cancels a managed process and waits for close",
    { skip: process.platform === "win32" },
    async () => {
      const controller = new AbortController();
      const running = runGitCommand(
        "git",
        process.cwd(),
        [
          "-c",
          "alias.nerve-wait=!printf 'Receiving objects: 20%%\\r' >&2; exec sleep 10",
          "nerve-wait",
        ],
        {
          network: true,
          signal: controller.signal,
          onProgress: () => controller.abort(),
          terminationGraceMs: 20,
        },
      );
      await assert.rejects(
        running,
        (error: unknown) =>
          error instanceof Error && error.name === "AbortError",
      );
    },
  );

  it(
    "escalates cancellation when a POSIX command ignores TERM",
    { skip: process.platform === "win32", timeout: 3000 },
    async () => {
      const controller = new AbortController();
      let abortedAt: number | undefined;
      await assert.rejects(
        runGitCommand(
          "git",
          process.cwd(),
          [
            "-c",
            "alias.nerve-ignore-term=!trap '' TERM; printf 'Receiving objects: 20%%\\r' >&2; exec sleep 10",
            "nerve-ignore-term",
          ],
          {
            network: true,
            signal: controller.signal,
            terminationGraceMs: 20,
            onProgress: () => {
              if (abortedAt !== undefined) return;
              abortedAt = performance.now();
              controller.abort();
            },
            timeoutMs: 2000,
          },
        ),
        (error: unknown) =>
          error instanceof Error && error.name === "AbortError",
      );
      assert.notEqual(abortedAt, undefined);
      assert.ok(
        performance.now() - abortedAt! >= 15,
        "cancellation must await managed close through TERM grace/KILL, not only process result or abort",
      );
    },
  );

  it(
    "enforces inactivity and total deadlines",
    { skip: process.platform === "win32" },
    async () => {
      for (const options of [
        { network: true, inactivityMs: 30, timeoutMs: 2000 },
        { network: true, inactivityMs: 2000, timeoutMs: 30 },
      ]) {
        await assert.rejects(
          runGitCommand(
            "git",
            process.cwd(),
            ["-c", "alias.nerve-wait=!exec sleep 10", "nerve-wait"],
            { ...options, terminationGraceMs: 20 },
          ),
          /timed out/,
        );
      }
    },
  );

  it(
    "bounds retained output and reports overflow",
    { skip: process.platform === "win32" },
    async () => {
      await assert.rejects(
        runGitCommand(
          "git",
          process.cwd(),
          [
            "-c",
            "alias.nerve-overflow=!head -c 16777217 /dev/zero",
            "nerve-overflow",
          ],
          { terminationGraceMs: 20 },
        ),
        (error: unknown) => {
          assert.ok(error instanceof GitCommandError);
          assert.match(error.message, /output exceeded/);
          assert.ok(Buffer.byteLength(error.stdout) <= 16 * 1024 * 1024);
          return true;
        },
      );
    },
  );

  it("maps startup failures to a stable command error", async () => {
    await assert.rejects(
      runGitCommand("git", join(process.cwd(), "does-not-exist"), ["status"]),
      (error: unknown) => {
        assert.ok(error instanceof GitCommandError);
        assert.equal(error.code, null);
        return true;
      },
    );
  });
});
