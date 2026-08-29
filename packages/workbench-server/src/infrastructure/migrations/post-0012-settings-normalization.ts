import {
  defaultNotificationEventSounds,
  defaultSettings,
  type Settings,
  settingsSchema,
} from "@nervekit/contracts";
import { migrateLegacyPermissionValue } from "./post-0012-permission-normalization.js";
import {
  migrateApplicationConfiguration,
  migrateLegacyAppearanceSettings,
} from "./post-0012-settings-migrations.js";

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function migrateLegacyToolNames(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  const settings = objectRecord(value);
  const tools = objectRecord(settings?.tools);
  const disabled = tools?.disabled;
  if (
    !settings ||
    !tools ||
    !Array.isArray(disabled) ||
    !disabled.includes("python")
  ) {
    return { value, changed: false };
  }
  return {
    value: {
      ...settings,
      tools: {
        ...tools,
        disabled: [
          ...new Set(
            disabled.map((name) => (name === "python" ? "python_exec" : name)),
          ),
        ],
      },
    },
    changed: true,
  };
}

function migrateImageExplanationTool(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  const settings = objectRecord(value);
  const tools = objectRecord(settings?.tools);
  if (!settings || !tools || "imageExplanation" in tools)
    return { value, changed: false };
  const disabled = Array.isArray(tools.disabled) ? tools.disabled : [];
  return {
    value: {
      ...settings,
      tools: {
        ...tools,
        disabled: [...new Set([...disabled, "explain_image"])],
        imageExplanation: {},
      },
    },
    changed: true,
  };
}

const removedNotificationToneIds = new Set([
  "kenney-click-1",
  "kenney-click-2",
  "kenney-click-3",
  "kenney-rollover-1",
  "kenney-rollover-4",
  "kenney-rollover-6",
  "kenney-switch-1",
  "kenney-switch-7",
  "kenney-switch-10",
  "kenney-switch-15",
  "kenney-switch-20",
  "kenney-switch-31",
]);

function migrateRemovedNotificationTones(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  const settings = objectRecord(value);
  const notifications = objectRecord(settings?.notifications);
  const events = objectRecord(notifications?.events);
  if (!settings || !notifications || !events) return { value, changed: false };
  const migratedEvents = { ...events };
  let changed = false;
  for (const [event, fallback] of Object.entries(
    defaultNotificationEventSounds,
  )) {
    if (removedNotificationToneIds.has(String(migratedEvents[event]))) {
      migratedEvents[event] = fallback;
      changed = true;
    }
  }
  return changed
    ? {
        value: {
          ...settings,
          notifications: { ...notifications, events: migratedEvents },
        },
        changed,
      }
    : { value, changed: false };
}

function migrateLegacyPermissionSettings(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  const migrated = migrateLegacyPermissionValue(value);
  return {
    value: migrated,
    changed: JSON.stringify(migrated) !== JSON.stringify(value),
  };
}

export function normalizeSettings(value: unknown): {
  settings: Settings;
  changed: boolean;
} {
  const steps = [
    migrateApplicationConfiguration,
    migrateLegacyAppearanceSettings,
    migrateLegacyToolNames,
    migrateLegacyPermissionSettings,
    migrateImageExplanationTool,
    migrateRemovedNotificationTones,
  ];
  let current = value;
  let changed = false;
  for (const step of steps) {
    const result = step(current);
    current = result.value;
    changed ||= result.changed;
  }
  const merged = mergeLegacySettings(defaultSettings, current);
  const settings = settingsSchema.parse(merged);
  return {
    settings,
    changed: changed || JSON.stringify(settings) !== JSON.stringify(value),
  };
}

function mergeLegacySettings(defaults: unknown, legacy: unknown): unknown {
  const defaultRecord = objectRecord(defaults);
  const legacyRecord = objectRecord(legacy);
  if (!defaultRecord || !legacyRecord) {
    return legacy === undefined ? defaults : legacy;
  }
  const merged: Record<string, unknown> = { ...defaultRecord };
  for (const [key, value] of Object.entries(legacyRecord)) {
    if (value === undefined) continue;
    merged[key] = mergeLegacySettings(merged[key], value);
  }
  return merged;
}
