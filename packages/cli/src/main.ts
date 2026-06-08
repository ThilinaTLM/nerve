#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type AuthProviderMetadata,
  type DaemonFile,
  daemonFileSchema,
  type OAuthFlowInfo,
  type StatusResponse,
} from "@nerve/shared";

function dataDir(): string {
  return process.env.NERVE_HOME && process.env.NERVE_HOME.trim().length > 0
    ? process.env.NERVE_HOME
    : join(homedir(), ".nerve");
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readDaemonFile(): Promise<DaemonFile> {
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

interface DaemonConnection {
  url: string;
  token: string;
}

function readEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

async function readDaemonConnection(): Promise<DaemonConnection> {
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

function localConnectUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (
    url.protocol === "http:" &&
    (url.hostname === "0.0.0.0" || url.hostname === "::")
  ) {
    url.hostname = "127.0.0.1";
  }
  return url.origin;
}

async function apiGet<T>(path: string): Promise<T> {
  const connection = await readDaemonConnection();
  const response = await fetch(`${connection.url}${path}`, {
    headers: { authorization: `Bearer ${connection.token}` },
  });
  if (!response.ok)
    throw new Error(
      `${response.status} ${response.statusText}: ${await response.text()}`,
    );
  return (await response.json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const connection = await readDaemonConnection();
  const response = await fetch(`${connection.url}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${connection.token}`,
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

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const connection = await readDaemonConnection();
  const response = await fetch(`${connection.url}${path}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${connection.token}`,
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

async function apiDelete<T>(path: string): Promise<T> {
  const connection = await readDaemonConnection();
  const response = await fetch(`${connection.url}${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${connection.token}` },
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
  const connection = await readDaemonConnection();
  console.log(connection.url);
  if (args.includes("--open")) openUrl(connection.url);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLinePrompt(label: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await readline.question(label);
  } finally {
    readline.close();
  }
}

async function readSecretPrompt(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Cannot read an interactive secret. Use --stdin instead.");
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        const code = char.charCodeAt(0);
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (code === 3) {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (code === 8 || code === 127) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += char;
        process.stdout.write("*");
      }
    };

    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readStdin(): Promise<string> {
  let value = "";
  for await (const chunk of process.stdin) value += String(chunk);
  return value;
}

type AuthProvidersResponse = { providers: AuthProviderMetadata[] };

function printAuthHelp(): void {
  console.log(`nerve auth

Usage:
  nerve auth list
  nerve auth login <provider>
  nerve auth set-key <provider> [--stdin]
  nerve auth remove <provider>
`);
}

function providerLabel(provider: AuthProviderMetadata): string {
  const credential = provider.credentialType ?? "not configured";
  return `${provider.displayName} (${provider.provider}) · ${credential}`;
}

async function commandAuthList(): Promise<void> {
  const { providers } = await apiGet<AuthProvidersResponse>(
    "/api/auth/providers",
  );
  const configured = providers.filter((provider) => provider.configured);
  const oauthAvailable = providers.filter(
    (provider) => provider.supportsOAuth && !provider.configured,
  );
  const apiKeyAvailable = providers.filter(
    (provider) => provider.supportsApiKey && !provider.configured,
  );

  console.log("Configured providers:");
  if (configured.length === 0) {
    console.log("  none");
  } else {
    for (const provider of configured) {
      console.log(`  ${providerLabel(provider)}`);
      if (provider.warning) console.log(`    warning: ${provider.warning}`);
    }
  }

  if (oauthAvailable.length > 0) {
    console.log("\nSubscription/OAuth providers:");
    for (const provider of oauthAvailable) {
      console.log(
        `  ${provider.displayName} (${provider.provider}) — nerve auth login ${provider.provider}`,
      );
    }
  }

  if (apiKeyAvailable.length > 0) {
    console.log("\nAPI-key providers:");
    for (const provider of apiKeyAvailable) {
      const env = provider.envVar ? `, env ${provider.envVar}` : "";
      console.log(
        `  ${provider.provider}${env} — nerve auth set-key ${provider.provider}`,
      );
    }
  }
}

function isTerminalOAuthFlow(flow: OAuthFlowInfo): boolean {
  return ["succeeded", "failed", "cancelled"].includes(flow.status);
}

async function chooseOAuthOption(flow: OAuthFlowInfo): Promise<string> {
  if (!flow.options?.length) throw new Error("OAuth flow has no options.");
  console.log(flow.message ?? "Choose an option:");
  flow.options.forEach((option, index) => {
    console.log(`  ${index + 1}. ${option.label} (${option.id})`);
  });

  while (true) {
    const answer = (await readLinePrompt("Selection: ")).trim();
    const byNumber = Number(answer);
    if (
      Number.isInteger(byNumber) &&
      byNumber >= 1 &&
      byNumber <= flow.options.length
    ) {
      return flow.options[byNumber - 1].id;
    }
    const byId = flow.options.find((option) => option.id === answer);
    if (byId) return byId.id;
    console.log("Enter an option number or id.");
  }
}

async function promptOAuthValue(flow: OAuthFlowInfo): Promise<string> {
  const label = `${flow.message ?? "Response"} `;
  while (true) {
    const value = await readLinePrompt(label);
    if (flow.allowEmpty || value.trim().length > 0) return value;
    console.log("A response is required.");
  }
}

async function getOAuthFlow(flowId: string): Promise<OAuthFlowInfo> {
  return (
    await apiGet<{ flow: OAuthFlowInfo }>(
      `/api/auth/oauth/flows/${encodeURIComponent(flowId)}`,
    )
  ).flow;
}

async function waitForOAuthFlowAdvance(
  previous: OAuthFlowInfo,
): Promise<OAuthFlowInfo> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(attempt === 0 ? 100 : 500);
    const next = await getOAuthFlow(previous.flowId);
    if (
      next.status !== previous.status ||
      next.promptId !== previous.promptId ||
      next.updatedAt !== previous.updatedAt ||
      isTerminalOAuthFlow(next)
    ) {
      return next;
    }
  }
  throw new Error("OAuth flow did not advance after submitting a response.");
}

async function driveOAuthFlow(initialFlow: OAuthFlowInfo): Promise<void> {
  let flow = initialFlow;
  const printed = new Set<string>();

  const printOnce = (key: string, print: () => void) => {
    if (printed.has(key)) return;
    printed.add(key);
    print();
  };

  while (true) {
    if (flow.status === "succeeded") {
      console.log(flow.message ?? `Logged in to ${flow.providerName}.`);
      return;
    }
    if (flow.status === "failed") {
      throw new Error(flow.error ?? flow.message ?? "OAuth login failed.");
    }
    if (flow.status === "cancelled") {
      throw new Error(flow.message ?? "OAuth login cancelled.");
    }

    if (flow.status === "auth_url") {
      printOnce(`auth:${flow.authUrl ?? ""}:${flow.instructions ?? ""}`, () => {
        console.log(flow.message ?? "Complete login in your browser.");
        if (flow.authUrl) console.log(`Open: ${flow.authUrl}`);
        if (flow.instructions) console.log(flow.instructions);
      });
    } else if (flow.status === "device_code" && flow.deviceCode) {
      printOnce(
        `device:${flow.deviceCode.verificationUri}:${flow.deviceCode.userCode}`,
        () => {
          console.log(flow.message ?? "Complete login with the device code.");
          console.log(`Open: ${flow.deviceCode?.verificationUri}`);
          console.log(`Code: ${flow.deviceCode?.userCode}`);
        },
      );
    } else if (flow.status === "select" && flow.promptId) {
      const selectedId = await chooseOAuthOption(flow);
      await apiPost<{ flow: OAuthFlowInfo }>(
        `/api/auth/oauth/flows/${encodeURIComponent(flow.flowId)}/respond`,
        { promptId: flow.promptId, selectedId },
      );
      flow = await waitForOAuthFlowAdvance(flow);
      continue;
    } else if (flow.status === "prompt" && flow.promptId) {
      printOnce(
        `prompt-auth:${flow.authUrl ?? ""}:${flow.instructions ?? ""}`,
        () => {
          if (flow.authUrl) console.log(`Open: ${flow.authUrl}`);
          if (flow.instructions) console.log(flow.instructions);
        },
      );
      const value = await promptOAuthValue(flow);
      await apiPost<{ flow: OAuthFlowInfo }>(
        `/api/auth/oauth/flows/${encodeURIComponent(flow.flowId)}/respond`,
        { promptId: flow.promptId, value },
      );
      flow = await waitForOAuthFlowAdvance(flow);
      continue;
    } else if (flow.status === "progress" && flow.message) {
      printOnce(`progress:${flow.message}`, () => console.log(flow.message));
    }

    if (!isTerminalOAuthFlow(flow)) await delay(1000);
    flow = await getOAuthFlow(flow.flowId);
  }
}

async function commandAuthLogin(args: string[]): Promise<void> {
  const provider = args.find((arg) => !arg.startsWith("-"));
  if (!provider) throw new Error("Usage: nerve auth login <provider>");
  const { flow } = await apiPost<{ flow: OAuthFlowInfo }>(
    "/api/auth/oauth/flows",
    { provider },
  );
  await driveOAuthFlow(flow);
}

async function commandAuthSetKey(args: string[]): Promise<void> {
  const provider = args.find((arg) => !arg.startsWith("-"));
  if (!provider)
    throw new Error("Usage: nerve auth set-key <provider> [--stdin]");
  const apiKey = (
    args.includes("--stdin")
      ? await readStdin()
      : await readSecretPrompt(`API key for ${provider}: `)
  ).trim();
  if (!apiKey) throw new Error("API key cannot be empty.");
  await apiPut<{ ok: true }>("/api/provider-keys", { provider, apiKey });
  console.log(`Saved API key for ${provider}.`);
}

async function commandAuthRemove(args: string[]): Promise<void> {
  const provider = args.find((arg) => !arg.startsWith("-"));
  if (!provider) throw new Error("Usage: nerve auth remove <provider>");
  await apiDelete<{ ok: true }>(
    `/api/auth/providers/${encodeURIComponent(provider)}`,
  );
  console.log(`Removed credentials for ${provider}.`);
}

async function commandAuth(args: string[]): Promise<void> {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "list") {
    await commandAuthList();
    return;
  }
  if (subcommand === "login") {
    await commandAuthLogin(rest);
    return;
  }
  if (subcommand === "set-key") {
    await commandAuthSetKey(rest);
    return;
  }
  if (subcommand === "remove") {
    await commandAuthRemove(rest);
    return;
  }
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printAuthHelp();
    return;
  }
  console.error(`unknown auth command: ${subcommand}`);
  printAuthHelp();
  process.exit(2);
}

async function commandRun(args: string[]): Promise<void> {
  const dir = args[0] && !args[0].startsWith("-") ? args[0] : process.cwd();
  const promptParts = dir === args[0] ? args.slice(1) : args;
  const prompt = promptParts.join(" ").trim();

  const { project } = await apiPost<{ project: { id: string; name: string } }>(
    "/api/projects",
    { dir },
  );
  const { conversation } = await apiPost<{ conversation: { id: string } }>(
    "/api/conversations",
    { projectId: project.id, title: `CLI run: ${project.name}` },
  );
  const { agent } = await apiPost<{ agent: { id: string } }>("/api/agents", {
    projectId: project.id,
    conversationId: conversation.id,
  });

  console.log(`project: ${project.id}`);
  console.log(`conversation: ${conversation.id}`);
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
  const connection = await readDaemonConnection();
  const wsUrl = new URL(connection.url);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.pathname = "/ws";
  wsUrl.searchParams.set("token", connection.token);

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let done = false;
    socket.addEventListener("open", () => {
      apiPost(`/api/agents/${agentId}/prompt`, { text: prompt }).catch(reject);
    });
    socket.addEventListener("message", (message) => {
      const event = JSON.parse(String(message.data)) as {
        type?: string;
        data?: {
          agentId?: string;
          kind?: string;
          delta?: string;
          message?: string;
          aborted?: boolean;
        };
      };
      if (event.data?.agentId !== agentId) return;
      if (
        event.type === "conversation.live.content.delta" &&
        event.data.kind === "text"
      ) {
        process.stdout.write(event.data.delta ?? "");
      }
      if (event.type === "conversation.run.completed") {
        done = true;
        process.stdout.write("\n");
        socket.close();
        resolve();
      }
      if (event.type === "conversation.run.failed") {
        done = true;
        socket.close();
        if (event.data.aborted) resolve();
        else reject(new Error(event.data?.message ?? "Agent error"));
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

async function commandServe(args: string[]): Promise<void> {
  if (args.includes("--open")) void openUiWhenReady();
  await import("@nerve/orchestrator/main");
}

async function openUiWhenReady(): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const connection = await readDaemonConnection();
      const response = await fetch(`${connection.url}/api/status`, {
        headers: { authorization: `Bearer ${connection.token}` },
      });
      if (response.ok) {
        openUrl(connection.url);
        return;
      }
    } catch {
      // The daemon may not have written daemon.json yet.
    }
    await delay(200);
  }
  console.error("Timed out waiting to open the Nerve Web UI.");
}

function printHelp(): void {
  console.log(`nerve

Usage:
  nerve daemon [--host 127.0.0.1] [--port 3747] [--allow-remote]
  nerve serve [--host 127.0.0.1] [--port 3747] [--open] [--allow-remote]
  nerve status
  nerve ui [--open]
  nerve run [dir] [prompt...]
  nerve auth list
  nerve auth login <provider>
  nerve auth set-key <provider> [--stdin]
  nerve auth remove <provider>

Environment:
  NERVE_HOME   Override the data directory (default: ~/.nerve)
  NERVE_HOST   Override daemon host
  NERVE_PORT   Override daemon port
  NERVE_ALLOW_REMOTE=1   Allow non-loopback daemon bind addresses
  NERVE_DAEMON_URL     Connect CLI commands to an explicit daemon URL
  NERVE_DAEMON_TOKEN   Bearer token for NERVE_DAEMON_URL or local daemon override
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
  if (command === "serve") {
    await commandServe(args);
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
  if (command === "auth") {
    await commandAuth(args);
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
