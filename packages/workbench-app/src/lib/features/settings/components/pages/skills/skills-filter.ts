import type { AvailableSkill } from "$lib/api";

export type SkillSource = "agentBrowser" | "global" | "project";

/** Sidebar section id for a skill source. */
export const skillSourceSectionIds: Record<SkillSource, string> = {
  agentBrowser: "agent-browser",
  global: "global",
  project: "project",
};

export type SkillEntry = {
  skill: AvailableSkill;
  source: SkillSource;
  enabled: boolean;
  /** Set when another definition takes precedence over this one. */
  overrideNote?: string;
};

export type SkillSets = {
  /** Disabled file-skill names (`skills.disabled`). */
  disabled: string[];
  /** Enabled agent-browser skill names (`skills.agentBrowser.enabled`). */
  agentBrowserEnabled: string[];
};

export type BuildSkillEntriesInput = {
  agentBrowserSkills: AvailableSkill[];
  globalSkills: AvailableSkill[];
  projectSkills: AvailableSkill[];
  sets: SkillSets;
};

const bySortName = (left: AvailableSkill, right: AvailableSkill): number =>
  left.name.localeCompare(right.name);

export function buildSkillEntries(input: BuildSkillEntriesInput): SkillEntry[] {
  const { agentBrowserSkills, globalSkills, projectSkills, sets } = input;
  const disabled = new Set(sets.disabled);
  const agentBrowserEnabled = new Set(sets.agentBrowserEnabled);
  const fileSkillNames = new Set(
    [...projectSkills, ...globalSkills].map((skill) => skill.name),
  );
  const projectNames = new Set(projectSkills.map((skill) => skill.name));

  const entries: SkillEntry[] = [];
  for (const skill of agentBrowserSkills.toSorted(bySortName)) {
    entries.push({
      skill,
      source: "agentBrowser",
      enabled: agentBrowserEnabled.has(skill.name),
      overrideNote: fileSkillNames.has(skill.name)
        ? "File skill takes precedence"
        : undefined,
    });
  }
  for (const skill of globalSkills.toSorted(bySortName)) {
    entries.push({
      skill,
      source: "global",
      enabled: !disabled.has(skill.name),
      overrideNote: projectNames.has(skill.name)
        ? "Project overrides global"
        : undefined,
    });
  }
  for (const skill of projectSkills.toSorted(bySortName)) {
    entries.push({
      skill,
      source: "project",
      enabled: !disabled.has(skill.name),
    });
  }
  return entries;
}

export function filterSkills(input: {
  entries: SkillEntry[];
  query?: string;
}): SkillEntry[] {
  const needle = (input.query ?? "").trim().toLowerCase();
  return input.entries.filter((entry) => {
    if (!needle) return true;
    const haystack =
      `${entry.skill.name} ${entry.skill.description}`.toLowerCase();
    return haystack.includes(needle);
  });
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

/**
 * Computes the complete persisted name sets for a bulk enable/disable applied
 * to `entries` only. Names outside `entries` keep their current state, and both
 * source families are updated in one patch.
 */
export function bulkSkillSets(input: {
  entries: SkillEntry[];
  enabled: boolean;
  sets: SkillSets;
}): SkillSets {
  const disabled = new Set(input.sets.disabled);
  const agentBrowserEnabled = new Set(input.sets.agentBrowserEnabled);

  for (const entry of input.entries) {
    if (entry.source === "agentBrowser") {
      if (input.enabled) agentBrowserEnabled.add(entry.skill.name);
      else agentBrowserEnabled.delete(entry.skill.name);
      continue;
    }
    if (input.enabled) disabled.delete(entry.skill.name);
    else disabled.add(entry.skill.name);
  }

  return {
    disabled: [...disabled].sort((left, right) => left.localeCompare(right)),
    agentBrowserEnabled: [...agentBrowserEnabled].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export const skillSourceLabels: Record<SkillSource, string> = {
  agentBrowser: "Agent Browser",
  global: "Global",
  project: "Project",
};
