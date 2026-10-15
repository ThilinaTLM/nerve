import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import type { ConversationConfig } from "@nervekit/contracts/core";
import type { ModelSelection } from "@nervekit/contracts/models";
import type {
  SubagentProfile,
  SubagentProfileDiagnostic,
  SubagentProfilesLeadContext,
} from "@nervekit/contracts/subagents";
import type { AgentModelInfo } from "@nervekit/harness/models";

export interface ProfileAvailabilityContext {
  capabilityOverrides?: CapabilityOverridesDocument;
  projectId?: string;
  conversationId?: string;
  /** Creation-only snapshot: validate exactly the model/thinking that will be copied. */
  parentConfig?: ConversationConfig;
  /** Read-only draft preview: only values inherited by model/thinking. */
  lead?: SubagentProfilesLeadContext;
}
export type ProfileAvailability = (
  profile: SubagentProfile,
  context: ProfileAvailabilityContext,
) => Promise<SubagentProfileDiagnostic[]>;

export function parseProfileModel(
  profile: string,
  value: string,
): ModelSelection {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1)
    throw new Error(
      `Profile ${profile}: model "${value}" must be "lead" or "<provider>/<modelId>"`,
    );
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

/** Availability is advisory for portable references, blocking only model/thinking. */
export function createProfileAvailability(options: {
  modelInfo(selection: ModelSelection): Promise<AgentModelInfo>;
  parent(conversationId: string): ConversationConfig;
  resources(
    context: ProfileAvailabilityContext,
    profile: SubagentProfile,
  ): Promise<{
    /** Missing names are unknown; a string explains a known unavailable resource. */
    tools: ReadonlyMap<string, string | undefined>;
    skills: ReadonlyMap<string, string | undefined>;
  }>;
}): ProfileAvailability {
  return async (profile, context) => {
    const diagnostics: SubagentProfileDiagnostic[] = [];
    const resources = await options.resources(context, profile);
    for (const field of ["tools", "skills"] as const) {
      const selections = profile[field];
      if (typeof selections !== "object") continue;
      for (const [reference, enabled] of Object.entries(selections)) {
        if (enabled === false) continue;
        // Contracts already diagnose portable unknown tool names. Avoid duplicate warnings.
        if (field === "tools" && !resources.tools.has(reference)) continue;
        const reason = resources[field].has(reference)
          ? resources[field].get(reference)
          : `Unknown or not installed ${field === "tools" ? "tool" : "skill"}`;
        if (reason)
          diagnostics.push({
            severity: "warning",
            code: `unavailable_${field === "tools" ? "tool" : "skill"}`,
            field,
            reference,
            message: `${reference}: ${reason}. It will not be enabled on the sub-agent.`,
          });
      }
    }
    const parent =
      context.lead ??
      context.parentConfig ??
      (context.conversationId
        ? options.parent(context.conversationId)
        : undefined);
    const selection =
      profile.model === "lead"
        ? parent?.model
        : parseProfileModel(profile.name, profile.model);
    if (!selection) return diagnostics;
    let resolved;
    try {
      resolved = await options.modelInfo(selection);
    } catch (error) {
      diagnostics.push({
        severity: "blocking",
        code: "unavailable_model",
        field: "model",
        reference: `${selection.provider}/${selection.modelId}`,
        message: `Model ${selection.provider}/${selection.modelId} is not available (${error instanceof Error ? error.message : String(error)}). Choose another model in Settings → Sub-agents.`,
      });
      return diagnostics;
    }
    const thinking =
      profile.thinking === "lead" ? parent?.reasoningLevel : profile.thinking;
    if (thinking) {
      const supported = resolved.supportedThinkingLevels;
      if (!supported.includes(thinking))
        diagnostics.push({
          severity: "blocking",
          code: "unsupported_thinking",
          field: "thinking",
          reference: thinking,
          message: `Thinking level "${thinking}" is not supported by ${selection.provider}/${selection.modelId}. Choose a supported level: ${supported.join(", ")}.`,
        });
    }
    return diagnostics;
  };
}

/** Preserve the stored profile, but never apply unavailable references to a child. */
export function availableProfileSnapshot(
  profile: SubagentProfile,
  diagnostics: readonly SubagentProfileDiagnostic[],
): SubagentProfile {
  const snapshot = structuredClone(profile);
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== "warning" || !diagnostic.reference) continue;
    if (diagnostic.field === "tools")
      snapshot.tools[diagnostic.reference] = false;
    if (diagnostic.field === "skills" && typeof snapshot.skills === "object")
      snapshot.skills[diagnostic.reference] = false;
  }
  return snapshot;
}
