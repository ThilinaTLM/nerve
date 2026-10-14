import {
  capabilityToolNameSchema,
  type CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import type { ModelInfo } from "@nervekit/contracts/models";
import type {
  SubagentProfile,
  SubagentProfileConfiguration,
  SubagentProfileEntry,
  SubagentProfileScope,
  SubagentProfileDiagnostic,
  SubagentProfileSource,
  SubagentProfilesDocument,
} from "@nervekit/contracts/subagents";
import {
  profileCreatedHere,
  profileCustomizedFields,
  profileDescription,
  profileFieldLabel,
  profileFieldValueLabel,
  profileLabel,
  profileModelLabel,
  profileOriginLayer,
  profilePermissionLabel,
  type ProfileField,
} from "$lib/presentation/subagents/profile-layers";
import { capabilityToolGroupsFor } from "$lib/presentation/composer/capability-tool-labels";

/** Invalid local entries have no parsed local value, but can still be removed whole. */
export function canResetProfileEntry(
  profile: SubagentProfileConfiguration,
  scope: SubagentProfileScope,
): boolean {
  return (
    profile.local !== null ||
    profile.diagnostics.some(
      (item) => item.code === "invalid_entry" && item.source === scope,
    )
  );
}

/** Keep actionable host prose visible; only structured validator payloads need a summary. */
function isTechnicalDiagnostic(message: string): boolean {
  const candidate = message.trim().replace(/^ZodError:\s*/, "");
  if (!candidate.startsWith("[") && !candidate.startsWith("{")) return false;
  try {
    const payload: unknown = JSON.parse(candidate);
    return payload !== null && typeof payload === "object";
  } catch {
    // Truncated validator output is still technical, not actionable prose.
    return /"(?:code|path|issues|schemaVersion)"\s*:/.test(candidate);
  }
}

export function profileDiagnosticSummary(
  diagnostic: SubagentProfileDiagnostic,
): string {
  if (!isTechnicalDiagnostic(diagnostic.message)) return diagnostic.message;
  const source = diagnostic.source ? `${diagnostic.source} ` : "";
  switch (diagnostic.code) {
    case "invalid_document":
      return `The ${source}subagents.json document is invalid or unreadable. Correct or restore it before using or editing profiles.`;
    case "invalid_entry":
      return `This profile entry is invalid. Review its settings in ${source}subagents.json, or reset the entry in its owning scope.`;
    case "incomplete_profile":
      return "This profile is incomplete. Restore its required settings before use.";
    default:
      return "Sub-agent configuration reported a diagnostic. Review the technical details.";
  }
}

/** Document failures are explained once above the list, not repeated in every row. */
export function profileRowDiagnostics(
  profile: SubagentProfileConfiguration,
  documentDiagnostics: readonly SubagentProfileDiagnostic[],
  scope: SubagentProfileScope,
): { diagnostics: SubagentProfileDiagnostic[]; documentBlock?: string } {
  const shared = profile.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "invalid_document" &&
      documentDiagnostics.some(
        (document) =>
          document.code === diagnostic.code &&
          document.source === diagnostic.source,
      ),
  );
  const blockers = shared.filter(
    (diagnostic) => diagnostic.severity === "blocking",
  );
  const sources = [
    ...new Set(
      blockers.map((diagnostic) =>
        diagnostic.source
          ? `${diagnostic.source !== scope ? "inherited " : ""}${diagnostic.source}`
          : "sub-agent",
      ),
    ),
  ];
  return {
    diagnostics: profile.diagnostics.filter(
      (diagnostic) => !shared.includes(diagnostic),
    ),
    ...(sources.length
      ? {
          documentBlock: `Blocked by ${sources.join(" and ")} configuration. See the document error above.`,
        }
      : {}),
  };
}

/** The layers Settings edits; conversations are edited in the popover. */
export type ProfileSettingsLayer = Exclude<
  SubagentProfileScope,
  "conversation"
>;

export type ProfileGroup = {
  origin: SubagentProfileSource;
  title: string;
  profiles: SubagentProfileConfiguration[];
};

const groupTitles: Record<
  ProfileSettingsLayer,
  Partial<Record<SubagentProfileSource, string>>
> = {
  user: { user: "Your profiles", builtin: "Built-in" },
  project: {
    project: "Project profiles",
    user: "From User",
    builtin: "Built-in",
  },
};

/** Profiles created here first, then inherited ones by layer; empty groups are skipped. */
export function groupProfilesByOrigin(
  profiles: readonly SubagentProfileConfiguration[],
  scope: ProfileSettingsLayer,
): ProfileGroup[] {
  const titles = groupTitles[scope];
  const groups = (Object.keys(titles) as SubagentProfileSource[]).map(
    (origin): ProfileGroup => ({
      origin,
      title: titles[origin] ?? origin,
      profiles: [],
    }),
  );
  for (const profile of profiles) {
    const origin = profileOriginLayer(profile, scope);
    (
      groups.find((group) => group.origin === origin) ?? groups[0]
    ).profiles.push(profile);
  }
  return groups.filter((group) => group.profiles.length > 0);
}

export function profileMatchesFilter(
  profile: SubagentProfileConfiguration,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    profile.name,
    profileLabel(profile),
    profileDescription(profile) ?? "",
  ]
    .join("\n")
    .toLowerCase()
    .includes(needle);
}

export type ProfileRowProblems = {
  /** Diagnostics shown under the row; document failures are explained above the list. */
  diagnostics: SubagentProfileDiagnostic[];
  documentBlock?: string;
  blocked: boolean;
  reduced: boolean;
  needsReview: boolean;
};

export function profileRowProblems(
  profile: SubagentProfileConfiguration,
  documentDiagnostics: readonly SubagentProfileDiagnostic[],
  scope: SubagentProfileScope,
): ProfileRowProblems {
  const row = profileRowDiagnostics(profile, documentDiagnostics, scope);
  const blocked =
    row.documentBlock !== undefined ||
    row.diagnostics.some((item) => item.severity === "blocking");
  return {
    ...row,
    blocked,
    reduced: !blocked && row.diagnostics.length > 0,
    needsReview: profile.trust === "untrusted",
  };
}

export type ProfileRowActions = {
  edit: boolean;
  duplicate: boolean;
  /** The other settings layer this profile can be copied into. */
  copyTo?: ProfileSettingsLayer;
  exportJson: boolean;
  resetCustomizations: boolean;
  delete: boolean;
};

/** Only the actions that apply to a row; built-ins are never deletable. */
export function profileRowActions(
  profile: SubagentProfileConfiguration,
  scope: SubagentProfileScope,
  options: { canCopyToProject: boolean },
): ProfileRowActions {
  const effective = profile.effective !== null;
  const origin = profileOriginLayer(profile, scope);
  const createdHere = profileCreatedHere(profile, scope);
  const resettable = canResetProfileEntry(profile, scope);
  let copyTo: ProfileSettingsLayer | undefined;
  if (
    effective &&
    scope === "user" &&
    origin === "user" &&
    options.canCopyToProject
  )
    copyTo = "project";
  if (
    effective &&
    scope === "project" &&
    (origin === "project" ||
      (origin === "user" && profileCustomizedFields(profile, scope).length > 0))
  )
    copyTo = "user";
  return {
    edit: effective || profile.local !== null,
    duplicate: effective,
    ...(copyTo ? { copyTo } : {}),
    exportJson: effective,
    resetCustomizations: resettable && !createdHere,
    delete: resettable && createdHere && origin !== "builtin",
  };
}

function lowerLayerValues(
  profile: SubagentProfileConfiguration,
  scope: SubagentProfileScope,
): string {
  if (scope === "user") return "Built-in values";
  return profileOriginLayer(profile, scope) === "user"
    ? "User values"
    : "User and Built-in values";
}

/** Confirmation copy for removing this layer's changes to an inherited profile. */
export function profileResetConfirmation(
  profile: SubagentProfileConfiguration,
  scope: SubagentProfileScope,
  models: readonly ModelInfo[],
): { title: string; description: string; confirmLabel: string } {
  const label = profileLabel(profile);
  const fields = profileCustomizedFields(profile, scope);
  const changes = fields.map((field) => {
    const local = profile.local?.[field];
    const inherited = profile.inherited?.[field];
    return `${profileFieldLabel(field)} (${profileFieldValueLabel(field, local, models)} → ${profileFieldValueLabel(field, inherited, models)})`;
  });
  const removed = changes.length
    ? `Removes ${changes.join(", ")}.`
    : "Removes this layer's entry.";
  const shared =
    scope === "project" ? " Teammates who use this repo are affected too." : "";
  return {
    title: `Reset ${label} ${scope === "project" ? "for this project" : "in User settings"}?`,
    description: `${removed} ${label} will use the ${lowerLayerValues(profile, scope)} again.${shared}`,
    confirmLabel:
      fields.length > 0
        ? `Reset ${fields.length} change${fields.length === 1 ? "" : "s"}`
        : "Reset",
  };
}

export function profileDeleteConfirmation(
  profile: SubagentProfileConfiguration,
  scope: SubagentProfileScope,
  filePath: string,
): { title: string; description: string } {
  const label = profileLabel(profile);
  const shared =
    scope === "project" ? " Teammates who use this repo lose it too." : "";
  return {
    title: `Delete ${label}?`,
    description: `Removes ${label} from ${filePath}. The lead can no longer assign work to it.${shared}`,
  };
}

export type ProfileTrustReviewEntry = {
  name: string;
  label: string;
  /** Created by the project rather than customizing an inherited profile. */
  isNew: boolean;
  autonomous: boolean;
  description?: string;
  instructions?: string;
  /** Other fields the entry sets, as readable label/value pairs. */
  fields: { label: string; value: string }[];
};

const reviewSkipped = new Set<ProfileField>([
  "label",
  "description",
  "instructions",
]);

/** What each project entry would change once the file is trusted. */
export function profileTrustReviewEntries(
  document: SubagentProfilesDocument | null,
  profiles: readonly SubagentProfileConfiguration[],
  models: readonly ModelInfo[],
): ProfileTrustReviewEntry[] {
  return Object.entries(document?.profiles ?? {}).map(([name, entry]) => {
    const profile = profiles.find((item) => item.name === name);
    const fields = (Object.keys(entry) as (keyof SubagentProfileEntry)[])
      .filter((field) => !reviewSkipped.has(field))
      .map((field) => ({
        label: profileFieldLabel(field),
        value: profileFieldValueLabel(field, entry[field], models),
      }));
    return {
      name,
      label: entry.label ?? (profile ? profileLabel(profile) : name),
      isNew: profile ? profileCreatedHere(profile, "project") : true,
      autonomous: entry.permission === "autonomous",
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.instructions ? { instructions: entry.instructions } : {}),
      fields,
    };
  });
}

/** What the lead has, so a profile row can count what its sub-agents get. */
export type ProfileLeadContext = {
  models: readonly ModelInfo[];
  /** The lead has this capability tool enabled. */
  leadTool: (name: CapabilityToolName) => boolean;
  /** Skills the lead loads. */
  leadSkills: readonly string[];
};

const thinkingShortLabels: Record<string, string> = {
  off: "Off",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

const profileToolGroups = capabilityToolGroupsFor(
  capabilityToolNameSchema.options.filter((name) => name !== "subagents"),
);

/**
 * The collapsed row line: model with short thinking, permission, then how many
 * optional tool groups and skills a new sub-agent gets.
 */
export function profileRowSummary(
  profile: SubagentProfile,
  lead: ProfileLeadContext,
): string[] {
  const model =
    profile.model === "lead"
      ? "Lead's model"
      : profileModelLabel(profile.model, lead.models);
  const thinking =
    profile.thinking === "lead"
      ? ""
      : ` (${thinkingShortLabels[profile.thinking] ?? profile.thinking})`;
  const toolsOn = profileToolGroups.filter((group) =>
    group.names.every((name) => {
      const value = profile.tools[name];
      return value === undefined ? lead.leadTool(name) : value !== false;
    }),
  ).length;
  const skills =
    profile.skills === "none"
      ? 0
      : profile.skills === "inherit"
        ? lead.leadSkills.length
        : lead.leadSkills.filter(
            (name) =>
              (profile.skills as Record<string, boolean>)[name] !== false,
          ).length;
  return [
    `${model}${thinking}`,
    profilePermissionLabel(profile.permission),
    `${toolsOn}/${profileToolGroups.length} tools`,
    skills === 0 ? "No skills" : `${skills} skill${skills === 1 ? "" : "s"}`,
  ];
}
