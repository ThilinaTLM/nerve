import { realpath } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovalPolicy,
  PermissionLevel,
  SandboxConfigV1,
} from "@nervekit/shared";
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
  if (runtime.readOnly && writeCapableTool(tool))
    throw new Error("write-capable tool denied in degraded read-only mode");
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
  policy: {
    permissionLevel?: PermissionLevel;
    approvalPolicy?: Partial<ApprovalPolicy>;
  } = {},
): ToolDecision {
  const permissionLevel = policy.permissionLevel ?? "autonomous";
  if (permissionLevel === "read_only") {
    if (isReadOnlyShellCommand(command)) return { allowed: true };
    return {
      allowed: false,
      reason: "shell command denied by read-only sandbox policy",
    };
  }
  if (permissionLevel === "supervised") {
    if (approval === "never" && isReadOnlyShellCommand(command))
      return { allowed: true };
    if (approval === "never" && !isRiskyShellCommand(command))
      return { allowed: true };
    if (approval === "always" || isRiskyShellCommand(command))
      return {
        allowed: false,
        approvalRequired: true,
        reason: isRiskyShellCommand(command)
          ? "risky shell command requires approval"
          : "approval required",
      };
    return { allowed: true };
  }
  if (approval === "always")
    return {
      allowed: false,
      approvalRequired: true,
      reason: "approval required",
    };
  if (approval === "risky" && isRiskyShellCommand(command))
    return {
      allowed: false,
      approvalRequired: true,
      reason: "destructive command requires approval",
    };
  return { allowed: true };
}

export function decideNonShellTool(
  tool: string,
  _args: unknown,
  policy: {
    permissionLevel?: PermissionLevel;
    approvalPolicy?: Partial<ApprovalPolicy>;
  } = {},
): ToolDecision {
  const permissionLevel = policy.permissionLevel ?? "autonomous";
  if (permissionLevel === "read_only" && writeCapableTool(tool)) {
    return {
      allowed: false,
      reason: `tool denied by read-only sandbox policy: ${tool}`,
    };
  }
  if (permissionLevel === "supervised" && riskyTool(tool)) {
    return {
      allowed: false,
      approvalRequired: true,
      reason: `tool requires approval by supervised sandbox policy: ${tool}`,
    };
  }
  return { allowed: true };
}

function isRiskyShellCommand(command: string): boolean {
  return /\b(rm\s+-rf|mkfs|shutdown|reboot|dd\s+|chmod\s+-R\s+777)\b/.test(
    command,
  );
}

function isReadOnlyShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return true;
  if (
    /[>|;&`$()]|\b(sudo|rm|mv|cp|chmod|chown|mkdir|touch|tee|dd|mkfs|shutdown|reboot|curl|wget|python|node|npm|pnpm|yarn|bun)\b/.test(
      trimmed,
    )
  )
    return false;
  return /^(pwd|ls|cat|grep|rg|find|head|tail|wc|sed -n|git status|git diff|git log)(\s|$)/.test(
    trimmed,
  );
}

function riskyTool(tool: string): boolean {
  return ["write", "edit", "bash", "python", "task_start"].includes(tool);
}

function writeCapableTool(tool: string): boolean {
  return [
    "write",
    "edit",
    "bash",
    "python",
    "task_start",
    "task_cancel",
  ].includes(tool);
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
