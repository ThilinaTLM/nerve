import { z } from "zod";
import { thinkingLevelSchema } from "../models/index.js";

/**
 * pi-ai `KnownApi` values. Custom providers pick one of these API
 * implementations to talk to an endpoint. Manually-added models inherit this
 * from their selected provider.
 */
export const piApiSchema = z.enum([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-vertex",
  "mistral-conversations",
]);
export type PiApi = z.infer<typeof piApiSchema>;

export const modelInputSchema = z.enum(["text", "image"]);
export type ModelInputModality = z.infer<typeof modelInputSchema>;

export const modelCostSchema = z.object({
  input: z.number().nonnegative().default(0),
  output: z.number().nonnegative().default(0),
  cacheRead: z.number().nonnegative().default(0),
  cacheWrite: z.number().nonnegative().default(0),
});
export type ModelCost = z.infer<typeof modelCostSchema>;

/** Slug used as the pi-ai `provider` id and the credential secret key. */
export const providerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Use lowercase letters, numbers, and dashes (must start with a letter or number).",
  );

/** Free-form pi-ai compat overrides; validated by pi-ai at request time. */
export const providerCompatSchema = z.record(z.string(), z.unknown());

export const customProviderSchema = z.object({
  id: providerIdSchema,
  displayName: z.string().min(1),
  api: piApiSchema,
  baseUrl: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  compat: providerCompatSchema.optional(),
});
export type CustomProvider = z.infer<typeof customProviderSchema>;

/**
 * A manually-added model. Connection fields (`api`/`baseUrl`/`headers`/`compat`)
 * are inherited from the selected provider when omitted: custom providers supply
 * saved endpoint settings, while built-in pi-ai providers use their catalog
 * defaults. The optional fields remain for persisted legacy/override data.
 */
export const modelDefinitionSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  name: z.string().min(1),
  api: piApiSchema.optional(),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  compat: providerCompatSchema.optional(),
  reasoning: z.boolean().default(false),
  supportedThinkingLevels: z.array(thinkingLevelSchema).default(["off"]),
  thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
  input: z.array(modelInputSchema).default(["text"]),
  cost: modelCostSchema.default({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  }),
  contextWindow: z.number().int().nonnegative().default(0),
  maxTokens: z.number().int().nonnegative().default(0),
});
export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;

export const providerCatalogSchema = z.object({
  version: z.literal(1).default(1),
  providers: z.array(customProviderSchema).default([]),
  models: z.array(modelDefinitionSchema).default([]),
});
export type ProviderCatalog = z.infer<typeof providerCatalogSchema>;

export const defaultProviderCatalog: ProviderCatalog = {
  version: 1,
  providers: [],
  models: [],
};

export const upsertCustomProviderRequestSchema = customProviderSchema;
export type UpsertCustomProviderRequest = z.infer<
  typeof upsertCustomProviderRequestSchema
>;

export const upsertModelDefinitionRequestSchema = modelDefinitionSchema;
export type UpsertModelDefinitionRequest = z.infer<
  typeof upsertModelDefinitionRequestSchema
>;
