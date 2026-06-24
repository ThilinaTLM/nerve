import type {
  CustomProvider,
  ModelDefinition,
  ProviderCatalog,
} from "@nervekit/shared";
import {
  apiDelete,
  apiGet,
  apiPathSegment,
  apiPut,
} from "../../../core/api/client";

export async function getProviderCatalog(): Promise<ProviderCatalog> {
  return apiGet<ProviderCatalog>("/api/providers/catalog");
}

export async function upsertCustomProvider(
  provider: CustomProvider,
): Promise<ProviderCatalog> {
  return apiPut<ProviderCatalog>("/api/providers/custom", provider);
}

export async function deleteCustomProvider(
  id: string,
): Promise<ProviderCatalog> {
  return apiDelete<ProviderCatalog>(
    `/api/providers/custom/${apiPathSegment(id)}`,
  );
}

export async function upsertModelDefinition(
  model: ModelDefinition,
): Promise<ProviderCatalog> {
  return apiPut<ProviderCatalog>("/api/providers/models", model);
}

export async function deleteModelDefinition(
  provider: string,
  modelId: string,
): Promise<ProviderCatalog> {
  return apiDelete<ProviderCatalog>(
    `/api/providers/models/${apiPathSegment(provider)}/${apiPathSegment(modelId)}`,
  );
}
