import { z } from "zod";

export const credentialTypeSchema = z.enum(["api_key", "oauth"]);
export type CredentialType = z.infer<typeof credentialTypeSchema>;

export const providerApiKeySchema = z.object({
  provider: z.string().min(1),
  envVar: z.string().min(1),
  configured: z.boolean(),
});
export type ProviderApiKey = z.infer<typeof providerApiKeySchema>;

export const authProviderMetadataSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  supportsApiKey: z.boolean(),
  supportsOAuth: z.boolean(),
  oauthName: z.string().optional(),
  configured: z.boolean(),
  credentialType: credentialTypeSchema.optional(),
  envVar: z.string().optional(),
  warning: z.string().optional(),
});
export type AuthProviderMetadata = z.infer<typeof authProviderMetadataSchema>;

export const encryptedSecretEnvelopeSchema = z.object({
  keyId: z.string().min(1),
  encryptedKey: z.string().min(1), // base64 RSA-OAEP(aesKey)
  iv: z.string().min(1), // base64 (12 bytes)
  ciphertext: z.string().min(1), // base64 AES-GCM(secret)||tag
});
export type EncryptedSecretEnvelope = z.infer<
  typeof encryptedSecretEnvelopeSchema
>;

export const credentialKeyResponseSchema = z.object({
  keyId: z.string().min(1),
  algorithm: z.literal("RSA-OAEP-256+A256GCM"),
  publicKey: z.string().min(1), // base64 SPKI DER
});
export type CredentialKeyResponse = z.infer<typeof credentialKeyResponseSchema>;

export const setProviderApiKeyRequestSchema = z
  .object({
    provider: z.string().min(1),
    apiKey: z.string().min(1).optional(),
    encryptedApiKey: encryptedSecretEnvelopeSchema.optional(),
  })
  .refine((value) => Boolean(value.apiKey) !== Boolean(value.encryptedApiKey), {
    message: "Provide exactly one of apiKey or encryptedApiKey.",
  });
export type SetProviderApiKeyRequest = z.infer<
  typeof setProviderApiKeyRequestSchema
>;

export const startOAuthFlowRequestSchema = z.object({
  provider: z.string().min(1),
});
export type StartOAuthFlowRequest = z.infer<typeof startOAuthFlowRequestSchema>;

export const oauthFlowStatusSchema = z.enum([
  "starting",
  "select",
  "auth_url",
  "device_code",
  "prompt",
  "progress",
  "succeeded",
  "failed",
  "cancelled",
]);
export type OAuthFlowStatus = z.infer<typeof oauthFlowStatusSchema>;

export const oauthFlowInfoSchema = z.object({
  flowId: z.string().startsWith("authflow_"),
  provider: z.string().min(1),
  providerName: z.string().min(1),
  status: oauthFlowStatusSchema,
  promptId: z.string().optional(),
  message: z.string().optional(),
  authUrl: z.string().optional(),
  instructions: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  deviceCode: z
    .object({
      userCode: z.string(),
      verificationUri: z.string(),
      intervalSeconds: z.number().optional(),
      expiresInSeconds: z.number().optional(),
    })
    .optional(),
  placeholder: z.string().optional(),
  allowEmpty: z.boolean().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OAuthFlowInfo = z.infer<typeof oauthFlowInfoSchema>;

export const respondOAuthFlowRequestSchema = z.object({
  promptId: z.string().min(1),
  value: z.string().optional(),
  selectedId: z.string().optional(),
});
export type RespondOAuthFlowRequest = z.infer<
  typeof respondOAuthFlowRequestSchema
>;
