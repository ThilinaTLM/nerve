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
    await attempts.append({
      phase: phase.name,
      index,
      status: result.timedOut
        ? "timeout"
        : result.code === 0
          ? "completed"
          : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.code,
      stdout: redactor.redactText(result.stdout),
      stderr: redactor.redactText(result.stderr),
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
    const child = spawn("/bin/sh", ["-lc", script], {
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
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code ?? (timedOut ? 124 : 1), stdout, stderr, timedOut });
    });
  });
}
