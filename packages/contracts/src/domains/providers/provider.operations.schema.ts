import {
  providerCatalogSchema,
  upsertCustomProviderRequestSchema,
  upsertModelDefinitionRequestSchema,
} from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();
const deleteProviderParamsSchema = z.object({ id: z.string().min(1) });
const deleteModelParamsSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});

export const providersOperationDefinitions = [
  defineOperation(
    "providerCatalog.get",
    emptyParamsSchema,
    providerCatalogSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.providerCatalog.get",
  ),
  defineOperation(
    "providerCatalog.custom.upsert",
    upsertCustomProviderRequestSchema,
    providerCatalogSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.providerCatalog.custom.upsert",
  ),
  defineOperation(
    "providerCatalog.custom.delete",
    deleteProviderParamsSchema,
    providerCatalogSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.providerCatalog.custom.delete",
  ),
  defineOperation(
    "providerCatalog.model.upsert",
    upsertModelDefinitionRequestSchema,
    providerCatalogSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.providerCatalog.model.upsert",
  ),
  defineOperation(
    "providerCatalog.model.delete",
    deleteModelParamsSchema,
    providerCatalogSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.providerCatalog.model.delete",
  ),
] as const;
