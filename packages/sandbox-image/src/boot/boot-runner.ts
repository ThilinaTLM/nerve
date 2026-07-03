import { spawn } from "node:child_process";
import path from "node:path";
import type { SandboxConfigV1 } from "@nervekit/shared";
import type { SecretResolver } from "../credentials/secret-resolver.js";
import { Redactor } from "../security/redaction.js";
import { atomicWriteFile } from "../state/json-store.js";
import { JsonlStore } from "../state/jsonl-store.js";
import { buildBootPlan } from "./boot-plan.js";

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
    const env: Record<string, string> = {};
    for (const [key, ref] of Object.entries(phase.env ?? {}))
      env[key] = opts.resolver ? await opts.resolver.resolve(ref) : "";
    const result = await runShell(
      phase.script,
      opts.workspaceDir,
      phase.timeoutMs,
      env,
    );
    const redactor =
      opts.redactor ?? new Redactor({ secrets: Object.values(env) });
    await atomicWriteFile(
      path.join(opts.stateDir, "boot", "latest.log"),
      redactor.redactText(`${result.stdout}\n${result.stderr}`),
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
      stdout: redactor.redactText(result.stdout),
      stderr: redactor.redactText(result.stderr),
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
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
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
        stderr: (stderr + String(error instanceof Error ? error.message : error)).slice(-64_000),
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

function shellCommand(script: string): [string, string[]] {
  if (process.platform === "win32") return ["bash", ["-lc", script]];
  return ["/bin/sh", ["-lc", script]];
}
