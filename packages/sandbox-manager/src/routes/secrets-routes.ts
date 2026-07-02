import type { ManagerState } from "../app/manager-state.js";
import {
  authorizeSecretKey,
  type SecretPolicy,
} from "../secrets/secret-policy.js";
export async function resolveSandboxSecret(
  state: ManagerState,
  sandboxId: string,
  request: { key: string; version?: string },
  policy?: SecretPolicy,
) {
  void sandboxId;
  authorizeSecretKey(policy, request.key);
  return state.secrets.resolve(request);
}
