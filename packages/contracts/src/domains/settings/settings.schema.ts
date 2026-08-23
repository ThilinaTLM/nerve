import { z } from "zod";
import { applicationLogLevelSchema } from "../logs/logs.schema.js";
import {
  modelSelectionSchema,
  thinkingLevelSchema,
} from "../models/models.schema.js";
import {
  applicationSettingsPatchSchema,
  applicationSettingsSchema,
  defaultApplicationSettings,
} from "./application-configuration.schema.js";
import {
  supervisionGrantSchema,
  toolNameSchema,
  userConfigurableToolNameSchema,
} from "../tools/records.schema.js";

export const modeSchema = z.enum(["planning", "coding"]);
export type Mode = z.infer<typeof modeSchema>;

export const colorThemeSchema = z.enum(["nerve", "ocean", "forest"]);
export type ColorTheme = z.infer<typeof colorThemeSchema>;

export const colorModeSchema = z.enum(["system", "light", "dark"]);
export type ColorMode = z.infer<typeof colorModeSchema>;

export const headerTypeSchema = z.enum(["auto", "linux", "windows", "macos"]);
export type HeaderType = z.infer<typeof headerTypeSchema>;

export const permissionLevelSchema = z.enum([
  "autonomous",
  "supervised",
  "read_only",
]);
export type PermissionLevel = z.infer<typeof permissionLevelSchema>;

export const approvalPolicySchema = z.object({
  autoApproveReadOnly: z.boolean().default(true),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
export const defaultApprovalPolicy: ApprovalPolicy = {
  autoApproveReadOnly: true,
};
const approvalPolicyPatchSchema = z.object({
  autoApproveReadOnly: z.boolean().optional(),
});

export const agentSelectionSettingsSchema = z.object({
  mode: modeSchema.default("coding"),
  permissionLevel: permissionLevelSchema.default("autonomous"),
  approvalPolicy: approvalPolicySchema.default(defaultApprovalPolicy),
  model: modelSelectionSchema.optional(),
  thinkingLevel: thinkingLevelSchema.default("off"),
});
export type AgentSelectionSettings = z.infer<
  typeof agentSelectionSettingsSchema
>;

const runtimeSettingsSchema = z.object({
  pythonExecutablePath: z.string().trim().min(1).optional(),
  shellPath: z.string().trim().min(1).optional(),
});

const supervisionGrantsSchema = z
  .array(supervisionGrantSchema)
  .max(256)
  .superRefine((grants, context) => {
    const ids = new Set<string>();
    for (const [index, grant] of grants.entries()) {
      if (ids.has(grant.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate supervision grant id '${grant.id}'`,
          path: [index, "id"],
        });
      }
      ids.add(grant.id);
      if (grant.target === "tool") {
        if (!toolNameSchema.safeParse(grant.toolName).success) {
          context.addIssue({
            code: "custom",
            message: `Unknown tool '${grant.toolName}'`,
            path: [index, "toolName"],
          });
        }
        if (grant.toolName === "bash") {
          context.addIssue({
            code: "custom",
            message: "Bash requires a command-prefix grant.",
            path: [index, "toolName"],
          });
        }
      }
    }
  });

const supervisionSettingsSchema = z.object({
  grants: supervisionGrantsSchema.default([]),
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
  atlassianProfiles: atlassianProfilesSchema.default([]),
  tavilyProfiles: tavilyProfilesSchema.default([]),
});
export type ProvidersSettings = z.infer<typeof providersSettingsSchema>;

export const jiraToolSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  profileId: z.string().trim().min(1).optional(),
});

export const confluenceToolSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  profileId: z.string().trim().min(1).optional(),
});

export const webToolSettingsSchema = z.object({
  tavilyProfileId: z.string().trim().min(1).optional(),
});

const bashAutoPromotionSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  afterMs: z.number().int().positive().max(86_400_000).default(120_000),
});

const bashToolSettingsSchema = z.object({
  autoPromotion: bashAutoPromotionSettingsSchema.default({
    enabled: true,
    afterMs: 120_000,
  }),
});

const imageExplanationToolSettingsSchema = z.object({
  model: modelSelectionSchema.optional(),
  thinkingLevel: thinkingLevelSchema.default("off"),
});

const toolSettingsSchema = z.object({
  disabled: z.array(userConfigurableToolNameSchema).default(["explain_image"]),
  bash: bashToolSettingsSchema.default({
    autoPromotion: { enabled: true, afterMs: 120_000 },
  }),
  jira: jiraToolSettingsSchema.default({ enabled: false }),
  confluence: confluenceToolSettingsSchema.default({ enabled: false }),
  web: webToolSettingsSchema.default({}),
  imageExplanation: imageExplanationToolSettingsSchema.default({
    thinkingLevel: "off",
  }),
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
  question: notificationToneSchema.default(
    defaultNotificationEventSounds.question,
  ),
  planReview: notificationToneSchema.default(
    defaultNotificationEventSounds.planReview,
  ),
  approval: notificationToneSchema.default(
    defaultNotificationEventSounds.approval,
  ),
  completed: notificationToneSchema.default(
    defaultNotificationEventSounds.completed,
  ),
  failed: notificationToneSchema.default(defaultNotificationEventSounds.failed),
});

export const autoCompactionSettingsSchema = z.object({
  auto: z.boolean().default(true),
  profile: compactionProfileSchema.default("balanced"),
  customTriggerPercent: z.number().int().min(60).max(90).default(80),
  customKeepRecentPercent: z.number().int().min(5).max(40).default(15),
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
  model: transcriptionModelSchema.default("gpt-4o-transcribe"),
  languages: z.array(transcriptionLanguageSchema).max(10).default([]),
  vocabulary: z.array(transcriptionVocabularyTermSchema).max(50).default([]),
});
export type TranscriptionSettings = z.infer<typeof transcriptionSettingsSchema>;

export const settingsSchema = z.object({
  defaultMode: modeSchema,
  defaultPermissionLevel: permissionLevelSchema,
  defaultApprovalPolicy: approvalPolicySchema.default(defaultApprovalPolicy),
  defaultModel: modelSelectionSchema.optional(),
  defaultThinkingLevel: thinkingLevelSchema.default("off"),
  rememberLastAgentSelection: z.boolean().default(false),
  lastAgentSelection: agentSelectionSettingsSchema.default({
    mode: "coding",
    permissionLevel: "autonomous",
    approvalPolicy: defaultApprovalPolicy,
    thinkingLevel: "off",
  }),
  exploreAgent: z.object({
    model: modelSelectionSchema.optional(),
    thinkingLevel: thinkingLevelSchema.default("off"),
  }),
  application: applicationSettingsSchema.default(defaultApplicationSettings),
  ui: z.object({
    theme: colorThemeSchema.default("nerve"),
    colorMode: colorModeSchema.default("system"),
    zoomLevel: z.number().int().min(-8).max(8).default(0),
  }),
  desktop: z.object({
    closeToTray: z.boolean().default(true),
    headerType: headerTypeSchema.default("auto"),
  }),
  notifications: z
    .object({
      systemEnabled: z.boolean().default(true),
      soundsEnabled: z.boolean().default(true),
      events: notificationEventSoundSettingsSchema.default(
        defaultNotificationEventSounds,
      ),
    })
    .default({
      systemEnabled: true,
      soundsEnabled: true,
      events: defaultNotificationEventSounds,
    }),
  transcription: transcriptionSettingsSchema.default({
    model: "gpt-4o-transcribe",
    languages: [],
    vocabulary: [],
  }),
  compaction: autoCompactionSettingsSchema,
  logging: z.object({
    level: applicationLogLevelSchema.default("info"),
    retentionDays: z.number().int().positive().default(14),
    maxBufferedLogs: z.number().int().positive().default(2000),
  }),
  retry: z.object({
    enabled: z.boolean().default(true),
    maxRetries: z.number().int().nonnegative().default(3),
    baseDelayMs: z.number().int().positive().default(2000),
  }),
  runtime: runtimeSettingsSchema.default({}),
  supervision: supervisionSettingsSchema.default({ grants: [] }),
  providers: providersSettingsSchema.default({
    atlassianProfiles: [],
    tavilyProfiles: [],
  }),
  tools: toolSettingsSchema.default({
    disabled: ["explain_image"],
    bash: { autoPromotion: { enabled: true, afterMs: 120_000 } },
    jira: { enabled: false },
    confluence: { enabled: false },
    web: {},
    imageExplanation: { thinkingLevel: "off" },
  }),
  skills: z
    .object({
      disabled: z.array(z.string().min(1)).default([]),
      agentBrowser: z
        .object({ enabled: z.array(z.string().min(1)).default([]) })
        .default({ enabled: [] }),
    })
    .default({
      disabled: [],
      agentBrowser: { enabled: [] },
    }),
  scopedModels: z.array(modelSelectionSchema).default([]),
});
export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  defaultMode: "coding",
  defaultPermissionLevel: "autonomous",
  defaultApprovalPolicy,
  defaultThinkingLevel: "off",
  rememberLastAgentSelection: false,
  lastAgentSelection: {
    mode: "coding",
    permissionLevel: "autonomous",
    approvalPolicy: defaultApprovalPolicy,
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
  supervision: { grants: [] },
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
  defaultApprovalPolicy: approvalPolicyPatchSchema.optional(),
  defaultModel: modelSelectionSchema.nullable().optional(),
  defaultThinkingLevel: thinkingLevelSchema.optional(),
  rememberLastAgentSelection: z.boolean().optional(),
  lastAgentSelection: z
    .object({
      mode: modeSchema.optional(),
      permissionLevel: permissionLevelSchema.optional(),
      approvalPolicy: approvalPolicyPatchSchema.optional(),
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
  supervision: z
    .object({
      grants: supervisionGrantsSchema.optional(),
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
