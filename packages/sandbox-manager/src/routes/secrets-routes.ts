import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ManagerState } from "../app/manager-state.js";
import {
  authorizeSecretKey,
  readSecretPolicy,
  type SecretPolicy,
} from "../secrets/secret-policy.js";

export async function resolveSandboxSecret(
  state: ManagerState,
  sandboxId: string,
  request: { key: string; version?: string },
  policy?: SecretPolicy,
) {
  const effectivePolicy =
    policy ??
    (await readSecretPolicy(
      path.join(state.config.storageDir, "secret-policies"),
      sandboxId,
    ));
  try {
    if (
      request.key.length > 512 ||
      (request.version && request.version.length > 256)
    )
      throw new Error("Secret resolve request too large");
    authorizeSecretKey(effectivePolicy, request.key, request.version);
    const response = await state.secrets.resolve(request);
    if (
      typeof response.value === "string" &&
      response.value.length > 1024 * 1024
    )
      throw new Error("Secret resolve response too large");
    await audit(state, sandboxId, effectivePolicy, request.key, true);
    return response;
  } catch (error) {
    await audit(state, sandboxId, effectivePolicy, request.key, false);
    throw error;
  }
}

async function audit(
  state: ManagerState,
  sandboxId: string,
  policy: SecretPolicy | undefined,
  key: string,
  success: boolean,
): Promise<void> {
  const auditDir = path.join(state.config.storageDir, "audit");
  await mkdir(auditDir, { recursive: true });
  await appendFile(
    path.join(auditDir, "secrets.jsonl"),
    `${JSON.stringify({
      ts: new Date().toISOString(),
      sandboxId,
      key: policy?.redactKeyNames ? "[REDACTED]" : key,
      success,
    })}\n`,
  );
}
