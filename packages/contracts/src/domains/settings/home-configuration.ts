import { z } from "zod";
import { applicationLogLevelSchema } from "../logs/logs.js";
import {
  modelInputSchema,
  modelSelectionSchema,
  thinkingLevelSchema,
} from "../models/models.js";
import {
  permissionOverlaySchema,
  permissionRuleSetIdSchema,
} from "../permissions/permission-rule-sets.js";
import { permissionLevelSchema } from "../permissions/permissions.js";
import {
  modelCostSchema,
  piApiSchema,
  providerCompatSchema,
  providerIdSchema,
} from "../providers/providers.js";
import { userConfigurableToolNameSchema } from "../tools/tool-name.js";
import {
  colorModeSchema,
  colorThemeSchema,
  compactionProfileSchema,
  headerTypeSchema,
  modeSchema,
  notificationToneSchema,
  transcriptionModelSchema,
} from "./settings.js";
import {
  electronFontRenderHintingSchema,
  electronOzonePlatformSchema,
} from "./application-configuration.js";

export const nerveHomeManifestSchema = z
  .object({
    format: z.literal("nerve-home"),
    version: z.literal(1),
  })
  .strict();
export type NerveHomeManifest = z.infer<typeof nerveHomeManifestSchema>;

export const NERVE_HOME_MANIFEST: NerveHomeManifest = {
  format: "nerve-home",
  version: 1,
};

const agentSelectionConfigSchema = z
  .object({
    mode: modeSchema,
    permissionLevel: permissionLevelSchema,
    permissionRuleSetId: permissionRuleSetIdSchema.optional(),
    model: modelSelectionSchema.optional(),
    thinkingLevel: thinkingLevelSchema,
  })
  .strict();

export const daemonConfigSchema = z
  .object({
    version: z.literal(1),
    network: z
      .object({
        host: z.string().trim().min(1),
        port: z.number().int().min(1).max(65_535),
        allowRemote: z.boolean(),
        mobileHttps: z.boolean(),
        httpsPort: z.number().int().min(1).max(65_535),
      })
      .strict(),
    diagnostics: z
      .object({
        loggingEnabled: z.boolean(),
        performanceEnabled: z.boolean(),
      })
      .strict(),
    process: z
      .object({
        startupTimeoutMs: z.number().int().positive(),
        maxOldSpaceMb: z.number().int().positive(),
      })
      .strict(),
    logging: z
      .object({
        level: applicationLogLevelSchema,
        retentionDays: z.number().int().positive(),
        maxBufferedLogs: z.number().int().positive(),
      })
      .strict(),
    electron: z
      .object({
        ozonePlatform: electronOzonePlatformSchema,
        fontRenderHinting: electronFontRenderHintingSchema,
      })
      .strict(),
  })
  .strict();
export type DaemonConfig = z.infer<typeof daemonConfigSchema>;

export const defaultDaemonConfig: DaemonConfig = {
  version: 1,
  network: {
    host: "127.0.0.1",
    port: 3747,
    allowRemote: false,
    mobileHttps: false,
    httpsPort: 3748,
  },
  diagnostics: { loggingEnabled: false, performanceEnabled: false },
  process: { startupTimeoutMs: 60_000, maxOldSpaceMb: 4096 },
  logging: { level: "info", retentionDays: 14, maxBufferedLogs: 2000 },
  electron: { ozonePlatform: "auto", fontRenderHinting: "slight" },
};

export const harnessConfigSchema = z
  .object({
    version: z.literal(1),
    defaults: agentSelectionConfigSchema,
    rememberLastSelection: z.boolean(),
    lastSelection: agentSelectionConfigSchema,
    exploreAgent: z
      .object({
        model: modelSelectionSchema.optional(),
        thinkingLevel: thinkingLevelSchema,
      })
      .strict(),
    compaction: z
      .object({
        auto: z.boolean(),
        profile: compactionProfileSchema,
        customTriggerPercent: z.number().int().min(60).max(90),
        customKeepRecentPercent: z.number().int().min(5).max(40),
      })
      .strict(),
    retry: z
      .object({
        enabled: z.boolean(),
        maxRetries: z.number().int().nonnegative(),
        baseDelayMs: z.number().int().positive(),
      })
      .strict(),
    execution: z
      .object({
        pythonExecutablePath: z.string().trim().min(1).optional(),
        shellPath: z.string().trim().min(1).optional(),
      })
      .strict(),
    tools: z
      .object({
        disabled: z.array(userConfigurableToolNameSchema),
        bash: z
          .object({
            autoPromotion: z
              .object({
                enabled: z.boolean(),
                afterMs: z.number().int().positive().max(86_400_000),
              })
              .strict(),
          })
          .strict(),
        imageExplanation: z
          .object({
            model: modelSelectionSchema.optional(),
            thinkingLevel: thinkingLevelSchema,
          })
          .strict(),
      })
      .strict(),
    skills: z
      .object({
        disabled: z.array(z.string().trim().min(1)),
        agentBrowser: z
          .object({ enabled: z.array(z.string().trim().min(1)) })
          .strict(),
      })
      .strict(),
    scopedModels: z.array(modelSelectionSchema),
  })
  .strict();
export type HarnessConfig = z.infer<typeof harnessConfigSchema>;

export const defaultHarnessConfig: HarnessConfig = {
  version: 1,
  defaults: {
    mode: "coding",
    permissionLevel: "autonomous",
    permissionRuleSetId: "autonomous",
    thinkingLevel: "off",
  },
  rememberLastSelection: false,
  lastSelection: {
    mode: "coding",
    permissionLevel: "autonomous",
    permissionRuleSetId: "autonomous",
    thinkingLevel: "off",
  },
  exploreAgent: { thinkingLevel: "off" },
  compaction: {
    auto: true,
    profile: "balanced",
    customTriggerPercent: 80,
    customKeepRecentPercent: 15,
  },
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
  execution: {},
  tools: {
    disabled: ["explain_image"],
    bash: { autoPromotion: { enabled: true, afterMs: 120_000 } },
    imageExplanation: { thinkingLevel: "off" },
  },
  skills: { disabled: [], agentBrowser: { enabled: [] } },
  scopedModels: [],
};

export const uiConfigSchema = z
  .object({
    version: z.literal(1),
    appearance: z
      .object({
        theme: colorThemeSchema,
        colorMode: colorModeSchema,
        zoomLevel: z.number().int().min(-8).max(8),
      })
      .strict(),
    desktop: z
      .object({
        closeToTray: z.boolean(),
        headerType: headerTypeSchema,
      })
      .strict(),
    notifications: z
      .object({
        systemEnabled: z.boolean(),
        soundsEnabled: z.boolean(),
        events: z
          .object({
            question: notificationToneSchema,
            planReview: notificationToneSchema,
            approval: notificationToneSchema,
            completed: notificationToneSchema,
            failed: notificationToneSchema,
          })
          .strict(),
      })
      .strict(),
    transcription: z
      .object({
        model: transcriptionModelSchema,
        languages: z.array(z.string().trim().min(1)).max(10),
        vocabulary: z.array(z.string().trim().min(1).max(100)).max(50),
      })
      .strict(),
  })
  .strict();
export type UiConfig = z.infer<typeof uiConfigSchema>;

export const defaultUiConfig: UiConfig = {
  version: 1,
  appearance: { theme: "nerve", colorMode: "system", zoomLevel: 0 },
  desktop: { closeToTray: true, headerType: "auto" },
  notifications: {
    systemEnabled: true,
    soundsEnabled: true,
    events: {
      question: "bell",
      planReview: "chime",
      approval: "bell",
      completed: "success",
      failed: "alert",
    },
  },
  transcription: {
    model: "gpt-4o-transcribe",
    languages: [],
    vocabulary: [],
  },
};

export const permissionRuleConfigSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    effect: z.enum(["allow", "deny"]),
    tool: z.string().trim().min(1).max(128),
    matcher: z
      .object({
        kind: z.enum(["whole_tool", "path_glob", "command_glob", "url_glob"]),
        pattern: z.string().trim().min(1).max(1_024),
      })
      .strict(),
    enabled: z.boolean(),
  })
  .strict();
export type PermissionRuleConfig = z.infer<typeof permissionRuleConfigSchema>;

export const legacyPermissionsConfigSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(permissionRuleConfigSchema).max(256),
  })
  .strict();
export type LegacyPermissionsConfig = z.infer<
  typeof legacyPermissionsConfigSchema
>;

export const permissionsConfigSchema = permissionOverlaySchema;
export type PermissionsConfig = z.infer<typeof permissionsConfigSchema>;
export const defaultPermissionsConfig: PermissionsConfig = {
  schemaVersion: 1,
  rules: [],
};

export const headerConfigSchema = z.union([
  z.object({ value: z.string() }).strict(),
  z.object({ credential: z.string().trim().min(1) }).strict(),
]);
export type HeaderConfig = z.infer<typeof headerConfigSchema>;

export const customProviderConfigSchema = z
  .object({
    id: providerIdSchema,
    displayName: z.string().trim().min(1),
    api: piApiSchema,
    baseUrl: z.string().url(),
    headers: z.record(z.string(), headerConfigSchema),
    compat: providerCompatSchema.optional(),
  })
  .strict();
export type CustomProviderConfig = z.infer<typeof customProviderConfigSchema>;

export const modelDefinitionConfigSchema = z
  .object({
    provider: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    api: piApiSchema.optional(),
    baseUrl: z.string().url().optional(),
    headers: z.record(z.string(), headerConfigSchema).optional(),
    compat: providerCompatSchema.optional(),
    reasoning: z.boolean(),
    supportedThinkingLevels: z.array(thinkingLevelSchema),
    thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
    input: z.array(modelInputSchema),
    cost: modelCostSchema,
    contextWindow: z.number().int().nonnegative(),
    maxTokens: z.number().int().nonnegative(),
    samplingParams: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ModelDefinitionConfig = z.infer<typeof modelDefinitionConfigSchema>;

export const providerAuthenticationConfigSchema = z
  .object({
    provider: z.string().trim().min(1),
    method: z.enum(["api_key", "oauth"]),
    credential: z.string().trim().min(1),
  })
  .strict();

export const providersConfigSchema = z
  .object({
    version: z.literal(1),
    providers: z.array(customProviderConfigSchema),
    models: z.array(modelDefinitionConfigSchema),
    authentication: z.array(providerAuthenticationConfigSchema),
  })
  .strict();
export type ProvidersConfig = z.infer<typeof providersConfigSchema>;
export const defaultProvidersConfig: ProvidersConfig = {
  version: 1,
  providers: [],
  models: [],
  authentication: [],
};

const atlassianProfileConfigSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    siteUrl: z.string().url().optional(),
    email: z.string().email().optional(),
    defaultProjectKey: z.string().trim().min(1).optional(),
    defaultSpaceKey: z.string().trim().min(1).optional(),
    credential: z.string().trim().min(1),
  })
  .strict();
const tavilyProfileConfigSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    credential: z.string().trim().min(1),
  })
  .strict();

export const integrationsConfigSchema = z
  .object({
    version: z.literal(1),
    profiles: z
      .object({
        atlassian: z.array(atlassianProfileConfigSchema),
        tavily: z.array(tavilyProfileConfigSchema),
      })
      .strict(),
    tools: z
      .object({
        jira: z
          .object({ enabled: z.boolean(), profileId: z.string().optional() })
          .strict(),
        confluence: z
          .object({ enabled: z.boolean(), profileId: z.string().optional() })
          .strict(),
        web: z.object({ tavilyProfileId: z.string().optional() }).strict(),
      })
      .strict(),
  })
  .strict();
export type IntegrationsConfig = z.infer<typeof integrationsConfigSchema>;
export const defaultIntegrationsConfig: IntegrationsConfig = {
  version: 1,
  profiles: { atlassian: [], tavily: [] },
  tools: {
    jira: { enabled: false },
    confluence: { enabled: false },
    web: {},
  },
};

export const userConfigurationSchema = z
  .object({
    daemon: daemonConfigSchema,
    harness: harnessConfigSchema,
    ui: uiConfigSchema,
    permissions: permissionsConfigSchema,
    providers: providersConfigSchema,
    integrations: integrationsConfigSchema,
  })
  .strict();
export type UserConfiguration = z.infer<typeof userConfigurationSchema>;

export const defaultUserConfiguration: UserConfiguration = {
  daemon: defaultDaemonConfig,
  harness: defaultHarnessConfig,
  ui: defaultUiConfig,
  permissions: defaultPermissionsConfig,
  providers: defaultProvidersConfig,
  integrations: defaultIntegrationsConfig,
};
