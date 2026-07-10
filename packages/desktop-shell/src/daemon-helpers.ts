import { readFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DaemonFile, daemonFileSchema } from "@nervekit/contracts";
import type { EnsureDaemonOptions } from "./daemon.js";

const defaultReadinessTimeoutMs = 60_000;
const healthCheckTimeoutMs = 1500;

export interface DaemonPaths {
  home: string;
  daemonPath: string;
  localTokenPath: string;
}

export interface HealthyDaemon {
  daemon: DaemonFile;
  url: string;
  token: string;
}

export interface ShareUrls {
  shareUrl?: string;
  mobileSetupUrl?: string;
  secureShareUrl?: string;
  caCertUrl?: string;
}

function resolveDaemonMaxOldSpaceMb(): number {
  const raw = process.env.NERVE_DAEMON_MAX_OLD_SPACE_MB?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4096;
}

export function buildOrchestratorEnv(
  options: EnsureDaemonOptions,
): NodeJS.ProcessEnv {
  const nodeOptions = [
    process.env.NODE_OPTIONS,
    `--max-old-space-size=${resolveDaemonMaxOldSpaceMb()}`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: nodeOptions,
    NERVE_HOST: options.host ?? process.env.NERVE_HOST ?? "127.0.0.1",
    ...(options.port ? { NERVE_PORT: String(options.port) } : {}),
    ...(options.httpsPort
      ? { NERVE_HTTPS_PORT: String(options.httpsPort) }
      : {}),
    ...(options.allowRemote ? { NERVE_ALLOW_REMOTE: "1" } : {}),
    ...(options.mobileHttps ? { NERVE_MOBILE_HTTPS: "1" } : {}),
    ...(options.webDistPath ? { NERVE_WEB_DIST: options.webDistPath } : {}),
  };
}

export function buildShareUrls(daemon: DaemonFile, token: string): ShareUrls {
  const shareUrl = remoteShareUrl(daemon, token);
  const secureUrls = remoteSecureUrls(daemon, token);
  return {
    shareUrl,
    mobileSetupUrl: secureUrls?.mobileSetupUrl,
    secureShareUrl: secureUrls?.secureShareUrl,
    caCertUrl: secureUrls?.caCertUrl,
  };
}

export function wantsLanAccess(options: EnsureDaemonOptions): boolean {
  const host = options.host ?? process.env.NERVE_HOST;
  return Boolean(
    options.allowRemote ||
    process.env.NERVE_ALLOW_REMOTE === "1" ||
    (host && !isLoopbackHost(host)),
  );
}

export function resolveDaemonPaths(): DaemonPaths {
  const explicitHome = process.env.NERVE_HOME;
  const home = explicitHome?.trim() ? explicitHome : join(homedir(), ".nerve");
  return {
    home,
    daemonPath: join(home, "daemon.json"),
    localTokenPath: join(home, "auth", "local-token"),
  };
}

export function resolveReadinessTimeoutMs(): number {
  const raw = process.env.NERVE_DAEMON_STARTUP_TIMEOUT_MS?.trim();
  if (!raw) return defaultReadinessTimeoutMs;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return defaultReadinessTimeoutMs;
  return Math.max(1, Math.trunc(value));
}

export function resolveOrchestratorMainPath(): string {
  const resolvedUrl = import.meta.resolve("@nervekit/workbench-server/main");
  return fileURLToPath(resolvedUrl);
}

export async function findHealthyDaemon(
  paths: DaemonPaths,
): Promise<HealthyDaemon | undefined> {
  const daemon = await readDaemonFile(paths.daemonPath);
  if (!daemon) return undefined;

  const url = localConnectUrl(daemon.url);
  if (!url) return undefined;

  const token = await readToken(paths.localTokenPath);
  if (!token) return undefined;

  const healthy = await isHealthy(url, token);
  return healthy ? { daemon, url, token } : undefined;
}

function remoteShareUrl(daemon: DaemonFile, token: string): string | undefined {
  const host = remoteShareHost(daemon.host);
  if (!host) return undefined;
  const url = new URL(`http://127.0.0.1:${daemon.port}/`);
  url.hostname = host;
  url.searchParams.set("token", token);
  return url.toString();
}

function remoteSecureUrls(
  daemon: DaemonFile,
  token: string,
):
  | { mobileSetupUrl: string; secureShareUrl: string; caCertUrl: string }
  | undefined {
  if (!daemon.mobileHttps) return undefined;
  const host = remoteShareHost(daemon.host);
  if (!host) return undefined;
  const secureShareUrl = new URL(
    `https://127.0.0.1:${daemon.mobileHttps.port}/`,
  );
  secureShareUrl.hostname = host;
  secureShareUrl.searchParams.set("token", token);

  const mobileSetupUrl = new URL(
    `http://127.0.0.1:${daemon.port}/mobile-setup`,
  );
  mobileSetupUrl.hostname = host;
  mobileSetupUrl.searchParams.set("token", token);

  const caCertUrl = new URL(
    `http://127.0.0.1:${daemon.port}/nerve-local-ca.pem`,
  );
  caCertUrl.hostname = host;

  return {
    mobileSetupUrl: mobileSetupUrl.toString(),
    secureShareUrl: secureShareUrl.toString(),
    caCertUrl: caCertUrl.toString(),
  };
}

function remoteShareHost(boundHost: string): string | undefined {
  if (isWildcardHost(boundHost)) return firstLanIpv4Address();
  if (isLoopbackHost(boundHost)) return undefined;
  if (boundHost.includes(":")) return undefined;
  return boundHost;
}

function firstLanIpv4Address(): string | undefined {
  const candidates: Array<{ name: string; address: string }> = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push({ name, address: address.address });
      }
    }
  }

  return (
    candidates.find(
      (candidate) =>
        isPrivateIpv4(candidate.address) && !isVirtualInterface(candidate.name),
    )?.address ??
    candidates.find((candidate) => isPrivateIpv4(candidate.address))?.address ??
    candidates.find((candidate) => !isVirtualInterface(candidate.name))
      ?.address ??
    candidates[0]?.address
  );
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isVirtualInterface(name: string): boolean {
  return /^(br-|docker|veth|virbr|vmnet|vboxnet|lo)/i.test(name);
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  );
}

async function readDaemonFile(path: string): Promise<DaemonFile | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = daemonFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function readToken(path: string): Promise<string | undefined> {
  try {
    const token = (await readFile(path, "utf8")).trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

export async function assertHealthy(
  daemonUrl: string,
  token: string,
  label: string,
): Promise<void> {
  if (await isHealthy(daemonUrl, token)) return;
  throw new Error(`Could not connect to ${label} at ${daemonUrl}.`);
}

export async function isHealthy(
  daemonUrl: string,
  token: string,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), healthCheckTimeoutMs);
  try {
    const response = await fetch(new URL("/api/status", daemonUrl), {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeRemoteDaemonUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote daemon URL must use http:// or https://.");
  }
  return url.origin;
}

export function localConnectUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:") return undefined;
    if (url.hostname === "0.0.0.0" || url.hostname === "::") {
      url.hostname = "127.0.0.1";
    }
    return url.origin;
  } catch {
    return undefined;
  }
}
