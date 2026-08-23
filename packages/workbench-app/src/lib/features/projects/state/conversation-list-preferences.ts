export type ConversationListPreferences = {
  hideCompleted: boolean;
};

export type ConversationListPreferenceStorage = Pick<
  Storage,
  "getItem" | "setItem"
>;

const STORAGE_KEY = "nerve:conversation-list-preferences:v1";
const defaultPreferences: ConversationListPreferences = {
  hideCompleted: false,
};

export function browserConversationListPreferenceStorage():
  | ConversationListPreferenceStorage
  | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadConversationListPreferences(
  storage:
    | ConversationListPreferenceStorage
    | undefined = browserConversationListPreferenceStorage(),
): ConversationListPreferences {
  if (!storage) return { ...defaultPreferences };
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return { ...defaultPreferences };
    return {
      hideCompleted:
        "hideCompleted" in parsed && typeof parsed.hideCompleted === "boolean"
          ? parsed.hideCompleted
          : false,
    };
  } catch {
    return { ...defaultPreferences };
  }
}

export function persistConversationListPreferences(
  preferences: ConversationListPreferences,
  storage:
    | ConversationListPreferenceStorage
    | undefined = browserConversationListPreferenceStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
}
