import {
  daemonConfigSchema,
  harnessConfigSchema,
  uiConfigSchema,
  permissionsConfigSchema,
  providersConfigSchema,
  integrationsConfigSchema,
  type UserConfiguration,
} from "@nervekit/contracts/settings";
export type HomeConfigurationDocumentId = keyof UserConfiguration;
export const HOME_CONFIGURATION_CODECS = {
  daemon: { decode: (value: unknown) => daemonConfigSchema.parse(value) },
  harness: { decode: (value: unknown) => harnessConfigSchema.parse(value) },
  ui: { decode: (value: unknown) => uiConfigSchema.parse(value) },
  permissions: {
    decode: (value: unknown) => permissionsConfigSchema.parse(value),
  },
  providers: { decode: (value: unknown) => providersConfigSchema.parse(value) },
  integrations: {
    decode: (value: unknown) => integrationsConfigSchema.parse(value),
  },
};
