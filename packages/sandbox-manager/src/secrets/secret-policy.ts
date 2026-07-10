import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxConfigV1, SandboxSecretRef } from "@nervekit/contracts";

export class SecretPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretPolicyError";
  }
}

export type SecretPolicy = {
  sandboxId?: string;
  allowedKeys: string[];
  allowedVersions?: Record<string, string[]>;
  redactKeyNames?: boolean;
};

export function authorizeSecretKey(
  policy: SecretPolicy | undefined,
  key: string,
  version?: string,
): void {
  if (!policy) return;
  if (!policy.allowedKeys.includes(key))
    throw new SecretPolicyError("Unauthorized secret key");
  const versions = policy.allowedVersions?.[key];
  if (version && versions && !versions.includes(version))
    throw new SecretPolicyError("Unauthorized secret version");
}

export function buildSecretPolicy(
  sandboxId: string,
  config: SandboxConfigV1,
): SecretPolicy {
  const keys = new Set<string>();
  const versions: Record<string, string[]> = {};
  visit(config, (ref) => {
    if ("kv" in ref) {
      keys.add(ref.kv.key);
      if (ref.kv.version) {
        versions[ref.kv.key] = Array.from(
          new Set([...(versions[ref.kv.key] ?? []), ref.kv.version]),
        );
      }
    }
  });
  return {
    sandboxId,
    allowedKeys: Array.from(keys).sort(),
    allowedVersions: versions,
    redactKeyNames: true,
  };
}

export async function writeSecretPolicy(
  rootDir: string,
  policy: SecretPolicy,
): Promise<void> {
  if (!policy.sandboxId) throw new Error("secret policy requires sandboxId");
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(rootDir, `${safe(policy.sandboxId)}.json`),
    `${JSON.stringify(policy, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export async function readSecretPolicy(
  rootDir: string,
  sandboxId: string,
): Promise<SecretPolicy | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(rootDir, `${safe(sandboxId)}.json`), "utf8"),
    ) as SecretPolicy;
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    )
      return undefined;
    throw error;
  }
}

function visit(value: unknown, onRef: (ref: SandboxSecretRef) => void): void {
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if ("env" in object || "file" in object || "kv" in object) {
    const ref = object as SandboxSecretRef;
    if ("kv" in ref || "env" in ref || "file" in ref) onRef(ref);
  }
  for (const child of Object.values(object)) visit(child, onRef);
}

function safe(value: string): string {
  return Buffer.from(value).toString("base64url");
}
