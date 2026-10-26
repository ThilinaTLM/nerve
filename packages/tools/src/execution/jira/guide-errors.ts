import { builtinSkillFilePath } from "@nervekit/skills";

export function guideErrorMessage(message: string): string {
  const path = builtinSkillFilePath("jira");
  return path ? `${message} See ${path}.` : message;
}
