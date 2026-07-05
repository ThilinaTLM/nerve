import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type ApprovalPolicy,
  approvalPolicySchema,
  defaultApprovalPolicy,
  type PermissionLevel,
  permissionLevelSchema,
  type SandboxAgentModelSelection,
  type SandboxConfigV1,
  sandboxAgentModelSelectionSchema,
} from "@nervekit/shared";

export type AgentConfigOverlay = {
  model?: Partial<SandboxAgentModelSelection>;
  mode?: "coding" | "planning";
  permissionLevel?: PermissionLevel;
  approvalPolicy?: Partial<ApprovalPolicy>;
  updatedAt?: string;
};

export type AgentEffectiveConfig = {
  model: SandboxAgentModelSelection;
  mode: "coding" | "planning";
  permissionLevel: PermissionLevel;
  approvalPolicy: ApprovalPolicy;
  updatedAt?: string;
};

export type AgentConfigPatch = Omit<AgentConfigOverlay, "updatedAt">;

export class AgentConfigStore {
  private overlay: AgentConfigOverlay = {};
  constructor(private readonly stateDir: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath(), "utf8");
      this.overlay = normalizeOverlay(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.overlay = {};
    }
  }

  read(): AgentConfigOverlay {
    return structuredClone(this.overlay) as AgentConfigOverlay;
  }

  async update(patch: AgentConfigPatch): Promise<AgentConfigOverlay> {
    const normalized = normalizeOverlay({
      ...this.overlay,
      ...patch,
      model: { ...(this.overlay.model ?? {}), ...(patch.model ?? {}) },
      approvalPolicy: {
        ...(this.overlay.approvalPolicy ?? {}),
        ...(patch.approvalPolicy ?? {}),
      },
      updatedAt: new Date().toISOString(),
    });
    await mkdir(path.dirname(this.filePath()), { recursive: true });
    await writeFile(
      this.filePath(),
      `${JSON.stringify(normalized, null, 2)}\n`,
    );
    this.overlay = normalized;
    return this.read();
  }

  effective(baseConfig: SandboxConfigV1): AgentEffectiveConfig {
    const baseModel = baseConfig.agent.mainModel;
    const model = sandboxAgentModelSelectionSchema.parse({
      provider: this.overlay.model?.provider ?? baseModel.provider,
      model: this.overlay.model?.model ?? baseModel.model,
      thinkingLevel:
        this.overlay.model?.thinkingLevel ?? baseModel.thinkingLevel ?? "off",
    });
    const mode =
      this.overlay.mode ??
      (baseConfig.agent.mode === "planning" ? "planning" : "coding");
    return {
      model,
      mode,
      permissionLevel:
        this.overlay.permissionLevel ??
        baseConfig.agent.permissionLevel ??
        "autonomous",
      approvalPolicy: approvalPolicySchema.parse({
        ...defaultApprovalPolicy,
        ...(this.overlay.approvalPolicy ?? {}),
      }),
      updatedAt: this.overlay.updatedAt,
    };
  }

  effectiveSandboxConfig(baseConfig: SandboxConfigV1): SandboxConfigV1 {
    const effective = this.effective(baseConfig);
    return {
      ...baseConfig,
      agent: {
        ...baseConfig.agent,
        mainModel: effective.model,
        mode: effective.mode === "planning" ? "planning" : "normal",
        permissionLevel: effective.permissionLevel,
      },
    };
  }

  private filePath(): string {
    return path.join(this.stateDir, "agent", "config.json");
  }
}

export function sanitizeEffectiveAgentConfig(
  baseConfig: SandboxConfigV1,
  store?: AgentConfigStore,
): AgentEffectiveConfig {
  if (store) return store.effective(baseConfig);
  const temporary = new AgentConfigStore("/state");
  return temporary.effective(baseConfig);
}

function normalizeOverlay(value: unknown): AgentConfigOverlay {
  if (!isRecord(value)) return {};
  const normalized: AgentConfigOverlay = {};
  if (isRecord(value.model)) {
    const model = sandboxAgentModelSelectionSchema.partial().parse(value.model);
    if (Object.keys(model).length) normalized.model = model;
  }
  if (value.mode === "coding" || value.mode === "planning") {
    normalized.mode = value.mode;
  }
  if (value.permissionLevel) {
    normalized.permissionLevel = permissionLevelSchema.parse(
      value.permissionLevel,
    );
  }
  if (isRecord(value.approvalPolicy)) {
    const approvalPolicy = approvalPolicySchema
      .partial()
      .parse(value.approvalPolicy);
    if (Object.keys(approvalPolicy).length)
      normalized.approvalPolicy = approvalPolicy;
  }
  if (typeof value.updatedAt === "string")
    normalized.updatedAt = value.updatedAt;
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
