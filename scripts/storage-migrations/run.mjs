import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scripts = new Map([
  ["check", "check.ts"],
  ["migrate", "migrate.ts"],
  ["rehearse", "rehearse.ts"],
  ["copy", "storage-copy.ts"],
  ["baseline", "rehearse-baseline.ts"],
]);

export function runMigrationScript(command, args, run = spawnSync) {
  const script = scripts.get(command);
  if (!script) throw new Error(`Unknown storage migration command: ${command}`);

  function execute(args) {
    const result = run("pnpm", args, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.signal)
      throw new Error(`Migration command terminated by ${result.signal}`);
    return result.status ?? 1;
  }

  // The entrypoints load server source, but workspace imports resolve to dist.
  // Let pnpm derive the dependency closure; do not build the server or maintain
  // a parallel list of the packages imported by migration/bootstrap code.
  const status = execute([
    "--filter",
    "@nervekit/workbench-server^...",
    "build",
  ]);
  if (status !== 0) return status;
  return execute([
    "exec",
    "tsx",
    `scripts/storage-migrations/${script}`,
    ...args,
  ]);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = runMigrationScript(
      process.argv[2],
      process.argv.slice(3),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
