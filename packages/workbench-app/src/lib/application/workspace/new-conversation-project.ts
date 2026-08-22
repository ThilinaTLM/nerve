import type { ProjectRecord } from "$lib/api";

export function projectForNewConversation(
  projects: readonly ProjectRecord[],
  projectDir: string,
): ProjectRecord | undefined {
  return projects.find((project) => project.dir === projectDir);
}
