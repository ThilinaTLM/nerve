import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  repositoryRoot,
  resolveStorageSlot,
} from "../development/storage-slot.mjs";
import {
  assertAllowedOptions,
  option,
  parseOptions,
} from "./home-operations.js";

export function resolveStorageCopyOptions(
  args: string[],
  repo = repositoryRoot,
  defaultSource = join(homedir(), ".nerve"),
) {
  const options = parseOptions(args.filter((arg) => arg !== "--"));
  assertAllowedOptions(options, ["--from", "--slot"]);
  const slot = resolveStorageSlot(
    options.has("--slot") ? ["--slot", option(options, "--slot")] : [],
    repo,
  );
  return {
    source: resolve(option(options, "--from", defaultSource)),
    slot,
  };
}
