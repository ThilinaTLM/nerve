import { readFile } from "node:fs/promises";
import { type DaemonFile, daemonFileSchema } from "@nervekit/contracts";
import type { DaemonPaths, HealthyDaemon } from "../contracts.js";
import { localConnectUrl } from "../urls.js";
import { checkHealth } from "./daemon-health.js";

type DaemonMetadataRead =
  | { status: "missing" }
  | { status: "valid"; daemon: DaemonFile }
  | { status: "invalid" | "unreadable"; cause?: unknown };

export async function findHealthyDaemon(
  paths: DaemonPaths,
): Promise<HealthyDaemon | undefined> {
  const daemonResult = await readDaemonFile(paths.daemonPath);
  if (daemonResult.status === "missing") return undefined;
  if (daemonResult.status !== "valid") {
    throw new Error(
      `Nerve daemon metadata at ${paths.daemonPath} is ${daemonResult.status}; refusing to start a second daemon.`,
      { cause: daemonResult.cause },
    );
  }
  const daemon = daemonResult.daemon;
  const url = localConnectUrl(daemon.url);
  if (!url)
    throw new Error(
      `Nerve daemon metadata at ${paths.daemonPath} contains an invalid local URL; refusing to start a second daemon.`,
    );
  const token = await readToken(paths.localTokenPath);
  const health = await checkHealth(url, token);
  return health.healthy ? { daemon, url, token } : undefined;
}

async function readDaemonFile(path: string): Promise<DaemonMetadataRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    return errorCode(cause) === "ENOENT"
      ? { status: "missing" }
      : { status: "unreadable", cause };
  }
  try {
    const parsed = daemonFileSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { status: "valid", daemon: parsed.data }
      : { status: "invalid", cause: parsed.error };
  } catch (cause) {
    return { status: "invalid", cause };
  }
}

async function readToken(path: string): Promise<string> {
  let token: string;
  try {
    token = (await readFile(path, "utf8")).trim();
  } catch (cause) {
    throw new Error(
      `Nerve daemon authentication metadata at ${path} is unreadable; refusing to start a second daemon.`,
      { cause },
    );
  }
  if (!token)
    throw new Error(
      `Nerve daemon authentication metadata at ${path} is empty; refusing to start a second daemon.`,
    );
  return token;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
