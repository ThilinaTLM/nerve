const legacyColorModes = new Set(["system", "light", "dark"]);

export function migrateApplicationConfiguration(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value, changed: false };
  }
  const settings = value as Record<string, unknown>;
  const legacyServer =
    settings.server &&
    typeof settings.server === "object" &&
    !Array.isArray(settings.server)
      ? (settings.server as Record<string, unknown>)
      : undefined;
  if (settings.application !== undefined && !legacyServer) {
    return { value, changed: false };
  }
  const existing =
    settings.application &&
    typeof settings.application === "object" &&
    !Array.isArray(settings.application)
      ? (settings.application as Record<string, unknown>)
      : {};
  const existingNetwork =
    existing.network &&
    typeof existing.network === "object" &&
    !Array.isArray(existing.network)
      ? (existing.network as Record<string, unknown>)
      : {};
  const allowRemote = Boolean(
    existingNetwork.allowRemote ?? legacyServer?.allowRemote ?? false,
  );
  let host = String(existingNetwork.host ?? legacyServer?.host ?? "127.0.0.1");
  if (allowRemote && (host === "127.0.0.1" || host === "localhost")) {
    host = "0.0.0.0";
  }
  const rest = { ...settings };
  delete rest.server;
  return {
    value: {
      ...rest,
      application: {
        ...existing,
        network: {
          host,
          port: existingNetwork.port ?? legacyServer?.port ?? 3747,
          allowRemote,
          mobileHttps: existingNetwork.mobileHttps ?? false,
          httpsPort: existingNetwork.httpsPort ?? 3748,
        },
        diagnostics: {
          loggingEnabled: false,
          ...((existing.diagnostics as object | undefined) ?? {}),
        },
        daemon: {
          startupTimeoutMs: 60_000,
          maxOldSpaceMb: 4096,
          ...((existing.daemon as object | undefined) ?? {}),
        },
        electron: {
          ozonePlatform: "auto",
          fontRenderHinting: "slight",
          ...((existing.electron as object | undefined) ?? {}),
        },
      },
    },
    changed: true,
  };
}

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
