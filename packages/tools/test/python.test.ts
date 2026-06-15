import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

describe("python executor", () => {
  it("rejects empty code", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    await assert.rejects(
      executePython(
        { code: "   " },
        { cwd: process.cwd(), pythonRuntime: runtime },
      ),
      /code.*non-empty string/,
    );
  });

  it("returns stdout, stderr, and exitCode for multiline code", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const project = await createTempProject();
    const result = await executePython(
      {
        code: [
          "import sys",
          "def value():",
          "    return 'out'",
          "print(value(), end='')",
          "print('err', end='', file=sys.stderr)",
        ].join("\n"),
      },
      { cwd: project.root, pythonRuntime: runtime },
    );

    assert.equal(result.stdout, "out");
    assert.equal(result.stderr, "err");
    assert.equal(result.exitCode, 0);
    const details = result.details as {
      durationMs?: number;
      exitCode?: number;
      timedOut?: boolean;
      timeoutKilled?: boolean;
      streams?: { stdout?: { bytes?: number; truncated?: boolean } };
    };
    assert.equal(details.exitCode, 0);
    assert.equal(typeof details.durationMs, "number");
    assert.equal(details.timedOut, false);
    assert.equal(details.timeoutKilled, false);
    assert.equal(details.streams?.stdout?.bytes, 3);
    assert.equal(details.streams?.stdout?.truncated, false);
  });

  it("streams stdout and stderr updates", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const chunks: string[] = [];
    await executePython(
      { code: "import sys\nprint('out')\nprint('err', file=sys.stderr)" },
      {
        cwd: process.cwd(),
        pythonRuntime: runtime,
        onUpdate: (update) => chunks.push(`${update.stream}:${update.chunk}`),
      },
    );

    assert.ok(chunks.some((chunk) => chunk.includes("stdout:out")));
    assert.ok(chunks.some((chunk) => chunk.includes("stderr:err")));
  });

  it("normalizes non-zero exits instead of throwing", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const result = await executePython(
      { code: "import sys\nprint('out', end='')\nsys.exit(7)" },
      { cwd: process.cwd(), pythonRuntime: runtime },
    );

    assert.equal(result.stdout, "out");
    assert.equal(result.exitCode, 7);
    assert.match(result.content ?? "", /Python exited with code 7/);
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

  it("truncates large output and saves full output", async (t) => {
    const runtime = await runtimeOrSkip(t);
    if (!runtime) return;
    const result = await executePython(
      { code: "for i in range(2100): print(f'line {i}')" },
      { cwd: process.cwd(), pythonRuntime: runtime },
    );

    assert.match(result.content ?? "", /output truncated/);
    const details = result.details as {
      fullOutputPath?: string;
      streams?: {
        stdout?: {
          truncated?: boolean;
          omittedLines?: number;
          savedTo?: string;
        };
        combined?: { truncated?: boolean };
      };
    };
    assert.ok(details.fullOutputPath);
    assert.equal(details.streams?.stdout?.truncated, true);
    assert.ok((details.streams?.stdout?.omittedLines ?? 0) > 0);
    assert.ok(details.streams?.stdout?.savedTo);
    assert.equal(details.streams?.combined?.truncated, true);
    assert.match(await readFile(details.fullOutputPath, "utf8"), /line 0/);
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
