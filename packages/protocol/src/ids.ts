export type IdFactory = (prefix: string) => string;

/**
 * Creates a random, non-sortable transport/session/client identifier.
 *
 * Persisted domain entities use the time-sortable `createId` factory in
 * `@nervekit/contracts` instead; the two ID strategies are intentionally
 * distinct.
 */
export const createTransportId: IdFactory = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
  return `${prefix}_${uuid.replaceAll("-", "")}`;
};

function fallbackUuid(): string {
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if (!bytes)
    throw new Error("Web Crypto is required to generate protocol IDs.");

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}
