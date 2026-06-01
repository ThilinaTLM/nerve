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

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const daemon = await readDaemonFile();
  const token = await readToken();
  const response = await fetch(`${daemon.url}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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

async function commandRun(args: string[]): Promise<void> {
  const dir = args[0] && !args[0].startsWith("-") ? args[0] : process.cwd();
  const promptParts = dir === args[0] ? args.slice(1) : args;
  const prompt = promptParts.join(" ").trim();

  const { project } = await apiPost<{ project: { id: string; name: string } }>(
    "/api/projects",
    { dir },
  );
  const { session } = await apiPost<{ session: { id: string } }>(
    "/api/sessions",
    { projectId: project.id, title: `CLI run: ${project.name}` },
  );
  const { agent } = await apiPost<{ agent: { id: string } }>("/api/agents", {
    projectId: project.id,
    sessionId: session.id,
  });

  console.log(`project: ${project.id}`);
  console.log(`session: ${session.id}`);
  console.log(`agent: ${agent.id}`);

  if (!prompt) {
    console.log(
      "No prompt supplied. Open the UI or pass prompt text after the directory.",
    );
    return;
  }

  await streamPrompt(agent.id, prompt);
}

async function streamPrompt(agentId: string, prompt: string): Promise<void> {
  const daemon = await readDaemonFile();
  const token = await readToken();
  const wsUrl = new URL(daemon.url);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.pathname = "/ws";
  wsUrl.searchParams.set("token", token);

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let done = false;
    socket.addEventListener("open", () => {
      apiPost(`/api/agents/${agentId}/prompt`, { text: prompt }).catch(reject);
    });
    socket.addEventListener("message", (message) => {
      const event = JSON.parse(String(message.data)) as {
        type?: string;
        data?: { agentId?: string; delta?: string; message?: string };
      };
      if (event.data?.agentId !== agentId) return;
      if (event.type === "agent.message_delta")
        process.stdout.write(event.data.delta ?? "");
      if (event.type === "agent.message_complete") {
        done = true;
        process.stdout.write("\n");
        socket.close();
        resolve();
      }
      if (event.type === "agent.error") {
        done = true;
        socket.close();
        reject(new Error(event.data?.message ?? "Agent error"));
      }
    });
    socket.addEventListener("error", () =>
      reject(new Error("WebSocket error")),
    );
    socket.addEventListener("close", () => {
      if (!done) reject(new Error("WebSocket closed before completion"));
    });
  });
}

function printHelp(): void {
  console.log(`nerve

Usage:
  nerve daemon [--host 127.0.0.1] [--port 3747]
  nerve status
  nerve ui [--open]
  nerve run [dir] [prompt...]

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
  if (command === "run") {
    await commandRun(args);
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
