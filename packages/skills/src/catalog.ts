import { fileURLToPath } from "node:url";
import { NodeExecutionEnv } from "@nervekit/harness/node";
import { loadSkills, type Skill } from "@nervekit/harness/resources";

export const expectedNerveSkillNames = ["skill-creator"] as const;

let catalogPromise: Promise<readonly Skill[]> | undefined;

export class NerveSkillCatalog {
  #skills: readonly Skill[] = [];

  get skills(): readonly Skill[] {
    return this.#skills;
  }

  async initialize(): Promise<void> {
    this.#skills = await loadNerveSkills();
  }
}

export function loadNerveSkills(): Promise<readonly Skill[]> {
  catalogPromise ??= loadCatalog();
  return catalogPromise;
}

async function loadCatalog(): Promise<readonly Skill[]> {
  const root = fileURLToPath(new URL("./builtin/", import.meta.url));
  const loaded = await loadSkills(new NodeExecutionEnv({ cwd: root }), root);
  if (loaded.diagnostics.length > 0) {
    throw new Error(
      `Invalid built-in Nerve skill catalog: ${loaded.diagnostics
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("; ")}`,
    );
  }

  const skills = [...loaded.skills].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const names = skills.map((skill) => skill.name);
  if (new Set(names).size !== names.length) {
    throw new Error("Invalid built-in Nerve skill catalog: duplicate names");
  }
  if (
    names.length !== expectedNerveSkillNames.length ||
    names.some((name, index) => name !== expectedNerveSkillNames[index])
  ) {
    throw new Error(
      `Invalid built-in Nerve skill catalog: expected ${expectedNerveSkillNames.join(", ")}, found ${names.join(", ") || "none"}`,
    );
  }
  return Object.freeze(skills.map((skill) => Object.freeze(skill)));
}
