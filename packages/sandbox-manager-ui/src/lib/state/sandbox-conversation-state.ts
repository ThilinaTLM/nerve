import type {
  SandboxDetailState,
  SandboxPendingConversationState,
  SandboxWorkspaceTabIdentity,
} from "./sandbox-ui-types";

const PENDING_PREFIX = "pending_";

export function createPendingConversationId(): string {
  return `${PENDING_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isPendingConversationId(id: string | undefined): boolean {
  return Boolean(id?.startsWith(PENDING_PREFIX));
}

export function createPendingConversation(
  id = createPendingConversationId(),
): SandboxPendingConversationState {
  return {
    id,
    title: "New Conversation",
    composerText: "",
    sending: false,
    createdAt: new Date().toISOString(),
  };
}

export function ensurePendingConversation(
  detail: SandboxDetailState,
  id = createPendingConversationId(),
): SandboxPendingConversationState {
  const pending = detail.pendingConversationsById[id];
  if (pending) return pending;
  const next = createPendingConversation(id);
  detail.pendingConversationsById[id] = next;
  return next;
}

export function activeConversationKey(
  detail: SandboxDetailState | undefined,
): string | undefined {
  if (!detail) return undefined;
  return detail.selectedPendingConversationId ?? detail.selectedConversationId;
}

export function activeComposerText(
  detail: SandboxDetailState | undefined,
): string {
  if (!detail) return "";
  const pendingId = detail.selectedPendingConversationId;
  if (pendingId)
    return detail.pendingConversationsById[pendingId]?.composerText ?? "";
  const conversationId = detail.selectedConversationId;
  if (conversationId)
    return detail.composerTextByConversationId[conversationId] ?? "";
  return detail.composerText;
}

export function setActiveComposerText(
  detail: SandboxDetailState,
  text: string,
): void {
  const pendingId = detail.selectedPendingConversationId;
  if (pendingId) {
    ensurePendingConversation(detail, pendingId).composerText = text;
    return;
  }
  const conversationId = detail.selectedConversationId;
  if (conversationId) {
    detail.composerTextByConversationId[conversationId] = text;
    return;
  }
  detail.composerText = text;
}

export function activeQueuedPrompt(
  detail: SandboxDetailState | undefined,
): string | undefined {
  if (!detail) return undefined;
  const pendingId = detail.selectedPendingConversationId;
  if (pendingId)
    return detail.pendingConversationsById[pendingId]?.queuedPrompt;
  const conversationId = detail.selectedConversationId;
  if (conversationId)
    return detail.queuedPromptByConversationId[conversationId];
  return detail.queuedPrompt;
}

export function setActiveQueuedPrompt(
  detail: SandboxDetailState,
  text: string | undefined,
): void {
  const pendingId = detail.selectedPendingConversationId;
  if (pendingId) {
    const pending = ensurePendingConversation(detail, pendingId);
    pending.queuedPrompt = text;
    return;
  }
  const conversationId = detail.selectedConversationId;
  if (conversationId) {
    detail.queuedPromptByConversationId[conversationId] = text;
    return;
  }
  detail.queuedPrompt = text;
}

export function selectPendingConversation(
  detail: SandboxDetailState,
  pendingId: string,
): void {
  ensurePendingConversation(detail, pendingId);
  detail.selectedPendingConversationId = pendingId;
  detail.selectedConversationId = undefined;
  detail.selectedAgentId = undefined;
  detail.selectedRunId = undefined;
}

export function selectDurableConversation(
  detail: SandboxDetailState,
  conversationId: string,
): void {
  detail.selectedPendingConversationId = undefined;
  detail.selectedConversationId = conversationId;
}

export function chatTabFor(key: string): SandboxWorkspaceTabIdentity {
  return { kind: "chat", id: key };
}

export function replacePendingConversation(
  detail: SandboxDetailState,
  pendingId: string,
  real: { conversationId: string; agentId?: string; runId?: string },
): void {
  const pending = detail.pendingConversationsById[pendingId];
  if (pending?.composerText)
    detail.composerTextByConversationId[real.conversationId] =
      pending.composerText;
  if (pending?.queuedPrompt)
    detail.queuedPromptByConversationId[real.conversationId] =
      pending.queuedPrompt;
  delete detail.pendingConversationsById[pendingId];

  detail.openWorkspaceTabs = detail.openWorkspaceTabs.map((tab) =>
    tab.kind === "chat" && tab.id === pendingId
      ? chatTabFor(real.conversationId)
      : tab,
  );
  if (
    detail.activeWorkspaceTab?.kind === "chat" &&
    detail.activeWorkspaceTab.id === pendingId
  ) {
    detail.activeWorkspaceTab = chatTabFor(real.conversationId);
  }

  detail.selectedPendingConversationId = undefined;
  detail.selectedConversationId = real.conversationId;
  detail.selectedAgentId = real.agentId;
  detail.selectedRunId = real.runId;
}
