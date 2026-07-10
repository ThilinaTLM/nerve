import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  decideToolPermission,
  isLikelyLongRunningCommand,
  toolDefinitionByName,
} from "@nervekit/agent-tools";
import type {
  ApprovalPolicy,
  PermissionLevel,
  SandboxConfigV1,
} from "@nervekit/contracts";

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
  runtime: {
    workspaceDir: string;
    readOnly?: boolean;
    mode?: "coding" | "planning";
    planDir?: string;
  },
): Promise<void> {
  const workspaceDir = runtime.workspaceDir;
  if (runtime.readOnly && writeCapableTool(tool))
    throw new Error("write-capable tool denied in degraded read-only mode");
  const pathValue = typeof args.path === "string" ? args.path : undefined;
  if (runtime.mode === "planning" && writeCapableTool(tool)) {
    if (!runtime.planDir || !["write", "edit"].includes(tool) || !pathValue)
      throw new Error("write-capable tool denied while planning");
    const candidate = path.isAbsolute(pathValue)
      ? pathValue
      : path.join(workspaceDir, pathValue);
    await assertToolPathAllowed(path.dirname(candidate), runtime.planDir);
  }
  if (pathValue) {
    const candidate = path.isAbsolute(pathValue)
      ? pathValue
      : path.join(workspaceDir, pathValue);
    const checked = ["write", "edit"].includes(tool)
      ? path.dirname(candidate)
      : candidate;
    try {
      await assertToolPathAllowed(checked, workspaceDir);
    } catch (error) {
      if (!runtime.planDir) throw error;
      await assertToolPathAllowed(checked, runtime.planDir);
    }
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
  return toSandboxDecision(
    decideToolPermission(
      "bash",
      { command },
      {
        permissionLevel: policy.permissionLevel ?? "autonomous",
        approvalPolicy: {
          autoApproveReadOnly:
            policy.approvalPolicy?.autoApproveReadOnly ?? true,
        },
        groupRequireApproval: approval,
      },
    ),
  );
}

export function decideNonShellTool(
  tool: string,
  args: unknown,
  policy: {
    permissionLevel?: PermissionLevel;
    approvalPolicy?: Partial<ApprovalPolicy>;
  } = {},
): ToolDecision {
  const definition = toolDefinitionByName(tool);
  if (!definition) {
    return { allowed: false, reason: `unknown tool: ${tool}` };
  }
  return toSandboxDecision(
    decideToolPermission(
      definition.name,
      args && typeof args === "object" ? (args as Record<string, unknown>) : {},
      {
        permissionLevel: policy.permissionLevel ?? "autonomous",
        approvalPolicy: {
          autoApproveReadOnly:
            policy.approvalPolicy?.autoApproveReadOnly ?? true,
        },
      },
    ),
  );
}

function toSandboxDecision(decision: {
  decision: "allow" | "approval" | "deny";
  reason: string;
}): ToolDecision {
  return {
    allowed: decision.decision === "allow",
    approvalRequired: decision.decision === "approval" || undefined,
    reason: decision.reason,
  };
}

function writeCapableTool(tool: string): boolean {
  return toolDefinitionByName(tool)?.traits.includes("write_capable") === true;
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
