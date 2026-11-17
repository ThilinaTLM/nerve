import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Runs a tool bundled with the SDK (`tsc`, `vitest`) in the project folder; resolves with its exit code. */
function run(script: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** `tsc --noEmit` over the project's tsconfig.json. */
export function typecheck(projectDir: string): Promise<number> {
  return run(
    require.resolve("typescript/bin/tsc"),
    ["--noEmit", "-p", projectDir, "--pretty", "false"],
    projectDir,
  );
}

/** `vitest run` in the project; no test files is not a failure. */
export function runTests(projectDir: string): Promise<number> {
  const vitest = join(
    dirname(require.resolve("vitest/package.json")),
    "vitest.mjs",
  );
  return run(
    vitest,
    ["run", "--root", projectDir, "--passWithNoTests"],
    projectDir,
  );
}
