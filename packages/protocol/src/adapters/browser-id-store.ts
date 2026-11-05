import { createTransportId } from "../runtime/ids.js";

const CLIENT_ID_KEY = "nerve.protocol.clientId";
const INSTANCE_ID_KEY = "nerve.protocol.instanceId";

// Used when storage is unavailable or throws, so the id stays stable for the page's lifetime.
const fallbackIds = new Map<string, string>();

export function protocolClientId(): string {
  return storedId(safeLocalStorage(), CLIENT_ID_KEY, () =>
    createTransportId("cli"),
  );
}

export function protocolInstanceId(): string {
  return storedId(
    safeSessionStorage(),
    INSTANCE_ID_KEY,
    () => `tab_${createTransportId("cli").slice(4)}`,
  );
}

function storedId(
  storage: Storage | undefined,
  key: string,
  create: () => string,
): string {
  try {
    const existing = storage?.getItem(key);
    if (existing) return existing;
  } catch {
    // Fall through to the in-memory id.
  }
  const next = fallbackIds.get(key) ?? create();
  fallbackIds.set(key, next);
  try {
    storage?.setItem(key, next);
  } catch {
    // Quota or privacy mode: the in-memory id is still stable.
  }
  return next;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function safeSessionStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
