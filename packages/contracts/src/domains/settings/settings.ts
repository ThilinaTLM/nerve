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
import { permissionExceptionSchema } from "../permissions/permissions.js";

/** The client's single theme choice, ordered by family for pickers. */
export const colorThemeSchema = z.enum([
  "nerve-light",
  "nerve-dark",
  "melange-light",
  "melange-dark",
  "graphite",
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
};

export const headerTypeSchema = z.enum(["auto", "linux", "windows", "macos"]);
export type HeaderType = z.infer<typeof headerTypeSchema>;

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

export const imageGenerationProviderSchema = z.enum(["openai-codex"]);
export type ImageGenerationProvider = z.infer<
  typeof imageGenerationProviderSchema
>;

export const openAiCodexImageModelSchema = z.enum([
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
]);
export type OpenAiCodexImageModel = z.infer<typeof openAiCodexImageModelSchema>;
export const openAiCodexImageQualitySchema = z.enum([
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type OpenAiCodexImageQuality = z.infer<
  typeof openAiCodexImageQualitySchema
>;
export const openAiCodexImageBackgroundSchema = z.enum([
  "auto",
  "opaque",
  "transparent",
]);
export type OpenAiCodexImageBackground = z.infer<
  typeof openAiCodexImageBackgroundSchema
>;
const customOpenAiCodexImageSizeSchema = z
  .string()
  .regex(/^\d+x\d+$/)
  .refine((value) => {
    const [width, height] = value.split("x").map(Number);
    if (!width || !height || width % 16 !== 0 || height % 16 !== 0) {
      return false;
    }
    const longEdge = Math.max(width, height);
    const shortEdge = Math.min(width, height);
    const pixels = width * height;
    return (
      longEdge <= 3840 &&
      longEdge / shortEdge <= 3 &&
      pixels >= 655_360 &&
      pixels <= 8_294_400
    );
  });
export const openAiCodexImageSizeSchema = z.union([
  z.literal("auto"),
  customOpenAiCodexImageSizeSchema,
]);
export type OpenAiCodexImageSize = z.infer<typeof openAiCodexImageSizeSchema>;

export const openAiCodexImageGenerationSettingsSchema = z.object({
  provider: z.literal("openai-codex"),
  model: openAiCodexImageModelSchema,
  options: z.object({
    quality: openAiCodexImageQualitySchema,
    size: openAiCodexImageSizeSchema,
    background: openAiCodexImageBackgroundSchema,
  }),
});
export type OpenAiCodexImageGenerationSettings = z.infer<
  typeof openAiCodexImageGenerationSettingsSchema
>;
export const imageGenerationToolSettingsSchema = z.discriminatedUnion(
  "provider",
  [openAiCodexImageGenerationSettingsSchema],
);
export type ImageGenerationToolSettings = z.infer<
  typeof imageGenerationToolSettingsSchema
>;

export const krokiToolSettingsSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1)
      .max(2_048)
      .url()
      .refine(
        (value) => {
          try {
            const url = new URL(value);
            return (
              ["http:", "https:"].includes(url.protocol) &&
              !url.username &&
              !url.password &&
              !url.search &&
              !url.hash
            );
          } catch {
            return false;
          }
        },
        {
          message:
            "Use an HTTP(S) URL without credentials, query parameters, or fragments.",
        },
      )
      .transform((value) => {
        const url = new URL(value);
        if (!url.pathname.endsWith("/")) url.pathname += "/";
        return url.href;
      }),
  })
  .strict();
export type KrokiToolSettings = z.infer<typeof krokiToolSettingsSchema>;
export const defaultKrokiToolSettings: KrokiToolSettings = {
  url: "https://kroki.io/",
};

const toolSettingsSchema = z.object({
  kroki: krokiToolSettingsSchema,
  disabled: disabledToolListSchema,
  bash: bashToolSettingsSchema,
  pythonExec: pythonExecToolSettingsSchema,
  planPresent: planPresentToolSettingsSchema,
  jira: jiraToolSettingsSchema,
  confluence: confluenceToolSettingsSchema,
  web: webToolSettingsSchema,
  imageExplanation: imageExplanationToolSettingsSchema,
  imageGeneration: imageGenerationToolSettingsSchema.default({
    provider: "openai-codex",
    model: "gpt-image-2.5-flare",
    options: { quality: "auto", size: "auto", background: "auto" },
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
  providers: providersSettingsSchema,
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
  providers: { atlassianProfiles: [], tavilyProfiles: [] },
  tools: {
    disabled: [
      "plan_present",
      "explain_image",
      "generate_image",
      "kroki_export",
      ...subagentToolNames,
    ],
    bash: {
      autoPromotion: { enabled: true, afterMs: 120_000 },
      maxTimeoutMs: 900_000,
    },
    pythonExec: {},
    planPresent: { approvalProfile: "coding" },
    jira: { enabled: false },
    confluence: { enabled: false },
    web: {},
    kroki: defaultKrokiToolSettings,
    imageExplanation: { thinkingLevel: "off" },
    imageGeneration: {
      provider: "openai-codex",
      model: "gpt-image-2.5-flare",
      options: { quality: "auto", size: "auto", background: "auto" },
    },
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
      exceptions: permissionExceptionsSchema.optional(),
    })
    .optional(),
  providers: z
    .object({
      atlassianProfiles: atlassianProfilesSchema.optional(),
      tavilyProfiles: tavilyProfilesSchema.optional(),
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
