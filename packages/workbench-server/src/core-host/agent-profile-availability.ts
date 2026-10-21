import { scalarValue } from "./agent-profile-scalars.js";
import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import type { ConversationConfig } from "@nervekit/contracts/core";
import type { ModelSelection } from "@nervekit/contracts/models";
import type {
  AgentProfile,
  AgentProfileDiagnostic,
  AgentProfilesLeadContext,
} from "@nervekit/contracts/agent-profiles";
import type { AgentModelInfo } from "@nervekit/harness/models";

export interface ProfileAvailabilityContext {
  capabilityOverrides?: CapabilityOverridesDocument;
  projectId?: string;
  conversationId?: string;
  /** Creation-only snapshot: validate exactly the model/thinking that will be copied. */
  parentConfig?: ConversationConfig;
  /** Read-only draft preview: only values inherited by model/thinking. */
  lead?: AgentProfilesLeadContext;
}
export type ProfileAvailability = (
  profile: AgentProfile,
  context: ProfileAvailabilityContext,
) => Promise<AgentProfileDiagnostic[]>;

export function parseProfileModel(
  profile: string,
  value: string,
): ModelSelection {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1)
    throw new Error(
      `Profile ${profile}: model "${value}" must be "<provider>/<modelId>"`,
    );
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

/** Availability is advisory for portable references, blocking only model/thinking. */
export function createProfileAvailability(options: {
  modelInfo(selection: ModelSelection): Promise<AgentModelInfo>;
  parent(conversationId: string): ConversationConfig;
  defaults?(
    projectId?: string,
  ): Promise<Partial<Pick<ConversationConfig, "model" | "reasoningLevel">>>;
  resources(
    context: ProfileAvailabilityContext,
    profile: AgentProfile,
  ): Promise<{
    /** Missing names are unknown; a string explains a known unavailable resource. */
    tools: ReadonlyMap<string, string | undefined>;
    skills: ReadonlyMap<string, string | undefined>;
  }>;
}): ProfileAvailability {
  return async (profile, context) => {
    const diagnostics: AgentProfileDiagnostic[] = [];
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
    const defaults = options.defaults
      ? await options.defaults(context.projectId)
      : undefined;
    const model = scalarValue(profile.model);
    const selection =
      model === "inherit"
        ? parent?.model
        : model === "default"
          ? defaults?.model
          : parseProfileModel(profile.name, model);
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
        message: `Model ${selection.provider}/${selection.modelId} is not available (${error instanceof Error ? error.message : String(error)}). Choose another model in Settings → Agent profiles.`,
      });
      return diagnostics;
    }
    const setting = scalarValue(profile.thinking);
    const thinking =
      setting === "inherit"
        ? parent?.reasoningLevel
        : setting === "default"
          ? defaults?.reasoningLevel
          : setting;
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
  profile: AgentProfile,
  diagnostics: readonly AgentProfileDiagnostic[],
): AgentProfile {
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
