#!/usr/bin/env -S pnpm exec tsx
import {
  assertAllowedOptions,
  cloneNerveHome,
  defaultNerveHome,
  option,
  parseOptions,
} from "./home-operations.js";

try {
  const options = parseOptions(process.argv.slice(2));
  assertAllowedOptions(options, ["--from", "--to"]);
  const source = option(options, "--from", defaultNerveHome());
  const destination = option(options, "--to");
  await cloneNerveHome({ source, destination });
  console.log(`Created disposable Nerve home clone at ${destination}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
