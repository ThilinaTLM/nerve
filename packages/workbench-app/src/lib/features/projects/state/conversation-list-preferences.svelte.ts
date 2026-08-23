import {
  loadConversationListPreferences,
  persistConversationListPreferences,
} from "./conversation-list-preferences";

export const conversationListPreferences = $state(
  loadConversationListPreferences(),
);

export function setHideCompletedConversations(enabled: boolean): void {
  conversationListPreferences.hideCompleted = enabled;
  persistConversationListPreferences(conversationListPreferences);
}
