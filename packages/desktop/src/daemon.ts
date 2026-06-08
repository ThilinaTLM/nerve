import { type ChildProcess, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DaemonFile, daemonFileSchema } from "@nerve/shared";
import { desktopLog } from "./logging.js";

const readinessTimeoutMs = 15_000;
const healthCheckTimeoutMs = 1500;
const shutdownTimeoutMs = 5000;

export type DaemonMode = "local" | "remote";

export interface ManagedDaemon {
  url: string;
  owned: boolean;
  mode: DaemonMode;
  token?: string;
  stop: () => Promise<void>;
}

export interface EnsureDaemonOptions {
  webDistPath?: string;
  mode?: DaemonMode;
  remoteUrl?: string;
  token?: string;
  host?: string;
  port?: number;
  allowRemote?: boolean;
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
  const existing = await findHealthyDaemon(paths);
  if (existing) {
    void desktopLog("info", "daemon", "Using existing healthy local daemon", {
      context: { url: existing.url },
    });
    return {
      url: existing.url,
      token: existing.token,
      owned: false,
      mode: "local",
      stop: async () => undefined,
    };
  }

  const orchestratorMain = resolveOrchestratorMainPath();
  await access(orchestratorMain).catch(() => {
    throw new Error(
      `Nerve orchestrator build was not found at ${orchestratorMain}. Run pnpm --filter @nerve/orchestrator build first.`,
    );
  });

  const output = new OutputBuffer();
  void desktopLog("info", "daemon", "Starting owned local daemon", {
    context: { orchestratorMain },
  });
  const child = spawn(process.execPath, [orchestratorMain], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NERVE_HOST: options.host ?? process.env.NERVE_HOST ?? "127.0.0.1",
      ...(options.port ? { NERVE_PORT: String(options.port) } : {}),
      ...(options.allowRemote ? { NERVE_ALLOW_REMOTE: "1" } : {}),
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
      );
    }
    if (childExit) {
      throw daemonStartupError(
        `Nerve daemon exited before it became ready${formatExit(childExit)}.`,
        output,
      );
    }

    const daemon = await findHealthyDaemon(paths);
    if (daemon) {
      void desktopLog("info", "daemon", "Owned local daemon became ready", {
        context: { url: daemon.url },
      });
      return {
        url: daemon.url,
        token: daemon.token,
        owned: true,
        mode: "local",
        stop: () => stopOwnedChild(child, () => childExit !== undefined),
      };
    }
    await delay(200);
  }

  await stopOwnedChild(child, () => childExit !== undefined);
  const error = daemonStartupError(
    `Nerve daemon did not become ready within ${readinessTimeoutMs}ms.`,
    output,
  );
  void desktopLog("error", "daemon", "Owned local daemon startup timed out", {
    error,
    context: { output: output.tail() },
  });
  throw error;
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
  if (hasExited()) return;

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
      if (!hasExited()) child.kill("SIGKILL");
    }, shutdownTimeoutMs);
    const resolveTimer = setTimeout(finish, shutdownTimeoutMs + 1000);

    child.once("exit", finish);
    if (!child.kill("SIGTERM")) finish();
  });
}

function daemonStartupError(message: string, output: OutputBuffer): Error {
  return new Error(`${message}\n\nDaemon output:\n${output.tail()}`);
}

function formatExit(exit: ChildExit): string {
  if (exit.signal) return ` after signal ${exit.signal}`;
  if (exit.code !== null) return ` with code ${exit.code}`;
  return "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
