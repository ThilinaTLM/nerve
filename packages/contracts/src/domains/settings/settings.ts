import { agentProfileNameSchema } from "../agent-profiles/constants.js";
import {
  disabledToolListSchema,
  subagentToolNames,
} from "../tools/subagent-tools.js";
import { z } from "zod";
import { applicationLogLevelSchema } from "../logs/logs.js";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import {
  applicationSettingsPatchSchema,
  applicationSettingsSchema,
  defaultApplicationSettings,
} from "./application-configuration.js";
import { permissionRuleSetIdSchema } from "../permissions/permission-rule-sets.js";
import { permissionExceptionListSchema } from "../permissions/permissions.js";

/** The client's single theme choice, ordered by family for pickers. */
export const colorThemeSchema = z.enum([
  "nerve-light",
  "nerve-dark",
  "melange-light",
  "melange-dark",
  "graphite",
  "indigo",
]);
export type ColorTheme = z.infer<typeof colorThemeSchema>;
export const defaultColorTheme = "nerve-dark" satisfies ColorTheme;

/**
 * Each theme is either light or dark; the kind drives the mode-dependent
 * globals (`.dark`, `color-scheme`) for the chosen theme.
 */
export type ColorThemeKind = "light" | "dark";
export const colorThemeKind: Record<ColorTheme, ColorThemeKind> = {
  "nerve-light": "light",
  "nerve-dark": "dark",
  "melange-light": "light",
  "melange-dark": "dark",
  graphite: "dark",
  indigo: "dark",
};

export const headerTypeSchema = z.enum(["auto", "linux", "windows", "macos"]);
export type HeaderType = z.infer<typeof headerTypeSchema>;

const permissionSettingsSchema = z.object({
  exceptions: permissionExceptionListSchema,
});

const bashAutoPromotionSettingsSchema = z.object({
  enabled: z.boolean(),
  afterMs: z.number().int().positive().max(86_400_000),
});

export const pythonExecToolSettingsSchema = z
  .object({
    interpreterPath: z.string().trim().min(1).optional(),
  })
  .strict();
export type PythonExecToolSettings = z.infer<
  typeof pythonExecToolSettingsSchema
>;
export const planPresentToolSettingsSchema = z
  .object({
    approvalProfile: agentProfileNameSchema,
  })
  .strict();
export type PlanPresentToolSettings = z.infer<
  typeof planPresentToolSettingsSchema
>;

export const bashToolSettingsSchema = z.object({
  shellPath: z.string().trim().min(1).optional(),
  autoPromotion: bashAutoPromotionSettingsSchema,
  maxTimeoutMs: z.number().int().min(1000).max(3_600_000).default(900_000),
});

export type BashToolSettings = z.infer<typeof bashToolSettingsSchema>;

export const imageExplanationToolSettingsSchema = z.object({
  model: modelSelectionSchema.optional(),
  thinkingLevel: thinkingLevelSchema,
});
export type ImageExplanationToolSettings = z.infer<
  typeof imageExplanationToolSettingsSchema
>;

const toolSettingsSchema = z.object({
  disabled: disabledToolListSchema,
  bash: bashToolSettingsSchema,
  pythonExec: pythonExecToolSettingsSchema,
  planPresent: planPresentToolSettingsSchema,
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

export const autoCompactionSettingsSchema = z
  .object({
    auto: z.boolean(),
    profile: compactionProfileSchema,
    customTriggerPercent: z.number().int().min(60).max(90),
  })
  .strict();

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

export const conversationTitlesSettingsSchema = z.object({
  enabled: z.boolean(),
  model: modelSelectionSchema.nullable(),
});
export type ConversationTitlesSettings = z.infer<
  typeof conversationTitlesSettingsSchema
>;

export const settingsSchema = z.object({
  defaultAgentProfile: agentProfileNameSchema.optional(),
  defaultPermissionRuleSetId: permissionRuleSetIdSchema,
  defaultModel: modelSelectionSchema.optional(),
  defaultThinkingLevel: thinkingLevelSchema,
  application: applicationSettingsSchema,
  ui: z.object({
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
  conversationTitles: conversationTitlesSettingsSchema.default({
    enabled: false,
    model: null,
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
  permissions: permissionSettingsSchema,
  tools: toolSettingsSchema,
  skills: z.object({
    disabled: z.array(z.string().min(1)),
    nerve: z.object({ enabled: z.array(z.string().min(1)) }),
    agentBrowser: z.object({ enabled: z.array(z.string().min(1)) }),
  }),
  scopedModels: z.array(modelSelectionSchema),
});
export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  defaultPermissionRuleSetId: "autonomous",
  defaultThinkingLevel: "off",
  application: defaultApplicationSettings,
  ui: {
    zoomLevel: 0,
  },
  desktop: {
    closeToTray: false,
    headerType: "auto",
  },
  notifications: {
    systemEnabled: true,
    soundsEnabled: true,
    events: defaultNotificationEventSounds,
  },
  conversationTitles: { enabled: false, model: null },
  transcription: {
    model: "gpt-4o-transcribe",
    languages: [],
    vocabulary: [],
  },
  compaction: {
    auto: true,
    profile: "balanced",
    customTriggerPercent: 80,
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
  permissions: { exceptions: [] },
  tools: {
    disabled: ["plan_present", "explain_image", ...subagentToolNames],
    bash: {
      autoPromotion: { enabled: true, afterMs: 120_000 },
      maxTimeoutMs: 900_000,
    },
    pythonExec: {},
    planPresent: { approvalProfile: "coding" },
    imageExplanation: { thinkingLevel: "off" },
  },
  skills: {
    disabled: [],
    nerve: { enabled: [] },
    agentBrowser: { enabled: [] },
  },
  scopedModels: [],
};

export const updateSettingsRequestSchema = z.strictObject({
  conversationTitles: conversationTitlesSettingsSchema.optional(),
  application: applicationSettingsPatchSchema.optional(),
  ui: z
    .object({
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
  logging: z
    .object({
      level: applicationLogLevelSchema.optional(),
      retentionDays: z.number().int().positive().optional(),
      maxBufferedLogs: z.number().int().positive().optional(),
    })
    .optional(),
  permissions: z
    .object({
      exceptions: permissionExceptionListSchema.optional(),
    })
    .optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

export const TITLE_TEST_PROMPT =
  "Can you look at why the websocket reconnect backoff never resets after a successful reconnect?";
export const titleTestResultSchema = z.discriminatedUnion("category", [
  z.object({
    category: z.literal("success"),
    title: z.string(),
    latencyMs: z.number(),
  }),
  z.object({
    category: z.enum([
      "timeout",
      "auth",
      "rate limit",
      "invalid output",
      "unavailable",
    ]),
  }),
]);
export type TitleTestResult = z.infer<typeof titleTestResultSchema>;
