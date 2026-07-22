import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { resolvePythonRuntime } from "../src/execution/index.js";
import { createTempProject, withPath, writeExecutable } from "./helpers.js";

function requireExecutableFixtures(t: TestContext): boolean {
  if (process.platform !== "win32") return true;
  t.skip("Executable fixture scripts use POSIX shebangs.");
  return false;
}

async function writeFakePython(
  directory: string,
  name: string,
  version = "3.12.4",
): Promise<string> {
  const path = join(directory, name);
  const [major, minor, patch] = version.split(".").map(Number);
  return await writeExecutable(
    directory,
    name,
    `
const metadata = {
  executable: ${JSON.stringify(path)},
  version: ${JSON.stringify(version)},
  versionInfo: [${major}, ${minor}, ${patch}],
};
if (!process.argv.slice(2).includes("-c")) process.exit(2);
process.stdout.write(JSON.stringify(metadata));
`,
  );
}

async function writeFakeUv(
  directory: string,
  pythonPath?: string,
): Promise<string> {
  return await writeExecutable(
    directory,
    "uv",
    pythonPath
      ? `
const expected = ["python", "find", "--no-project"];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(2);
if (process.env.UV_PYTHON_DOWNLOADS !== "never") process.exit(3);
process.stdout.write(${JSON.stringify(`${pythonPath}\n`)});
`
      : "process.exit(1);",
  );
}

describe("Python runtime resolver", () => {
  it("prefers a uv-resolved interpreter over system Python", async (t) => {
    if (!requireExecutableFixtures(t)) return;
    const project = await createTempProject("nerve-python-runtime-");
    const bin = join(project.root, "bin");
    await mkdir(bin);
    const uvPython = await writeFakePython(bin, "uv-python");
    await writeFakePython(bin, "python3");
    await writeFakeUv(bin, uvPython);

    const status = await withPath(bin, () =>
      resolvePythonRuntime({ cwd: project.root }),
    );

    assert.equal(status.available, true);
    if (!status.available) return;
    assert.equal(status.source, "uv");
    assert.equal(status.displayPath, uvPython);
  });

  it("falls back to system Python and ignores project virtual environments", async (t) => {
    if (!requireExecutableFixtures(t)) return;
    const project = await createTempProject("nerve-python-runtime-");
    const bin = join(project.root, "bin");
    const venvBin = join(project.root, ".venv", "bin");
    await mkdir(bin);
    await mkdir(venvBin, { recursive: true });
    await writeFakeUv(bin);
    const systemPython = await writeFakePython(bin, "python3");
    await writeFakePython(venvBin, "python");

    const status = await withPath(bin, () =>
      resolvePythonRuntime({ cwd: project.root }),
    );

    assert.equal(status.available, true);
    if (!status.available) return;
    assert.equal(status.source, "path");
    assert.equal(status.displayPath, systemPython);
  });

  it("keeps an explicit manual interpreter authoritative", async (t) => {
    if (!requireExecutableFixtures(t)) return;
    const project = await createTempProject("nerve-python-runtime-");
    const bin = join(project.root, "bin");
    await mkdir(bin);
    const manualPython = await writeFakePython(bin, "manual-python");
    const uvPython = await writeFakePython(bin, "uv-python");
    await writeFakeUv(bin, uvPython);

    const status = await withPath(bin, () =>
      resolvePythonRuntime({ cwd: project.root, manualPath: manualPython }),
    );

    assert.equal(status.available, true);
    if (!status.available) return;
    assert.equal(status.source, "manual");
    assert.equal(status.displayPath, manualPython);
  });
});
