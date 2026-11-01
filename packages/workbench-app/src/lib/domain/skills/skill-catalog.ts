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

export const skillSourceLabels: Record<SkillSource, string> = {
  user: "Your skills",
  project: "Project skills",
  nerve: "Built-in Nerve skills",
  agentBrowser: "Agent Browser skills",
};

export const skillSourceItemLabels: Record<SkillSource, string> = {
  user: "Your skill",
  project: "Project skill",
  nerve: "Built-in Nerve skill",
  agentBrowser: "Agent Browser skill",
};

export const skillSourceSectionIds: Record<SkillSource, string> = {
  user: "user",
  project: "project",
  nerve: "nerve",
  agentBrowser: "agent-browser",
};

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

export function shadowNote(entry: SkillEntry): string | undefined {
  if (!entry.shadowedBy) return undefined;
  return entry.source === "user"
    ? "The project skill with this name takes precedence"
    : `${skillSourceItemLabels[entry.shadowedBy]} with this name takes precedence`;
}

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
