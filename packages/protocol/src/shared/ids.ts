export type IdFactory = (prefix: string) => string;

/**
 * Creates a random, non-sortable transport/session/client identifier.
 *
 * Persisted domain entities use the time-sortable `createId` factory in
 * `@nervekit/contracts` instead; the two ID strategies are intentionally
 * distinct.
 */
export const createTransportId: IdFactory = (prefix) =>
  `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
