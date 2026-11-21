/** Project directories are keys: compare them by their normalized path. */
export function resolveKey(projectDir: string): string {
  return projectDir.length > 1 ? projectDir.replace(/\/+$/, "") : projectDir;
}
