import {
  skillOverrideKind,
  type AvailableSkill,
  type SkillSource,
} from "@nervekit/contracts/skills";
import type {
  CapabilityOverridesDocument,
  CapabilitySelection,
} from "@nervekit/contracts/capabilities";

export type { AvailableSkill, SkillSource };
export { skillOverrideKind };

/** Where an enable/disable decision is written. */
export type SkillScope = "user" | "project" | "conversation";

export const skillSourceLabels: Record<SkillSource, string> = {
  user: "Your skills",
  project: "Project skills",
  agentBrowser: "Agent Browser skills",
};

export const skillSourceItemLabels: Record<SkillSource, string> = {
  user: "Your skill",
  project: "Project skill",
  agentBrowser: "Agent Browser skill",
};

export const skillSourceSectionIds: Record<SkillSource, string> = {
  user: "user",
  project: "project",
  agentBrowser: "agent-browser",
};

/**
 * User settings are name-keyed and machine-wide, so they never govern
 * project-directory skills; those belong to project and conversation scope.
 */
export function sourcesForScope(scope: SkillScope): SkillSource[] {
  return scope === "user"
    ? ["user", "agentBrowser"]
    : ["user", "project", "agentBrowser"];
}

/** User-level persisted sets (`settings.skills`). */
export type SkillSets = {
  disabled: string[];
  agentBrowserEnabled: string[];
};

export type SkillEntry = {
  skill: AvailableSkill;
  source: SkillSource;
  kind: "file" | "agentBrowser";
  /** Effective value at the scope being edited. */
  enabled: boolean;
  /** Set at the scope being edited rather than inherited. */
  overridden: boolean;
  /** Value this row would fall back to when the override is removed. */
  inherited: boolean;
  /** Set when another definition wins at runtime. */
  shadowedBy?: SkillSource;
};

const bySortName = (left: AvailableSkill, right: AvailableSkill): number =>
  left.name.localeCompare(right.name);

function userEnabled(skill: AvailableSkill, sets: SkillSets): boolean {
  return skillOverrideKind(skill.source) === "agentBrowser"
    ? sets.agentBrowserEnabled.includes(skill.name)
    : !sets.disabled.includes(skill.name);
}

function overrideValue(
  document: CapabilityOverridesDocument | undefined,
  skill: AvailableSkill,
): boolean | undefined {
  return document?.skills[skillOverrideKind(skill.source)][skill.name];
}

export type BuildSkillEntriesInput = {
  skills: AvailableSkill[];
  scope: SkillScope;
  sets: SkillSets;
  /** Project overrides; inherited in conversation scope, editable in project scope. */
  project?: CapabilityOverridesDocument;
  /** Conversation overrides, editable in conversation scope. */
  conversation?: CapabilityOverridesDocument;
};

export function buildSkillEntries(input: BuildSkillEntriesInput): SkillEntry[] {
  const sources = new Set(sourcesForScope(input.scope));
  const visible = input.skills.filter((skill) => sources.has(skill.source));
  const fileNames = new Set(
    visible
      .filter((skill) => skill.source !== "agentBrowser")
      .map((skill) => skill.name),
  );
  const projectNames = new Set(
    visible
      .filter((skill) => skill.source === "project")
      .map((skill) => skill.name),
  );

  const entries: SkillEntry[] = [];
  for (const source of sourcesForScope(input.scope)) {
    for (const skill of visible
      .filter((candidate) => candidate.source === source)
      .toSorted(bySortName)) {
      const fromUser = userEnabled(skill, input.sets);
      const fromProject = overrideValue(input.project, skill);
      const fromConversation = overrideValue(input.conversation, skill);
      const inherited =
        input.scope === "user"
          ? fromUser
          : input.scope === "project"
            ? fromUser
            : (fromProject ?? fromUser);
      const own =
        input.scope === "user"
          ? undefined
          : input.scope === "project"
            ? fromProject
            : fromConversation;
      entries.push({
        skill,
        source,
        kind: skillOverrideKind(source),
        enabled: own ?? inherited,
        overridden: own !== undefined,
        inherited,
        shadowedBy:
          source === "agentBrowser" && fileNames.has(skill.name)
            ? "project"
            : source === "user" && projectNames.has(skill.name)
              ? "project"
              : undefined,
      });
    }
  }
  return entries;
}

export function shadowNote(entry: SkillEntry): string | undefined {
  if (!entry.shadowedBy) return undefined;
  return entry.source === "agentBrowser"
    ? "A file skill with this name takes precedence"
    : "The project skill with this name takes precedence";
}

/**
 * Names that are disabled or overridden but match no discovered skill, so the
 * stored entry stays visible and removable instead of silently applying.
 */
export type OrphanedSkill = {
  name: string;
  kind: "file" | "agentBrowser";
  enabled: boolean;
};

export function orphanedSkills(input: {
  skills: AvailableSkill[];
  scope: SkillScope;
  sets: SkillSets;
  overrides?: CapabilityOverridesDocument;
}): OrphanedSkill[] {
  const sources = new Set(sourcesForScope(input.scope));
  const known = new Set(
    input.skills
      .filter((skill) => sources.has(skill.source))
      .map((skill) => `${skillOverrideKind(skill.source)}:${skill.name}`),
  );
  const orphans: OrphanedSkill[] = [];
  const add = (
    name: string,
    kind: "file" | "agentBrowser",
    enabled: boolean,
  ) => {
    if (known.has(`${kind}:${name}`)) return;
    orphans.push({ name, kind, enabled });
  };
  if (input.scope === "user") {
    for (const name of input.sets.disabled) add(name, "file", false);
    for (const name of input.sets.agentBrowserEnabled)
      add(name, "agentBrowser", true);
  } else {
    for (const kind of ["file", "agentBrowser"] as const)
      for (const [name, enabled] of Object.entries(
        input.overrides?.skills[kind] ?? {},
      ))
        add(name, kind, enabled);
  }
  return orphans.toSorted((left, right) => left.name.localeCompare(right.name));
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

/**
 * Persisted name sets for a bulk enable/disable applied to `entries` only;
 * names outside `entries` keep their current state.
 */
export function bulkSkillSets(input: {
  entries: SkillEntry[];
  enabled: boolean;
  sets: SkillSets;
}): SkillSets {
  const disabled = new Set(input.sets.disabled);
  const agentBrowserEnabled = new Set(input.sets.agentBrowserEnabled);
  for (const entry of input.entries) {
    if (entry.kind === "agentBrowser") {
      if (input.enabled) agentBrowserEnabled.add(entry.skill.name);
      else agentBrowserEnabled.delete(entry.skill.name);
      continue;
    }
    if (input.enabled) disabled.delete(entry.skill.name);
    else disabled.add(entry.skill.name);
  }
  const sorted = (names: Set<string>) =>
    [...names].sort((left, right) => left.localeCompare(right));
  return {
    disabled: sorted(disabled),
    agentBrowserEnabled: sorted(agentBrowserEnabled),
  };
}

export type ComposerSkillRow = {
  key: string;
  name: string;
  source: SkillSource;
  kind: "file" | "agentBrowser";
  enabled: boolean;
  overridden: boolean;
  /** Where the effective value comes from when not set on the conversation. */
  inheritedFrom: "project" | "user";
};

/**
 * Composer rows follow runtime precedence: project file skills shadow user file
 * skills with the same name, while Agent Browser skills stay a separate family.
 */
export function composerSkillRows(input: {
  skills: AvailableSkill[];
  selection: CapabilitySelection;
  project?: CapabilityOverridesDocument;
  conversation?: CapabilityOverridesDocument;
}): ComposerSkillRow[] {
  const winners = new Map<string, AvailableSkill>();
  for (const skill of input.skills) {
    const key = `${skillOverrideKind(skill.source)}:${skill.name}`;
    const current = winners.get(key);
    if (!current || (current.source === "user" && skill.source === "project"))
      winners.set(key, skill);
  }
  const order: Record<SkillSource, number> = {
    project: 0,
    user: 1,
    agentBrowser: 2,
  };
  return [...winners.values()]
    .toSorted(
      (left, right) =>
        order[left.source] - order[right.source] ||
        left.name.localeCompare(right.name),
    )
    .map((skill) => {
      const kind = skillOverrideKind(skill.source);
      const own = overrideValue(input.conversation, skill);
      return {
        key: `${kind}:${skill.name}`,
        name: skill.name,
        source: skill.source,
        kind,
        enabled:
          kind === "agentBrowser"
            ? input.selection.enabledAgentBrowserSkills.includes(skill.name)
            : !input.selection.disabledFileSkills.includes(skill.name),
        overridden: own !== undefined,
        inheritedFrom:
          overrideValue(input.project, skill) !== undefined
            ? "project"
            : "user",
      };
    });
}
