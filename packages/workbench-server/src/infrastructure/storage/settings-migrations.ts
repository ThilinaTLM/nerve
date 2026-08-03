const legacyColorModes = new Set(["system", "light", "dark"]);

export function migrateLegacyAppearanceSettings(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value, changed: false };
  }

  const settings = value as Record<string, unknown>;
  const ui = settings.ui;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) {
    return { value, changed: false };
  }

  const legacyUi = ui as Record<string, unknown>;
  if (!legacyColorModes.has(String(legacyUi.theme))) {
    return { value, changed: false };
  }

  return {
    value: {
      ...settings,
      ui: {
        ...legacyUi,
        theme: "nerve",
        colorMode: legacyUi.theme,
      },
    },
    changed: true,
  };
}
