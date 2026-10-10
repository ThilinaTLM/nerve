export const ts = "2026-10-10T00:00:00.000Z";
export function assistantEvent(
  content: unknown = [{ type: "text", text: "Short prose." }],
) {
  return {
    id: "evt_test",
    conversationId: "conv_test",
    sequence: 7,
    previousEventId: null,
    inputId: null,
    turnId: "turn_test",
    type: "assistant_message",
    llmRepresentation: "assistant",
    createdAt: ts,
    payload: {
      content,
      api: "openai-completions",
      provider: "test",
      model: "test",
      stopReason: "stop",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  };
}
export function toolCall() {
  return {
    id: "tool_test",
    conversationId: "conv_test",
    turnId: "turn_test",
    providerCallId: "provider_test",
    assistantEventId: "evt_test",
    contentIndex: 0,
    origin: "model",
    toolName: "bash",
    arguments: { command: "pnpm test" },
    state: "awaiting_approval",
    executionClaim: null,
    updatedAt: ts,
    supervision: { decision: "approval", suggestedRules: [], authority: {} },
    interaction: {
      kind: "approval",
      request: {
        reason: "Command needs approval",
        suggestedRules: [{ tool: "bash", effect: "allow", rule: "pnpm test*" }],
      },
    },
  };
}
