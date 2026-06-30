// Node-safe helpers for Electron's platform-binary download path.
// This module must not import Electron; it runs before `require("electron")`.

const loopbackNoProxyEntries = ["localhost", "127.0.0.1", "::1"];

export interface ElectronDownloadEnvPreparation {
  proxyConfigured: boolean;
  enabledElectronGetProxy: boolean;
  copiedFromPackageManagerConfig: string[];
  noProxyUpdated: boolean;
  nodeExtraCaCertsFromPackageManagerCafile: boolean;
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

  const existingNoProxy = firstEnvValue(env, ["NO_PROXY", "no_proxy"]);
  const noProxyBase = existingNoProxy ?? npmNoProxy ?? "";
  const mergedNoProxy = mergeNoProxy(noProxyBase);
  const shouldSetNoProxy = proxyConfigured || Boolean(noProxyBase);
  const noProxyUpdated = shouldSetNoProxy && mergedNoProxy !== noProxyBase;
  if (shouldSetNoProxy) {
    env.NO_PROXY = mergedNoProxy;
    if (!existingNoProxy && npmNoProxy) {
      copiedFromPackageManagerConfig.push("NO_PROXY");
    }
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
    "  NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem   # if TLS is intercepted",
    "",
    "Then retry from a source checkout:",
    "  pnpm --filter @nervekit/desktop rebuild electron",
    "  pnpm desktop",
    "",
    "If your company mirrors Electron artifacts, also set ELECTRON_MIRROR.",
    errorMessage ? `Original error: ${errorMessage}` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
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

function sanitizeErrorMessage(error: unknown): string | undefined {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return redactUrlCredentials(trimmed);
}

function redactUrlCredentials(value: string): string {
  return value.replace(/(https?:\/\/)([^\s/@]+)@/gi, "$1[redacted]@");
}
