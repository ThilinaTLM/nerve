import { createHash } from "node:crypto";

/** Hash an immutable, developer-maintained migration manifest string. */
export function migrationChecksum(manifest: string): string {
  return createHash("sha256").update(manifest, "utf8").digest("hex");
}
