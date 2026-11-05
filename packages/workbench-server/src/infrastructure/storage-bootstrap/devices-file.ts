import { readFile } from "node:fs/promises";
import { deviceSchema } from "@nervekit/contracts/access";
import { z } from "zod";
import { atomicWriteFile } from "./file-mutations.js";

export const passkeyRecordSchema = z.object({
  /** WebAuthn credential id, base64url. */
  id: z.string().min(1),
  /** COSE public key, base64url. */
  publicKey: z.string().min(1),
  counter: z.number().int().nonnegative(),
  transports: z.array(z.string()).optional(),
  name: z.string().min(1).max(80),
  createdAt: z.number(),
  lastUsedAt: z.number().optional(),
});
export type PasskeyRecord = z.infer<typeof passkeyRecordSchema>;

export const deviceRecordSchema = z.object({
  device: deviceSchema,
  /** SHA-256 hex of the current secret. */
  secretHash: z.string().length(64),
  /** When the current secret was issued (drives 24 h rotation). */
  secretIssuedAt: z.number(),
  /** Previous secret, valid until `previousUntil` to absorb parallel requests. */
  previousHash: z.string().length(64).optional(),
  previousUntil: z.number().optional(),
});
export type DeviceRecord = z.infer<typeof deviceRecordSchema>;

export const devicesFileSchema = z.object({
  version: z.literal(1),
  devices: z.array(deviceRecordSchema),
  owner: z.object({ passkeys: z.array(passkeyRecordSchema) }).optional(),
});
export type DevicesFile = z.infer<typeof devicesFileSchema>;

export function emptyDevicesFile(): DevicesFile {
  return { version: 1, devices: [] };
}

/**
 * Read `secrets/devices.json`. A missing file is empty. A damaged file fails
 * safe: it is treated as empty (every device revoked) rather than blocking
 * startup; the next write replaces it.
 */
export async function readDevicesFile(path: string): Promise<DevicesFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return emptyDevicesFile();
    throw error;
  }
  try {
    return devicesFileSchema.parse(JSON.parse(raw));
  } catch {
    return emptyDevicesFile();
  }
}

/** Atomic (temp + rename) 0600 write; the in-process queue serializes writers. */
export function writeDevicesFile(
  path: string,
  file: DevicesFile,
): Promise<void> {
  return atomicWriteFile(path, `${JSON.stringify(file, null, 2)}\n`, {
    mode: 0o600,
  });
}
