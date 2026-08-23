import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EOL } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { executePython, resolvePythonRuntime } from "../src/execution/index.js";
import type { PythonRuntime } from "../src/index.js";
import { createTempProject } from "./helpers.js";

async function runtimeOrSkip(
  t: TestContext,
): Promise<PythonRuntime | undefined> {
  const status = await resolvePythonRuntime({ cwd: process.cwd() });
  if (!status.available) {
    t.skip(`Python runtime unavailable: ${status.error}`);
    return undefined;
  }
  return {
    command: status.command,
    args: status.args,
    displayPath: status.displayPath,
    version: status.version,
    source: status.source,
  };
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const value = await readFile(path, "utf8").catch(() => undefined);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Process ${pid} survived abort`);
}

describe("python executor", () => {
  it("rejects missing, empty, or conflicting source inputs", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    await assert.rejects(
      executePython({}, { cwd: process.cwd(), pythonRuntime: runtime }),
      /exactly one.*code.*path/,
    );
    await assert.rejects(
      executePython(
        { code: "   " },
        { cwd: process.cwd(), pythonRuntime: runtime },
      ),
      /code.*non-empty string/,
    );
    await assert.rejects(
      executePython(
        { code: "print('inline')", path: "script.py" },
        { cwd: process.cwd(), pythonRuntime: runtime },
      ),
      /exactly one.*code.*path/,
    );
  });

  it("executes a Python script file by path", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const project = await createTempProject();
    await project.write("scripts/helper.py", "VALUE = 'helper'");
    const scriptPath = await project.write(
      "scripts/hello.py",
      [
        "import os",
        "from pathlib import Path",
        "import helper",
        "print(Path.cwd().name)",
        "print(helper.VALUE)",
        "print(os.environ['NERVE_TEST_FLAG'], end='')",
      ].join("\n"),
    );

    const result = await executePython(
      { path: "scripts/hello.py", env: { NERVE_TEST_FLAG: " file" } },
      { cwd: project.root, pythonRuntime: runtime },
    );

    assert.equal(
      result.stdout,
      `${project.root.split(/[\\/]/).pop()}${EOL}helper${EOL} file`,
    );
    assert.equal(result.exitCode, 0);
    const details = result.details as {
      inputMode?: string;
      scriptPath?: string;
    };
    assert.equal(details.inputMode, "file");
    assert.equal(details.scriptPath, scriptPath);
  });

  it(
    "streams flushed output before the Python process completes",
    { timeout: 5_000 },
    async (t) => {
      const runtime = await runtimeOrSkip(t);
      if (!runtime) return;
      const project = await createTempProject();
      const updates: string[] = [];
      let settled = false;
      let resolveFirstUpdate!: (chunk: string) => void;
      const firstUpdate = new Promise<string>((resolve) => {
        resolveFirstUpdate = resolve;
      });

      const execution = executePython(
        {
          code: [
            "import time",
            "print('tick 1', flush=True)",
            "time.sleep(0.25)",
            "print('tick 2', flush=True)",
          ].join("\n"),
        },
        {
          cwd: project.root,
          pythonRuntime: runtime,
          onUpdate: (update) => {
            if (update.kind !== "output") return;
            updates.push(update.chunk);
            if (updates.length === 1) resolveFirstUpdate(update.chunk);
          },
        },
      );
      void execution.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      assert.match(await firstUpdate, /tick 1/);
      assert.equal(settled, false);

      const result = await execution;
      assert.equal(result.exitCode, 0);
      assert.match(updates.join(""), /tick 1[\s\S]*tick 2/);
    },
  );

  it("rejects missing or non-file Python script paths", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const project = await createTempProject();
    await assert.rejects(
      executePython(
        { path: "missing.py" },
        { cwd: project.root, pythonRuntime: runtime },
      ),
      /python_exec path not found/,
    );
    await assert.rejects(
      executePython(
        { path: "." },
        { cwd: project.root, pythonRuntime: runtime },
      ),
      /must point to a Python script file/,
    );
  });

  it("fails immediately for stdin reads", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const inputResult = await executePython(
      { code: "input('name: ')" },
      { cwd: process.cwd(), pythonRuntime: runtime },
    );
    assert.notEqual(inputResult.exitCode, 0);
    assert.match(inputResult.stderr ?? "", /stdin is not available/);

    const readResult = await executePython(
      { code: "import sys\nsys.stdin.read()" },
      { cwd: process.cwd(), pythonRuntime: runtime },
    );
    assert.notEqual(readResult.exitCode, 0);
    assert.match(readResult.stderr ?? "", /stdin is not available/);
  });

  it("blocks common file writes when allowFileWrite is false", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const project = await createTempProject();
    const result = await executePython(
      {
        code: "from pathlib import Path\nPath('blocked.txt').write_text('no')",
      },
      {
        cwd: project.root,
        pythonRuntime: runtime,
        pythonPolicy: { allowNetwork: true, allowFileWrite: false },
      },
    );

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr ?? "", /file writes are disabled/);
  });

  it("allows file writes when allowFileWrite is true", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const project = await createTempProject();
    const result = await executePython(
      { code: "from pathlib import Path\nPath('ok.txt').write_text('yes')" },
      {
        cwd: project.root,
        pythonRuntime: runtime,
        pythonPolicy: { allowNetwork: true, allowFileWrite: true },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(join(project.root, "ok.txt"), "utf8"), "yes");
  });

  it("applies non-secret env overrides and rejects sensitive env keys", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const result = await executePython(
      {
        code: "import os\nprint(os.environ['NERVE_TEST_FLAG'], end='')",
        env: { NERVE_TEST_FLAG: "enabled" },
      },
      { cwd: process.cwd(), pythonRuntime: runtime },
    );

    assert.equal(result.stdout, "enabled");
    assert.deepEqual((result.details as { envKeys?: string[] }).envKeys, [
      "NERVE_TEST_FLAG",
    ]);

    await assert.rejects(
      executePython(
        { code: "print('no')", env: { API_KEY: "secret" } },
        { cwd: process.cwd(), pythonRuntime: runtime },
      ),
      /sensitive-looking key/,
    );
  });

  it("returns files written to the artifact directory", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const project = await createTempProject();
    const result = await executePython(
      {
        code: [
          "import os",
          "from pathlib import Path",
          "artifact = Path(os.environ['NERVE_PYTHON_ARTIFACT_DIR']) / 'report.json'",
          "artifact.write_text('{\"ok\": true}', encoding='utf8')",
          "print(artifact)",
        ].join("\n"),
      },
      { cwd: project.root, dataDir: project.root, pythonRuntime: runtime },
    );

    const artifacts = (result.details as { artifacts?: { path: string }[] })
      .artifacts;
    assert.equal(artifacts?.length, 1);
    assert.match(artifacts?.[0]?.path ?? "", /report\.json$/);
    assert.equal(
      await readFile(artifacts?.[0]?.path ?? "", "utf8"),
      '{"ok": true}',
    );
    assert.match(result.content ?? "", /Python artifacts \(1\)/);
  });

  it("blocks file-backed workspace writes when allowFileWrite is false", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const project = await createTempProject();
    await project.write(
      "write_blocked.py",
      "from pathlib import Path\nPath('blocked.txt').write_text('no')",
    );
    const result = await executePython(
      { path: "write_blocked.py" },
      {
        cwd: project.root,
        pythonRuntime: runtime,
        pythonPolicy: { allowNetwork: true, allowFileWrite: false },
      },
    );

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr ?? "", /file writes are disabled/);
  });

  it("permits artifact writes while planning-mode workspace writes are blocked", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const project = await createTempProject();
    const result = await executePython(
      {
        code: [
          "import os",
          "from pathlib import Path",
          "artifact = Path(os.environ['NERVE_PYTHON_ARTIFACT_DIR']) / 'plan-report.txt'",
          "artifact.write_text('ok', encoding='utf8')",
          "Path('blocked.txt').write_text('no', encoding='utf8')",
        ].join("\n"),
      },
      {
        cwd: project.root,
        dataDir: project.root,
        pythonRuntime: runtime,
        pythonPolicy: { allowNetwork: true, allowFileWrite: false },
      },
    );

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr ?? "", /file writes are disabled/);
    const artifacts = (result.details as { artifacts?: { path: string }[] })
      .artifacts;
    assert.equal(artifacts?.length, 1);
    assert.equal(await readFile(artifacts?.[0]?.path ?? "", "utf8"), "ok");
  });

  it("force-kills Python when execution is aborted", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX process-group assertion");
      return;
    }
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const project = await createTempProject();
    const pidPath = join(project.root, "abort.pid");
    const abort = new AbortController();
    const execution = executePython(
      {
        code: [
          "import os, signal, time",
          "open('abort.pid', 'w').write(str(os.getpid()))",
          "signal.signal(signal.SIGTERM, lambda *_: None)",
          "while True: time.sleep(1)",
        ].join("\n"),
      },
      {
        cwd: project.root,
        pythonRuntime: runtime,
        signal: abort.signal,
      },
    );
    const pid = Number(await waitForFile(pidPath));

    abort.abort();
    await assert.rejects(execution, /aborted/i);
    await waitForProcessExit(pid);
  });

  it("times out long-running code with structured metadata", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const result = await executePython(
      { code: "while True: pass", timeout: 1 },
      { cwd: process.cwd(), pythonRuntime: runtime },
    );

    assert.equal(result.exitCode, 124);
    assert.match(result.content ?? "", /timed out after 1s/);
    const details = result.details as {
      timedOut?: boolean;
      timeoutKilled?: boolean;
      durationMs?: number;
    };
    assert.equal(details.timedOut, true);
    assert.equal(details.timeoutKilled, true);
    assert.ok((details.durationMs ?? 0) >= 1);
  });
});
