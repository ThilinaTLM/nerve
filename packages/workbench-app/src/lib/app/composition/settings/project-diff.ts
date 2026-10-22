import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import type { CapabilityPatch } from "@nervekit/contracts/capabilities";
import {
  projectHarnessValuesSchema,
  type ProjectHarnessOverrides,
  type ProjectSettingsPatch,
} from "@nervekit/contracts/settings";

/**
 * How a project differs from the user's settings, per project settings page.
 * Everything here is derived from what the project layer stores: an entry
 * exists only where the project overrides the user value.
 */
export type ProjectPageDiffs = Readonly<Record<string, number>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Counts overridden leaves; arrays and scalars count once. */
export function overrideLeafCount(value: unknown): number {
  if (value === undefined) return 0;
  if (!isPlainObject(value)) return 1;
  return Object.values(value).reduce<number>(
    (sum, entry) => sum + overrideLeafCount(entry),
    0,
  );
}

/** Known harness overrides only; extension data is retained but never counted. */
function knownHarnessOverrides(
  overrides: ProjectHarnessOverrides | undefined,
): Record<string, unknown> {
  if (!overrides) return {};
  const rest: Record<string, unknown> = { ...overrides };
  delete rest.version;
  return projectHarnessValuesSchema.parse(rest) as Record<string, unknown>;
}

export function harnessOverrideCount(
  overrides: ProjectHarnessOverrides | undefined,
): number {
  return overrideLeafCount(knownHarnessOverrides(overrides));
}

/** Removes every known harness override, leaving extension data untouched. */
export function harnessResetPatch(
  overrides: ProjectHarnessOverrides | undefined,
): ProjectSettingsPatch {
  return Object.fromEntries(
    Object.keys(knownHarnessOverrides(overrides)).map((key) => [key, null]),
  ) as ProjectSettingsPatch;
}

export function toolOverrideCount(
  document: CapabilityOverridesDocument | undefined,
): number {
  return Object.keys(document?.tools ?? {}).length;
}

export function skillOverrideCount(
  document: CapabilityOverridesDocument | undefined,
): number {
  const skills = document?.skills;
  return skills
    ? Object.keys(skills.file).length +
        Object.keys(skills.nerve).length +
        Object.keys(skills.agentBrowser).length
    : 0;
}

export function toolsResetPatch(
  document: CapabilityOverridesDocument,
): CapabilityPatch {
  return {
    tools: Object.fromEntries(
      Object.keys(document.tools).map((name) => [name, null]),
    ),
  };
}

export function skillsResetPatch(
  document: CapabilityOverridesDocument,
): CapabilityPatch {
  const bucket = (entries: Record<string, boolean>) =>
    Object.fromEntries(Object.keys(entries).map((name) => [name, null]));
  return {
    skills: {
      file: bucket(document.skills.file),
      nerve: bucket(document.skills.nerve),
      agentBrowser: bucket(document.skills.agentBrowser),
    },
  };
}

export function projectPageDiffs(input: {
  harness?: ProjectHarnessOverrides;
  capabilities?: CapabilityOverridesDocument;
  /** Agent and sub-agent profile files this project defines or shadows. */
  agentFiles: number;
  subAgentFiles: number;
}): ProjectPageDiffs {
  return {
    general: harnessOverrideCount(input.harness),
    tools: toolOverrideCount(input.capabilities),
    skills: skillOverrideCount(input.capabilities),
    agents: input.agentFiles,
    "sub-agents": input.subAgentFiles,
  };
}
