import { z } from "zod";
import { applicationLogLevelSchema } from "../logs/logs.js";

export const MIN_DAEMON_MAX_OLD_SPACE_MB = 512;
export const MAX_CONCURRENT_MODEL_RUNS = 32;
export const MAX_PARALLEL_TOOLS_PER_RUN = 16;
export const MAX_ACTIVE_PROCESSES = 256;
export const MAX_ACTIVE_EXPLORE_AGENTS = 32;

export const resourcePolicyModeSchema = z.enum(["automatic", "manual"]);
export type ResourcePolicyMode = z.infer<typeof resourcePolicyModeSchema>;

export const resourceLimitsSchema = z.object({
  maxConcurrentModelRuns: z
    .number()
    .int()
    .min(1)
    .max(MAX_CONCURRENT_MODEL_RUNS),
  maxParallelToolsPerRun: z
    .number()
    .int()
    .min(1)
    .max(MAX_PARALLEL_TOOLS_PER_RUN),
  maxActiveProcesses: z.number().int().min(1).max(MAX_ACTIVE_PROCESSES),
  maxActiveExploreAgents: z
    .number()
    .int()
    .min(1)
    .max(MAX_ACTIVE_EXPLORE_AGENTS),
});
export type ResourceLimits = z.infer<typeof resourceLimitsSchema>;

export const detectedResourceCapacitySchema = z.object({
  logicalCpuCount: z.number().int().positive(),
  effectiveCpuCount: z.number().int().positive(),
  totalMemoryMb: z.number().int().positive(),
});
export type DetectedResourceCapacity = z.infer<
  typeof detectedResourceCapacitySchema
>;

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxConcurrentModelRuns: 10,
  maxParallelToolsPerRun: 3,
  maxActiveProcesses: 16,
  maxActiveExploreAgents: 5,
};

export const electronOzonePlatformSchema = z.enum(["auto", "x11", "wayland"]);
export type ElectronOzonePlatform = z.infer<typeof electronOzonePlatformSchema>;

export const electronFontRenderHintingSchema = z.enum([
  "system",
  "none",
  "slight",
  "medium",
  "full",
]);
export type ElectronFontRenderHinting = z.infer<
  typeof electronFontRenderHintingSchema
>;

export const applicationSettingsSchema = z.object({
  network: z.object({
    host: z.string().trim().min(1).default("127.0.0.1"),
    port: z.number().int().min(1).max(65_535).default(3747),
    allowRemote: z.boolean().default(false),
    mobileHttps: z.boolean().default(false),
    httpsPort: z.number().int().min(1).max(65_535).default(3748),
  }),
  diagnostics: z.object({
    loggingEnabled: z.boolean().default(false),
    performanceEnabled: z.boolean().optional(),
  }),
  daemon: z.object({
    startupTimeoutMs: z.number().int().positive().default(60_000),
    maxOldSpaceMb: z.number().int().positive().default(4096),
  }),
  resources: z
    .object({
      mode: resourcePolicyModeSchema.default("automatic"),
      ...resourceLimitsSchema.shape,
    })
    .default({ mode: "automatic", ...DEFAULT_RESOURCE_LIMITS }),
  electron: z.object({
    ozonePlatform: electronOzonePlatformSchema.default("auto"),
    fontRenderHinting: electronFontRenderHintingSchema.default("slight"),
  }),
});
export type ApplicationSettings = z.infer<typeof applicationSettingsSchema>;

export const defaultApplicationSettings: ApplicationSettings = {
  network: {
    host: "127.0.0.1",
    port: 3747,
    allowRemote: false,
    mobileHttps: false,
    httpsPort: 3748,
  },
  diagnostics: { loggingEnabled: false },
  daemon: { startupTimeoutMs: 60_000, maxOldSpaceMb: 4096 },
  resources: { mode: "automatic", ...DEFAULT_RESOURCE_LIMITS },
  electron: { ozonePlatform: "auto", fontRenderHinting: "slight" },
};

export const applicationSettingsPatchSchema = z.object({
  network: z
    .object({
      host: z.string().trim().min(1).optional(),
      port: z.number().int().min(1).max(65_535).optional(),
      allowRemote: z.boolean().optional(),
      mobileHttps: z.boolean().optional(),
      httpsPort: z.number().int().min(1).max(65_535).optional(),
    })
    .optional(),
  diagnostics: z
    .object({
      loggingEnabled: z.boolean().optional(),
      performanceEnabled: z.boolean().optional(),
    })
    .optional(),
  daemon: z
    .object({
      startupTimeoutMs: z.number().int().positive().optional(),
      maxOldSpaceMb: z
        .number()
        .int()
        .min(MIN_DAEMON_MAX_OLD_SPACE_MB)
        .optional(),
    })
    .optional(),
  resources: z
    .object({
      mode: resourcePolicyModeSchema.optional(),
      maxConcurrentModelRuns:
        resourceLimitsSchema.shape.maxConcurrentModelRuns.optional(),
      maxParallelToolsPerRun:
        resourceLimitsSchema.shape.maxParallelToolsPerRun.optional(),
      maxActiveProcesses:
        resourceLimitsSchema.shape.maxActiveProcesses.optional(),
      maxActiveExploreAgents:
        resourceLimitsSchema.shape.maxActiveExploreAgents.optional(),
    })
    .optional(),
  electron: z
    .object({
      ozonePlatform: electronOzonePlatformSchema.optional(),
      fontRenderHinting: electronFontRenderHintingSchema.optional(),
    })
    .optional(),
});
export type ApplicationSettingsPatch = z.infer<
  typeof applicationSettingsPatchSchema
>;

export const updateApplicationConfigurationRequestSchema = z.object({
  application: applicationSettingsPatchSchema.optional(),
  logging: z
    .object({
      level: applicationLogLevelSchema.optional(),
      retentionDays: z.number().int().positive().optional(),
      maxBufferedLogs: z.number().int().positive().optional(),
    })
    .optional(),
});
export type UpdateApplicationConfigurationRequest = z.infer<
  typeof updateApplicationConfigurationRequestSchema
>;

export const configurationSourceSchema = z.object({
  kind: z.enum([
    "settings",
    "environment",
    "command_line",
    "development_default",
    "automatic",
  ]),
  name: z.string().optional(),
});
export type ConfigurationSource = z.infer<typeof configurationSourceSchema>;

export const restartTargetSchema = z.enum(["none", "daemon", "desktop"]);
export type RestartTarget = z.infer<typeof restartTargetSchema>;

function resolvedSettingSchema<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    activeValue: value,
    savedValue: value,
    source: configurationSourceSchema,
    editable: z.boolean(),
    restartTarget: restartTargetSchema,
    pendingRestart: z.boolean(),
  });
}

const resolvedStringSettingSchema = resolvedSettingSchema(z.string());
const resolvedNumberSettingSchema = resolvedSettingSchema(z.number());
const resolvedBooleanSettingSchema = resolvedSettingSchema(z.boolean());

export const applicationConfigurationSnapshotSchema = z.object({
  application: z.object({
    network: z.object({
      host: resolvedStringSettingSchema,
      port: resolvedNumberSettingSchema,
      allowRemote: resolvedBooleanSettingSchema,
      mobileHttps: resolvedBooleanSettingSchema,
      httpsPort: resolvedNumberSettingSchema,
    }),
    diagnostics: z.object({
      loggingEnabled: resolvedBooleanSettingSchema,
      performanceEnabled: resolvedBooleanSettingSchema,
      level: resolvedSettingSchema(applicationLogLevelSchema),
      retentionDays: resolvedNumberSettingSchema,
      maxBufferedLogs: resolvedNumberSettingSchema,
    }),
    daemon: z.object({
      startupTimeoutMs: resolvedNumberSettingSchema,
      maxOldSpaceMb: resolvedNumberSettingSchema,
    }),
    resources: z.object({
      mode: resolvedSettingSchema(resourcePolicyModeSchema),
      maxConcurrentModelRuns: resolvedNumberSettingSchema,
      maxParallelToolsPerRun: resolvedNumberSettingSchema,
      maxActiveProcesses: resolvedNumberSettingSchema,
      maxActiveExploreAgents: resolvedNumberSettingSchema,
    }),
    electron: z.object({
      ozonePlatform: resolvedSettingSchema(electronOzonePlatformSchema),
      fontRenderHinting: resolvedSettingSchema(electronFontRenderHintingSchema),
    }),
  }),
  context: z.object({
    dataDir: z.string(),
    dataDirSource: z.enum(["default", "environment"]),
    platform: z.string(),
    packaged: z.boolean().optional(),
    webAssetsOverridden: z.boolean(),
    proxyConfigured: z.boolean(),
    proxyDebugEnabled: z.boolean(),
    resources: z.object({
      detected: detectedResourceCapacitySchema,
      recommended: resourceLimitsSchema,
      effective: resourceLimitsSchema,
      controlWorkConcurrency: z.number().int().positive(),
    }),
  }),
});
export type ApplicationConfigurationSnapshot = z.infer<
  typeof applicationConfigurationSnapshotSchema
>;
