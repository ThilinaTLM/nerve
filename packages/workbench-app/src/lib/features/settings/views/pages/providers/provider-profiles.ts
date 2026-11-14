import type { AuthProviderMetadata } from "$lib/api";

/** Search terms shared by provider choices, including familiar product aliases. */
export function providerSearchKeywords(id: string, label: string): string[] {
  const aliases = [
    [/anthropic|claude/i, "Anthropic Claude"],
    [/openai|codex/i, "OpenAI Codex ChatGPT"],
    [/google|gemini|vertex/i, "Google Gemini Vertex"],
    [/amazon|bedrock/i, "Amazon AWS Bedrock"],
    [/github|copilot/i, "GitHub Copilot"],
  ] as const;
  return [
    id,
    label,
    id.replace(/[-_:]/g, " "),
    ...aliases
      .filter(([pattern]) => pattern.test(`${id} ${label}`))
      .map(([, alias]) => alias),
  ];
}

export function providerCommandItems(providers: AuthProviderMetadata[]) {
  return [...providers]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((provider) => ({
      key: provider.provider,
      label: provider.displayName,
      group: provider.configured ? "Connected" : "Available",
      keywords: providerSearchKeywords(provider.provider, provider.displayName),
      detail: provider.provider,
      provider,
    }));
}
