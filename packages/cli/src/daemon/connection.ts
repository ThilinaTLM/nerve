import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type DaemonFile, daemonFileSchema } from "@nerve/shared";

export interface DaemonConnection {
  url: string;
  token: string;
}

export function dataDir(): string {
  return process.env.NERVE_HOME && process.env.NERVE_HOME.trim().length > 0
    ? process.env.NERVE_HOME
    : join(homedir(), ".nerve");
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function readDaemonFile(): Promise<DaemonFile> {
  const path = join(dataDir(), "daemon.json");
  try {
    const raw = await readFile(path, "utf8");
    return daemonFileSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(
        `Nerve daemon is not running (missing ${path}). Start it with \`nerve daemon\` or \`nerve serve\`, then retry this command.`,
      );
    }
    throw error;
  }
}

async function readToken(): Promise<string> {
  return (
    await readFile(join(dataDir(), "auth", "local-token"), "utf8")
  ).trim();
}

function readEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function localConnectUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (
    url.protocol === "http:" &&
    (url.hostname === "0.0.0.0" || url.hostname === "::")
  ) {
    url.hostname = "127.0.0.1";
  }
  return url.origin;
}

export async function readDaemonConnection(): Promise<DaemonConnection> {
  const explicitUrl = readEnvValue("NERVE_DAEMON_URL");
  const explicitToken = readEnvValue("NERVE_DAEMON_TOKEN");

  if (explicitUrl) {
    if (!explicitToken) {
      throw new Error(
        "NERVE_DAEMON_TOKEN is required when NERVE_DAEMON_URL is set.",
      );
    }
    new URL(explicitUrl);
    return { url: explicitUrl, token: explicitToken };
  }

  const daemon = await readDaemonFile();
  return {
    url: localConnectUrl(daemon.url),
    token: explicitToken ?? (await readToken()),
  };
}
