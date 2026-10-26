import type { EffectiveAgentView } from "./agent-configuration-service.js";

/** Disposable agent-only display projection. Prompt context never enters this cache. */
export function conversationSummary(
  view: Extract<EffectiveAgentView, { status: "available" }>,
) {
  const settings = view.resolution.settings;
  const conversation = view.sources.find(
    (source) => source.scope.scope === "conversation",
  );
  if (!conversation || !("appliedProfile" in conversation.document))
    return undefined;
  return {
    observedDigest: conversation.digest,
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.reasoningLevel
      ? { reasoningLevel: settings.reasoningLevel }
      : {}),
    ...(settings.permissionRuleSetId
      ? { permissionRuleSetId: settings.permissionRuleSetId }
      : {}),
    ...(conversation.document.appliedProfile
      ? { agentProfile: conversation.document.appliedProfile.name }
      : {}),
  };
}
