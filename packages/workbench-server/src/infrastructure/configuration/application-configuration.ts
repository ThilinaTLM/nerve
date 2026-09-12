import type {
  ApplicationConfigurationSnapshot,
  ApplicationSettings,
  ConfigurationSource,
  Settings,
  ResourceLimits,
  UpdateApplicationConfigurationRequest,
} from "@nervekit/contracts/settings";
import {
  MAX_ACTIVE_EXPLORE_AGENTS,
  MAX_ACTIVE_PROCESSES,
  MAX_CONCURRENT_MODEL_RUNS,
  MAX_PARALLEL_TOOLS_PER_RUN,
  MIN_DAEMON_MAX_OLD_SPACE_MB,
} from "@nervekit/contracts/settings";
import {
  detectHostResourceFacts,
  recommendResourcePolicy,
  type HostResourceFacts,
} from "./resource-policy.js";

export interface ResolvedApplicationStartup {
  snapshot: ApplicationConfigurationSnapshot;
  values: {
    host: string;
    port: number;
    allowRemote: boolean;
    mobileHttps: boolean;
    httpsPort: number;
    loggingEnabled: boolean;
    performanceEnabled: boolean;
    startupTimeoutMs: number;
    maxOldSpaceMb: number;
    ozonePlatform: ApplicationSettings["electron"]["ozonePlatform"];
    fontRenderHinting: ApplicationSettings["electron"]["fontRenderHinting"];
    resources: ResourceLimits;
    controlWorkConcurrency: number;
  };
}

interface ResolveOptions {
  settings: Settings;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  dataDir: string;
  platform?: string;
  development?: boolean;
  packaged?: boolean;
  activeSnapshot?: ApplicationConfigurationSnapshot;
  hostResources?: HostResourceFacts;
}

type RestartTarget = "none" | "daemon" | "desktop";

function commandLineValue(argv: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function parseBooleanEnvironment(
  env: NodeJS.ProcessEnv,
  name: string,
): boolean | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  throw new Error(
    `Invalid ${name}=${JSON.stringify(raw)}. Expected 1, 0, true, or false.`,
  );
}

function parsePositiveInteger(
  raw: string,
  source: string,
  maximum?: number,
): number {
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    (maximum !== undefined && value > maximum)
  ) {
    const range = maximum ? `1-${maximum}` : "a positive integer";
    throw new Error(
      `Invalid ${source}=${JSON.stringify(raw)}. Expected ${range}.`,
    );
  }
  return value;
}

function envString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function source(
  kind: ConfigurationSource["kind"],
  name?: string,
): ConfigurationSource {
  return name ? { kind, name } : { kind };
}

function select<T>(input: {
  saved: T;
  environment?: { value: T; name: string };
  commandLine?: { value: T; name: string };
  developmentDefault?: T;
}): { value: T; source: ConfigurationSource; editable: boolean } {
  if (input.commandLine) {
    return {
      value: input.commandLine.value,
      source: source("command_line", input.commandLine.name),
      editable: false,
    };
  }
  if (input.environment) {
    return {
      value: input.environment.value,
      source: source("environment", input.environment.name),
      editable: false,
    };
  }
  if (input.developmentDefault !== undefined) {
    return {
      value: input.developmentDefault,
      source: source("development_default"),
      editable: true,
    };
  }
  return { value: input.saved, source: source("settings"), editable: true };
}

function automaticSelection<T>(value: T): {
  value: T;
  source: ConfigurationSource;
  editable: boolean;
} {
  return { value, source: source("automatic"), editable: true };
}

function leaf<T>(input: {
  selected: { value: T; source: ConfigurationSource; editable: boolean };
  saved: T;
  restartTarget: RestartTarget;
  active?: T;
}) {
  const activeValue = input.active ?? input.selected.value;
  return {
    activeValue,
    savedValue: input.saved,
    source: input.selected.source,
    editable: input.selected.editable,
    restartTarget: input.restartTarget,
    pendingRestart:
      input.selected.editable &&
      input.selected.source.kind !== "automatic" &&
      input.restartTarget !== "none" &&
      !Object.is(activeValue, input.saved),
  };
}

export function resolveApplicationConfiguration(
  options: ResolveOptions,
): ResolvedApplicationStartup {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const saved = options.settings.application;
  const resourceRecommendation = recommendResourcePolicy(
    options.hostResources ?? detectHostResourceFacts(),
  );

  const cliAllowRemote = hasFlag(argv, "--allow-remote") ? true : undefined;
  const envAllowRemote = parseBooleanEnvironment(env, "NERVE_ALLOW_REMOTE");
  const allowRemote = select({
    saved: saved.network.allowRemote,
    commandLine:
      cliAllowRemote === undefined
        ? undefined
        : { value: cliAllowRemote, name: "--allow-remote" },
    environment:
      envAllowRemote === undefined
        ? undefined
        : { value: envAllowRemote, name: "NERVE_ALLOW_REMOTE" },
  });

  const cliHost = commandLineValue(argv, "--host");
  const environmentHost = envString(env, "NERVE_HOST");
  const impliedRemoteHost =
    allowRemote.value &&
    (saved.network.host === "127.0.0.1" || saved.network.host === "localhost")
      ? "0.0.0.0"
      : saved.network.host;
  const host = select({
    saved: impliedRemoteHost,
    commandLine: cliHost ? { value: cliHost, name: "--host" } : undefined,
    environment: environmentHost
      ? { value: environmentHost, name: "NERVE_HOST" }
      : undefined,
  });

  const cliPort = commandLineValue(argv, "--port");
  const environmentPort = envString(env, "NERVE_PORT");
  const port = select({
    saved: saved.network.port,
    commandLine: cliPort
      ? {
          value: parsePositiveInteger(cliPort, "--port", 65_535),
          name: "--port",
        }
      : undefined,
    environment: environmentPort
      ? {
          value: parsePositiveInteger(environmentPort, "NERVE_PORT", 65_535),
          name: "NERVE_PORT",
        }
      : undefined,
  });

  const cliMobileHttps = hasFlag(argv, "--mobile-https") ? true : undefined;
  const envMobileHttps = parseBooleanEnvironment(env, "NERVE_MOBILE_HTTPS");
  const mobileHttps = select({
    saved: saved.network.mobileHttps,
    commandLine:
      cliMobileHttps === undefined
        ? undefined
        : { value: cliMobileHttps, name: "--mobile-https" },
    environment:
      envMobileHttps === undefined
        ? undefined
        : { value: envMobileHttps, name: "NERVE_MOBILE_HTTPS" },
  });

  const cliHttpsPort = commandLineValue(argv, "--https-port");
  const environmentHttpsPort = envString(env, "NERVE_HTTPS_PORT");
  const httpsPort = select({
    saved: saved.network.httpsPort,
    commandLine: cliHttpsPort
      ? {
          value: parsePositiveInteger(cliHttpsPort, "--https-port", 65_535),
          name: "--https-port",
        }
      : undefined,
    environment: environmentHttpsPort
      ? {
          value: parsePositiveInteger(
            environmentHttpsPort,
            "NERVE_HTTPS_PORT",
            65_535,
          ),
          name: "NERVE_HTTPS_PORT",
        }
      : undefined,
  });

  const envLogging = parseBooleanEnvironment(env, "NERVE_LOGGING_ENABLED");
  const loggingEnabled = select({
    saved: saved.diagnostics.loggingEnabled,
    environment:
      envLogging === undefined
        ? undefined
        : { value: envLogging, name: "NERVE_LOGGING_ENABLED" },
  });
  const envPerformance = parseBooleanEnvironment(
    env,
    "NERVE_PERFORMANCE_DIAGNOSTICS",
  );
  const savedPerformance = saved.diagnostics.performanceEnabled;
  const performanceEnabled = select({
    saved: savedPerformance ?? false,
    environment:
      envPerformance === undefined
        ? undefined
        : { value: envPerformance, name: "NERVE_PERFORMANCE_DIAGNOSTICS" },
    developmentDefault:
      envPerformance === undefined &&
      savedPerformance === undefined &&
      (options.development || env.NERVE_DEVELOPMENT_PERFORMANCE_DEFAULT === "1")
        ? true
        : undefined,
  });

  const envTimeout = envString(env, "NERVE_DAEMON_STARTUP_TIMEOUT_MS");
  const startupTimeoutMs = select({
    saved: saved.daemon.startupTimeoutMs,
    environment: envTimeout
      ? {
          value: parsePositiveInteger(
            envTimeout,
            "NERVE_DAEMON_STARTUP_TIMEOUT_MS",
          ),
          name: "NERVE_DAEMON_STARTUP_TIMEOUT_MS",
        }
      : undefined,
  });
  const envHeap = envString(env, "NERVE_DAEMON_MAX_OLD_SPACE_MB");
  const requestedMaxOldSpaceMb = select({
    saved: saved.daemon.maxOldSpaceMb,
    environment: envHeap
      ? {
          value: parsePositiveInteger(envHeap, "NERVE_DAEMON_MAX_OLD_SPACE_MB"),
          name: "NERVE_DAEMON_MAX_OLD_SPACE_MB",
        }
      : undefined,
  });
  const maxOldSpaceMb = {
    ...requestedMaxOldSpaceMb,
    value: Math.max(MIN_DAEMON_MAX_OLD_SPACE_MB, requestedMaxOldSpaceMb.value),
  };

  const resourceMode = select({ saved: saved.resources.mode });
  const resolveResourceLimit = (
    savedValue: number,
    recommendedValue: number,
    environmentName: string,
    maximum: number,
  ) => {
    const environmentValue = envString(env, environmentName);
    if (environmentValue) {
      return select({
        saved: savedValue,
        environment: {
          value: parsePositiveInteger(
            environmentValue,
            environmentName,
            maximum,
          ),
          name: environmentName,
        },
      });
    }
    return resourceMode.value === "automatic"
      ? automaticSelection(recommendedValue)
      : select({ saved: savedValue });
  };
  const maxConcurrentModelRuns = resolveResourceLimit(
    saved.resources.maxConcurrentModelRuns,
    resourceRecommendation.limits.maxConcurrentModelRuns,
    "NERVE_MAX_CONCURRENT_MODEL_RUNS",
    MAX_CONCURRENT_MODEL_RUNS,
  );
  const maxParallelToolsPerRun = resolveResourceLimit(
    saved.resources.maxParallelToolsPerRun,
    resourceRecommendation.limits.maxParallelToolsPerRun,
    "NERVE_MAX_PARALLEL_TOOLS_PER_RUN",
    MAX_PARALLEL_TOOLS_PER_RUN,
  );
  const maxActiveProcesses = resolveResourceLimit(
    saved.resources.maxActiveProcesses,
    resourceRecommendation.limits.maxActiveProcesses,
    "NERVE_MAX_ACTIVE_PROCESSES",
    MAX_ACTIVE_PROCESSES,
  );
  const maxActiveExploreAgents = resolveResourceLimit(
    saved.resources.maxActiveExploreAgents,
    resourceRecommendation.limits.maxActiveExploreAgents,
    "NERVE_MAX_ACTIVE_EXPLORE_AGENTS",
    MAX_ACTIVE_EXPLORE_AGENTS,
  );

  const ozoneEnvironment = envString(env, "NERVE_ELECTRON_OZONE_PLATFORM");
  if (
    ozoneEnvironment &&
    !["auto", "x11", "wayland"].includes(ozoneEnvironment)
  ) {
    throw new Error(
      `Invalid NERVE_ELECTRON_OZONE_PLATFORM=${JSON.stringify(ozoneEnvironment)}. Expected auto, x11, or wayland.`,
    );
  }
  const ozonePlatform = select({
    saved: saved.electron.ozonePlatform,
    environment: ozoneEnvironment
      ? {
          value:
            ozoneEnvironment as ApplicationSettings["electron"]["ozonePlatform"],
          name: "NERVE_ELECTRON_OZONE_PLATFORM",
        }
      : undefined,
  });
  const fontEnvironment = envString(env, "NERVE_ELECTRON_FONT_RENDER_HINTING");
  if (
    fontEnvironment &&
    !["system", "none", "slight", "medium", "full"].includes(fontEnvironment)
  ) {
    throw new Error(
      `Invalid NERVE_ELECTRON_FONT_RENDER_HINTING=${JSON.stringify(fontEnvironment)}. Expected system, none, slight, medium, or full.`,
    );
  }
  const fontRenderHinting = select({
    saved: saved.electron.fontRenderHinting,
    environment: fontEnvironment
      ? {
          value:
            fontEnvironment as ApplicationSettings["electron"]["fontRenderHinting"],
          name: "NERVE_ELECTRON_FONT_RENDER_HINTING",
        }
      : undefined,
  });

  const active = options.activeSnapshot?.application;
  const snapshot: ApplicationConfigurationSnapshot = {
    application: {
      network: {
        host: leaf({
          selected: host,
          saved: impliedRemoteHost,
          restartTarget: "daemon",
          active: active?.network.host.activeValue,
        }),
        port: leaf({
          selected: port,
          saved: saved.network.port,
          restartTarget: "daemon",
          active: active?.network.port.activeValue,
        }),
        allowRemote: leaf({
          selected: allowRemote,
          saved: saved.network.allowRemote,
          restartTarget: "daemon",
          active: active?.network.allowRemote.activeValue,
        }),
        mobileHttps: leaf({
          selected: mobileHttps,
          saved: saved.network.mobileHttps,
          restartTarget: "daemon",
          active: active?.network.mobileHttps.activeValue,
        }),
        httpsPort: leaf({
          selected: httpsPort,
          saved: saved.network.httpsPort,
          restartTarget: "daemon",
          active: active?.network.httpsPort.activeValue,
        }),
      },
      diagnostics: {
        loggingEnabled: leaf({
          selected: loggingEnabled,
          saved: saved.diagnostics.loggingEnabled,
          restartTarget: "daemon",
          active: active?.diagnostics.loggingEnabled.activeValue,
        }),
        performanceEnabled: leaf({
          selected: performanceEnabled,
          saved: savedPerformance ?? performanceEnabled.value,
          restartTarget: "daemon",
          active: active?.diagnostics.performanceEnabled.activeValue,
        }),
        level: leaf({
          selected: select({ saved: options.settings.logging.level }),
          saved: options.settings.logging.level,
          restartTarget: "daemon",
          active: active?.diagnostics.level.activeValue,
        }),
        retentionDays: leaf({
          selected: select({ saved: options.settings.logging.retentionDays }),
          saved: options.settings.logging.retentionDays,
          restartTarget: "daemon",
          active: active?.diagnostics.retentionDays.activeValue,
        }),
        maxBufferedLogs: leaf({
          selected: select({ saved: options.settings.logging.maxBufferedLogs }),
          saved: options.settings.logging.maxBufferedLogs,
          restartTarget: "daemon",
          active: active?.diagnostics.maxBufferedLogs.activeValue,
        }),
      },
      daemon: {
        startupTimeoutMs: leaf({
          selected: startupTimeoutMs,
          saved: saved.daemon.startupTimeoutMs,
          restartTarget: "desktop",
          active: active?.daemon.startupTimeoutMs.activeValue,
        }),
        maxOldSpaceMb: leaf({
          selected: maxOldSpaceMb,
          saved: saved.daemon.maxOldSpaceMb,
          restartTarget: "daemon",
          active: active?.daemon.maxOldSpaceMb.activeValue,
        }),
      },
      resources: {
        mode: leaf({
          selected: resourceMode,
          saved: saved.resources.mode,
          restartTarget: "daemon",
          active: active?.resources.mode.activeValue,
        }),
        maxConcurrentModelRuns: leaf({
          selected: maxConcurrentModelRuns,
          saved: saved.resources.maxConcurrentModelRuns,
          restartTarget: "daemon",
          active: active?.resources.maxConcurrentModelRuns.activeValue,
        }),
        maxParallelToolsPerRun: leaf({
          selected: maxParallelToolsPerRun,
          saved: saved.resources.maxParallelToolsPerRun,
          restartTarget: "daemon",
          active: active?.resources.maxParallelToolsPerRun.activeValue,
        }),
        maxActiveProcesses: leaf({
          selected: maxActiveProcesses,
          saved: saved.resources.maxActiveProcesses,
          restartTarget: "daemon",
          active: active?.resources.maxActiveProcesses.activeValue,
        }),
        maxActiveExploreAgents: leaf({
          selected: maxActiveExploreAgents,
          saved: saved.resources.maxActiveExploreAgents,
          restartTarget: "daemon",
          active: active?.resources.maxActiveExploreAgents.activeValue,
        }),
      },
      electron: {
        ozonePlatform: leaf({
          selected: ozonePlatform,
          saved: saved.electron.ozonePlatform,
          restartTarget: "desktop",
          active: active?.electron.ozonePlatform.activeValue,
        }),
        fontRenderHinting: leaf({
          selected: fontRenderHinting,
          saved: saved.electron.fontRenderHinting,
          restartTarget: "desktop",
          active: active?.electron.fontRenderHinting.activeValue,
        }),
      },
    },
    context: {
      dataDir: options.dataDir,
      dataDirSource: env.NERVE_HOME?.trim() ? "environment" : "default",
      platform: options.platform ?? process.platform,
      packaged: options.packaged,
      webAssetsOverridden: Boolean(env.NERVE_WEB_DIST?.trim()),
      proxyConfigured: Boolean(
        env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy,
      ),
      proxyDebugEnabled: env.NERVE_DEBUG_PROXY === "1",
      resources: {
        detected: resourceRecommendation.detected,
        recommended: resourceRecommendation.limits,
        effective: {
          maxConcurrentModelRuns:
            active?.resources.maxConcurrentModelRuns.activeValue ??
            maxConcurrentModelRuns.value,
          maxParallelToolsPerRun:
            active?.resources.maxParallelToolsPerRun.activeValue ??
            maxParallelToolsPerRun.value,
          maxActiveProcesses:
            active?.resources.maxActiveProcesses.activeValue ??
            maxActiveProcesses.value,
          maxActiveExploreAgents:
            active?.resources.maxActiveExploreAgents.activeValue ??
            maxActiveExploreAgents.value,
        },
        controlWorkConcurrency: resourceRecommendation.controlWorkConcurrency,
      },
    },
  };

  return {
    snapshot,
    values: {
      host: host.value,
      port: port.value,
      allowRemote: allowRemote.value,
      mobileHttps: mobileHttps.value,
      httpsPort: httpsPort.value,
      loggingEnabled: loggingEnabled.value,
      performanceEnabled: performanceEnabled.value,
      startupTimeoutMs: startupTimeoutMs.value,
      maxOldSpaceMb: maxOldSpaceMb.value,
      ozonePlatform: ozonePlatform.value,
      fontRenderHinting: fontRenderHinting.value,
      resources: {
        maxConcurrentModelRuns: maxConcurrentModelRuns.value,
        maxParallelToolsPerRun: maxParallelToolsPerRun.value,
        maxActiveProcesses: maxActiveProcesses.value,
        maxActiveExploreAgents: maxActiveExploreAgents.value,
      },
      controlWorkConcurrency: resourceRecommendation.controlWorkConcurrency,
    },
  };
}

export function assertApplicationConfigurationEditable(
  snapshot: ApplicationConfigurationSnapshot,
  patch: UpdateApplicationConfigurationRequest,
): void {
  const checks: Array<
    [unknown, { editable: boolean; source: ConfigurationSource }]
  > = [
    [patch.application?.network?.host, snapshot.application.network.host],
    [patch.application?.network?.port, snapshot.application.network.port],
    [
      patch.application?.network?.allowRemote,
      snapshot.application.network.allowRemote,
    ],
    [
      patch.application?.network?.mobileHttps,
      snapshot.application.network.mobileHttps,
    ],
    [
      patch.application?.network?.httpsPort,
      snapshot.application.network.httpsPort,
    ],
    [
      patch.application?.diagnostics?.loggingEnabled,
      snapshot.application.diagnostics.loggingEnabled,
    ],
    [
      patch.application?.diagnostics?.performanceEnabled,
      snapshot.application.diagnostics.performanceEnabled,
    ],
    [
      patch.application?.daemon?.startupTimeoutMs,
      snapshot.application.daemon.startupTimeoutMs,
    ],
    [
      patch.application?.daemon?.maxOldSpaceMb,
      snapshot.application.daemon.maxOldSpaceMb,
    ],
    [patch.application?.resources?.mode, snapshot.application.resources.mode],
    [
      patch.application?.resources?.maxConcurrentModelRuns,
      snapshot.application.resources.maxConcurrentModelRuns,
    ],
    [
      patch.application?.resources?.maxParallelToolsPerRun,
      snapshot.application.resources.maxParallelToolsPerRun,
    ],
    [
      patch.application?.resources?.maxActiveProcesses,
      snapshot.application.resources.maxActiveProcesses,
    ],
    [
      patch.application?.resources?.maxActiveExploreAgents,
      snapshot.application.resources.maxActiveExploreAgents,
    ],
    [
      patch.application?.electron?.ozonePlatform,
      snapshot.application.electron.ozonePlatform,
    ],
    [
      patch.application?.electron?.fontRenderHinting,
      snapshot.application.electron.fontRenderHinting,
    ],
  ];
  for (const [value, setting] of checks) {
    if (value === undefined || setting.editable) continue;
    throw new Error(
      `This setting is controlled by ${setting.source.name ?? setting.source.kind}. Unset that override before changing it.`,
    );
  }
}
