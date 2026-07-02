import type { SandboxCredentialConfig } from "@nervekit/shared";
import type { SecretResolver } from "../credentials/secret-resolver.js";
export async function resolveProviderCredential(
  credential: SandboxCredentialConfig | undefined,
  resolver: SecretResolver,
): Promise<Record<string, string>> {
  if (!credential) return {};
  switch (credential.type) {
    case "api_key":
      return { apiKey: await resolver.resolve(credential.apiKey) };
    case "bearer":
      return { bearerToken: await resolver.resolve(credential.token) };
    case "basic":
      return {
        username: credential.username,
        password: await resolver.resolve(credential.password),
      };
    case "oauth":
      return {
        ...(credential.accessToken
          ? { accessToken: await resolver.resolve(credential.accessToken) }
          : {}),
      };
    default:
      return {};
  }
}
