import { spawnSync } from "node:child_process";
import { CliError } from "./main.mjs";

/**
 * Run one command with inherited stdio and throw a CliError on spawn error or
 * non-zero status. `failure(result)` customizes the message.
 */
export function runStep(
  command,
  args,
  {
    cwd,
    spawn = spawnSync,
    shell,
    failure = (result) =>
      `${command} failed (${result.signal ?? result.status})`,
  } = {},
) {
  const result = spawn(command, args, {
    cwd,
    stdio: "inherit",
    ...(shell === undefined ? {} : { shell }),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new CliError(failure(result));
}
