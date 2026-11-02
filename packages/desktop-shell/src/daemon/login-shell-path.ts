import { execFile } from "node:child_process";
import { delimiter } from "node:path";

const START_MARKER = "__NERVE_PATH_START_7f3a9c__";
const END_MARKER = "__NERVE_PATH_END_7f3a9c__";
const LOGIN_SHELL_TIMEOUT_MS = 3_000;

export type LoginShellRunner = (
  shell: string,
  args: string[],
  timeoutMs: number,
) => Promise<string>;

export interface LoginShellPathOptions {
  platform?: NodeJS.Platform;
  run?: LoginShellRunner;
}

const runShell: LoginShellRunner = (shell, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      shell,
      args,
      { timeout: timeoutMs, encoding: "utf8", windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

/**
 * A Finder-launched macOS app gets a minimal PATH. Ask the user's login shell
 * for its PATH and merge it ahead of the current one. Returns `undefined` when
 * nothing changes or the shell cannot be queried.
 */
export async function resolveLoginShellPath(
  env: NodeJS.ProcessEnv,
  options: LoginShellPathOptions = {},
): Promise<string | undefined> {
  if ((options.platform ?? process.platform) !== "darwin") return undefined;
  const shell = env.SHELL?.trim() || "/bin/zsh";
  const script = `printf '%s' "${START_MARKER}$PATH${END_MARKER}"`;
  try {
    const output = await (options.run ?? runShell)(
      shell,
      ["-ilc", script],
      LOGIN_SHELL_TIMEOUT_MS,
    );
    const start = output.lastIndexOf(START_MARKER);
    const end = output.indexOf(END_MARKER, start);
    if (start < 0 || end < 0) return undefined;
    const loginPath = output.slice(start + START_MARKER.length, end).trim();
    if (!loginPath) return undefined;
    const merged = [
      ...new Set(
        [
          ...loginPath.split(delimiter),
          ...(env.PATH ?? "").split(delimiter),
        ].filter(Boolean),
      ),
    ].join(delimiter);
    return merged === env.PATH ? undefined : merged;
  } catch {
    return undefined;
  }
}
