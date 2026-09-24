import { createId } from "@nervekit/contracts";
import {
  asyncSubagentNameSchema,
  type AgentRecord,
  type AsyncSubagentControl,
  type AsyncSubagentListDetails,
  type AsyncSubagentPromptDetails,
  type AsyncSubagentStatus,
  type AsyncSubagentView,
  type CreateAgentRequest,
} from "@nervekit/contracts/agents";
import type { RunRecord } from "@nervekit/contracts/runs";
import type { ModelSelection } from "@nervekit/contracts/models";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import { ApplicationError } from "../../core/application-error.js";

export interface AsyncSubagentPorts {
  getAgent(id: string): AgentRecord;
  listAgents(): AgentRecord[];
  createAgent(
    request: CreateAgentRequest,
    authorized: boolean,
  ): Promise<AgentRecord>;
  enabled(lead: AgentRecord): Promise<boolean>;
  configuredModel(lead: AgentRecord): Promise<ModelSelection | undefined>;
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
  start(agent: AgentRecord, runId: string, prompt?: string): Promise<RunRecord>;
  cancel(agent: AgentRecord): Promise<void>;
  activeTaskCount(agent: AgentRecord): number;
  entries(agent: AgentRecord): Promise<ConversationEntry[]>;
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
  ): Promise<AsyncSubagentView> {
    return this.exclusive(leadId, async () => {
      const lead = await this.requireLead(leadId);
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
      const child = await this.ports.createAgent(
        {
          conversationId: lead.conversationId,
          projectId: lead.projectId,
          projectDir: lead.projectDir,
          parentAgentId: lead.id,
          executionKind: "async_developer",
          name: parsedName,
          mode: "coding",
          permissionLevel: "autonomous",
          permissionRuleSetId: "autonomous",
          workspaceScope: { roots: [...lead.workspaceScope.roots] },
          model: (await this.ports.configuredModel(lead)) ?? lead.model,
          thinkingLevel: lead.thinkingLevel,
        },
        authorized,
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
  ): Promise<AsyncSubagentPromptDetails> {
    if (!prompt.trim())
      throw new ApplicationError(
        400,
        "SUBAGENT_PROMPT_EMPTY",
        "A prompt is required.",
      );
    return this.exclusive(leadId, async () => {
      await this.requireLead(leadId);
      const child = this.requireNamedChild(leadId, name);
      const control = await this.ports.readControl(child.id);
      await this.assertIdle(child, control);
      const team = await this.ports.readControl(leadId);
      if (team.stopped)
        throw new ApplicationError(
          409,
          "SUBAGENT_TEAM_STOPPED",
          "The team is stopped. A new user prompt must reopen it.",
        );
      await this.assertCapacity(leadId);
      const run = await this.admit(
        child,
        { ...control, stopped: false },
        prompt,
      );
      return {
        agentId: child.id,
        name: child.name!,
        runId: run.runId,
        accepted: true,
      };
    });
  }

  async wake(childId: string): Promise<void> {
    const child = this.ports.getAgent(childId);
    if (child.executionKind !== "async_developer" || !child.parentAgentId)
      return;
    await this.exclusive(child.parentAgentId, async () => {
      const lead = this.ports.getAgent(child.parentAgentId!);
      const team = await this.ports.readControl(lead.id);
      const control = await this.ports.readControl(childId);
      if (
        team.stopped ||
        control.stopped ||
        control.stopping ||
        !(await this.ports.enabled(lead))
      )
        return;
      if (await this.ports.activeRun(child)) return;
      await this.assertCapacity(lead.id);
      await this.admit(child, control);
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
      return this.inspect(this.requireNamedChild(leadId, name), true);
    });
  }

  async stop(leadId: string, name: string): Promise<AsyncSubagentView> {
    const child = await this.exclusive(leadId, async () => {
      await this.requireLead(leadId);
      return this.requireNamedChild(leadId, name);
    });
    await this.stopChild(leadId, child.id);
    return this.inspect(child, false);
  }

  async stopTeam(leadId: string): Promise<void> {
    await this.exclusive(leadId, async () => {
      if (
        this.children(leadId).length === 0 &&
        !(await this.ports.enabled(this.ports.getAgent(leadId)))
      )
        return;
      const team = await this.ports.readControl(leadId);
      if (!team.stopped)
        await this.ports.writeControl({
          ...team,
          stopped: true,
          generation: team.generation + 1,
        });
    });
    await Promise.all(
      this.children(leadId).map((child) => this.stopChild(leadId, child.id)),
    );
  }

  async settleTeam(leadId: string): Promise<void> {
    await Promise.all(
      this.children(leadId).map((child) => this.stopChild(leadId, child.id)),
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
        generation: control.generation + 1,
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
      .filter((agent) => agent.executionKind === "async_developer")) {
      const leadId = child.parentAgentId!;
      await this.exclusive(leadId, async () => {
        const control = await this.ports.readControl(child.id);
        const active = await this.ports.activeRun(child);
        if (
          !active &&
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
      const lead = this.ports.getAgent(leadId);
      if (
        !(await this.ports.enabled(lead)) &&
        !(await this.ports.readControl(leadId)).stopped
      )
        await this.stopTeam(leadId);
    }
  }

  private async admit(
    child: AgentRecord,
    control: AsyncSubagentControl,
    prompt?: string,
  ): Promise<RunRecord> {
    const runId = createId("run");
    const team = await this.ports.readControl(child.parentAgentId!);
    await this.ports.reserveAssignment({
      runId,
      childId: child.id,
      leadId: child.parentAgentId!,
      generation: team.generation,
      childGeneration: control.generation,
    });
    await this.ports.writeControl({ ...control, reservedRunId: runId });
    try {
      const run = await this.ports.start(child, runId, prompt);
      await this.ports.writeControl({ ...control, reservedRunId: undefined });
      return run;
    } catch (error) {
      // The canonical active run, if committed, still prevents another admission.
      await this.ports.writeControl({ ...control, reservedRunId: undefined });
      throw error;
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
      name: child.name!,
      state,
      runId: latest?.runId,
      outcome,
    };
    if (includeResponse && state === "idle") {
      const entry = (await this.ports.entries(child))
        .filter(
          (entry) =>
            entry.agentId === child.id &&
            entry.role === "assistant" &&
            entry.runId,
        )
        .at(-1);
      if (entry?.runId)
        result.response = {
          entryId: entry.id,
          runId: entry.runId,
          text: entry.text ?? "",
          complete:
            entry.runId === latest?.runId && latest.status === "completed",
        };
    }
    return result;
  }

  private children(leadId: string): AgentRecord[] {
    return this.ports
      .listAgents()
      .filter(
        (agent) =>
          agent.parentAgentId === leadId &&
          agent.executionKind === "async_developer",
      );
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
    if (
      child.parentAgentId !== leadId ||
      child.executionKind !== "async_developer"
    )
      throw new ApplicationError(
        404,
        "SUBAGENT_NOT_FOUND",
        "Teammate not found for this lead.",
      );
    return child;
  }

  private async requireLead(id: string): Promise<AgentRecord> {
    const lead = this.ports.getAgent(id);
    if (
      lead.parentAgentId ||
      lead.mode !== "coding" ||
      lead.permissionLevel === "read_only" ||
      !(await this.ports.enabled(lead))
    )
      throw new ApplicationError(
        403,
        "SUBAGENTS_UNAVAILABLE",
        "Async developer teammates are unavailable for this agent.",
      );
    return lead;
  }

  private async assertIdle(
    child: AgentRecord,
    control: AsyncSubagentControl,
  ): Promise<void> {
    if (
      control.stopping ||
      control.reservedRunId ||
      (await this.ports.activeRun(child))
    )
      throw new ApplicationError(
        409,
        "SUBAGENT_BUSY",
        "Teammate is running or stopping; no prompt was queued.",
      );
  }

  private async assertCapacity(leadId: string): Promise<void> {
    const active = await Promise.all(
      this.children(leadId).map(
        async (child) =>
          Boolean(await this.ports.activeRun(child)) ||
          Boolean((await this.ports.readControl(child.id)).reservedRunId),
      ),
    );
    if (active.filter(Boolean).length >= MAX_ACTIVE_CHILDREN)
      throw new ApplicationError(
        409,
        "SUBAGENT_CAPACITY",
        "At most four developer teammates may execute concurrently.",
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
