import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreProcessHost } from "./process.adapter.js";

void test("async bash cancellation sends SIGTERM then escalates after the launch grace period", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX signal fixture");
  const dir = await mkdtemp(join(tmpdir(), "nerve-stop-"));
  const host = new CoreProcessHost("/bin/bash");
  const script =
    'process.on("SIGTERM", () => process.stderr.write("TERM received\\n")); process.stdout.write("READY\\n"); setInterval(() => {}, 1000)';
  let background;
  try {
    background = await host.spawn({
      command: `exec ${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
      cwd: dir,
      artifactDir: dir,
    });
    const deadline = Date.now() + 10_000;
    while (
      !(
        await readFile(background.outputFiles.stdout, "utf8").catch(() => "")
      ).includes("READY")
    ) {
      assert.ok(Date.now() < deadline, "fixture startup timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const started = Date.now();
    await background.cancel();
    assert.ok(
      Date.now() - started >= 4_900,
      "SIGKILL must wait for the 5s grace period",
    );
    assert.match(
      await readFile(background.outputFiles.stderr, "utf8"),
      /TERM received/,
    );
    assert.equal((await background.wait()).status, "cancelled");
  } finally {
    await background?.cancel();
    await rm(dir, { recursive: true, force: true });
  }
});

void test("shell settings are read lazily for each run and spawn", async () => {
  let calls = 0;
  let current = "first";
  const host = new CoreProcessHost(async (cwd) => {
    calls++;
    assert.equal(cwd, "project-directory");
    throw new Error(`shell unavailable: ${current}`);
  });
  assert.equal(calls, 0, "construction must not require an installed shell");
  await assert.rejects(
    host.run({
      command: "pwd",
      cwd: "project-directory",
      signal: new AbortController().signal,
    }),
    /shell unavailable: first/,
  );
  current = "updated";
  const dir = await mkdtemp(join(tmpdir(), "nerve-shell-settings-"));
  try {
    await assert.rejects(
      host.spawn({
        command: "pwd",
        cwd: "project-directory",
        artifactDir: dir,
      }),
      /shell unavailable: updated/,
    );
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
