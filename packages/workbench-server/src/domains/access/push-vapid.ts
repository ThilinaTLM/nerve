import { generateVAPIDKeys } from "web-push";
import { z } from "zod";
import { atomicWriteFile } from "../../infrastructure/storage-bootstrap/file-mutations.js";
import { readJsonFile } from "../../infrastructure/storage-bootstrap/json.js";

/**
 * Contact the push services receive with each request (RFC 8292 `sub`). They
 * only use it to reach the sender about abuse; a fixed project address keeps
 * the owner's identity out of it.
 */
export const VAPID_SUBJECT = "https://github.com/nervekit/nerve";

const vapidKeysSchema = z.object({
  publicKey: z.string().min(1),
  privateKey: z.string().min(1),
});
export type VapidKeys = z.infer<typeof vapidKeysSchema>;

/** Read the key pair, generating and persisting it (0600) on first use. */
export async function loadOrCreateVapidKeys(path: string): Promise<VapidKeys> {
  try {
    return await readJsonFile(path, vapidKeysSchema);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Damaged file: replacing the keys only invalidates existing
      // subscriptions, which the apps recreate when they next open.
    }
  }
  const keys = generateVAPIDKeys();
  await atomicWriteFile(path, `${JSON.stringify(keys, null, 2)}\n`, {
    mode: 0o600,
    durability: "directory",
  });
  return keys;
}
