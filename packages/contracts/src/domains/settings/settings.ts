import { z } from "zod";
import { applicationLogLevelSchema } from "../logs/logs.js";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import {
  applicationSettingsPatchSchema,
  applicationSettingsSchema,
  defaultApplicationSettings,
} from "./application-configuration.js";
import { permissionRuleSetIdSchema } from "../permissions/permission-rule-sets.js";
import {
  permissionExceptionSchema,
  permissionLevelSchema,
} from "../permissions/permissions.js";
import { userConfigurableToolNameSchema } from "../tools/tool-name.js";

export const modeSchema = z.enum(["planning", "coding"]);
export type Mode = z.infer<typeof modeSchema>;

export const colorThemeSchema = z.enum(["nerve", "ocean", "forest"]);
export type ColorTheme = z.infer<typeof colorThemeSchema>;

export const colorModeSchema = z.enum(["system", "light", "dark"]);
export type ColorMode = z.infer<typeof colorModeSchema>;

export const headerTypeSchema = z.enum(["auto", "linux", "windows", "macos"]);
export type HeaderType = z.infer<typeof headerTypeSchema>;

export const agentSelectionSettingsSchema = z.object({
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  permissionRuleSetId: permissionRuleSetIdSchema.optional(),
  model: modelSelectionSchema.optional(),
  thinkingLevel: thinkingLevelSchema,
});
export type AgentSelectionSettings = z.infer<
  typeof agentSelectionSettingsSchema
>;

const runtimeSettingsSchema = z.object({
  pythonExecutablePath: z.string().trim().min(1).optional(),
  shellPath: z.string().trim().min(1).optional(),
});

const permissionExceptionsSchema = z
  .array(permissionExceptionSchema)
  .max(256)
  .superRefine((exceptions, context) => {
    const ids = new Set<string>();
    for (const [index, exception] of exceptions.entries()) {
      if (ids.has(exception.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate permission exception id '${exception.id}'`,
          path: [index, "id"],
        });
      }
      ids.add(exception.id);
    }
  });

const permissionSettingsSchema = z.object({
  exceptions: permissionExceptionsSchema,
});

export const atlassianProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  siteUrl: z.string().trim().url().optional(),
  email: z.string().trim().email().optional(),
  defaultProjectKey: z.string().trim().min(1).optional(),
  defaultSpaceKey: z.string().trim().min(1).optional(),
});
export type AtlassianProfile = z.infer<typeof atlassianProfileSchema>;

export const tavilyProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
});
export type TavilyProfile = z.infer<typeof tavilyProfileSchema>;

function uniqueProfileIds<T extends { id: string }>(
  profiles: T[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, profile] of profiles.entries()) {
    if (seen.has(profile.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate profile id '${profile.id}'`,
        path: [index, "id"],
      });
    }
    seen.add(profile.id);
  }
}

const atlassianProfilesSchema = z
  .array(atlassianProfileSchema)
  .superRefine(uniqueProfileIds);
const tavilyProfilesSchema = z
  .array(tavilyProfileSchema)
  .superRefine(uniqueProfileIds);

export const providersSettingsSchema = z.object({
  atlassianProfiles: atlassianProfilesSchema,
  tavilyProfiles: tavilyProfilesSchema,
});
export type ProvidersSettings = z.infer<typeof providersSettingsSchema>;

export const jiraToolSettingsSchema = z.object({
  enabled: z.boolean(),
  profileId: z.string().trim().min(1).optional(),
});

export const confluenceToolSettingsSchema = z.object({
  enabled: z.boolean(),
  profileId: z.string().trim().min(1).optional(),
});

export const webToolSettingsSchema = z.object({
  tavilyProfileId: z.string().trim().min(1).optional(),
});

const bashAutoPromotionSettingsSchema = z.object({
  enabled: z.boolean(),
  afterMs: z.number().int().positive().max(86_400_000),
});

const bashToolSettingsSchema = z.object({
  autoPromotion: bashAutoPromotionSettingsSchema,
});

const imageExplanationToolSettingsSchema = z.object({
  model: modelSelectionSchema.optional(),
  thinkingLevel: thinkingLevelSchema,
});

const toolSettingsSchema = z.object({
  disabled: z.array(userConfigurableToolNameSchema),
  bash: bashToolSettingsSchema,
  jira: jiraToolSettingsSchema,
  confluence: confluenceToolSettingsSchema,
  web: webToolSettingsSchema,
  imageExplanation: imageExplanationToolSettingsSchema,
});

export const compactionProfileSchema = z.enum([
  "aggressive",
  "balanced",
  "conservative",
  "custom",
]);
export type CompactionProfile = z.infer<typeof compactionProfileSchema>;

export const notificationToneSchema = z.enum([
  "none",
  "bell",
  "chime",
  "click",
  "pop",
  "success",
  "alert",
  "ping",
  "pulse",
  "ripple",
  "sparkle",
  "knock",
  "signal",
]);
export type NotificationTone = z.infer<typeof notificationToneSchema>;

export const defaultNotificationEventSounds = {
  question: "bell",
  planReview: "chime",
  approval: "bell",
  completed: "success",
  failed: "alert",
} as const satisfies Record<string, NotificationTone>;

const notificationEventSoundSettingsSchema = z.object({
  question: notificationToneSchema,
  planReview: notificationToneSchema,
  approval: notificationToneSchema,
  completed: notificationToneSchema,
  failed: notificationToneSchema,
});

export const autoCompactionSettingsSchema = z.object({
  auto: z.boolean(),
  profile: compactionProfileSchema,
  customTriggerPercent: z.number().int().min(60).max(90),
  customKeepRecentPercent: z.number().int().min(5).max(40),
});
export type AutoCompactionSettings = z.infer<
  typeof autoCompactionSettingsSchema
>;

export const transcriptionModelSchema = z.enum([
  "gpt-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
]);
export type TranscriptionModel = z.infer<typeof transcriptionModelSchema>;

const transcriptionLanguageSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(?:-[a-z]{2})?$/);
const transcriptionVocabularyTermSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^<>\r\n]+$/);

export const transcriptionSettingsSchema = z.object({
  model: transcriptionModelSchema,
  languages: z.array(transcriptionLanguageSchema).max(10),
  vocabulary: z.array(transcriptionVocabularyTermSchema).max(50),
});
export type TranscriptionSettings = z.infer<typeof transcriptionSettingsSchema>;

export const settingsSchema = z.object({
  defaultMode: modeSchema,
  defaultPermissionLevel: permissionLevelSchema,
  defaultPermissionRuleSetId: permissionRuleSetIdSchema.optional(),
  defaultModel: modelSelectionSchema.optional(),
  defaultThinkingLevel: thinkingLevelSchema,
  rememberLastAgentSelection: z.boolean(),
  lastAgentSelection: agentSelectionSettingsSchema,
  exploreAgent: z.object({
    model: modelSelectionSchema.optional(),
    thinkingLevel: thinkingLevelSchema,
  }),
  application: applicationSettingsSchema,
  ui: z.object({
    theme: colorThemeSchema,
    colorMode: colorModeSchema,
    zoomLevel: z.number().int().min(-8).max(8),
  }),
  desktop: z.object({
    closeToTray: z.boolean(),
    headerType: headerTypeSchema,
  }),
  notifications: z.object({
    systemEnabled: z.boolean(),
    soundsEnabled: z.boolean(),
    events: notificationEventSoundSettingsSchema,
  }),
  transcription: transcriptionSettingsSchema,
  compaction: autoCompactionSettingsSchema,
  logging: z.object({
    level: applicationLogLevelSchema,
    retentionDays: z.number().int().positive(),
    maxBufferedLogs: z.number().int().positive(),
  }),
  retry: z.object({
    enabled: z.boolean(),
    maxRetries: z.number().int().nonnegative(),
    baseDelayMs: z.number().int().positive(),
  }),
  runtime: runtimeSettingsSchema,
  permissions: permissionSettingsSchema,
  providers: providersSettingsSchema,
  tools: toolSettingsSchema,
  skills: z.object({
    disabled: z.array(z.string().min(1)),
    agentBrowser: z.object({ enabled: z.array(z.string().min(1)) }),
  }),
  scopedModels: z.array(modelSelectionSchema),
});
export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  defaultMode: "coding",
  defaultPermissionLevel: "autonomous",
  defaultPermissionRuleSetId: "autonomous",
  defaultThinkingLevel: "off",
  rememberLastAgentSelection: false,
  lastAgentSelection: {
    mode: "coding",
    permissionLevel: "autonomous",
    permissionRuleSetId: "autonomous",
    thinkingLevel: "off",
  },
  exploreAgent: {
    thinkingLevel: "off",
  },
  application: defaultApplicationSettings,
  ui: {
    theme: "nerve",
    colorMode: "system",
    zoomLevel: 0,
  },
  desktop: {
    closeToTray: true,
    headerType: "auto",
  },
  notifications: {
    systemEnabled: true,
    soundsEnabled: true,
    events: defaultNotificationEventSounds,
  },
  transcription: {
    model: "gpt-4o-transcribe",
    languages: [],
    vocabulary: [],
  },
  compaction: {
    auto: true,
    profile: "balanced",
    customTriggerPercent: 80,
    customKeepRecentPercent: 15,
  },
  logging: {
    level: "info",
    retentionDays: 14,
    maxBufferedLogs: 2000,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
  },
  runtime: {},
  permissions: { exceptions: [] },
  providers: { atlassianProfiles: [], tavilyProfiles: [] },
  tools: {
    disabled: ["explain_image"],
    bash: { autoPromotion: { enabled: true, afterMs: 120_000 } },
    jira: { enabled: false },
    confluence: { enabled: false },
    web: {},
    imageExplanation: { thinkingLevel: "off" },
  },
  skills: { disabled: [], agentBrowser: { enabled: [] } },
  scopedModels: [],
};

export const updateSettingsRequestSchema = z.object({
  defaultMode: modeSchema.optional(),
  defaultPermissionLevel: permissionLevelSchema.optional(),
  defaultPermissionRuleSetId: permissionRuleSetIdSchema.optional(),
  defaultModel: modelSelectionSchema.nullable().optional(),
  defaultThinkingLevel: thinkingLevelSchema.optional(),
  rememberLastAgentSelection: z.boolean().optional(),
  lastAgentSelection: z
    .object({
      mode: modeSchema.optional(),
      permissionLevel: permissionLevelSchema.optional(),
      permissionRuleSetId: permissionRuleSetIdSchema.optional(),
      model: modelSelectionSchema.nullable().optional(),
      thinkingLevel: thinkingLevelSchema.optional(),
    })
    .optional(),
  exploreAgent: z
    .object({
      model: modelSelectionSchema.nullable().optional(),
      thinkingLevel: thinkingLevelSchema.optional(),
    })
    .optional(),
  application: applicationSettingsPatchSchema.optional(),
  ui: z
    .object({
      theme: colorThemeSchema.optional(),
      colorMode: colorModeSchema.optional(),
      zoomLevel: z.number().int().min(-8).max(8).optional(),
    })
    .optional(),
  desktop: z
    .object({
      closeToTray: z.boolean().optional(),
      headerType: headerTypeSchema.optional(),
    })
    .optional(),
  notifications: z
    .object({
      systemEnabled: z.boolean().optional(),
      soundsEnabled: z.boolean().optional(),
      events: z
        .object({
          question: notificationToneSchema.optional(),
          planReview: notificationToneSchema.optional(),
          approval: notificationToneSchema.optional(),
          completed: notificationToneSchema.optional(),
          failed: notificationToneSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  transcription: z
    .object({
      model: transcriptionModelSchema.optional(),
      languages: z.array(transcriptionLanguageSchema).max(10).optional(),
      vocabulary: z.array(transcriptionVocabularyTermSchema).max(50).optional(),
    })
    .optional(),
  compaction: z
    .object({
      auto: z.boolean().optional(),
      profile: compactionProfileSchema.optional(),
      customTriggerPercent: z.number().int().min(60).max(90).optional(),
      customKeepRecentPercent: z.number().int().min(5).max(40).optional(),
    })
    .optional(),
  logging: z
    .object({
      level: applicationLogLevelSchema.optional(),
      retentionDays: z.number().int().positive().optional(),
      maxBufferedLogs: z.number().int().positive().optional(),
    })
    .optional(),
  retry: z
    .object({
      enabled: z.boolean().optional(),
      maxRetries: z.number().int().nonnegative().optional(),
      baseDelayMs: z.number().int().positive().optional(),
    })
    .optional(),
  permissions: z
    .object({
      exceptions: permissionExceptionsSchema.optional(),
    })
    .optional(),
  runtime: z
    .object({
      pythonExecutablePath: z.string().trim().min(1).nullable().optional(),
      shellPath: z.string().trim().min(1).nullable().optional(),
    })
    .optional(),
  providers: z
    .object({
      atlassianProfiles: atlassianProfilesSchema.optional(),
      tavilyProfiles: tavilyProfilesSchema.optional(),
    })
    .optional(),
  skills: z
    .object({
      disabled: z.array(z.string().min(1)).optional(),
      agentBrowser: z
        .object({
          enabled: z.array(z.string().min(1)).optional(),
        })
        .optional(),
    })
    .optional(),
  tools: z
    .object({
      disabled: z.array(userConfigurableToolNameSchema).optional(),
      bash: z
        .object({
          autoPromotion: z
            .object({
              enabled: z.boolean().optional(),
              afterMs: z.number().int().positive().max(86_400_000).optional(),
            })
            .optional(),
        })
        .optional(),
      jira: z
        .object({
          enabled: z.boolean().optional(),
          profileId: z.string().trim().min(1).nullable().optional(),
        })
        .optional(),
      confluence: z
        .object({
          enabled: z.boolean().optional(),
          profileId: z.string().trim().min(1).nullable().optional(),
        })
        .optional(),
      web: z
        .object({
          tavilyProfileId: z.string().trim().min(1).nullable().optional(),
        })
        .optional(),
      imageExplanation: z
        .object({
          model: modelSelectionSchema.nullable().optional(),
          thinkingLevel: thinkingLevelSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  scopedModels: z.array(modelSelectionSchema).optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
