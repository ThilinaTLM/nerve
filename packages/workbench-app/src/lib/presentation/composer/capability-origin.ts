import {
  capabilityToolEnabled,
  isProfiledCapabilityTool,
  type CapabilityConfiguration,
  type CapabilityOverridesDocument,
  type CapabilityPatch,
  type CapabilityProfileOption,
  type CapabilityToolName,
  type ProfiledCapabilityToolName,
} from "@nervekit/contracts/capabilities";

/** The level being edited: a conversation inherits from project, a project from you. */
export type CapabilityEditLevel = "conversation" | "project";
export type CapabilityParentLevel = "project" | "user";

/**
 * Describe where a value comes from. "Set" means the edited level stores its
 * own value, even when that value currently equals the inherited one, because
 * it will not follow later parent changes until it is reset.
 */
export function capabilityOriginLabel(input: {
  level: CapabilityEditLevel;
  stored: boolean;
  matchesInherited: boolean;
  inheritedFrom: CapabilityParentLevel;
}): string {
  if (!input.stored)
    return input.inheritedFrom === "project"
      ? "Inherited from project settings"
      : "Inherited from your settings";
  const own =
    input.level === "conversation"
      ? "Set in this conversation"
      : "Set in this project";
  if (!input.matchesInherited) return own;
  return `${own} · same as ${input.inheritedFrom === "project" ? "project" : "your settings"}`;
}

export type CapabilityToolState = {
  enabled: boolean;
  /** The edited level stores a value for any field of this tool group. */
  stored: boolean;
  /** Every field equals what the edited level would inherit. */
  matchesInherited: boolean;
  inheritedFrom: CapabilityParentLevel;
  originLabel: string;
  /** The tool in this group that selects an integration profile. */
  profileTool?: ProfiledCapabilityToolName;
  profileId?: string;
  profileOptions: CapabilityProfileOption[];
  /** The resolved profile ID does not exist on this machine. */
  profileMissing: boolean;
  /** Enabled, but the integration cannot run without a profile. */
  needsProfile: boolean;
};

/** Profiles are mandatory for Atlassian tools; web fetch works without Tavily. */
const profileRequired = new Set<CapabilityToolName>(["jira", "confluence"]);

/**
 * Resolve one tool group (for example Web access = web_search + web_fetch) at
 * the edited level. A trusted project document only decides whether a
 * conversation's inherited value is attributed to the project or to you.
 */
export function capabilityToolState(input: {
  configuration: CapabilityConfiguration;
  level: CapabilityEditLevel;
  names: readonly CapabilityToolName[];
}): CapabilityToolState {
  const { configuration, level, names } = input;
  const own: CapabilityOverridesDocument | undefined =
    level === "conversation"
      ? configuration.conversation
      : configuration.project;
  const parent =
    level === "conversation" && configuration.trust.status === "trusted"
      ? configuration.project
      : undefined;
  const effective = configuration.effective;
  const inherited = configuration.inherited;
  const profileTool = names.find(isProfiledCapabilityTool);
  const profileId = profileTool
    ? effective.toolProfiles[profileTool]
    : undefined;
  const profileOptions = profileTool
    ? configuration.toolProfileOptions[profileTool]
    : [];
  const enabled = names.every((name) => capabilityToolEnabled(effective, name));
  const stored = names.some((name) => own?.tools[name] !== undefined);
  const matchesInherited =
    names.every(
      (name) =>
        capabilityToolEnabled(effective, name) ===
        capabilityToolEnabled(inherited, name),
    ) &&
    (!profileTool || profileId === inherited.toolProfiles[profileTool]);
  const inheritedFrom: CapabilityParentLevel = names.some(
    (name) => parent?.tools[name] !== undefined,
  )
    ? "project"
    : "user";
  const profileMissing = Boolean(
    profileId && !profileOptions.some((option) => option.id === profileId),
  );
  return {
    enabled,
    stored,
    matchesInherited,
    inheritedFrom,
    originLabel: capabilityOriginLabel({
      level,
      stored,
      matchesInherited,
      inheritedFrom,
    }),
    profileTool,
    profileId,
    profileOptions,
    profileMissing,
    needsProfile:
      enabled &&
      Boolean(profileTool && profileRequired.has(profileTool)) &&
      (!profileId || profileMissing),
  };
}

/**
 * Patch for switching a tool group on or off. Enabling an integration that has
 * no usable profile picks the only available one, so one click is enough.
 */
export function capabilityTogglePatch(
  state: CapabilityToolState,
  names: readonly CapabilityToolName[],
  enabled: boolean,
): NonNullable<CapabilityPatch["tools"]> {
  const autoProfile =
    enabled &&
    state.profileTool &&
    profileRequired.has(state.profileTool) &&
    (!state.profileId || state.profileMissing) &&
    state.profileOptions.length === 1
      ? state.profileOptions[0]?.id
      : undefined;
  return Object.fromEntries(
    names.map((name) => [
      name,
      name === state.profileTool && autoProfile
        ? { enabled, profileId: autoProfile }
        : { enabled },
    ]),
  );
}

/** Patch that removes every stored field of a tool group at the edited level. */
export function capabilityResetPatch(
  names: readonly CapabilityToolName[],
): NonNullable<CapabilityPatch["tools"]> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      isProfiledCapabilityTool(name)
        ? { enabled: null, profileId: null }
        : { enabled: null },
    ]),
  );
}
