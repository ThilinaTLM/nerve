import type { AuthProviderMetadata } from "$lib/api";

export const CHATGPT_AUDIO_PROVIDER = "openai-codex";

export function hasChatGptAudioAuth(
  authProviders: readonly AuthProviderMetadata[] | undefined,
): boolean {
  return Boolean(
    authProviders?.some(
      (provider) =>
        provider.provider === CHATGPT_AUDIO_PROVIDER &&
        provider.configured &&
        provider.credentialType === "oauth",
    ),
  );
}
