import type { ModelInfo } from "@nervekit/contracts/models";
import {
  modelDisplayName,
  modelKey,
  modelNameCounts,
  providerDisplayName,
  supportsImageInput,
} from "./model";

/** Capabilities a model catalog can be filtered by. */
export type ModelCapability = "vision" | "reasoning" | "long-context";

export const modelCapabilities: readonly ModelCapability[] = [
  "vision",
  "reasoning",
  "long-context",
];

/** Context windows at or above this size count as long context. */
export const LONG_CONTEXT_TOKENS = 400_000;

export const modelCapabilityLabels: Record<ModelCapability, string> = {
  vision: "Vision",
  reasoning: "Reasoning",
  "long-context": "Long context",
};

export function modelSupportsReasoning(model: ModelInfo): boolean {
  return (model.supportedThinkingLevels ?? []).some((level) => level !== "off");
}

export function modelHasCapability(
  model: ModelInfo,
  capability: ModelCapability,
): boolean {
  switch (capability) {
    case "vision":
      return supportsImageInput(model);
    case "reasoning":
      return modelSupportsReasoning(model);
    case "long-context":
      return model.contextWindow >= LONG_CONTEXT_TOKENS;
  }
}

export type ModelCatalogEntry = {
  key: string;
  model: ModelInfo;
  displayName: string;
  contextualLabel: string;
  providerLabel: string;
  searchText: string;
};

export type ModelProviderFacet = {
  id: string;
  label: string;
  count: number;
};

export function buildModelCatalog(models: ModelInfo[]): ModelCatalogEntry[] {
  const nameCounts = modelNameCounts(models);
  return models
    .map((model) => {
      const displayName = modelDisplayName(model);
      const providerLabel = providerDisplayName(model.provider);
      return {
        key: modelKey(model),
        model,
        displayName,
        contextualLabel:
          (nameCounts.get(displayName) ?? 0) > 1
            ? `${providerLabel} / ${displayName}`
            : displayName,
        providerLabel,
        searchText:
          `${displayName} ${model.modelId} ${providerLabel} ${model.provider}`.toLowerCase(),
      };
    })
    .sort((left, right) => {
      const provider = left.providerLabel.localeCompare(right.providerLabel);
      const name = left.displayName.localeCompare(right.displayName);
      return provider || name || left.key.localeCompare(right.key);
    });
}

export function filterModelCatalog(
  entries: ModelCatalogEntry[],
  query: string,
  provider = "all",
  capabilities: ReadonlySet<ModelCapability> = new Set(),
): ModelCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle && provider === "all" && capabilities.size === 0) return entries;
  return entries.filter(
    (entry) =>
      (provider === "all" || entry.model.provider === provider) &&
      (!needle || entry.searchText.includes(needle)) &&
      [...capabilities].every((capability) =>
        modelHasCapability(entry.model, capability),
      ),
  );
}

export function modelProviderFacets(
  entries: ModelCatalogEntry[],
): ModelProviderFacet[] {
  const facets = new Map<string, ModelProviderFacet>();
  for (const entry of entries) {
    const current = facets.get(entry.model.provider);
    if (current) current.count += 1;
    else {
      facets.set(entry.model.provider, {
        id: entry.model.provider,
        label: entry.providerLabel,
        count: 1,
      });
    }
  }
  return [
    { id: "all", label: "All", count: entries.length },
    ...[...facets.values()].sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
  ];
}
