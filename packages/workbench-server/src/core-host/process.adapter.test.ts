import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

void test("project launch diagnostics are drained before completion, bypass is explicit, and stops stay quiet", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX manager fixture");
  const dir = await mkdtemp(join(tmpdir(), "nerve-project-launch-"));
  const host = new CoreProcessHost("/bin/bash");
  const env = { PATH: `${dir}:${process.env.PATH}` };
  try {
    await writeFile(join(dir, ".envrc"), "# fixture");
    const manager = join(dir, "direnv");
    await writeFile(
      manager,
      '#!/bin/sh\nprintf "manager error\\n" >&2\nexit 23\n',
      { mode: 0o755 },
    );
    const failed = await host.spawn({
      command: "echo PROBE",
      cwd: dir,
      env,
      artifactDir: join(dir, "failed"),
    });
    assert.equal((await failed.wait()).exitCode, 23);
    assert.equal(failed.launch?.manager, "direnv");
    assert.equal(failed.launch?.configFile, join(dir, ".envrc"));
    assert.equal(await readFile(failed.outputFiles.stdout, "utf8"), "");
    const diagnostic = await readFile(failed.outputFiles.stderr, "utf8");
    assert.ok(
      diagnostic.startsWith(
        "manager error\n\n[Nerve project-environment diagnostic]",
      ),
    );
    assert.match(
      diagnostic,
      /activation or the submitted command may have failed/,
    );
    assert.equal(
      await readFile(failed.outputFiles.combined!, "utf8"),
      diagnostic,
    );

    const bypass = await host.start({
      command: "echo PROBE",
      cwd: dir,
      env,
      projectEnvironment: false,
      artifactDir: join(dir, "bypass"),
      signal: new AbortController().signal,
    });
    assert.equal((await bypass.process.wait()).status, "completed");
    assert.equal(bypass.process.launch?.manager, undefined);
    assert.equal(
      await readFile(bypass.process.outputFiles.stdout, "utf8"),
      "PROBE\n",
    );
    assert.equal(await readFile(bypass.process.outputFiles.stderr, "utf8"), "");

    await writeFile(manager, '#!/bin/sh\nshift 2\nexec "$@"\n', {
      mode: 0o755,
    });
    const child = await host.spawn({
      command: "echo child-error >&2; exit 7",
      cwd: dir,
      env,
      artifactDir: join(dir, "child"),
    });
    assert.equal((await child.wait()).exitCode, 7);
    assert.match(
      await readFile(child.outputFiles.stderr, "utf8"),
      /child-error\n\n\[Nerve project-environment diagnostic\]/,
    );
    const success = await host.spawn({
      command: "echo OK",
      cwd: dir,
      env,
      artifactDir: join(dir, "success"),
    });
    assert.equal((await success.wait()).status, "completed");
    assert.equal(await readFile(success.outputFiles.stderr, "utf8"), "");
    for (const stop of ["timeout", "cancel"] as const) {
      const stopped = await host.spawn({
        command: "exec sleep 10",
        cwd: dir,
        env,
        timeoutMs: stop === "timeout" ? 50 : undefined,
        artifactDir: join(dir, stop),
      });
      if (stop === "cancel") await stopped.cancel();
      assert.equal(
        (await stopped.wait()).status,
        stop === "timeout" ? "timed_out" : "cancelled",
      );
      assert.doesNotMatch(
        await readFile(stopped.outputFiles.stderr, "utf8"),
        /Nerve project-environment diagnostic/,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
