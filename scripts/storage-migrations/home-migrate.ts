#!/usr/bin/env -S pnpm exec tsx
import { version } from "../../packages/workbench-server/src/app/version.js";
import {
  assertAllowedOptions,
  defaultNerveHome,
  dryRunNerveHomeMigration,
  option,
  parseOptions,
} from "./home-operations.js";

try {
  const options = parseOptions(process.argv.slice(2));
  assertAllowedOptions(options, ["--dry-run", "--home"]);
  if (options.get("--dry-run") !== true)
    throw new Error(
      "home:migrate currently requires --dry-run; it never promotes storage.",
    );
  const home = option(options, "--home", defaultNerveHome());
  const result = await dryRunNerveHomeMigration({
    home,
    appVersion: version,
    report: (message) => console.log(message),
  });
  console.log(
    `Dry run complete in ${result.durationMs}ms: applied=${result.appliedIds.length}, adopted=${result.adoptedIds.length}, quarantined=${result.quarantinedIds.length}, sweepFailures=${result.sweepFailures}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
