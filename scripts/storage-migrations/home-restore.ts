#!/usr/bin/env -S pnpm exec tsx
import {
  assertAllowedOptions,
  defaultNerveHome,
  option,
  parseOptions,
  restoreNerveHome,
} from "./home-operations.js";

try {
  const options = parseOptions(process.argv.slice(2));
  assertAllowedOptions(options, ["--home", "--snapshot"]);
  const home = option(options, "--home", defaultNerveHome());
  const snapshot = option(options, "--snapshot");
  const result = await restoreNerveHome({ home, snapshot });
  console.log(
    `Restore complete. Previous current storage exported to ${result.exportedCurrentStorage}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
