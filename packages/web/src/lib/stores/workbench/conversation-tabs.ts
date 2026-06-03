import type { SessionRecord } from "../../api";

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

function uniqueSessionIds(tabIds: string[]): string[] {
  return [...new Set(tabIds.filter((id) => id.startsWith("ses_")))].slice(
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
    tabIds: uniqueSessionIds(stored.tabIds),
    activeId: stored.activeId?.startsWith("ses_") ? stored.activeId : undefined,
  };
}

export function saveConversationTabs(tabIds: string[], activeId?: string) {
  if (typeof localStorage === "undefined") return;
  const normalized = uniqueSessionIds(tabIds);
  const payload: StoredConversationTabs = {
    tabIds: normalized,
    activeId: activeId && normalized.includes(activeId) ? activeId : undefined,
  };
  localStorage.setItem(conversationTabsStorageKey, JSON.stringify(payload));
}

export function filterStoredTabsAgainstSessions(
  tabIds: string[],
  sessions: SessionRecord[],
): string[] {
  const existing = new Set(sessions.map((session) => session.id));
  return uniqueSessionIds(tabIds).filter((id) => existing.has(id));
}
