import path from "node:path";
import {
  AgentToolSuspension,
  isAgentToolSuspension,
} from "@nervekit/agent-runtime";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandlerRegistry,
} from "@nervekit/agent-tools";
import { toolDefinitionByName, toolManifest } from "@nervekit/agent-tools";
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
import type { ToolCallScope, ToolCallStore } from "../agent/tool-call-store.js";
import type { SecretResolver } from "../credentials/secret-resolver.js";
import { Redactor } from "../security/redaction.js";
import type { EventOutbox } from "../state/event-outbox.js";
import { sandboxSha256Digest } from "../state/hash.js";
import { JsonlStore } from "../state/jsonl-store.js";
import type { ApprovalWaiter } from "./approval-waiter.js";
import type { InputWaiter } from "./input-waiter.js";
import type { PlanReviewWaiter } from "./plan-review-waiter.js";
import { createSandboxOrchestrationHandlers } from "./sandbox-orchestration-handlers.js";
import { executeSandboxTool } from "./sandbox-tool-host.js";
import type { TaskSupervisor } from "./task-supervisor.js";
import { TodoStore } from "./todo-store.js";
import { computeToolGroupStatus } from "./tool-groups.js";
import {
  decideNonShellTool,
  decideShellCommand,
  enforceToolPolicy,
  type ToolDecision,
} from "./tool-policy.js";
import { activeKey, scopeValue, toolScope } from "./tool-scope.js";

export type SandboxToolRuntimeOptions = {
  workspaceDir: string;
  stateDir: string;
  dataDir?: string;
  readOnly?: boolean;
  redactor?: Redactor;
  secretResolver?: SecretResolver;
  approvalWaiter?: ApprovalWaiter;
  inputWaiter?: InputWaiter;
  planReviewWaiter?: PlanReviewWaiter;
  configStore?: AgentConfigStore;
  taskSupervisor?: TaskSupervisor;
  todoStore?: TodoStore;
  exploreRuntime?: ExploreRuntime;
  toolCallStore?: ToolCallStore;
  events?: EventOutbox;
  eventCommonData?: Record<string, unknown>;
};

type ActiveToolExecution = ToolCallScope & {
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
  private orchestrationHandlers: ToolHandlerRegistry;
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
    this.orchestrationHandlers = this.createOrchestrationHandlers();
  }

  setExploreRuntime(exploreRuntime: ExploreRuntime): void {
    this.options.exploreRuntime = exploreRuntime;
    this.orchestrationHandlers = this.createOrchestrationHandlers();
  }

  private createOrchestrationHandlers(): ToolHandlerRegistry {
    return createSandboxOrchestrationHandlers({
      workspaceDir: this.options.workspaceDir,
      redactor: this.redactor,
      inputWaiter: this.options.inputWaiter,
      planReviewWaiter: this.options.planReviewWaiter,
      configStore: this.options.configStore,
      taskSupervisor: this.options.taskSupervisor,
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
        planDir: this.options.planReviewWaiter?.planDir,
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
    if (decision.approvalRequired && this.options.approvalWaiter) {
      const scope = toolScope(context);
      const resolution =
        this.options.approvalWaiter.resolutionForToolCallOrScope({
          ...scope,
          toolCallId,
          toolName: tool,
          normalizedArgs: args,
        });
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
        await this.options.approvalWaiter.request({
          id: toolCallId,
          toolCallId,
          conversationId:
            scopeValue(context, "conversationId") ?? "conv_unknown",
          agentId: scopeValue(context, "agentId") ?? "agent_main",
          runId: scopeValue(context, "runId") ?? "run_unknown",
          reason: decision.reason ?? "approval required",
          risk: [decision.reason ?? "policy"],
          normalizedArgs: args,
          displayArgs: this.redactor.redact(args),
          toolName: tool,
          argsHash: sandboxSha256Digest(args),
        });
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
        const result = await executeSandboxTool({
          toolName: tool as ToolName,
          args,
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
        });
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
      planDir: this.options.planReviewWaiter?.planDir,
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
      const result = await executeSandboxTool({
        toolName: tool as ToolName,
        args: this.redactor.redact(args) as Record<string, unknown>,
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
      });
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

  async cancelRun(scope: ToolCallScope): Promise<void> {
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
      await this.options.events?.append({
        type: "tool.call.cancelled",
        durability: "durable",
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        data: {
          ...(this.options.eventCommonData ?? {}),
          ...scope,
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          status: "cancelled",
          lifecycleSeq: entry.lifecycleSeq,
          cancelledAt: new Date().toISOString(),
        },
      });
    }
    for (const task of (await this.options.taskSupervisor?.cancelRun(scope)) ??
      []) {
      if (!task.toolCallId) continue;
      await this.record(
        {
          toolCallId: task.toolCallId,
          toolName: "task_start",
          status: "cancelled",
          lifecycleSeq: 3,
        },
        scope,
      );
      await this.options.events?.append({
        type: "tool.call.cancelled",
        durability: "durable",
        conversationId: scope.conversationId,
        agentId: scope.agentId,
        runId: scope.runId,
        data: {
          ...(this.options.eventCommonData ?? {}),
          ...scope,
          toolCallId: task.toolCallId,
          toolName: "task_start",
          status: "cancelled",
          lifecycleSeq: 3,
          taskId: task.id,
          cancelledAt: new Date().toISOString(),
        },
      });
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
    const now = new Date().toISOString();
    const record = this.redactor.redact({
      ...entry,
      ts: now,
    }) as Record<string, unknown>;
    await this.records.append(record);
    if (!context || !this.options.toolCallStore) return;
    const harnessOwnsLifecycle =
      (context as Record<string, unknown>).lifecycleOwner === "bridge";
    if (harnessOwnsLifecycle && entry.status !== "cancelled") return;
    const status = normalizeToolStatus(entry.status);
    const scope = toolScope(context);
    await this.options.toolCallStore.append(scope, {
      toolCallId: String(entry.toolCallId ?? "tool_unknown"),
      toolName: String(entry.toolName ?? "tool_unknown"),
      status,
      displayArgs: entry.displayArgs,
      args: entry.displayArgs
        ? { hash: sandboxSha256Digest(entry.displayArgs) }
        : undefined,
      approvalId:
        typeof entry.approvalId === "string" ? entry.approvalId : undefined,
      lifecycleSeq:
        typeof entry.lifecycleSeq === "number" ? entry.lifecycleSeq : undefined,
      redactionVersion: 1,
      requestedAt: now,
      startedAt: status === "started" ? now : undefined,
      completedAt:
        status === "completed" || status === "failed" ? now : undefined,
      cancelledAt: status === "cancelled" ? now : undefined,
      result: entry.result,
      error: normalizeError(entry.error),
    });
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

function normalizeToolStatus(status: unknown) {
  if (
    status === "requested" ||
    status === "waiting_for_input" ||
    status === "waiting_for_approval" ||
    status === "started" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  )
    return status;
  return "failed" as const;
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

function normalizeError(error: unknown) {
  if (!error) return undefined;
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string")
      return { code: value.code, message: value.message };
  }
  return { code: "TOOL_FAILED", message: String(error).slice(0, 500) };
}

function isOrchestrationTool(tool: string): boolean {
  return toolDefinitionByName(tool)?.executionKind === "host";
}
