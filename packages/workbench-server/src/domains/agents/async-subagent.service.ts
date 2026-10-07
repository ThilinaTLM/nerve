import {
  agentAsyncObligationEntryId,
  asyncSubagentNameSchema,
  type AgentAsyncObligation,
  type AgentRecord,
  type AgentInputRecord,
  type AsyncSubagentControl,
  type AsyncSubagentListDetails,
  type AsyncSubagentPromptDetails,
  type AsyncSubagentStatus,
  type AsyncSubagentView,
  type CreateAgentRequest,
  type UpdateAgentRequest,
  type ParentConfigurationSnapshot,
} from "@nervekit/contracts/agents";
import type { RunRecord } from "@nervekit/contracts/runs";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
import { ApplicationError } from "../../core/application-error.js";
import {
  assertAgentParentOperation,
  assertAgentWorkspaceAuthority,
  resolveDelegatingParent,
  assertLiveParentDelegation,
} from "./agent-authority.js";

export interface AsyncSubagentPorts {
  getAgent(id: string): AgentRecord;
  listAgents(): AgentRecord[];
  createAgent(
    request: CreateAgentRequest,
    authorized: boolean,
    parentConfigurationSnapshot?: ParentConfigurationSnapshot,
  ): Promise<AgentRecord>;
  enabled(lead: AgentRecord): Promise<boolean>;
  /** Teammate model override from the lead's effective settings. */
  configuredModel(
    lead: AgentRecord,
  ): Promise<
    { model: ModelSelection; thinkingLevel?: ThinkingLevel } | undefined
  >;
  readControl(id: string): Promise<AsyncSubagentControl>;
  writeControl(control: AsyncSubagentControl): Promise<void>;
  activeRun(agent: AgentRecord): Promise<RunRecord | undefined>;
  latestRun(agent: AgentRecord): Promise<RunRecord | undefined>;
  reserveAssignment(input: {
    runId: string;
    childId: string;
    leadId: string;
    generation: number;
    childGeneration: number;
  }): Promise<void>;
  registerObligation?(obligation: AgentAsyncObligation): Promise<void>;
  getRun(runId: string): Promise<RunRecord | undefined>;
  assignments(): Promise<
    readonly import("@nervekit/contracts/agents").AsyncSubagentAssignment[]
  >;
  /** Same durable next-turn acceptance service used by direct user controls. */
  steer(
    agent: AgentRecord,
    prompt: string,
    parentConfigurationSnapshot?: ParentConfigurationSnapshot,
  ): Promise<AgentInputRecord>;
  controlGeneration(agentId: string): Promise<number>;
  delegationSnapshot(
    agentId: string,
    idempotencyKey: string,
  ): Promise<ParentConfigurationSnapshot | undefined>;
  resume(agent: AgentRecord): Promise<void>;
  configure(
    agent: AgentRecord,
    parent: AgentRecord,
    request: UpdateAgentRequest,
    parentConfigurationSnapshot?: ParentConfigurationSnapshot,
  ): Promise<void>;
  cancel(agent: AgentRecord): Promise<void>;
  cancelForShutdown(agent: AgentRecord): Promise<void>;
  activeTaskCount(agent: AgentRecord): number;
  completion(
    run: RunRecord,
  ): Promise<import("@nervekit/contracts/agents").AgentCompletion>;
}

const MAX_ACTIVE_CHILDREN = 4;

/** Persistent ownership; the run coordinator remains the sole execution authority. */
export class AsyncSubagentService {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly stops = new Map<string, Promise<void>>();
  constructor(private readonly ports: AsyncSubagentPorts) {}

  async create(
    leadId: string,
    name: string,
    authorized: boolean,
    parentSnapshot?: ParentConfigurationSnapshot,
  ): Promise<AsyncSubagentView> {
    return this.exclusive(leadId, async () => {
      const lead = resolveDelegatingParent(
        await this.requireLead(leadId),
        parentSnapshot,
      )!;
      if (!parentSnapshot && !(await this.ports.enabled(lead)))
        throw new ApplicationError(
          403,
          "SUBAGENTS_UNAVAILABLE",
          "Developer teammate creation is not configured.",
        );
      if ((await this.ports.readControl(leadId)).stopped)
        throw new ApplicationError(
          409,
          "SUBAGENT_TEAM_STOPPED",
          "The team is stopped. A new user prompt must reopen it.",
        );
      const parsedName = asyncSubagentNameSchema.parse(name);
      if (
        this.children(leadId).some(
          (child) => child.name?.toLowerCase() === parsedName.toLowerCase(),
        )
      ) {
        throw new ApplicationError(
          409,
          "SUBAGENT_NAME_CONFLICT",
          "A teammate with this name already exists.",
        );
      }
      const configured = await this.ports.configuredModel(lead);
      const child = await this.ports.createAgent(
        {
          conversationId: lead.conversationId,
          projectId: lead.projectId,
          projectDir: lead.projectDir,
          parentAgentId: lead.id,
          executionKind: "async_developer",
          orchestrationPolicy: {
            preset: "developer",
            parentCancellation: "independent",
            completionReporting: "parent",
          },
          name: parsedName,
          mode: authorized && !lead.readOnlyCeiling ? "coding" : lead.mode,
          permissionLevel:
            authorized && !lead.readOnlyCeiling
              ? "autonomous"
              : lead.permissionLevel,
          permissionRuleSetId:
            authorized && !lead.readOnlyCeiling
              ? "autonomous"
              : (lead.permissionRuleSetId ?? lead.permissionLevel),
          workspaceScope: {
            ...lead.workspaceScope,
            roots: [...lead.workspaceScope.roots],
          },
          model: configured?.model ?? lead.model,
          thinkingLevel: configured?.thinkingLevel ?? lead.thinkingLevel,
        },
        authorized,
        parentSnapshot,
      );
      await this.ports.writeControl({
        agentId: child.id,
        generation: 0,
        stopped: false,
        stopping: false,
      });
      return this.inspect(child, false);
    });
  }

  async prompt(
    leadId: string,
    name: string,
    prompt: string,
    options: {
      resume?: boolean;
      configuration?: UpdateAgentRequest;
      parentSnapshot?: ParentConfigurationSnapshot;
    } = {},
  ): Promise<AsyncSubagentPromptDetails> {
    if (!prompt.trim())
      throw new ApplicationError(
        400,
        "SUBAGENT_PROMPT_EMPTY",
        "A prompt is required.",
      );
    if (options.configuration) {
      const lead = await this.requireLead(leadId);
      const child = this.requireTarget(leadId, name);
      assertAgentParentOperation(child, lead, "configure");
      const originatingParent = resolveDelegatingParent(
        lead,
        options.parentSnapshot,
      )!;
      await this.ports.configure(
        child,
        originatingParent,
        options.configuration,
        options.parentSnapshot,
      );
    }
    if (options.resume) {
      const lead = await this.requireLead(leadId);
      const child = this.requireTarget(leadId, name);
      assertAgentParentOperation(child, lead, "prompt");
      await this.resume(child.id);
      await this.ports.resume(child);
    }
    const lead = await this.requireLead(leadId);
    const child = this.requireTarget(leadId, name);
    assertAgentParentOperation(child, lead, "prompt");
    assertAgentWorkspaceAuthority(
      resolveDelegatingParent(lead, options.parentSnapshot)!,
      child,
    );
    const input = await this.ports.steer(child, prompt, options.parentSnapshot);
    const active = await this.ports.activeRun(child);
    return {
      agentId: child.id,
      name: child.name ?? child.id,
      runId: input.delivery?.runId ?? active?.runId,
      inputId: input.id,
      accepted: true,
    };
  }

  /** Reservation only: common runtime owns every admission and execution. */
  async reserveAdmission(input: {
    agentId: string;
    runId: string;
    inputs: readonly AgentInputRecord[];
  }): Promise<void> {
    const child = this.ports.getAgent(input.agentId);
    const parentId = child.parentAgentId;
    await this.exclusive(parentId ?? child.id, async () => {
      const control = await this.ports.readControl(child.id);
      const liveParent = parentId
        ? this.ports.listAgents().find((agent) => agent.id === parentId)
        : undefined;
      const team = liveParent
        ? await this.ports.readControl(liveParent.id)
        : control;
      const proof = control.administrativeActivation;
      const independentUserActivation = Boolean(
        liveParent &&
        proof &&
        proof.agentId === child.id &&
        proof.parentAgentId === liveParent.id &&
        proof.parentStopGeneration === team.generation &&
        proof.childStopGeneration === control.generation &&
        proof.generation === (await this.ports.controlGeneration(child.id)) &&
        (!proof.runId || proof.runId === input.runId),
      );
      if (
        child.activationState === "paused" ||
        control.stopped ||
        control.stopping ||
        (team.stopped && !independentUserActivation)
      )
        throw new ApplicationError(
          409,
          "AGENT_ADMISSION_PAUSED",
          "Agent or team activation is paused; input remains pending.",
        );
      if (control.reservedRunId && control.reservedRunId !== input.runId)
        throw new ApplicationError(
          409,
          "AGENT_ADMISSION_RESERVED",
          "An earlier admission reservation must reconcile before replacement.",
        );
      if (!parentId) return;
      if (!liveParent) {
        if (
          input.inputs.some(
            (item) =>
              item.origin.kind === "parent" &&
              (item.eligibility.kind !== "run" ||
                item.eligibility.runId === input.runId),
          )
        )
          throw new ApplicationError(
            403,
            "AGENT_PARENT_FORBIDDEN",
            "The original parent no longer exists; delegated input cannot activate this agent.",
          );
        // Historical orphans remain directly administrable. A removed parent
        // is neither an admission budget owner nor delegated authority.
        return;
      }
      const parent = liveParent;
      for (const item of input.inputs) {
        if (
          item.eligibility.kind === "run" &&
          item.eligibility.runId !== input.runId
        )
          continue;
        if (
          item.eligibility.kind === "next_run" &&
          item.eligibility.afterRunId
        ) {
          const after = await this.ports.getRun(item.eligibility.afterRunId);
          if (
            after &&
            !["completed", "failed", "cancelled"].includes(after.status)
          )
            continue;
        }
        if (item.origin.kind !== "parent") continue;
        const source = this.ports.getAgent(item.origin.agentId);
        assertAgentParentOperation(child, source, "prompt");
        const proof = await this.ports.delegationSnapshot(
          child.id,
          item.idempotencyKey,
        );
        assertAgentWorkspaceAuthority(
          resolveDelegatingParent(source, proof)!,
          child,
        );
        assertLiveParentDelegation(source, child, {
          allowPausedParent: independentUserActivation,
        });
      }
      if (
        child.projectId !== parent.projectId ||
        child.rootAgentId !== parent.rootAgentId
      )
        throw new ApplicationError(
          403,
          "AGENT_PARENT_FORBIDDEN",
          "Child admission is outside its parent's identity/workspace authority.",
        );
      if (!control.reservedRunId) await this.assertCapacity(parentId);
      const reserved = {
        ...control,
        reservedRunId: input.runId,
        ...(independentUserActivation && proof
          ? { administrativeActivation: { ...proof, runId: input.runId } }
          : {}),
      };
      await this.ports.writeControl(reserved);
      try {
        await this.ports.reserveAssignment({
          runId: input.runId,
          childId: child.id,
          leadId: parentId,
          generation: team.generation,
          childGeneration: control.generation,
        });
      } catch (error) {
        await this.ports.writeControl({ ...control, reservedRunId: undefined });
        throw error;
      }
    });
  }

  async commitAdmission(input: {
    agentId: string;
    runId: string;
  }): Promise<void> {
    const child = this.ports.getAgent(input.agentId);
    if (!child.parentAgentId) return;
    await this.exclusive(child.parentAgentId, async () => {
      const run = await this.ports.getRun(input.runId);
      if (!run || run.agentId !== child.id)
        throw new Error("Admission commit has no correlated canonical run");
      const assignment = (await this.ports.assignments()).find(
        (item) => item.runId === input.runId && item.childId === child.id,
      );
      if (
        assignment &&
        this.ports
          .listAgents()
          .some((agent) => agent.id === child.parentAgentId) &&
        child.orchestrationPolicy?.completionReporting === "parent"
      ) {
        const timestamp = run.createdAt;
        await this.ports.registerObligation?.({
          id: `async_subagent:${input.runId}:${assignment.generation}`,
          conversationId: this.ports.getAgent(child.parentAgentId!)
            .conversationId,
          ownerAgentId: child.parentAgentId!,
          sourceKind: "async_subagent",
          sourceId: input.runId,
          sourceAgentId: child.id,
          state: "pending",
          notificationEntryId: agentAsyncObligationEntryId(
            "async_subagent",
            input.runId,
            assignment.generation,
          ),
          generation: assignment.generation,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      const control = await this.ports.readControl(child.id);
      if (control.reservedRunId === input.runId)
        await this.ports.writeControl({ ...control, reservedRunId: undefined });
    });
  }

  async releaseAdmission(input: {
    agentId: string;
    runId: string;
  }): Promise<void> {
    const child = this.ports.getAgent(input.agentId);
    await this.exclusive(child.parentAgentId ?? child.id, async () => {
      const control = await this.ports.readControl(child.id);
      if (control.reservedRunId !== input.runId) return;
      // A committed/uncertain canonical execution is never released as absent.
      const run = await this.ports.getRun(input.runId);
      if (run && !["completed", "cancelled", "failed"].includes(run.status))
        return;
      await this.ports.writeControl({
        ...control,
        reservedRunId: undefined,
        ...(control.administrativeActivation?.runId === input.runId
          ? {
              administrativeActivation: {
                ...control.administrativeActivation,
                runId: undefined,
              },
            }
          : {}),
      });
    });
  }

  async recordActivation(
    agentId: string,
    activationState: "enabled" | "paused",
  ): Promise<AsyncSubagentControl> {
    const agent = this.ports.getAgent(agentId);
    return this.exclusive(agent.parentAgentId ?? agent.id, async () => {
      const control = await this.ports.readControl(agentId);
      const stopped = activationState === "paused";
      const next = {
        ...control,
        stopped,
        generation:
          stopped && !control.stopped
            ? control.generation + 1
            : control.generation,
      };
      await this.ports.writeControl(next);
      return next;
    });
  }

  async recordAdministrativeActivation(input: {
    agentId: string;
    generation: number;
    cause: "user_resume" | "user_interrupt";
    runId?: string;
  }): Promise<void> {
    const child = this.ports.getAgent(input.agentId);
    if (
      !child.parentAgentId ||
      !this.ports.listAgents().some((agent) => agent.id === child.parentAgentId)
    )
      return;
    await this.exclusive(child.parentAgentId, async () => {
      const control = await this.ports.readControl(child.id);
      if (
        control.stopped ||
        control.stopping ||
        child.activationState === "paused" ||
        input.generation !== (await this.ports.controlGeneration(child.id))
      )
        throw new ApplicationError(
          409,
          "AGENT_ADMINISTRATIVE_ACTIVATION_STALE",
          "Explicit user activation was superseded by a newer stop.",
        );
      const parent = await this.ports.readControl(child.parentAgentId!);
      await this.ports.writeControl({
        ...control,
        administrativeActivation: {
          ...input,
          parentAgentId: child.parentAgentId!,
          parentStopGeneration: parent.generation,
          childStopGeneration: control.generation,
        },
      });
    });
  }

  async resume(childId: string): Promise<void> {
    const child = this.ports.getAgent(childId);
    await this.exclusive(child.parentAgentId ?? child.id, async () => {
      const control = await this.ports.readControl(childId);
      if (control.stopping)
        throw new ApplicationError(
          409,
          "SUBAGENT_STOPPING",
          "Wait for cancellation to settle before resuming.",
        );
      await this.ports.writeControl({ ...control, stopped: false });
      // Child activation never reopens an ancestor or sibling. Common runtime
      // persists explicit administrative authority separately before admission.
    });
  }

  async list(
    leadId: string,
    cursor?: string,
    limit = 50,
  ): Promise<AsyncSubagentListDetails> {
    await this.requireLead(leadId);
    const children = this.children(leadId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((child) => !cursor || child.id > cursor);
    const count = Math.max(1, Math.min(100, Math.trunc(limit)));
    const selected = children.slice(0, count);
    return {
      subagents: await Promise.all(
        selected.map((child) => this.inspect(child, false)),
      ),
      ...(children.length > count ? { nextCursor: selected.at(-1)!.id } : {}),
    };
  }

  async status(leadId: string, name: string): Promise<AsyncSubagentView> {
    return this.exclusive(leadId, async () => {
      await this.requireLead(leadId);
      return this.inspect(this.requireTarget(leadId, name), true);
    });
  }

  async stop(leadId: string, name: string): Promise<AsyncSubagentView> {
    const child = await this.exclusive(leadId, async () => {
      await this.requireLead(leadId);
      const child = this.requireTarget(leadId, name);
      assertAgentParentOperation(child, this.ports.getAgent(leadId), "stop");
      return child;
    });
    await this.stopChild(leadId, child.id);
    return this.inspect(child, false);
  }

  async stopTeam(leadId: string): Promise<void> {
    await this.exclusive(leadId, async () => {
      if (
        this.ports
          .listAgents()
          .filter((child) => child.parentAgentId === leadId).length === 0 &&
        !(await this.ports.enabled(this.ports.getAgent(leadId)))
      )
        return;
      const team = await this.ports.readControl(leadId);
      // Every explicit team stop invalidates earlier independent activation,
      // including a repeated stop while the parent itself remains paused.
      await this.ports.writeControl({
        ...team,
        stopped: true,
        generation: team.generation + 1,
      });
    });
    await Promise.all(
      this.ports
        .listAgents()
        .filter((child) => child.parentAgentId === leadId)
        .map(async (child) => {
          await this.stopChild(leadId, child.id);
          await this.stopTeam(child.id);
        }),
    );
  }

  async settleTeam(leadId: string): Promise<void> {
    // Process shutdown is not a user stop. Preserve activation/generation and
    // accepted general input for independent children across restart.
    await Promise.all(
      this.ports
        .listAgents()
        .filter((child) => child.parentAgentId === leadId)
        .map(async (child) => {
          await this.ports.cancelForShutdown(child);
          await this.settleTeam(child.id);
        }),
    );
  }

  async reopen(leadId: string): Promise<void> {
    await this.exclusive(leadId, async () => {
      const team = await this.ports.readControl(leadId);
      if (team.stopped)
        await this.ports.writeControl({ ...team, stopped: false });
    });
  }

  private stopChild(leadId: string, childId: string): Promise<void> {
    const existing = this.stops.get(childId);
    if (existing) return existing;
    const operation = this.performStopChild(leadId, childId).finally(() => {
      if (this.stops.get(childId) === operation) this.stops.delete(childId);
    });
    this.stops.set(childId, operation);
    return operation;
  }

  private async performStopChild(
    leadId: string,
    childId: string,
  ): Promise<void> {
    const child = this.requireChild(leadId, childId);
    await this.exclusive(leadId, async () => {
      const control = await this.ports.readControl(childId);
      await this.ports.writeControl({
        ...control,
        stopped: true,
        stopping: true,
        generation: control.stopped
          ? control.generation
          : control.generation + 1,
      });
    });
    // Never hold the admission lock while awaiting execution callbacks.
    await this.ports.cancel(child);
    await this.exclusive(leadId, async () => {
      const control = await this.ports.readControl(childId);
      if (await this.ports.activeRun(child)) return;
      if (this.ports.activeTaskCount(child)) return;
      await this.ports.writeControl({
        ...control,
        stopping: false,
        reservedRunId: undefined,
      });
    });
  }

  async reconcile(): Promise<void> {
    for (const child of this.ports
      .listAgents()
      .filter((agent) => Boolean(agent.parentAgentId))) {
      const leadId = child.parentAgentId!;
      await this.exclusive(leadId, async () => {
        const control = await this.ports.readControl(child.id);
        const active = await this.ports.activeRun(child);
        const reserved = control.reservedRunId
          ? await this.ports.getRun(control.reservedRunId)
          : undefined;
        if (
          !active &&
          (!reserved ||
            ["completed", "failed", "cancelled"].includes(reserved.status)) &&
          !this.ports.activeTaskCount(child) &&
          (control.reservedRunId || control.stopping)
        ) {
          await this.ports.writeControl({
            ...control,
            reservedRunId: undefined,
            stopping: false,
          });
        }
      });
      // Delegation capability changes fence parent operations and trusted
      // wakes; they do not revoke an authorized user's agent administration.
    }
  }

  private async inspect(
    child: AgentRecord,
    includeResponse: boolean,
  ): Promise<AsyncSubagentView> {
    const control = await this.ports.readControl(child.id);
    const active = await this.ports.activeRun(child);
    const latest = active ?? (await this.ports.latestRun(child));
    const state = control.stopping
      ? "stopping"
      : active || control.reservedRunId
        ? "running"
        : "idle";
    const outcome =
      latest?.failure?.code === "RUN_INTERRUPTED_NO_RESUME"
        ? "interrupted"
        : latest &&
            ["completed", "cancelled", "failed", "interrupted"].includes(
              latest.status,
            )
          ? (latest.status as AsyncSubagentStatus["outcome"])
          : undefined;
    const result: AsyncSubagentView = {
      agentId: child.id,
      name: child.name ?? child.id,
      state,
      runId: latest?.runId,
      outcome,
    };
    if (includeResponse && state === "idle" && latest) {
      result.response = (await this.ports.completion(latest)).response;
    }
    return result;
  }

  private children(leadId: string): AgentRecord[] {
    return this.ports
      .listAgents()
      .filter(
        (agent) =>
          agent.parentAgentId === leadId &&
          agent.orchestrationPolicy?.preset === "developer",
      );
  }

  private requireTarget(leadId: string, target: string): AgentRecord {
    if (target.startsWith("agent_")) return this.requireChild(leadId, target);
    return this.requireNamedChild(leadId, target);
  }

  private requireNamedChild(leadId: string, name: string): AgentRecord {
    const child = this.children(leadId).find(
      (candidate) =>
        candidate.name?.toLowerCase() === name.trim().toLowerCase(),
    );
    if (!child)
      throw new ApplicationError(
        404,
        "SUBAGENT_NOT_FOUND",
        "Teammate not found for this lead.",
      );
    return child;
  }

  private requireChild(leadId: string, childId: string): AgentRecord {
    const child = this.ports.getAgent(childId);
    if (child.parentAgentId !== leadId)
      throw new ApplicationError(
        404,
        "SUBAGENT_NOT_FOUND",
        "Teammate not found for this lead.",
      );
    return child;
  }

  private async requireLead(id: string): Promise<AgentRecord> {
    return this.ports.getAgent(id);
  }

  private async assertCapacity(leadId: string): Promise<void> {
    const active = await Promise.all(
      this.ports
        .listAgents()
        .filter((child) => child.parentAgentId === leadId)
        .map(
          async (child) =>
            Boolean(await this.ports.activeRun(child)) ||
            Boolean((await this.ports.readControl(child.id)).reservedRunId),
        ),
    );
    if (
      active.filter(Boolean).length >=
      (this.ports.getAgent(leadId).budget?.maxConcurrentChildren ??
        MAX_ACTIVE_CHILDREN)
    )
      throw new ApplicationError(
        409,
        "SUBAGENT_CAPACITY",
        `Parent concurrency budget (${this.ports.getAgent(leadId).budget?.maxConcurrentChildren ?? MAX_ACTIVE_CHILDREN}) is occupied; input remains pending.`,
      );
  }

  private async exclusive<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}
