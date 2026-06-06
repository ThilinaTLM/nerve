import type { ConversationRecord } from "../../api";

const conversationTabsStorageKey = "nerve.conversationTabs.v1";
const maxStoredTabs = 12;

type StoredConversationTabs = {
  tabIds: string[];
  activeId?: string;
};

function parseStoredTabs(value: string | null): StoredConversationTabs {
  if (!value) return { tabIds: [] };
  try {
    const parsed = JSON.parse(value) as Partial<StoredConversationTabs>;
    return {
      tabIds: Array.isArray(parsed.tabIds)
        ? parsed.tabIds.filter((id): id is string => typeof id === "string")
        : [],
      activeId:
        typeof parsed.activeId === "string" ? parsed.activeId : undefined,
    };
  } catch {
    return { tabIds: [] };
  }
}

function uniqueConversationIds(tabIds: string[]): string[] {
  return [...new Set(tabIds.filter((id) => id.startsWith("conv_")))].slice(
    0,
    maxStoredTabs,
  );
}

export function loadStoredConversationTabs(): StoredConversationTabs {
  if (typeof localStorage === "undefined") return { tabIds: [] };
  const stored = parseStoredTabs(
    localStorage.getItem(conversationTabsStorageKey),
  );
  return {
    tabIds: uniqueConversationIds(stored.tabIds),
    activeId: stored.activeId?.startsWith("conv_")
      ? stored.activeId
      : undefined,
  };
}

export function saveConversationTabs(tabIds: string[], activeId?: string) {
  if (typeof localStorage === "undefined") return;
  const normalized = uniqueConversationIds(tabIds);
  const payload: StoredConversationTabs = {
    tabIds: normalized,
    activeId: activeId && normalized.includes(activeId) ? activeId : undefined,
  };
  localStorage.setItem(conversationTabsStorageKey, JSON.stringify(payload));
}

export function filterStoredTabsAgainstConversations(
  tabIds: string[],
  conversations: ConversationRecord[],
): string[] {
  const existing = new Set(
    conversations.map((conversation) => conversation.id),
  );
  return uniqueConversationIds(tabIds).filter((id) => existing.has(id));
}
