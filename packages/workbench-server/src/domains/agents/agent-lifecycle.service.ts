import { resolve } from "node:path";
import {
  resolveAgentBlueprint,
  agentConfigurationActorSchema,
  agentConfigurationAcceptanceSchema,
  type AgentConfigurationActor,
  type AgentConfigurationAcceptance,
  agentParentGrantsSchema,
  updateAgentRequestSchema,
  type ParentConfigurationSnapshot,
  type AgentRecord,
  type CreateAgentRequest,
  type UpdateAgentRequest,
} from "@nervekit/contracts/agents";
import { createId } from "@nervekit/contracts";
import { type Mode } from "@nervekit/contracts/settings";
import { ApplicationError } from "../../core/application-error.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeQueryCache } from "../../infrastructure/persistence/query-cache/index.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import { resolveProjectSettings } from "../../infrastructure/configuration/index.js";
import type { RuntimeState } from "../../app/runtime/runtime-projections.js";
import type { ConversationService } from "../conversations/conversation-service.js";
import type { AgentRepository } from "./agent.repository.js";
import {
  assertAgentConfigurationAuthority,
  assertAgentWorkspaceAuthority,
  assertChildAuthority,
  resolveDelegatingParent,
  assertLiveParentDelegation,
  assertDelegatedRuleSelection,
} from "./agent-authority.js";
import { agentBudget } from "./agent-budget.js";

export class AgentLifecycleService {
  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: StreamLogRegistry,
    private readonly queryCache: RuntimeQueryCache,
    private readonly state: RuntimeState,
    private readonly agentRepository: AgentRepository,
    private readonly conversationService: ConversationService,
    private readonly updateConversation: (
      conversation: ReturnType<RuntimeState["getConversation"]>,
    ) => Promise<void>,
    private readonly abortAgent: (agentId: string) => Promise<void>,
    private readonly activeRunId: (
      agent: AgentRecord,
    ) => Promise<string | undefined>,
    _updateLiveAgent: (runId: string, agent: AgentRecord) => Promise<void>,
  ) {
    // Accepted settings are adopted only by the common next-turn preparation hook.
    void _updateLiveAgent;
  }

  async createAgent(
    request: CreateAgentRequest,
    options: {
      allowChildAuthorityExceed?: boolean;
      allowAsyncDeveloper?: boolean;
      id?: string;
      parentConfigurationSnapshot?: ParentConfigurationSnapshot;
    } = {},
  ): Promise<AgentRecord> {
    this.state.maintenanceScopes.assertConversation(request.conversationId);
    this.state.maintenanceScopes.assertProject(request.projectId);
    const conversation = this.state.getConversation(request.conversationId);
    const project = this.state.getProject(request.projectId);
    if (options.id) {
      const existing = this.state.agents.get(options.id);
      if (
        existing &&
        existing.conversationId === request.conversationId &&
        existing.projectId === request.projectId
      ) {
        return existing;
      }
      if (existing) throw new Error(`Agent identity conflict: ${options.id}`);
    }
    const liveParent = request.parentAgentId
      ? this.state.agents.get(request.parentAgentId)
      : undefined;
    if (request.parentAgentId && !liveParent)
      throw new ApplicationError(
        404,
        "PARENT_AGENT_NOT_FOUND",
        "Parent agent not found.",
      );

    const parent = resolveDelegatingParent(
      liveParent,
      options.parentConfigurationSnapshot,
    );

    const now = new Date().toISOString();
    const id = options.id ?? createId("agent");
    const projectDir = resolve(
      parent?.projectDir ?? project.dir,
      request.projectDir ?? ".",
    );
    const effectiveSettings = await resolveProjectSettings(
      this.storage,
      projectDir,
    );
    const defaultSelection = effectiveSettings.rememberLastAgentSelection
      ? effectiveSettings.lastAgentSelection
      : {
          mode: "coding" as const,
          permissionLevel: effectiveSettings.defaultPermissionLevel,
          permissionRuleSetId:
            effectiveSettings.defaultPermissionRuleSetId ??
            effectiveSettings.defaultPermissionLevel,
          model: effectiveSettings.defaultModel,
          thinkingLevel: effectiveSettings.defaultThinkingLevel,
        };
    const mode = request.mode ?? (parent ? parent.mode : conversation.mode);
    const permissionLevel =
      request.permissionLevel ??
      (parent ? parent.permissionLevel : conversation.permissionLevel);
    const model = parent
      ? (request.model ?? parent.model)
      : (request.model ?? defaultSelection.model);
    const thinkingLevel = parent
      ? (request.thinkingLevel ?? parent.thinkingLevel)
      : (request.thinkingLevel ?? defaultSelection.thinkingLevel);
    if (parent) {
      assertChildAuthority(
        parent,
        mode,
        permissionLevel,
        Boolean(options.allowChildAuthorityExceed),
      );
    }
    let agent: AgentRecord = resolveAgentBlueprint({
      id,
      conversationId: conversation.id,
      projectId: project.id,
      projectDir,
      parentAgentId: request.parentAgentId,
      executionKind: request.executionKind,
      name: request.name,
      rootAgentId: parent?.rootAgentId ?? id,
      mode,
      permissionLevel,
      permissionRuleSetId:
        request.permissionRuleSetId ??
        request.permissionLevel ??
        (parent
          ? (parent.permissionRuleSetId ?? permissionLevel)
          : (defaultSelection.permissionRuleSetId ?? permissionLevel)),
      workspaceScope: request.workspaceScope
        ? {
            ...request.workspaceScope,
            roots: request.workspaceScope.roots.map((root) =>
              resolve(projectDir, root),
            ),
          }
        : parent
          ? {
              ...parent.workspaceScope,
              roots: [...parent.workspaceScope.roots],
            }
          : { roots: [projectDir] },
      systemPrompt: request.systemPrompt,
      task: request.task,
      budget: {
        ...agentBudget(parent, request.budget),
        maxConcurrentChildren:
          request.budget?.maxConcurrentChildren ??
          parent?.budget.maxConcurrentChildren ??
          4,
      },
      model,
      thinkingLevel: thinkingLevel ?? "off",
      instructions: request.instructions,
      tools: request.tools,
      skills: request.skills,
      // New records resolve current configuration, never legacy kind defaults.
      // The blueprint helper retains kind decoding for historical records only.
      orchestrationPolicy: request.orchestrationPolicy ?? {
        preset: "standard",
        parentCancellation: "independent",
        completionReporting: "none",
      },
      readOnlyCeiling: request.readOnlyCeiling,
      parentGrants: request.parentGrants
        ? agentParentGrantsSchema.parse(request.parentGrants)
        : undefined,
      createdAt: now,
      updatedAt: now,
    });
    if (
      parent &&
      (agent.budget.maxDepth > parent.budget.maxDepth ||
        (agent.budget.maxConcurrentChildren ?? 4) >
          (parent.budget.maxConcurrentChildren ?? 4))
    ) {
      throw new ApplicationError(
        403,
        "SUBAGENT_BUDGET_EXCEEDED",
        "Delegated child budgets cannot exceed parent budgets.",
      );
    }
    if (liveParent && options.parentConfigurationSnapshot)
      assertLiveParentDelegation(liveParent, agent);
    assertAgentConfigurationAuthority(agent, agent);
    if (parent && !options.allowChildAuthorityExceed) {
      assertDelegatedRuleSelection(
        parent,
        agent.permissionRuleSetId ?? agent.permissionLevel,
      );
      assertAgentWorkspaceAuthority(parent, agent);
    }
    this.state.maintenanceScopes.assertConversation(request.conversationId);
    this.state.maintenanceScopes.assertProject(request.projectId);
    agent = await this.agentRepository.bindContextOwner(agent);
    await this.writeAgent(agent);
    this.state.agents.set(agent.id, agent);
    this.queryCache.upsertAgent(agent);
    if (!parent) {
      await this.updateConversation({
        ...conversation,
        activeAgentId: agent.id,
        updatedAt: now,
      });
    }
    await this.events.publish("agent.created", { agent, task: request.task });
    return agent;
  }

  listAgents(): AgentRecord[] {
    return this.state.listAgents();
  }

  getAgent(agentId: string): AgentRecord {
    return this.state.getAgent(agentId);
  }

  async removeAgentInternal(agentId: string): Promise<void> {
    if (!this.state.agents.has(agentId)) return;
    const agent = this.state.agents.get(agentId);
    if (agent && (!agent.parentAgentId || (await this.activeRunId(agent))))
      await this.abortAgent(agentId);
    for (const child of [...this.state.agents.values()].filter(
      (candidate) => candidate.parentAgentId === agentId,
    )) {
      await this.removeAgentInternal(child.id);
    }
    await this.storage.canonicalStore.deleteDocument(
      "async-subagent-control",
      "global",
      agentId,
    );
    for (const assignment of await this.storage.canonicalStore.listDocuments(
      "async-subagent-assignment",
      agentId,
    )) {
      await this.storage.canonicalStore.deleteDocument(
        "async-subagent-assignment",
        agentId,
        assignment.documentId,
      );
    }
    this.state.agents.delete(agentId);
    this.conversationService.deleteAgent(agentId);
    this.queryCache.removeAgent(agentId);
    await this.agentRepository.remove(agentId);
  }

  async configureAgent(
    agentId: string,
    request: UpdateAgentRequest,
    options: {
      parentAgentId?: string;
      parentConfigurationSnapshot?: ParentConfigurationSnapshot;
      /** Trusted caller context, not request payload. Unspecified means internal system. */
      actor?: AgentConfigurationActor;
      onConfigurationAccepted?: (
        acceptance: AgentConfigurationAcceptance,
      ) => Promise<void>;
    } = {},
  ): Promise<AgentRecord> {
    const actor = agentConfigurationActorSchema.parse(
      options.actor ?? { kind: "system", producer: "agent_lifecycle" },
    );
    if (
      (actor.kind === "parent" && actor.agentId !== options.parentAgentId) ||
      (actor.kind === "user" && options.parentAgentId !== undefined) ||
      (actor.kind === "self" &&
        (actor.agentId !== agentId || options.parentAgentId !== undefined))
    )
      throw new ApplicationError(
        403,
        "AGENT_CONFIGURATION_ACTOR_INVALID",
        "Configuration actor must match the trusted authorization context.",
      );
    const result = await this.serializeConfiguration(agentId, async () => {
      const agent = resolveAgentBlueprint(this.getAgent(agentId));
      const parsed = updateAgentRequestSchema.parse(request);
      const projectDir =
        parsed.projectDir === undefined
          ? agent.projectDir
          : resolve(agent.projectDir, parsed.projectDir);
      if (parsed.workspaceScope)
        parsed.workspaceScope = {
          ...parsed.workspaceScope,
          roots: parsed.workspaceScope.roots.map((root) =>
            resolve(projectDir, root),
          ),
        };
      let updated: AgentRecord = {
        ...agent,
        ...parsed,
        projectDir,
        model:
          parsed.model === null ? undefined : (parsed.model ?? agent.model),
        systemPrompt:
          parsed.systemPrompt === null
            ? undefined
            : (parsed.systemPrompt ?? agent.systemPrompt),
        permissionRuleSetId:
          parsed.permissionRuleSetId ??
          parsed.permissionLevel ??
          agent.permissionRuleSetId,
        configurationRevision: (agent.configurationRevision ?? 1) + 1,
        updatedAt: new Date().toISOString(),
      };
      const liveParent = options.parentAgentId
        ? this.getAgent(options.parentAgentId)
        : undefined;
      const parent = resolveDelegatingParent(
        liveParent,
        options.parentConfigurationSnapshot,
      );
      assertAgentConfigurationAuthority(agent, updated, parent);
      if (liveParent) assertLiveParentDelegation(liveParent, updated);
      const acceptance = agentConfigurationAcceptanceSchema.parse({
        agentId: agent.id,
        conversationId: agent.conversationId,
        parentAgentId: agent.parentAgentId,
        configurationRevision: updated.configurationRevision,
        actor,
        acceptedAt: updated.updatedAt,
      });
      updated = resolveAgentBlueprint({
        ...updated,
        configurationAcceptances: [
          ...(agent.configurationAcceptances ?? []),
          acceptance,
        ],
      });
      // Settings and exact provenance are ONE canonical document commit.
      await this.updateAgent(updated);
      await this.events.publish("agent.configured", { agent: updated });
      return { agent: updated, acceptance };
    });
    try {
      // Observer registration is outside the configuration fence and is not the
      // acceptance authority. Durable receipts recover an initial observer failure.
      await options.onConfigurationAccepted?.(
        agentConfigurationAcceptanceSchema.parse(result.acceptance),
      );
    } catch {
      // Producer owns diagnostics/retry; never report committed configuration rejected.
    }
    return result.agent;
  }

  listConfigurationAcceptances(
    agentId?: string,
  ): Promise<AgentConfigurationAcceptance[]> {
    return this.agentRepository.listConfigurationAcceptances(agentId);
  }

  private readonly configurationWrites = new Map<string, Promise<unknown>>();

  private async serializeConfiguration<T>(
    agentId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.configurationWrites.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.configurationWrites.set(agentId, next);
    try {
      return await next;
    } finally {
      if (this.configurationWrites.get(agentId) === next)
        this.configurationWrites.delete(agentId);
    }
  }

  async setEffectiveConfigurationRevision(
    agentId: string,
    revision: number,
  ): Promise<AgentRecord> {
    return this.serializeConfiguration(agentId, async () => {
      const current = resolveAgentBlueprint(this.getAgent(agentId));
      if (
        !Number.isSafeInteger(revision) ||
        revision < (current.effectiveConfigurationRevision ?? 0) ||
        revision > (current.configurationRevision ?? 1)
      ) {
        throw new ApplicationError(
          409,
          "AGENT_CONFIGURATION_REVISION_CONFLICT",
          "Effective revision must be an accepted, non-regressing configuration revision.",
        );
      }
      const agent = {
        ...current,
        effectiveConfigurationRevision: revision,
        updatedAt: new Date().toISOString(),
      };
      await this.updateAgent(agent);
      await this.events.publish("agent.configured", { agent });
      return agent;
    });
  }

  async setActivationState(
    agentId: string,
    activationState: "enabled" | "paused",
  ): Promise<AgentRecord> {
    return this.serializeConfiguration(agentId, async () => {
      const agent = {
        ...resolveAgentBlueprint(this.getAgent(agentId)),
        activationState,
        updatedAt: new Date().toISOString(),
      };
      await this.updateAgent(agent);
      await this.events.publish("agent.configured", { agent });
      return agent;
    });
  }

  async setAgentModeInternal(
    agentId: string,
    mode: Mode,
    reason: string,
  ): Promise<AgentRecord> {
    const agent = this.getAgent(agentId);
    const updated = await this.configureAgent(agentId, { mode });
    await this.events.publish("agent.mode_changed", {
      agent: updated,
      previousMode: agent.mode,
      mode,
      reason,
    });
    return updated;
  }

  async updateAgent(agent: AgentRecord): Promise<void> {
    await this.writeAgent(agent);
    this.state.agents.set(agent.id, agent);
    this.queryCache.upsertAgent(agent);
  }

  async loadAgents(): Promise<void> {
    for (const agent of await this.agentRepository.loadAll()) {
      this.state.agents.set(agent.id, agent);
      this.queryCache.upsertAgent(agent);
    }
    await this.repairActiveAgentReferences();
  }

  private async repairActiveAgentReferences(): Promise<void> {
    for (const conversation of this.state.conversations.values()) {
      if (!conversation.activeAgentId) continue;
      const active = this.state.agents.get(conversation.activeAgentId);
      if (
        active &&
        !active.parentAgentId &&
        active.conversationId === conversation.id
      ) {
        continue;
      }

      const root = active?.parentAgentId
        ? this.state.agents.get(active.rootAgentId)
        : undefined;
      const repairedAgent =
        root && !root.parentAgentId && root.conversationId === conversation.id
          ? root
          : [...this.state.agents.values()]
              .filter(
                (agent) =>
                  agent.conversationId === conversation.id &&
                  !agent.parentAgentId,
              )
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      await this.updateConversation({
        ...conversation,
        activeAgentId: repairedAgent?.id,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async writeAgent(agent: AgentRecord): Promise<void> {
    await this.agentRepository.write(agent);
  }
}
