import {
  createToolDispatcher,
  type ToolDecision,
  type ToolDispatcher,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolHandlerRegistry,
  type ToolLifecycleHooks,
} from "@nervekit/tools";
import type { ToolName } from "@nervekit/contracts";

export * from "@nervekit/tools";

/** Identity and scope carried by a single host tool execution. */
export interface HostToolExecutionIdentity {
  readonly projectId?: string;
  readonly workspaceId?: string;
  readonly conversationId?: string;
  readonly agentId?: string;
  readonly runId?: string;
  readonly workerId?: string;
  readonly toolCallId?: string;
  readonly host?: unknown;
}

export interface HostToolExecutionRequest {
  readonly toolName: ToolName;
  readonly identity?: HostToolExecutionIdentity | unknown;
}

export interface HostToolExecutionPorts<
  TRequest extends HostToolExecutionRequest,
> {
  /** Core filesystem/process/provider context for this execution. */
  readonly execution: {
    context(
      request: TRequest,
      name: ToolName,
      args: Record<string, unknown>,
    ): ToolExecutionContext | Promise<ToolExecutionContext>;
  };
  /** Canonical task/explore/todo/plan/interaction handlers supplied by the host. */
  readonly handlers: {
    forExecution(request: TRequest): ToolHandlerRegistry;
  };
  /** Availability, policy, and risk decisions. */
  readonly policy?: {
    authorize(
      request: TRequest,
      name: ToolName,
      args: Record<string, unknown>,
    ): ToolDecision | Promise<ToolDecision>;
  };
  /** Lifecycle and bounded progress callbacks. */
  readonly lifecycle?: {
    forExecution(request: TRequest): ToolLifecycleHooks | undefined;
  };
  /** Genuine environment-specific executor overrides, such as local foreground bash. */
  readonly overrides?: {
    forExecution(request: TRequest): ToolHandlerRegistry | undefined;
  };
}

/**
 * Shared host composition boundary around the pure @nervekit/tools dispatcher.
 * Host repositories, secrets, transports, and policy implementations stay behind
 * the constructor-injected ports above.
 */
export class HostToolFactory<
  TRequest extends HostToolExecutionRequest = HostToolExecutionRequest,
> {
  constructor(private readonly ports: HostToolExecutionPorts<TRequest>) {}

  create(request: TRequest): ToolDispatcher {
    return createToolDispatcher({
      advertisedToolNames: new Set<string>([request.toolName]),
      hostHandlers: this.ports.handlers.forExecution(request),
      localOverrides: this.ports.overrides?.forExecution(request),
      contextFor: (name, args) =>
        this.ports.execution.context(request, name, args),
      authorize: this.ports.policy
        ? (name, args) => this.ports.policy!.authorize(request, name, args)
        : undefined,
      lifecycle: this.ports.lifecycle?.forExecution(request),
    });
  }

  execute(
    request: TRequest,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    return this.create(request).execute(
      request.toolName,
      args,
      request.identity,
    );
  }
}

export function createHostToolFactory<
  TRequest extends HostToolExecutionRequest,
>(ports: HostToolExecutionPorts<TRequest>): HostToolFactory<TRequest> {
  return new HostToolFactory(ports);
}
