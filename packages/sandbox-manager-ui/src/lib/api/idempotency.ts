/**
 * Idempotency helpers for manager mutations. A stable operation id is reused
 * across UI retries while an operation is still pending so the manager can
 * deduplicate lifecycle/command requests.
 */
export function createOperationId(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}
