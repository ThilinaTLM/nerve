import { builtinSkillFilePath } from "@nervekit/skills";

export function guideErrorMessage(message: string): string {
  const path = builtinSkillFilePath("confluence");
  return path ? `${message} See ${path}.` : message;
}
