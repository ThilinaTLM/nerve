import type { EventEnvelope } from "@nervekit/shared";

export interface EventRefs {
  projectId?: string;
  conversationId?: string;
  agentId?: string;
  runId?: string;
}

export function refsForEvent(event: EventEnvelope): EventRefs {
  const data = event.data as Record<string, unknown> | undefined;
  const refs: EventRefs = {};
  if (!data) return refs;
  copyRef(data, refs, "projectId");
  copyRef(data, refs, "conversationId");
  copyRef(data, refs, "agentId");
  copyRef(data, refs, "runId");
  copyNestedRef(data.project, refs, "projectId", "id");
  copyNestedRef(data.conversation, refs, "conversationId", "id");
  copyNestedRef(data.agent, refs, "agentId", "id");
  copyNestedRef(data.task, refs, "projectId", "projectId");
  copyNestedRef(data.task, refs, "conversationId", "conversationId");
  copyNestedRef(data.task, refs, "agentId", "agentId");
  copyNestedRef(data.question, refs, "projectId", "projectId");
  copyNestedRef(data.question, refs, "conversationId", "conversationId");
  copyNestedRef(data.question, refs, "agentId", "agentId");
  copyNestedRef(data.entry, refs, "conversationId", "conversationId");
  copyNestedRef(data.entry, refs, "agentId", "agentId");
  copyNestedRef(data.entry, refs, "runId", "runId");
  copyNestedRef(data.toolCall, refs, "projectId", "projectId");
  copyNestedRef(data.toolCall, refs, "conversationId", "conversationId");
  copyNestedRef(data.toolCall, refs, "agentId", "agentId");
  copyNestedRef(data.toolCall, refs, "runId", "runId");
  return refs;
}

function copyRef(
  source: Record<string, unknown>,
  target: EventRefs,
  key: keyof EventRefs,
): void {
  const value = source[key];
  if (typeof value === "string") target[key] = value;
}

function copyNestedRef(
  source: unknown,
  target: EventRefs,
  targetKey: keyof EventRefs,
  sourceKey: string,
): void {
  if (!source || typeof source !== "object") return;
  const value = (source as Record<string, unknown>)[sourceKey];
  if (typeof value === "string") target[targetKey] = value;
}
