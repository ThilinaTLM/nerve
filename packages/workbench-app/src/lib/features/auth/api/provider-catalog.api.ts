import type {
  CustomProvider,
  ModelDefinition,
  ProviderCatalog,
} from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export async function getProviderCatalog(): Promise<ProviderCatalog> {
  return (await protocolRequest<ProviderCatalog>("providerCatalog.get", {}))
    .result;
}

export async function upsertCustomProvider(
  provider: CustomProvider,
): Promise<ProviderCatalog> {
  return (
    await protocolRequest<ProviderCatalog>(
      "providerCatalog.custom.upsert",
      provider,
    )
  ).result;
}

export async function deleteCustomProvider(
  id: string,
): Promise<ProviderCatalog> {
  return (
    await protocolRequest<ProviderCatalog>("providerCatalog.custom.delete", {
      id,
    })
  ).result;
}

export async function upsertModelDefinition(
  model: ModelDefinition,
): Promise<ProviderCatalog> {
  return (
    await protocolRequest<ProviderCatalog>(
      "providerCatalog.model.upsert",
      model,
    )
  ).result;
}

export async function deleteModelDefinition(
  provider: string,
  modelId: string,
): Promise<ProviderCatalog> {
  return (
    await protocolRequest<ProviderCatalog>("providerCatalog.model.delete", {
      provider,
      modelId,
    })
  ).result;
}
