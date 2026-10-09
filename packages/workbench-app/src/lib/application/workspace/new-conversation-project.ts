import type { Project } from "@nervekit/contracts/core";

export function projectForNewConversation(
  projects: readonly Project[],
  projectDir: string,
): Project | undefined {
  return projects.find((project) => project.directory === projectDir);
}
