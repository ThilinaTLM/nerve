#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type DaemonFile,
  daemonFileSchema,
  type StatusResponse,
} from "@nerve/shared";

function dataDir(): string {
  return process.env.NERVE_HOME && process.env.NERVE_HOME.trim().length > 0
    ? process.env.NERVE_HOME
    : join(homedir(), ".nerve");
}

async function readDaemonFile(): Promise<DaemonFile> {
  const raw = await readFile(join(dataDir(), "daemon.json"), "utf8");
  return daemonFileSchema.parse(JSON.parse(raw));
}

async function readToken(): Promise<string> {
  return (
    await readFile(join(dataDir(), "auth", "local-token"), "utf8")
  ).trim();
}

async function apiGet<T>(path: string): Promise<T> {
  const daemon = await readDaemonFile();
  const token = await readToken();
  const response = await fetch(`${daemon.url}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`,
    );
  return (await response.json()) as T;
}

async function commandStatus(): Promise<void> {
  const status = await apiGet<StatusResponse>("/api/status");
  console.log(`nerve daemon: ${status.daemonId}`);
  console.log(`version: ${status.version}`);
  console.log(`started: ${status.startedAt}`);
  console.log(`data: ${status.dataDir}`);
  console.log(
    `sqlite: ${status.storage.sqlitePath} (${status.storage.indexHealthy ? "healthy" : "unhealthy"})`,
  );
}

function openUrl(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

async function commandUi(args: string[]): Promise<void> {
  const daemon = await readDaemonFile();
  console.log(daemon.url);
  if (args.includes("--open")) openUrl(daemon.url);
}

function printHelp(): void {
  console.log(`nerve

Usage:
  nerve daemon [--host 127.0.0.1] [--port 3747]
  nerve status
  nerve ui [--open]

Environment:
  NERVE_HOME   Override the data directory (default: ~/.nerve)
  NERVE_HOST   Override daemon host
  NERVE_PORT   Override daemon port
`);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "--") rawArgs.shift();
  const [command = "ui", ...args] = rawArgs;

  if (command === "daemon") {
    await import("@nerve/orchestrator/main");
    return;
  }
  if (command === "status") {
    await commandStatus();
    return;
  }
  if (command === "ui") {
    await commandUi(args);
    return;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  console.error(`unknown command: ${command}`);
  printHelp();
  process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
