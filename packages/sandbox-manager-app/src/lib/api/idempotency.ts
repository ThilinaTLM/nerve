/**
 * Idempotency helpers for manager mutations. A stable operation id is reused
 * across UI retries while an operation is still pending so the manager can
 * deduplicate lifecycle/command requests.
 */
export function createOperationId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  const uuid =
    typeof cryptoApi.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : createUuidFromRandomBytes(cryptoApi);
  return `${prefix}_${uuid}`;
}

function createUuidFromRandomBytes(cryptoApi: Crypto): string {
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
