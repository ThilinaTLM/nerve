import { resolveAgentModel } from "@nervekit/harness/models";
import { listAvailableSkills } from "../../core-host/resources/resource-loader.js";

type Models = Parameters<typeof resolveAgentModel>[1];

/** Whether the model a `/model` pointer names is still in the catalog (for `missing-reference` diagnostics). */
export const referenceAvailable =
  (models: Models) =>
  (pointer: string, value: unknown): boolean => {
    if (!pointer.endsWith("/model")) return true;
    const selection = value as { provider: string; modelId: string };
    try {
      const model = resolveAgentModel(selection, models);
      return (
        model.provider === selection.provider && model.id === selection.modelId
      );
    } catch {
      return false;
    }
  };

/** The names of the user and project skills of a project, which its conversations' settings can switch. */
export async function discoverFileSkillNames(
  projectDirectory: string,
  sources: Parameters<typeof listAvailableSkills>[1],
): Promise<string[]> {
  const { skills } = await listAvailableSkills(projectDirectory, sources);
  return skills
    .filter((skill) => skill.source === "project" || skill.source === "user")
    .map((skill) => skill.name);
}

/** A counter that advances whenever the fingerprint of the resources a configuration depends on changes. */
export function resourceGenerationOf(fingerprint: () => string): () => number {
  let version = 0;
  let previous = "";
  return () => {
    const current = fingerprint();
    if (current !== previous) {
      version++;
      previous = current;
    }
    return version;
  };
}
