import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/** Runs a tool bundled with the SDK (`svelte-check`, `vitest`) in the project folder; resolves with its exit code. */
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

/**
 * `svelte-check` over the project's tsconfig.json: type checks the `.ts` files and the `.svelte`
 * components (their props against the declarations of `@nervekit/extension-sdk/ui`), as the editor does.
 */
export function typecheck(projectDir: string): Promise<number> {
  return run(
    require.resolve("svelte-check/bin/svelte-check"),
    [
      "--workspace",
      projectDir,
      "--tsconfig",
      join(projectDir, "tsconfig.json"),
      "--threshold",
      "error",
      "--output",
      "human",
    ],
    projectDir,
  );
}

/** `vitest run` in the project; no test files is not a failure. */
export function runTests(projectDir: string): Promise<number> {
  const vitest = join(
    dirname(require.resolve("vitest/package.json")),
    "vitest.mjs",
  );
  const ownConfig = readdirSync(projectDir).some((name) =>
    /^v(?:itest|ite)\.config\./.test(name),
  );
  const config = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets",
    "vitest.config.mjs",
  );
  return run(
    vitest,
    [
      "run",
      "--root",
      projectDir,
      "--passWithNoTests",
      ...(ownConfig ? [] : ["--config", config]),
    ],
    projectDir,
  );
}
