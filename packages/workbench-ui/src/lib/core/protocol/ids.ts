import { createId } from "@nervekit/contracts";

const CLIENT_ID_KEY = "nerve.protocol.clientId";
const INSTANCE_ID_KEY = "nerve.protocol.instanceId";

export function protocolClientId(): string {
  const storage = safeLocalStorage();
  const existing = storage?.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const next = createId("cli");
  storage?.setItem(CLIENT_ID_KEY, next);
  return next;
}

export function protocolInstanceId(): string {
  const storage = safeSessionStorage();
  const existing = storage?.getItem(INSTANCE_ID_KEY);
  if (existing) return existing;
  const next = `tab_${createId("cli").slice(4)}`;
  storage?.setItem(INSTANCE_ID_KEY, next);
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
