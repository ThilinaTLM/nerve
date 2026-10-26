import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const files = globSync(["src/**/*.test.ts", "scripts/**/*.test.ts"], {
  exclude: ["src/lib/app/design-lab/wireframes/**"],
}).sort();

// An empty file list would make node:test discover tests again, without exclusions.
if (files.length > 0) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--test",
      ...process.argv.slice(2),
      ...files,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.status ?? 1;
}
