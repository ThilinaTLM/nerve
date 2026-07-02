import { realpath } from "node:fs/promises";
import path from "node:path";
import type { SandboxConfigV1 } from "@nervekit/shared";
import { isLikelyLongRunningCommand } from "@nervekit/tools";

export type ToolDecision = {
  allowed: boolean;
  reason?: string;
  approvalRequired?: boolean;
};

export async function assertToolPathAllowed(
  candidate: string,
  workspaceDir: string,
): Promise<void> {
  const [realCandidate, realRoot] = await Promise.all([
    realpath(candidate),
    realpath(workspaceDir),
  ]);
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}/`))
    throw new Error("filesystem policy denied path outside workspace");
}

export async function enforceToolPolicy(
  tool: string,
  args: Record<string, unknown>,
  config: SandboxConfigV1,
  runtime: { workspaceDir: string; readOnly?: boolean },
): Promise<void> {
  const workspaceDir = runtime.workspaceDir;
  if (runtime.readOnly && ["write", "edit"].includes(tool))
    throw new Error("write tool denied in degraded read-only mode");
  const pathValue = typeof args.path === "string" ? args.path : undefined;
  if (pathValue) {
    const candidate = path.isAbsolute(pathValue)
      ? pathValue
      : path.join(workspaceDir, pathValue);
    await assertToolPathAllowed(
      ["write", "edit"].includes(tool) ? path.dirname(candidate) : candidate,
      workspaceDir,
    );
  }
  if (tool === "python") {
    const cwd = typeof args.cwd === "string" ? args.cwd : workspaceDir;
    await assertToolPathAllowed(
      path.isAbsolute(cwd) ? cwd : path.join(workspaceDir, cwd),
      workspaceDir,
    );
    if (args.env && typeof args.env === "object")
      assertEnvAllowlist(
        args.env,
        config.tools?.groups?.shell?.envAllowlist ?? [],
      );
    const timeout = Number(args.timeout ?? 30);
    assertTimeout(
      timeout,
      config.tools?.groups?.python?.toolOptions?.maxTimeoutMs,
    );
  }
  if (tool === "bash") {
    const command = String(args.command ?? "");
    const shell = config.tools?.groups?.shell;
    const timeout = Number(args.timeout ?? shell?.defaultTimeoutMs ?? 30);
    assertTimeout(timeout, shell?.maxTimeoutMs);
    if (args.env && typeof args.env === "object")
      assertEnvAllowlist(args.env, shell?.envAllowlist ?? []);
    if (!shell?.allowLongRunning && isLikelyLongRunningCommand(command))
      throw new Error("long-running shell commands require task management");
  }
}

export function decideShellCommand(
  command: string,
  approval: "never" | "risky" | "always" = "risky",
): ToolDecision {
  if (approval === "always")
    return {
      allowed: false,
      approvalRequired: true,
      reason: "approval required",
    };
  if (
    approval === "risky" &&
    /\b(rm\s+-rf|mkfs|shutdown|reboot|dd\s+|chmod\s+-R\s+777)\b/.test(command)
  )
    return {
      allowed: false,
      approvalRequired: true,
      reason: "destructive command requires approval",
    };
  return { allowed: true };
}

function assertTimeout(timeoutSeconds: number, maxTimeoutMs?: unknown): void {
  const maxSeconds =
    typeof maxTimeoutMs === "number" ? Math.ceil(maxTimeoutMs / 1000) : 600;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0)
    throw new Error("invalid tool timeout");
  if (timeoutSeconds > maxSeconds)
    throw new Error("tool timeout exceeds sandbox policy");
}

function assertEnvAllowlist(env: object, allowlist: string[]): void {
  for (const key of Object.keys(env)) {
    if (!allowlist.includes(key))
      throw new Error(`environment variable is not allowlisted: ${key}`);
  }
}
