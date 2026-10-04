import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../src/agent/contracts/index.js";
import type { ConversationTreeEntry } from "../../src/conversation/entries.js";

export const timestamp = "2026-01-01T00:00:00.000Z";
export function assistant(output = 100, signatures = 1): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "test",
    timestamp: 0,
    stopReason: "stop",
    content: Array.from({ length: signatures }, () => ({
      type: "thinking" as const,
      thinking: "",
      thinkingSignature: "opaque-test-payload",
    })),
    usage: {
      input: 900_000,
      output,
      reasoning: output,
      cacheRead: 800_000,
      cacheWrite: 0,
      totalTokens: 1_700_000 + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
export function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: 0 };
}
export function entry(
  id: string,
  message: AgentMessage,
): ConversationTreeEntry {
  return { type: "message", id, parentId: null, timestamp, message };
}
export function checkpoint(
  id: string,
  firstKeptEntryId: string,
  summary = "older summary",
): ConversationTreeEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp,
    firstKeptEntryId,
    summary,
    tokensBefore: 100_000,
    details: { tokensAfter: 1 },
  };
}
export const validSummary = `## Goal
Finish the feature.
## Requirements and Constraints
- Do not change the public API.
## Work Completed
- [x] Inspected the implementation.
## Work Remaining
- [ ] Fix the validation failure.
## Key Decisions
- Preserve compatibility.
## Current Working State
- Tests failed; changes are uncommitted.
## Continuation Plan
1. Fix the failure, then rerun tests.
## Critical References
- src/feature.ts`;
