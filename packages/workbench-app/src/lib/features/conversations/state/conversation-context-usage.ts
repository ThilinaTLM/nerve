import { getConversationContextUsage } from "$lib/api";
import { conversationViewKey } from "$lib/domain/navigation/view-keys";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { isOpenConversation } from "./conversation-reducer-shared";
import { ContextUsageRefreshGuard } from "./context-usage-refresh-guard";

const refreshGuard = new ContextUsageRefreshGuard();

const contextUsageRefreshTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

const CONTEXT_USAGE_REFRESH_DELAY_MS = 1000;

export function clearContextUsageRefresh(conversationId: string): void {
  refreshGuard.invalidate(conversationId);
  const timer = contextUsageRefreshTimers.get(conversationId);
  if (!timer) return;
  clearTimeout(timer);
  contextUsageRefreshTimers.delete(conversationId);
}

export function scheduleContextUsageRefresh(conversationId: string): void {
  if (!isOpenConversation(conversationId)) return;
  clearContextUsageRefresh(conversationId);
  const timer = setTimeout(() => {
    contextUsageRefreshTimers.delete(conversationId);
    void refreshContextUsage(conversationId);
  }, CONTEXT_USAGE_REFRESH_DELAY_MS);
  contextUsageRefreshTimers.set(conversationId, timer);
}

export async function refreshContextUsage(
  conversationId: string,
): Promise<void> {
  if (!isOpenConversation(conversationId)) return;
  const key = conversationViewKey(conversationId);
  const originalView = conversationState.conversationViews[key];
  const cursor = originalView?.cursorSeq;
  const entryId = originalView?.activeEntryId;
  const accept = refreshGuard.begin(conversationId);
  const contextUsage = await getConversationContextUsage(conversationId).catch(
    () => undefined,
  );
  const view =
    conversationState.conversationViews[conversationViewKey(conversationId)];
  if (
    !accept() ||
    !contextUsage ||
    !view ||
    !isOpenConversation(conversationId) ||
    view !== originalView ||
    view.cursorSeq !== cursor ||
    view.activeEntryId !== entryId
  )
    return;
  view.contextUsage = contextUsage;
}
