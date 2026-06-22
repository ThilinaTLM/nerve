import { type ChildProcess, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DaemonFile, daemonFileSchema } from "@nerve/shared";
import { desktopLog } from "./logging.js";

const defaultReadinessTimeoutMs = 60_000;
const healthCheckTimeoutMs = 1500;
const shutdownTimeoutMs = 5000;

export type DaemonMode = "local" | "remote";

export interface ManagedDaemon {
  url: string;
  owned: boolean;
  mode: DaemonMode;
  token?: string;
  shareUrl?: string;
  mobileSetupUrl?: string;
  secureShareUrl?: string;
  caCertUrl?: string;
  stop: () => Promise<void>;
}

export interface EnsureDaemonOptions {
  webDistPath?: string;
  mode?: DaemonMode;
  remoteUrl?: string;
  token?: string;
  host?: string;
  port?: number;
  httpsPort?: number;
  allowRemote?: boolean;
  mobileHttps?: boolean;
}

interface DaemonPaths {
  home: string;
  daemonPath: string;
  localTokenPath: string;
}

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface HealthyDaemon {
  daemon: DaemonFile;
  url: string;
  token: string;
}

class OutputBuffer {
  private readonly lines: string[] = [];

  append(stream: "stdout" | "stderr", chunk: unknown): void {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.lines.push(`[${stream}] ${line}`);
    }
    if (this.lines.length > 80) this.lines.splice(0, this.lines.length - 80);
  }

  tail(): string {
    return this.lines.length > 0 ? this.lines.join("\n") : "(no output)";
  }
}

export async function ensureDaemon(
  options: EnsureDaemonOptions = {},
): Promise<ManagedDaemon> {
  if (options.mode === "remote" || options.remoteUrl) {
    void desktopLog("info", "daemon", "Connecting to remote daemon", {
      context: { url: options.remoteUrl },
    });
    return connectRemoteDaemon(options);
  }
  void desktopLog("info", "daemon", "Ensuring local daemon");
  return ensureLocalDaemon(options);
}

async function connectRemoteDaemon(
  options: EnsureDaemonOptions,
): Promise<ManagedDaemon> {
  if (!options.remoteUrl) {
    throw new Error("Missing remote daemon URL. Use --connect <url>.");
  }
  const url = normalizeRemoteDaemonUrl(options.remoteUrl);
  const token = options.token?.trim() || process.env.NERVE_DAEMON_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Missing remote daemon token. Use --token <token> or NERVE_DAEMON_TOKEN.",
    );
  }

  await assertHealthy(url, token, "remote Nerve daemon");
  return {
    url,
    token,
    owned: false,
    mode: "remote",
    stop: async () => undefined,
  };
}

async function ensureLocalDaemon(
  options: EnsureDaemonOptions,
): Promise<ManagedDaemon> {
  const paths = resolveDaemonPaths();
  const readinessTimeoutMs = resolveReadinessTimeoutMs();
  const existing = await findHealthyDaemon(paths);
  if (existing) {
    if (wantsLanAccess(options) && isLoopbackHost(existing.daemon.host)) {
      throw new Error(
        `A Nerve daemon is already running at ${existing.url}, but it is bound to ${existing.daemon.host} and cannot accept LAN clients. Stop the existing daemon, then run make desktop again.`,
      );
    }
    if (options.mobileHttps && !existing.daemon.mobileHttps) {
      throw new Error(
        `A Nerve daemon is already running at ${existing.url}, but mobile HTTPS is not enabled. Stop the existing daemon, then run with --mobile-https again.`,
      );
    }
    void desktopLog("info", "daemon", "Using existing healthy local daemon", {
      context: { url: existing.url },
    });
    return toManagedLocalDaemon(existing, false, async () => undefined);
  }

  const orchestratorMain = resolveOrchestratorMainPath();
  await access(orchestratorMain).catch(() => {
    throw new Error(
      `Nerve orchestrator build was not found at ${orchestratorMain}. Run pnpm --filter @nerve/orchestrator build first.`,
    );
  });

  const output = new OutputBuffer();
  void desktopLog("info", "daemon", "Starting owned local daemon", {
    context: { orchestratorMain, dataDir: paths.home, readinessTimeoutMs },
  });
  const child = spawn(process.execPath, [orchestratorMain], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NERVE_HOST: options.host ?? process.env.NERVE_HOST ?? "127.0.0.1",
      ...(options.port ? { NERVE_PORT: String(options.port) } : {}),
      ...(options.httpsPort
        ? { NERVE_HTTPS_PORT: String(options.httpsPort) }
        : {}),
      ...(options.allowRemote ? { NERVE_ALLOW_REMOTE: "1" } : {}),
      ...(options.mobileHttps ? { NERVE_MOBILE_HTTPS: "1" } : {}),
      ...(options.webDistPath ? { NERVE_WEB_DIST: options.webDistPath } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => output.append("stdout", chunk));
  child.stderr?.on("data", (chunk) => output.append("stderr", chunk));

  let spawnError: Error | undefined;
  let childExit: ChildExit | undefined;
  const killOnParentExit = () => {
    if (!childExit) child.kill("SIGTERM");
  };
  process.once("exit", killOnParentExit);
  child.once("error", (error) => {
    spawnError = error;
  });
  child.once("exit", (code, signal) => {
    childExit = { code, signal };
    process.off("exit", killOnParentExit);
  });

  const deadline = Date.now() + readinessTimeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) {
      throw daemonStartupError(
        `Failed to start the Nerve daemon: ${spawnError.message}`,
        output,
        { dataDir: paths.home, readinessTimeoutMs },
      );
    }
    if (childExit) {
      throw daemonStartupError(
        `Nerve daemon exited before it became ready${formatExit(childExit)}.`,
        output,
        { dataDir: paths.home, readinessTimeoutMs },
      );
    }

    const daemon = await findHealthyDaemon(paths);
    if (daemon) {
      void desktopLog("info", "daemon", "Owned local daemon became ready", {
        context: { url: daemon.url },
      });
      return toManagedLocalDaemon(daemon, true, () =>
        stopOwnedChild(child, () => childExit !== undefined),
      );
    }
    await delay(200);
  }

  await stopOwnedChild(child, () => childExit !== undefined);
  const error = daemonStartupError(
    `Nerve daemon did not become ready within ${readinessTimeoutMs}ms.`,
    output,
    { dataDir: paths.home, readinessTimeoutMs },
  );
  void desktopLog("error", "daemon", "Owned local daemon startup timed out", {
    error,
    context: { output: output.tail(), dataDir: paths.home, readinessTimeoutMs },
  });
  throw error;
}

function wantsLanAccess(options: EnsureDaemonOptions): boolean {
  const host = options.host ?? process.env.NERVE_HOST;
  return Boolean(
    options.allowRemote ||
      process.env.NERVE_ALLOW_REMOTE === "1" ||
      (host && !isLoopbackHost(host)),
  );
}

function resolveDaemonPaths(): DaemonPaths {
  const explicitHome = process.env.NERVE_HOME;
  const home = explicitHome?.trim() ? explicitHome : join(homedir(), ".nerve");
  return {
    home,
    daemonPath: join(home, "daemon.json"),
    localTokenPath: join(home, "auth", "local-token"),
  };
}

function resolveReadinessTimeoutMs(): number {
  const raw = process.env.NERVE_DAEMON_STARTUP_TIMEOUT_MS?.trim();
  if (!raw) return defaultReadinessTimeoutMs;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return defaultReadinessTimeoutMs;
  return Math.max(1, Math.trunc(value));
}

function resolveOrchestratorMainPath(): string {
  const resolvedUrl = import.meta.resolve("@nerve/orchestrator/main");
  return fileURLToPath(resolvedUrl);
}

async function findHealthyDaemon(
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

function toManagedLocalDaemon(
  daemon: HealthyDaemon,
  owned: boolean,
  stop: () => Promise<void>,
): ManagedDaemon {
  const shareUrl = remoteShareUrl(daemon.daemon, daemon.token);
  const secureUrls = remoteSecureUrls(daemon.daemon, daemon.token);
  return {
    url: daemon.url,
    token: daemon.token,
    shareUrl,
    mobileSetupUrl: secureUrls?.mobileSetupUrl,
    secureShareUrl: secureUrls?.secureShareUrl,
    caCertUrl: secureUrls?.caCertUrl,
    owned,
    mode: "local",
    stop,
  };
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

function isLoopbackHost(host: string): boolean {
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

async function assertHealthy(
  daemonUrl: string,
  token: string,
  label: string,
): Promise<void> {
  if (await isHealthy(daemonUrl, token)) return;
  throw new Error(`Could not connect to ${label} at ${daemonUrl}.`);
}

async function isHealthy(daemonUrl: string, token: string): Promise<boolean> {
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

function normalizeRemoteDaemonUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote daemon URL must use http:// or https://.");
  }
  return url.origin;
}

function localConnectUrl(rawUrl: string): string | undefined {
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

async function stopOwnedChild(
  child: ChildProcess,
  hasExited: () => boolean,
): Promise<void> {
  if (hasExited()) {
    void desktopLog("info", "daemon", "Owned child already exited before stop");
    return;
  }

  const startedAt = Date.now();
  let forced = false;
  let fallbackResolved = false;
  await new Promise<void>((resolveStop) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(resolveTimer);
      resolveStop();
    };
    const forceTimer = setTimeout(() => {
      if (!hasExited()) {
        forced = true;
        child.kill("SIGKILL");
      }
    }, shutdownTimeoutMs);
    const resolveTimer = setTimeout(() => {
      fallbackResolved = true;
      finish();
    }, shutdownTimeoutMs + 1000);

    child.once("exit", finish);
    if (!child.kill("SIGTERM")) finish();
  });
  void desktopLog("info", "daemon", "Owned child stop completed", {
    durationMs: Date.now() - startedAt,
    context: { forced, fallbackResolved, exited: hasExited() },
  });
}

function daemonStartupError(
  message: string,
  output: OutputBuffer,
  context?: { dataDir?: string; readinessTimeoutMs?: number },
): Error {
  const diagnostics = [
    context?.readinessTimeoutMs
      ? `Startup timeout: ${context.readinessTimeoutMs}ms`
      : undefined,
    context?.dataDir ? `Data dir: ${context.dataDir}` : undefined,
    context?.dataDir
      ? `Application log: ${join(
          context.dataDir,
          "logs",
          `application-${new Date().toISOString().slice(0, 10)}.jsonl`,
        )}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return new Error(
    `${message}\n\nDaemon output:\n${output.tail()}${
      diagnostics.length > 0
        ? `\n\nDiagnostics:\n${diagnostics.map((line) => `- ${line}`).join("\n")}`
        : ""
    }`,
  );
}

function formatExit(exit: ChildExit): string {
  if (exit.signal) return ` after signal ${exit.signal}`;
  if (exit.code !== null) return ` with code ${exit.code}`;
  return "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
