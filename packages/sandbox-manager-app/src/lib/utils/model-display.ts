import type { ModelInfo } from "@nervekit/contracts";

const providerLabels: Record<string, string> = {
  "amazon-bedrock": "Amazon Bedrock",
  anthropic: "Anthropic",
  "azure-openai-responses": "Azure OpenAI",
  "github-copilot": "GitHub Copilot",
  google: "Google Gemini",
  "google-vertex": "Google Vertex AI",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  openrouter: "OpenRouter",
  "vercel-ai-gateway": "Vercel AI Gateway",
  xai: "xAI",
};

export function modelKey(
  model: Pick<ModelInfo, "provider" | "modelId">,
): string {
  return `${model.provider}:${model.modelId}`;
}

export function providerDisplayName(provider: string): string {
  if (providerLabels[provider]) return providerLabels[provider];
  return provider
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function modelDisplayName(model: ModelInfo): string {
  return model.label || model.name || model.modelId;
}

export function formatTokens(tokens: number): string {
  if (tokens <= 0) return "Unknown context";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M context`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`;
  return `${tokens.toLocaleString()} context`;
}
