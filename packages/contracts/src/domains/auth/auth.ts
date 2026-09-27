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

export const oauthFlowStateSchema = z.enum([
  "active",
  "succeeded",
  "failed",
  "cancelled",
]);
export type OAuthFlowState = z.infer<typeof oauthFlowStateSchema>;

export const oauthChoiceOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1).optional(),
  })
  .strict();
export type OAuthChoiceOption = z.infer<typeof oauthChoiceOptionSchema>;

export const oauthInteractionLinkSchema = z
  .object({
    url: z.string().url(),
    label: z.string().min(1).optional(),
  })
  .strict();
export type OAuthInteractionLink = z.infer<typeof oauthInteractionLinkSchema>;

export const oauthBrowserManualEntrySchema = z
  .object({
    interactionId: z.string().min(1),
    label: z.string().min(1),
    placeholder: z.string().min(1),
    acceptedInput: z.enum(["redirect_url", "authorization_input"]),
  })
  .strict();
export type OAuthBrowserManualEntry = z.infer<
  typeof oauthBrowserManualEntrySchema
>;

export const oauthInteractionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("starting") }).strict(),
  z
    .object({
      type: z.literal("choice"),
      interactionId: z.string().min(1),
      message: z.string().min(1),
      options: z.array(oauthChoiceOptionSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("browser"),
      authorizationUrl: z.string().url(),
      instructions: z.string().min(1),
      manualEntry: oauthBrowserManualEntrySchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("device_code"),
      verificationUrl: z.string().url(),
      userCode: z.string().min(1),
      expiresAt: z.string().datetime().optional(),
      intervalSeconds: z.number().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("text_input"),
      interactionId: z.string().min(1),
      message: z.string().min(1),
      placeholder: z.string().optional(),
      inputKind: z.enum(["text", "secret", "authorization"]),
      allowEmpty: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("progress"),
      message: z.string().min(1),
      links: z.array(oauthInteractionLinkSchema).optional(),
    })
    .strict(),
]);
export type OAuthInteraction = z.infer<typeof oauthInteractionSchema>;

export const oauthFailureSchema = z
  .object({
    message: z.string().min(1),
    detail: z.string().min(1).optional(),
  })
  .strict();
export type OAuthFailure = z.infer<typeof oauthFailureSchema>;

const oauthFlowIdentitySchema = z
  .object({
    flowId: z.string().startsWith("authflow_"),
    provider: z.string().min(1),
    providerName: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const oauthFlowInfoSchema = z.discriminatedUnion("state", [
  oauthFlowIdentitySchema.extend({
    state: z.literal("active"),
    interaction: oauthInteractionSchema,
  }),
  oauthFlowIdentitySchema.extend({
    state: z.literal("succeeded"),
    successMessage: z.string().min(1),
  }),
  oauthFlowIdentitySchema.extend({
    state: z.literal("failed"),
    failure: oauthFailureSchema,
  }),
  oauthFlowIdentitySchema.extend({
    state: z.literal("cancelled"),
  }),
]);
export type OAuthFlowInfo = z.infer<typeof oauthFlowInfoSchema>;

export const respondOAuthFlowRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("select"),
      interactionId: z.string().min(1),
      selectedId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      interactionId: z.string().min(1),
      value: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("manual_redirect"),
      interactionId: z.string().min(1),
      value: z.string().min(1),
    })
    .strict(),
]);
export type RespondOAuthFlowRequest = z.infer<
  typeof respondOAuthFlowRequestSchema
>;
