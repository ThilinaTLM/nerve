import type { Skill } from "../../harness/configuration/options.js";
import { dirnameEnvPath } from "../../paths.js";

/** Format a skill invocation prompt, optionally appending additional user instructions. */
export function formatSkillInvocation(
  skill: Skill,
  additionalInstructions?: string,
): string {
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${dirnameEnvPath(skill.filePath)}.\n\n${skill.content}\n</skill>`;
  return additionalInstructions
    ? `${skillBlock}\n\n${additionalInstructions}`
    : skillBlock;
}

/** Format the model-visible skill catalog for the system prompt. */
export function formatSkillsForSystemPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visibleSkills.length === 0) return "";

  const lines = ["<available_skills>"];

  for (const skill of visibleSkills) {
    lines.push(
      `- ${escapeXml(skill.name)}: ${escapeXml(skill.description)} (path: ${escapeXml(skill.filePath)})`,
    );
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
