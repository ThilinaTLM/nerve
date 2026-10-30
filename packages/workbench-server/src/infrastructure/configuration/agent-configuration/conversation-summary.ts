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

/** Summary publication is disposable and never rolls back configuration authority. */
export function publishConversationSummary(
  id: string,
  view: Extract<
    import("./agent-configuration-views.js").EffectiveAgentView,
    { status: "available" }
  >,
  forgotten: ReadonlySet<string>,
  summaries: import("../scoped-store/conversation-summary-cache.js").ConversationSummaryCache<
    import("./agent-configuration-views.js").Summary
  >,
  notify: (id: string) => void,
  queue: (work: () => Promise<unknown>) => void,
): void {
  if (forgotten.has(id)) return;
  if (
    view.resolution.diagnostics.some(
      (issue) => issue.code !== "reasoning-adjusted",
    )
  ) {
    summaries.remove(id);
    notify(id);
    queue(() => summaries.flush());
    return;
  }
  const summary = conversationSummary(view);
  if (!summary) return;
  try {
    summaries.set(id, summary);
    notify(id);
    queue(() => summaries.flush());
  } catch {
    /* Disposable display cache. */
  }
}
