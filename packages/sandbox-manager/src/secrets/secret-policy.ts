export type SecretPolicy = { allowedKeys: string[]; redactKeyNames?: boolean };
export function authorizeSecretKey(
  policy: SecretPolicy | undefined,
  key: string,
): void {
  if (!policy) return;
  if (!policy.allowedKeys.includes(key))
    throw new Error("Unauthorized secret key");
}
