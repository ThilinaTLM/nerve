import { spawn } from "node:child_process";
import path from "node:path";
import type { SandboxConfigV1 } from "@nervekit/shared";
import type { SecretResolver } from "../credentials/secret-resolver.js";
import { Redactor } from "../security/redaction.js";
import { atomicWriteFile } from "../state/json-store.js";
import { JsonlStore } from "../state/jsonl-store.js";
import { buildBootPlan } from "./boot-plan.js";

const bootEnvAllowlist = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "PAGER",
  "GIT_PAGER",
  "GIT_TERMINAL_PROMPT",
  "CI",
  "DEBIAN_FRONTEND",
  "COREPACK_ENABLE_DOWNLOAD_PROMPT",
  "NPM_CONFIG_YES",
  "npm_config_yes",
  "TMPDIR",
  "NVM_DIR",
  "PNPM_HOME",
  "NPM_CONFIG_PREFIX",
  "npm_config_prefix",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "npm_config_cache",
  "NPM_CONFIG_CACHE",
  "YARN_CACHE_FOLDER",
]);

const nonInteractiveBootEnvDefaults: Record<string, string> = {
  TERM: "dumb",
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  CI: "1",
  DEBIAN_FRONTEND: "noninteractive",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  NPM_CONFIG_YES: "true",
  npm_config_yes: "true",
};

const bootEnvDefaults: Record<string, string> = {
  ...nonInteractiveBootEnvDefaults,
  PATH: "/state/cache/dependencies/npm-global/bin:/state/cache/dependencies/pnpm:/home/sandbox/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOME: "/home/sandbox",
  USER: "sandbox",
  LOGNAME: "sandbox",
  SHELL: "/bin/sh",
  TMPDIR: "/tmp",
  PNPM_HOME: "/state/cache/dependencies/pnpm",
  NPM_CONFIG_PREFIX: "/state/cache/dependencies/npm-global",
  NPM_CONFIG_CACHE: "/state/cache/dependencies/npm",
  YARN_CACHE_FOLDER: "/state/cache/dependencies/yarn",
  XDG_CACHE_HOME: "/state/cache",
};

export async function runBootPlan(
  config: SandboxConfigV1,
  opts: {
    workspaceDir: string;
    stateDir: string;
    resolver?: SecretResolver;
    redactor?: Redactor;
    eventSink?: {
      append(input: {
        type: string;
        durability: "durable" | "transient";
        data: unknown;
      }): Promise<unknown>;
    };
    instanceId?: string;
    env?: Record<string, string>;
  },
): Promise<void> {
  const attempts = new JsonlStore<Record<string, unknown>>(
    path.join(opts.stateDir, "boot", "attempts.jsonl"),
  );
  for (const [index, phase] of buildBootPlan(config).entries()) {
    const startedAt = new Date().toISOString();
    await attempts.append({
      phase: phase.name,
      index,
      status: "started",
      startedAt,
    });
    await opts.eventSink?.append({
      type: "sandbox.boot.started",
      durability: "durable",
      data: {
        instanceId: opts.instanceId ?? "unknown",
        phase: phase.name,
        index,
        startedAt,
        timeoutMs: phase.timeoutMs,
        runAs: phase.runAs ?? "sandbox",
        network: phase.network ?? "inherit",
      },
    });
    const env: Record<string, string> = {
      ...bootBaseEnv(process.env),
      ...(opts.env ?? {}),
    };
    const phaseSecretValues: string[] = [];
    for (const [key, ref] of Object.entries(phase.env ?? {})) {
      const value = opts.resolver ? await opts.resolver.resolve(ref) : "";
      env[key] = value;
      phaseSecretValues.push(value);
    }
    const result = await runShell(
      phase.script,
      opts.workspaceDir,
      phase.timeoutMs,
      env,
    );
    const redactText = bootTextRedactor(opts.redactor, phaseSecretValues);
    await atomicWriteFile(
      path.join(opts.stateDir, "boot", "latest.log"),
      redactText(`${result.stdout}\n${result.stderr}`),
    );
    const completedAt = new Date().toISOString();
    const status = result.timedOut
      ? "timeout"
      : result.code === 0
        ? "completed"
        : "failed";
    const record = {
      phase: phase.name,
      index,
      status,
      startedAt,
      completedAt,
      exitCode: result.code,
      stdout: redactText(result.stdout),
      stderr: redactText(result.stderr),
    };
    await attempts.append(record);
    await opts.eventSink?.append({
      type: "sandbox.boot.completed",
      durability: "durable",
      data: {
        instanceId: opts.instanceId ?? "unknown",
        ...record,
        stdout: {
          text: record.stdout,
          bytes: Buffer.byteLength(record.stdout),
        },
        stderr: {
          text: record.stderr,
          bytes: Buffer.byteLength(record.stderr),
        },
      },
    });
    if (result.code !== 0 && config.boot?.onFailure !== "continue_readonly")
      throw new Error(`Boot phase failed: ${phase.name}`);
  }
}

function bootBaseEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of bootEnvAllowlist) {
    const value =
      nonInteractiveBootEnvDefaults[key] ?? source[key] ?? bootEnvDefaults[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function bootTextRedactor(
  baseRedactor: Redactor | undefined,
  phaseSecretValues: string[],
): (text: string) => string {
  const phaseRedactor = new Redactor({ secrets: phaseSecretValues });
  return (text: string) => {
    const redacted = phaseRedactor.redactText(text);
    return baseRedactor ? baseRedactor.redactText(redacted) : redacted;
  };
}

async function runShell(
  script: string,
  cwd: string,
  timeoutMs: number,
  env: Record<string, string>,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const [shell, args] = shellCommand(script);
    const child = spawn(shell, args, {
      cwd,
      detached: process.platform !== "win32",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killShellTree(child.pid);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + String(chunk)).slice(-64_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-64_000);
    });
    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        code: 127,
        stdout,
        stderr: (
          stderr + String(error instanceof Error ? error.message : error)
        ).slice(-64_000),
        timedOut,
      });
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code ?? (timedOut ? 124 : 1), stdout, stderr, timedOut });
    });
  });
}

function killShellTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") process.kill(pid, "SIGKILL");
    else process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

function shellCommand(script: string): [string, string[]] {
  if (process.platform === "win32") return ["bash", ["-lc", script]];
  return ["/bin/sh", ["-lc", script]];
}
