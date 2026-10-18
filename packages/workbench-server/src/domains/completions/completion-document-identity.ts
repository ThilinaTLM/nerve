import { createHash } from "node:crypto";

/** Canonical source identity, not a lexical score. Namespace by kind; long
 * identities use a disjoint JSON object representation to bound IPC/history. */
export function completionDocumentId(kind: string, identity: string): string {
  const encoded = JSON.stringify([kind, identity]);
  return encoded.length <= 192
    ? encoded
    : JSON.stringify([
        kind,
        { sha256: createHash("sha256").update(identity).digest("hex") },
      ]);
}
