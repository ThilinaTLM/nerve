// Node-safe helpers for Electron's platform-binary download path.
// This module must not import Electron; it runs before `require("electron")`.

export const loopbackNoProxyEntries = ["localhost", "127.0.0.1", "::1"];
export const chromiumLoopbackProxyBypassRules = [
  "<local>",
  "localhost",
  "127.0.0.1",
  "[::1]",
].join(",");

export interface ElectronDownloadEnvPreparation {
  proxyConfigured: boolean;
  enabledElectronGetProxy: boolean;
  enabledNodeEnvProxy: boolean;
  enabledNodeSystemCa: boolean;
  copiedFromPackageManagerConfig: string[];
  noProxyUpdated: boolean;
  nodeExtraCaCertsFromPackageManagerCafile: boolean;
}

export interface ElectronProxyPreparationLog {
  proxyConfigured: boolean;
  enabledElectronGetProxy: boolean;
  enabledNodeEnvProxy: boolean;
  enabledNodeSystemCa: boolean;
  copiedFromPackageManagerConfig: string[];
  noProxyUpdated: boolean;
  nodeExtraCaCertsFromPackageManagerCafile: boolean;
  envPresent: Record<string, boolean>;
  noProxyContainsLoopback: Record<string, boolean>;
}

/**
 * Prepare environment variables consumed by Electron's installer.
 *
 * pnpm/npm registry downloads can work through `npm_config_*` proxy settings
 * while Electron's GitHub binary download still fails. Electron uses
 * `@electron/get`, whose proxy support is enabled by `ELECTRON_GET_USE_PROXY`
 * and standard `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` variables.
 */
export function prepareElectronDownloadEnv(
  env: NodeJS.ProcessEnv = process.env,
): ElectronDownloadEnvPreparation {
  const copiedFromPackageManagerConfig: string[] = [];

  const npmHttpsProxy = firstEnvValue(env, ["npm_config_https_proxy"]);
  const npmHttpProxy = firstEnvValue(env, ["npm_config_http_proxy"]);
  const npmProxy = firstEnvValue(env, ["npm_config_proxy"]);
  const npmNoProxy = firstEnvValue(env, [
    "npm_config_noproxy",
    "npm_config_no_proxy",
  ]);

  if (!firstEnvValue(env, ["HTTPS_PROXY", "https_proxy"])) {
    const value = npmHttpsProxy ?? npmProxy;
    if (value) {
      env.HTTPS_PROXY = value;
      copiedFromPackageManagerConfig.push("HTTPS_PROXY");
    }
  }

  if (!firstEnvValue(env, ["HTTP_PROXY", "http_proxy"])) {
    const value = npmHttpProxy ?? npmProxy;
    if (value) {
      env.HTTP_PROXY = value;
      copiedFromPackageManagerConfig.push("HTTP_PROXY");
    }
  }

  const proxyConfigured = Boolean(
    firstEnvValue(env, [
      "HTTPS_PROXY",
      "https_proxy",
      "HTTP_PROXY",
      "http_proxy",
      "npm_config_https_proxy",
      "npm_config_http_proxy",
      "npm_config_proxy",
    ]),
  );

  const enabledElectronGetProxy =
    proxyConfigured && !firstEnvValue(env, ["ELECTRON_GET_USE_PROXY"]);
  if (enabledElectronGetProxy) env.ELECTRON_GET_USE_PROXY = "true";

  const enabledNodeEnvProxy =
    proxyConfigured && !firstEnvValue(env, ["NODE_USE_ENV_PROXY"]);
  if (enabledNodeEnvProxy) env.NODE_USE_ENV_PROXY = "1";

  const enabledNodeSystemCa = !firstEnvValue(env, ["NODE_USE_SYSTEM_CA"]);
  if (enabledNodeSystemCa) env.NODE_USE_SYSTEM_CA = "1";

  const existingNoProxy = firstEnvValue(env, ["NO_PROXY"]);
  const existingLowerNoProxy = firstEnvValue(env, ["no_proxy"]);
  const noProxyBase = mergeNoProxySources([
    existingNoProxy,
    existingLowerNoProxy,
    npmNoProxy,
  ]);
  const mergedNoProxy = mergeNoProxy(noProxyBase);
  const noProxyUpdated =
    env.NO_PROXY !== mergedNoProxy || env.no_proxy !== mergedNoProxy;
  env.NO_PROXY = mergedNoProxy;
  env.no_proxy = mergedNoProxy;
  if (!existingNoProxy && !existingLowerNoProxy && npmNoProxy) {
    copiedFromPackageManagerConfig.push("NO_PROXY");
  }

  const nodeExtraCaCertsFromPackageManagerCafile =
    !firstEnvValue(env, ["NODE_EXTRA_CA_CERTS"]) &&
    Boolean(firstEnvValue(env, ["npm_config_cafile"]));
  if (nodeExtraCaCertsFromPackageManagerCafile) {
    env.NODE_EXTRA_CA_CERTS = firstEnvValue(env, ["npm_config_cafile"]);
    copiedFromPackageManagerConfig.push("NODE_EXTRA_CA_CERTS");
  }

  return {
    proxyConfigured,
    enabledElectronGetProxy,
    enabledNodeEnvProxy,
    enabledNodeSystemCa,
    copiedFromPackageManagerConfig,
    noProxyUpdated,
    nodeExtraCaCertsFromPackageManagerCafile,
  };
}

export function formatElectronDownloadFailure(error: unknown): string {
  const errorMessage = sanitizeErrorMessage(error);
  return [
    "Electron could not be resolved or downloaded.",
    "",
    "In corporate proxy environments, configure the Electron binary downloader with:",
    "  ELECTRON_GET_USE_PROXY=true",
    "  HTTPS_PROXY=http://proxy.example.com:8080",
    "  HTTP_PROXY=http://proxy.example.com:8080",
    "  NO_PROXY=localhost,127.0.0.1,::1",
    "  NODE_USE_ENV_PROXY=1                           # enables Node fetch proxy env support",
    "  NODE_USE_SYSTEM_CA=1                            # trusts OS corporate CAs when supported",
    "  NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem   # explicit CA bundle if TLS is intercepted",
    "",
    "Then retry from a source checkout:",
    "  pnpm --filter @nervekit/desktop-shell rebuild electron",
    "  pnpm desktop",
    "",
    "If your company mirrors Electron artifacts, also set ELECTRON_MIRROR.",
    "Set NERVE_DEBUG_PROXY=1 for redacted desktop proxy diagnostics.",
    errorMessage ? `Original error: ${errorMessage}` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function formatProxyPreparationForLog(
  preparation: ElectronDownloadEnvPreparation,
  env: NodeJS.ProcessEnv = process.env,
): ElectronProxyPreparationLog {
  return {
    proxyConfigured: preparation.proxyConfigured,
    enabledElectronGetProxy: preparation.enabledElectronGetProxy,
    enabledNodeEnvProxy: preparation.enabledNodeEnvProxy,
    enabledNodeSystemCa: preparation.enabledNodeSystemCa,
    copiedFromPackageManagerConfig: preparation.copiedFromPackageManagerConfig,
    noProxyUpdated: preparation.noProxyUpdated,
    nodeExtraCaCertsFromPackageManagerCafile:
      preparation.nodeExtraCaCertsFromPackageManagerCafile,
    envPresent: Object.fromEntries(
      [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "NO_PROXY",
        "no_proxy",
        "NODE_EXTRA_CA_CERTS",
        "NODE_USE_ENV_PROXY",
        "NODE_USE_SYSTEM_CA",
        "ELECTRON_GET_USE_PROXY",
        "ELECTRON_MIRROR",
      ].map((name) => [name, Boolean(env[name]?.trim())]),
    ),
    noProxyContainsLoopback: Object.fromEntries(
      loopbackNoProxyEntries.map((entry) => [
        entry,
        noProxyContains(env.NO_PROXY, entry) ||
          noProxyContains(env.no_proxy, entry),
      ]),
    ),
  };
}

function firstEnvValue(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function mergeNoProxySources(values: Array<string | undefined>): string {
  const entries: string[] = [];
  const normalizedEntries = new Set<string>();
  for (const value of values) {
    for (const entry of (value ?? "").split(",")) {
      const trimmed = entry.trim();
      const normalized = trimmed.toLowerCase();
      if (!trimmed || normalizedEntries.has(normalized)) continue;
      entries.push(trimmed);
      normalizedEntries.add(normalized);
    }
  }
  return entries.join(",");
}

function mergeNoProxy(value: string): string {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const normalizedEntries = new Set(
    entries.map((entry) => entry.toLowerCase()),
  );
  for (const entry of loopbackNoProxyEntries) {
    if (normalizedEntries.has(entry.toLowerCase())) continue;
    entries.push(entry);
    normalizedEntries.add(entry.toLowerCase());
  }
  return entries.join(",");
}

function noProxyContains(value: string | undefined, entry: string): boolean {
  const normalizedEntry = entry.toLowerCase();
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .includes(normalizedEntry);
}

function sanitizeErrorMessage(error: unknown): string | undefined {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return redactUrlCredentials(trimmed);
}

function redactUrlCredentials(value: string): string {
  return value.replace(/(https?:\/\/)([^\s/@]+)@/gi, "$1[redacted]@");
}
