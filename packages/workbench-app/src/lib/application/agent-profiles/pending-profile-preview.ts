import {
  agentProfileDraftSchema,
  applyAgentProfileTemplate,
  type AgentProfile,
  type AgentProfileSettings,
} from "@nervekit/contracts/agent-profiles";
import {
  capabilityToolNameSchema,
  capabilityToolPayload,
  type CapabilitySelection,
} from "@nervekit/contracts/capabilities";
import type { ConversationConfig } from "@nervekit/contracts/core";
import { defaultSettings } from "@nervekit/contracts/settings";

/** Draft-only materialization. Never writes preview values back over user choices. */
export function pendingProfilePreview(
  profile: AgentProfile | undefined,
  config: Omit<ConversationConfig, "conversationId">,
  clampThinking: Parameters<
    typeof applyAgentProfileTemplate
  >[2]["clampThinking"],
  selection?: CapabilitySelection,
) {
  if (!profile) return undefined;
  const current: AgentProfileSettings = {
    model: config.model,
    thinking: config.reasoningLevel,
    permission: config.permissionRuleSetId,
    compaction: defaultSettings.compaction,
    tools: selection
      ? Object.fromEntries(
          capabilityToolNameSchema.options.map((name) => [
            name,
            capabilityToolPayload(selection, name),
          ]),
        )
      : {},
    skills: "none",
  };
  // Resolved profiles include catalog metadata, which is not part of a template.
  const template = agentProfileDraftSchema.parse(
    Object.fromEntries(
      Object.entries(profile).filter(
        ([key]) =>
          !["source", "trust", "path", "digest", "error"].includes(key),
      ),
    ),
  );
  return applyAgentProfileTemplate(template, current, { clampThinking });
}
