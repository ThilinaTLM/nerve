import {
  skillOverrideKind,
  skillSourceOrder,
  sortBySkillSource,
  type AvailableSkill,
  type SkillSource,
} from "@nervekit/contracts/skills";
export type { AvailableSkill, SkillSource };
export { skillOverrideKind, sortBySkillSource };

/** Where an enable/disable decision is written. */
export type SkillScope = "user" | "project" | "conversation";

/**
 * User settings are name-keyed and machine-wide, so they never govern
 * project-directory skills; those belong to project and conversation scope.
 */
export function sourcesForScope(scope: SkillScope): SkillSource[] {
  return skillSourceOrder.filter(
    (source) => scope !== "user" || source !== "project",
  );
}

export type SkillEntry = {
  skill: AvailableSkill;
  source: SkillSource;
  kind: "file" | "nerve" | "agentBrowser";
  /** Effective value at the scope being edited. */
  enabled: boolean;
  /** Set at the scope being edited rather than inherited. */
  overridden: boolean;
  /** Value this row would fall back to when the override is removed. */
  inherited: boolean;
  /** Set when another definition wins at runtime. */
  shadowedBy?: SkillSource;
};

export function filterSkills(input: {
  entries: SkillEntry[];
  query?: string;
}): SkillEntry[] {
  const needle = (input.query ?? "").trim().toLowerCase();
  if (!needle) return input.entries;
  return input.entries.filter((entry) =>
    `${entry.skill.name} ${entry.skill.description}`
      .toLowerCase()
      .includes(needle),
  );
}

export function summarizeSkills(entries: SkillEntry[]): {
  total: number;
  enabled: number;
} {
  return {
    total: entries.length,
    enabled: entries.filter((entry) => entry.enabled).length,
  };
}
