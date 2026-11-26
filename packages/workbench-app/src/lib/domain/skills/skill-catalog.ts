import { matchesTerms } from "@nervekit/ui-kit/collections/match-terms";
import type { ConversationScope } from "@nervekit/contracts/core";
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
export type SkillScope = ConversationScope;

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
  const query = input.query ?? "";
  return input.entries.filter((entry) =>
    matchesTerms(query, entry.skill.name, entry.skill.description),
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
