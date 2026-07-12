import path from "node:path";
import {
  AgentToolSuspension,
  isAgentToolSuspension,
} from "@nervekit/host-runtime/harness";
import type {
  HostToolFactory,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandlerRegistry,
} from "@nervekit/host-runtime/tools";
import { createHostToolFactory } from "@nervekit/host-runtime/tools";
import {
  toolDefinitionByName,
  toolManifest,
} from "@nervekit/host-runtime/tools";
import type {
  ApprovalPolicy,
  PermissionLevel,
  SandboxConfigV1,
  SandboxCredentialConfig,
  SandboxSecretRef,
  ToolName,
} from "@nervekit/contracts";
import type { AgentConfigStore } from "../agent/agent-config-store.js";
import type { ExploreRuntime } from "../agent/explore-runtime.js";
import type { SecretResolver } from "../credentials/secret-resolver.js";
import { Redactor } from "../security/redaction.js";
import { sandboxSha256Digest } from "../state/hash.js";
import { JsonlStore } from "../state/jsonl-store.js";
import type { SandboxPlanReviewStore } from "./plan-review-store.js";
import { createSandboxOrchestrationHandlers } from "./sandbox-orchestration-handlers.js";
import type { SandboxInteractionPort } from "./sandbox-orchestration-types.js";
import type { SandboxTaskService } from "./sandbox-task-service.js";
import { TodoStore } from "./todo-store.js";
import { computeToolGroupStatus } from "./tool-groups.js";
import {
  decideNonShellTool,
  decideShellCommand,
  enforceToolPolicy,
  type ToolDecision,
} from "./tool-policy.js";
import { activeKey, toolScope, type ToolRuntimeScope } from "./tool-scope.js";

export type SandboxToolRuntimeOptions = {
  workspaceDir: string;
  stateDir: string;
  dataDir?: string;
  readOnly?: boolean;
  redactor?: Redactor;
  secretResolver?: SecretResolver;
  planReviewStore?: SandboxPlanReviewStore;
  configStore?: AgentConfigStore;
  taskService?: SandboxTaskService;
  todoStore?: TodoStore;
  exploreRuntime?: ExploreRuntime;
};

type SandboxHostToolExecution = {
  toolName: ToolName;
  context: ToolExecutionContext;
  hostHandlers: ToolHandlerRegistry;
  identity?: unknown;
};

type ActiveToolExecution = ToolRuntimeScope & {
  key: string;
  toolCallId: string;
  toolName: string;
  abortController: AbortController;
  latestStatus: "requested" | "started" | "completed" | "failed" | "cancelled";
  lifecycleSeq: number;
  cancel?: () => Promise<void> | void;
};

export class SandboxToolRuntime {
  private readonly records: JsonlStore<Record<string, unknown>>;
  private readonly redactor: Redactor;
  private readonly todoStore: TodoStore;
  private readonly hostTools: HostToolFactory<SandboxHostToolExecution>;
  private orchestrationHandlers: ToolHandlerRegistry;
  private interactions?: SandboxInteractionPort;
  private readonly active = new Map<string, ActiveToolExecution>();
  private policyOverride: {
    permissionLevel?: PermissionLevel;
    approvalPolicy?: Partial<ApprovalPolicy>;
  } = {};
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly options: SandboxToolRuntimeOptions = {
      workspaceDir: "/workspace",
      stateDir: "/state",
    },
  ) {
    this.records = new JsonlStore(
      path.join(options.stateDir, "tools", "tool-calls.jsonl"),
    );
    this.redactor = options.redactor ?? new Redactor({ secrets: [] });
    this.todoStore = options.todoStore ?? new TodoStore(options.stateDir);
    this.hostTools = createHostToolFactory<SandboxHostToolExecution>({
      execution: { context: (request) => request.context },
      handlers: { forExecution: (request) => request.hostHandlers },
    });
    this.orchestrationHandlers = this.createOrchestrationHandlers();
  }

  setExploreRuntime(exploreRuntime: ExploreRuntime): void {
    this.options.exploreRuntime = exploreRuntime;
    this.orchestrationHandlers = this.createOrchestrationHandlers();
  }

  setInteractions(interactions: SandboxInteractionPort): void {
    this.interactions = interactions;
    this.orchestrationHandlers = this.createOrchestrationHandlers();
  }

  private createOrchestrationHandlers(): ToolHandlerRegistry {
    return createSandboxOrchestrationHandlers({
      workspaceDir: this.options.workspaceDir,
      redactor: this.redactor,
      interactions: this.interactions,
      planReviewStore: this.options.planReviewStore,
      configStore: this.options.configStore,
      taskService: this.options.taskService,
      todoStore: this.todoStore,
      exploreRuntime: this.options.exploreRuntime,
      record: (entry, context) => this.record(entry, context),
    });
  }

  updatePolicy(patch: {
    permissionLevel?: PermissionLevel;
    approvalPolicy?: Partial<ApprovalPolicy>;
  }): void {
    this.policyOverride = {
      ...this.policyOverride,
      ...patch,
      approvalPolicy: {
        ...(this.policyOverride.approvalPolicy ?? {}),
        ...(patch.approvalPolicy ?? {}),
      },
    };
  }

  private effectiveConfig(): SandboxConfigV1 {
    if (!this.policyOverride.permissionLevel) return this.config;
    return {
      ...this.config,
      agent: {
        ...this.config.agent,
        defaultPermissionLevel: this.policyOverride.permissionLevel,
      },
    };
  }

  private effectiveApprovalPolicy(): Partial<ApprovalPolicy> | undefined {
    return this.policyOverride.approvalPolicy;
  }

  private credentialGroup(group: string):
    | {
        enabled?: boolean;
        provider?: string;
        siteUrl?: string;
        baseUrl?: string;
        email?: string;
        defaultProjectKey?: string;
        defaultSpaceKey?: string;
        credential?: SandboxCredentialConfig;
      }
    | undefined {
    if (group !== "web" && group !== "jira" && group !== "confluence") {
      return undefined;
    }
    return this.effectiveConfig().tools?.groups?.[group];
  }

  private async resolveToolCredential(
    provider: string,
  ): Promise<string | undefined> {
    const group = this.credentialGroup(
      provider === "tavily" ? "web" : provider,
    );
    const resolver = this.options.secretResolver;
    if (!group?.credential || !resolver) return undefined;
    const ref = credentialSecretRef(group.credential);
    if (!ref) return undefined;
    const value = await resolver.resolve(ref);
    this.redactor.addSecret(value);
    return value;
  }

  private async resolveApproval(
    toolCallId: string,
    args: Record<string, unknown>,
  ): Promise<
    | {
        status: "granted" | "denied";
        toolCallId?: string;
        argsHash?: string;
        normalizedArgs?: unknown;
        denialError?: { code: string; message: string };
      }
    | undefined
  > {
    if (this.interactions) {
      const resolution = await this.interactions.resolved(toolCallId);
      if (!resolution) return undefined;
      const decision = resolution.decision;
      if (decision === "deny" || decision === "denied") {
        return {
          status: "denied",
          denialError: { code: "POLICY_DENIED", message: "Approval denied" },
        };
      }
      return {
        status: "granted",
        toolCallId,
        normalizedArgs: args,
        argsHash: sandboxSha256Digest(args),
      };
    }
    return undefined;
  }

  private async toolProviderConfig(provider: string): Promise<unknown> {
    const groupName = provider === "tavily" ? "web" : provider;
    const group = this.credentialGroup(groupName);
    if (!group) return undefined;
    return {
      ...group,
      enabled: group.enabled !== false,
    };
  }

  groups() {
    return computeToolGroupStatus(this.effectiveConfig(), {
      readOnly: this.options.readOnly,
      unavailable: toolManifest
        .filter((definition) => {
          if (!definition.traits.includes("credentialed")) return false;
          const group = this.credentialGroup(definition.group);
          return !this.options.secretResolver || !group?.credential;
        })
        .map((definition) => definition.name),
    });
  }

  decide(tool: string, args: unknown): ToolDecision {
    if (tool === "bash") {
      const effectiveConfig = this.effectiveConfig();
      const shell = effectiveConfig.tools?.groups?.shell;
      return decideShellCommand(
        String((args as { command?: unknown })?.command ?? ""),
        shell?.requireApproval ?? "risky",
        {
          permissionLevel:
            effectiveConfig.agent.defaultPermissionLevel ?? "autonomous",
          approvalPolicy: this.effectiveApprovalPolicy(),
        },
      );
    }
    const definition = toolDefinitionByName(tool);
    const active = this.groups().find(
      (entry) => entry.group === definition?.group,
    );
    if (!active?.active || !active.tools.includes(tool)) {
      return {
        allowed: false,
        reason: `tool disabled by sandbox policy: ${tool}`,
      };
    }
    return decideNonShellTool(tool, args, {
      permissionLevel:
        this.effectiveConfig().agent.defaultPermissionLevel ?? "autonomous",
      approvalPolicy: this.effectiveApprovalPolicy(),
    });
  }

  async execute(
    tool: string,
    args: Record<string, unknown>,
    context: Partial<ToolExecutionContext> & {
      conversationId?: string;
      agentId?: string;
      runId?: string;
      executionId?: string;
      toolCallId?: string;
      lifecycleOwner?: "bridge" | "runtime";
    } = {},
  ): Promise<ToolExecutionResult> {
    const toolCallId =
      context.toolCallId ??
      `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await this.record(
      {
        toolCallId,
        toolName: tool,
        status: "requested",
        displayArgs: this.redactor.redact(args),
        lifecycleSeq: 1,
      },
      context,
    );
    const effectiveMode = this.options.configStore?.effective(this.config).mode;
    if (tool === "plan_mode_present" && effectiveMode !== "planning") {
      await this.record(
        {
          toolCallId,
          toolName: tool,
          status: "failed",
          lifecycleSeq: 3,
          error: "plan_mode_present requires planning mode",
        },
        context,
      );
      throw new Error("plan_mode_present requires planning mode");
    }
    if (effectiveMode === "planning" && !isOrchestrationTool(tool))
      await enforceToolPolicy(tool, args, this.effectiveConfig(), {
        ...this.options,
        mode: effectiveMode,
        planDir: this.options.planReviewStore?.planDir,
      });
    const decision =
      effectiveMode === "planning" &&
      ["write", "edit"].includes(tool) &&
      this.effectiveConfig().agent.defaultPermissionLevel !== "read_only"
        ? { allowed: true }
        : this.decide(tool, args);
    if (!decision.allowed && !decision.approvalRequired) {
      await this.record(
        {
          toolCallId,
          toolName: tool,
          status: "failed",
          error: decision.reason,
        },
        context,
      );
      throw new Error(decision.reason ?? "tool denied by sandbox policy");
    }
    if (decision.approvalRequired) {
      const resolution = await this.resolveApproval(toolCallId, args);
      if (resolution?.status === "denied") {
        await this.record(
          {
            toolCallId,
            toolName: tool,
            status: "failed",
            lifecycleSeq: 3,
            error: resolution.denialError ?? {
              code: "POLICY_DENIED",
              message: "Approval denied",
            },
          },
          context,
        );
        return {
          content: resolution.denialError?.message ?? "Approval denied",
          details: {
            error: resolution.denialError ?? { code: "POLICY_DENIED" },
          },
        };
      }
      if (
        resolution?.status === "granted" &&
        resolution.toolCallId === toolCallId
      ) {
        const approvedHash =
          resolution.argsHash ?? sandboxSha256Digest(resolution.normalizedArgs);
        const actualHash = sandboxSha256Digest(args);
        if (approvedHash !== actualHash) {
          await this.record(
            {
              toolCallId,
              toolName: tool,
              status: "failed",
              lifecycleSeq: 3,
              error: {
                code: "VALIDATION_FAILED",
                message: "Tool arguments differ from approved arguments",
              },
            },
            context,
          );
          return {
            content: "Tool arguments differ from approved arguments",
            details: { error: { code: "VALIDATION_FAILED" } },
          };
        }
      }
      if (!resolution) {
        this.interactions?.setPending(toolCallId, {
          kind: "approval",
          prompt: decision.reason ?? "approval required",
          risk: [decision.reason ?? "policy"],
          normalizedArgs: args,
          offeredScopes: ["single_call", "same_tool_same_args", "run"],
        });
        if (!this.interactions) {
          throw new Error(
            "UNAVAILABLE: run interaction port is not configured",
          );
        }
        await this.record(
          {
            toolCallId,
            toolName: tool,
            status: "waiting_for_approval",
            approvalId: toolCallId,
            lifecycleSeq: 2,
          },
          context,
        );
        throw new AgentToolSuspension({
          toolCallId,
          toolName: tool,
          reason: `WAITING_FOR_APPROVAL: ${toolCallId}`,
        });
      }
    }
    if (isOrchestrationTool(tool)) {
      const tracked = tool.startsWith("task_") || tool === "explore";
      const active = tracked
        ? this.registerActive(tool, toolCallId, context, 1)
        : undefined;
      try {
        const request: SandboxHostToolExecution = {
          toolName: tool as ToolName,
          context: {
            cwd: this.options.workspaceDir,
            ...context,
            signal: mergedSignal(
              context.signal,
              active?.abortController.signal,
            ),
          },
          hostHandlers: this.orchestrationHandlers,
          identity: {
            scope: toolScope(context),
            toolCallId,
            context,
            setCancel: active
              ? (cancel: () => Promise<void> | void) => (active.cancel = cancel)
              : undefined,
          },
        };
        const result = await this.hostTools.execute(request, args);
        if (active?.latestStatus !== "cancelled") {
          await this.record(
            {
              toolCallId,
              toolName: tool,
              status: "completed",
              lifecycleSeq: 3,
              result,
            },
            context,
          );
          if (active) {
            active.latestStatus = "completed";
            active.lifecycleSeq = 3;
          }
        }
        return result;
      } catch (error) {
        if (
          active?.latestStatus === "cancelled" ||
          isAgentToolSuspension(error)
        )
          throw error;
        await this.record(
          {
            toolCallId,
            toolName: tool,
            status: "failed",
            lifecycleSeq: 3,
            error: error instanceof Error ? error.message : String(error),
          },
          context,
        );
        if (active) {
          active.latestStatus = "failed";
          active.lifecycleSeq = 3;
        }
        throw error;
      } finally {
        if (active) this.active.delete(active.key);
      }
    }
    await enforceToolPolicy(tool, args, this.effectiveConfig(), {
      ...this.options,
      mode: this.options.configStore?.effective(this.config).mode,
      planDir: this.options.planReviewStore?.planDir,
    });
    const active = this.registerActive(tool, toolCallId, context, 1);
    await this.record(
      {
        toolCallId,
        toolName: tool,
        status: "started",
        lifecycleSeq: 2,
      },
      context,
    );
    active.latestStatus = "started";
    active.lifecycleSeq = 2;
    try {
      const request: SandboxHostToolExecution = {
        toolName: tool as ToolName,
        context: {
          cwd: this.options.workspaceDir,
          dataDir:
            this.options.dataDir ??
            path.join(this.options.stateDir, "tool-data"),
          ...context,
          signal: mergedSignal(context.signal, active.abortController.signal),
          getApiKey: (provider) => this.resolveToolCredential(provider),
          getProviderConfig: (provider) => this.toolProviderConfig(provider),
        },
        hostHandlers: this.orchestrationHandlers,
        identity: context,
      };
      const result = await this.hostTools.execute(
        request,
        this.redactor.redact(args) as Record<string, unknown>,
      );
      if (!isActiveCancelled(active)) {
        await this.record(
          {
            toolCallId,
            toolName: tool,
            status: "completed",
            lifecycleSeq: 3,
            result,
          },
          context,
        );
        active.latestStatus = "completed";
        active.lifecycleSeq = 3;
      }
      return this.redactor.redact(result) as ToolExecutionResult;
    } catch (error) {
      if (isActiveCancelled(active)) throw error;
      await this.record(
        {
          toolCallId,
          toolName: tool,
          status: "failed",
          lifecycleSeq: 3,
          error: error instanceof Error ? error.message : String(error),
        },
        context,
      );
      active.latestStatus = "failed";
      active.lifecycleSeq = 3;
      throw error;
    } finally {
      this.active.delete(active.key);
    }
  }

  async cancelRun(scope: ToolRuntimeScope): Promise<void> {
    const matching = Array.from(this.active.values()).filter(
      (entry) =>
        entry.conversationId === scope.conversationId &&
        entry.agentId === scope.agentId &&
        entry.runId === scope.runId,
    );
    for (const entry of matching) {
      if (entry.latestStatus === "cancelled") continue;
      entry.latestStatus = "cancelled";
      entry.lifecycleSeq = Math.max(entry.lifecycleSeq + 1, 3);
      entry.abortController.abort();
      await entry.cancel?.();
      await this.record(
        {
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          status: "cancelled",
          lifecycleSeq: entry.lifecycleSeq,
        },
        scope,
      );
    }
    for (const task of (await this.options.taskService?.cancelRun(scope)) ??
      []) {
      if (task.origin.kind !== "agent_tool") continue;
      await this.record(
        {
          toolCallId: task.origin.toolCallId,
          toolName: "task_start",
          status: "cancelled",
          lifecycleSeq: 3,
        },
        scope,
      );
    }
  }

  private registerActive(
    toolName: string,
    toolCallId: string,
    context: Partial<ToolExecutionContext> & {
      conversationId?: string;
      agentId?: string;
      runId?: string;
    },
    lifecycleSeq: number,
  ): ActiveToolExecution {
    const scope = toolScope(context);
    const key = activeKey({ ...scope, toolCallId });
    const active: ActiveToolExecution = {
      ...scope,
      key,
      toolCallId,
      toolName,
      abortController: new AbortController(),
      latestStatus: "requested",
      lifecycleSeq,
    };
    this.active.set(key, active);
    return active;
  }

  private async record(
    entry: Record<string, unknown>,
    context?: Partial<ToolExecutionContext> & {
      conversationId?: string;
      agentId?: string;
      runId?: string;
    },
  ): Promise<void> {
    void context;
    const now = new Date().toISOString();
    const record = this.redactor.redact({
      ...entry,
      ts: now,
    }) as Record<string, unknown>;
    await this.records.append(record);
    // Canonical tool-call state is reported by SandboxRunExecution through
    // RunExecutionSink. This operational log is diagnostic only.
  }
}

function isActiveCancelled(active: ActiveToolExecution): boolean {
  return active.latestStatus === "cancelled";
}

function mergedSignal(
  outer?: AbortSignal,
  inner?: AbortSignal,
): AbortSignal | undefined {
  if (outer && inner) return AbortSignal.any([outer, inner]);
  return inner ?? outer;
}

function credentialSecretRef(
  credential: SandboxCredentialConfig,
): SandboxSecretRef | undefined {
  switch (credential.type) {
    case "api_key":
      return credential.apiKey;
    case "bearer":
      return credential.token;
    case "basic":
      return credential.password;
    case "oauth":
      return credential.accessToken ?? credential.source;
    case "ssh":
      return credential.privateKey;
    case "gpg":
      return credential.privateKey;
  }
}

function isOrchestrationTool(tool: string): boolean {
  return toolDefinitionByName(tool)?.executionKind === "host";
}
