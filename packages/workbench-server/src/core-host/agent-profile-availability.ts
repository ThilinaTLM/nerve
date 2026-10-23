import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import type { ConversationConfig } from "@nervekit/contracts/core";
import type { ModelSelection } from "@nervekit/contracts/models";
import {
  explicitValue,
  type AgentProfile,
  type AgentProfileDiagnostic,
  type AgentProfilesLeadContext,
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

/** Availability is advisory for portable references; unavailable models block, thinking clamps on apply. */
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
      const setting = profile[field];
      if (!setting || typeof setting === "string") continue;
      const value =
        "lock" in setting
          ? setting.lock
          : "set" in setting
            ? setting.set
            : setting;
      const selections =
        field === "tools"
          ? profile.tools
          : value === "none"
            ? {}
            : Object.assign({}, ...Object.values(value));
      for (const [reference, setting] of Object.entries(selections)) {
        if (!setting || setting === "lead" || setting === "settings") continue;
        const payload =
          typeof setting === "object"
            ? "lock" in setting
              ? setting.lock
              : "set" in setting
                ? setting.set
                : setting
            : setting;
        if (
          payload === false ||
          (typeof payload === "object" &&
            payload !== null &&
            "enabled" in payload &&
            payload.enabled === false)
        )
          continue;
        if (field === "tools" && !resources.tools.has(reference)) continue;
        const reason = resources[field].has(reference)
          ? resources[field].get(reference)
          : `Unknown or not installed skill`;
        if (reason)
          diagnostics.push({
            severity: "warning",
            code: `unavailable_${field === "tools" ? "tool" : "skill"}`,
            field,
            reference,
            message: `${reference}: ${reason}. It will not be enabled for this profile.`,
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
    const modelSetting = profile.model;
    const model =
      modelSetting === "settings"
        ? defaults?.model
        : explicitValue(modelSetting);
    const current =
      context.parentConfig ??
      (context.lead || profile.usableBy === "subagent" ? undefined : parent);
    const selection =
      model ??
      (modelSetting === "lead"
        ? parent?.model
        : (current?.model ?? defaults?.model));
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
    const thinkingSetting = profile.thinking;
    const thinking =
      thinkingSetting === "settings"
        ? defaults?.reasoningLevel
        : thinkingSetting === "lead"
          ? parent?.reasoningLevel
          : (explicitValue(thinkingSetting) ??
            current?.reasoningLevel ??
            defaults?.reasoningLevel);

    if (thinking) {
      const supported = resolved.supportedThinkingLevels;
      if (!supported.includes(thinking))
        diagnostics.push({
          severity: "warning",
          code: "unsupported_thinking",
          field: "thinking",
          reference: thinking,
          message: `Thinking level "${thinking}" is not supported by ${selection.provider}/${selection.modelId}. It will be clamped to a supported level: ${supported.join(", ")}.`,
        });
    }
    return diagnostics;
  };
}
