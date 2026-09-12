import { createHash } from "node:crypto";

export function reconciliationOperationId(
  conversationId: string,
  requestId: string,
): string {
  return `reconcile_${createHash("sha256")
    .update(`${conversationId}:${requestId}`)
    .digest("hex")
    .slice(0, 24)}`;
}
