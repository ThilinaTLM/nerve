/** Announce a step on its own paragraph. */
export function section(
  reason: string,
  log: (line: string) => void = console.log,
): void {
  log(`\n${reason}`);
}

/** Render a command line with every argument unambiguously quoted. */
export function formatCommand(
  command: string,
  args: readonly string[],
): string {
  return [command, ...args].map((arg) => JSON.stringify(arg)).join(" ");
}
