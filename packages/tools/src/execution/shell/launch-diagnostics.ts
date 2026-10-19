import type { ProjectShellLaunchContext } from "@nervekit/contracts/tools";

const MAX_FIELD_LENGTH = 240;

/** Quote, escape, and independently bound each field, including hostile paths. */
function formatField(value: string): string {
  let text = "";
  for (const character of value) {
    const escaped = /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u.test(character)
      ? `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
      : JSON.stringify(character).slice(1, -1);
    if (text.length + escaped.length > MAX_FIELD_LENGTH) {
      return `"${text}…"`;
    }
    text += escaped;
  }
  return `"${text}"`;
}

function formatLaunch(launch: ProjectShellLaunchContext): string {
  return [
    `cwd: ${formatField(launch.cwd)}`,
    `executable: ${formatField(launch.executable)}`,
    `shell: ${formatField(launch.shell)}`,
    ...(launch.manager ? [`manager: ${formatField(launch.manager)}`] : []),
    ...(launch.configFile ? [`config: ${formatField(launch.configFile)}`] : []),
  ].join("\n");
}

/** Owners call only for nonzero manager exits, excluding cancellation/timeouts. */
export function formatProjectShellFailure(
  launch: ProjectShellLaunchContext,
): string {
  return (
    "\n[Nerve project-environment diagnostic]\n" +
    formatLaunch(launch) +
    "\nProject activation or the submitted command may have failed. " +
    "This diagnostic does not establish which stage failed.\n" +
    "For commands that intentionally skip Nerve-managed project activation, set projectEnvironment: false; " +
    "the inherited environment and shell startup files still apply.\n" +
    "[/Nerve project-environment diagnostic]\n"
  );
}

/** Use for both synchronous spawn exceptions and asynchronous spawn-error events. */
export function contextualizeShellSpawnError(
  error: unknown,
  launch: ProjectShellLaunchContext,
): Error {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  const category =
    typeof error === "object" &&
    error !== null &&
    "category" in error &&
    typeof error.category === "string"
      ? error.category
      : undefined;
  const retryable =
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
      ? error.retryable
      : undefined;
  // Do not copy the original message: spawn messages can contain full argv.
  const contextualized = new Error(
    "Shell process spawn failed (not a normal command exit).\n" +
      formatLaunch(launch) +
      (typeof code === "string" || typeof code === "number"
        ? `\ncode: ${formatField(String(code))}`
        : "") +
      (category !== undefined ? `\ncategory: ${formatField(category)}` : "") +
      (retryable !== undefined ? `\nretryable: ${retryable}` : "") +
      "\nCheck that the executable and cwd exist and are accessible.",
    { cause: error },
  );
  if (code !== undefined) {
    Object.assign(contextualized, { code });
  }
  if (category !== undefined) {
    Object.assign(contextualized, { category });
  }
  if (retryable !== undefined) {
    Object.assign(contextualized, { retryable });
  }
  return contextualized;
}
