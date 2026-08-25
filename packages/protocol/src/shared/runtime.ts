import type {
  ProtocolClock,
  ProtocolIdSource,
  ProtocolTimers,
} from "./ports.js";

export const systemProtocolClock: ProtocolClock = {
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
};

export const systemProtocolTimers: ProtocolTimers = {
  setTimeout(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval(callback, intervalMs) {
    const handle = setInterval(callback, intervalMs);
    handle.unref?.();
    return handle;
  },
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

export const systemProtocolIds: ProtocolIdSource = {
  create: (prefix) => `${prefix}_${globalThis.crypto.randomUUID()}`,
};
