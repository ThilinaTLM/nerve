import type {
  AgentActivitySnapshot,
  AgentAsyncObligation,
  ConversationActivitySnapshot,
} from "@nervekit/contracts/agents";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type { RunRecord } from "@nervekit/contracts/runs";
import {
  ACTIVE_STATUSES,
  type RunHydratedState,
} from "../runs/runtime/index.js";

const ACTIVE_OBLIGATION_STATES = new Set<AgentAsyncObligation["state"]>([
  "pending",
  "ready",
  "delivered",
]);

export interface AgentActivityServicePorts {
  listAgents(): readonly AgentRecord[];
  listConversations(): readonly ConversationRecord[];
  listActiveRuns(): Promise<readonly RunHydratedState[]>;
  listRunMetadata(): Promise<readonly RunRecord[]>;
  listObligations(): Promise<readonly AgentAsyncObligation[]>;
}

export interface WorkspaceActivitySnapshots {
  agentActivities: AgentActivitySnapshot[];
  conversationActivities: ConversationActivitySnapshot[];
}

/** Rebuildable projection over canonical run, interaction, and obligation state. */
export class AgentActivityService {
  constructor(private readonly ports: AgentActivityServicePorts) {}

  async activityForAgent(agentId: string): Promise<AgentActivitySnapshot> {
    const snapshots = await this.workspaceActivity();
    const snapshot = snapshots.agentActivities.find(
      (candidate) => candidate.agentId === agentId,
    );
    if (!snapshot) throw new Error(`Unknown agent '${agentId}'.`);
    return snapshot;
  }

  async activityForConversation(
    conversationId: string,
  ): Promise<ConversationActivitySnapshot> {
    const snapshots = await this.workspaceActivity();
    const snapshot = snapshots.conversationActivities.find(
      (candidate) => candidate.conversationId === conversationId,
    );
    if (!snapshot) throw new Error(`Unknown conversation '${conversationId}'.`);
    return snapshot;
  }

  async workspaceActivity(): Promise<WorkspaceActivitySnapshots> {
    const agents = this.ports.listAgents();
    const conversations = this.ports.listConversations();
    const [activeRuns, runMetadata, obligations] = await Promise.all([
      this.ports.listActiveRuns(),
      this.ports.listRunMetadata(),
      this.ports.listObligations(),
    ]);
    const activeByAgent = new Map(
      activeRuns.map((state) => [state.run.agentId, state] as const),
    );
    const latestByAgent = latestRunsByAgent(runMetadata);
    const obligationsByAgent = groupActiveObligations(obligations);
    const conversationById = new Map(
      conversations.map((conversation) => [conversation.id, conversation]),
    );

    const agentActivities = agents.map((agent) =>
      projectAgentActivity({
        agent,
        conversation: conversationById.get(agent.conversationId),
        active: activeByAgent.get(agent.id),
        latest: latestByAgent.get(agent.id),
        obligations: obligationsByAgent.get(agent.id) ?? [],
      }),
    );
    const activityByAgent = new Map(
      agentActivities.map((activity) => [activity.agentId, activity] as const),
    );
    const conversationActivities = conversations.map((conversation) =>
      projectConversationActivity(
        conversation,
        agents
          .filter((agent) => agent.conversationId === conversation.id)
          .map((agent) => activityByAgent.get(agent.id)!)
          .filter(Boolean),
      ),
    );
    return { agentActivities, conversationActivities };
  }
}

function latestRunsByAgent(runs: readonly RunRecord[]): Map<string, RunRecord> {
  const result = new Map<string, RunRecord>();
  for (const run of runs) {
    const current = result.get(run.agentId);
    if (
      !current ||
      run.updatedAt.localeCompare(current.updatedAt) > 0 ||
      (run.updatedAt === current.updatedAt && run.runId > current.runId)
    ) {
      result.set(run.agentId, run);
    }
  }
  return result;
}

function groupActiveObligations(
  obligations: readonly AgentAsyncObligation[],
): Map<string, AgentAsyncObligation[]> {
  const result = new Map<string, AgentAsyncObligation[]>();
  for (const obligation of obligations) {
    if (!ACTIVE_OBLIGATION_STATES.has(obligation.state)) continue;
    const values = result.get(obligation.ownerAgentId) ?? [];
    values.push(obligation);
    result.set(obligation.ownerAgentId, values);
  }
  return result;
}

function projectAgentActivity(input: {
  agent: AgentRecord;
  conversation?: ConversationRecord;
  active?: RunHydratedState;
  latest?: RunRecord;
  obligations: readonly AgentAsyncObligation[];
}): AgentActivitySnapshot {
  const { agent, conversation, active, latest, obligations } = input;
  const pendingInteractionCount =
    active?.interactions.filter(
      (interaction) => interaction.status === "pending",
    ).length ?? 0;
  const pendingAsyncCount = obligations.length;
  const clearedAt = conversation?.runtimeStatusClearedAt;
  const latestIsUncleared =
    latest !== undefined &&
    (!clearedAt || latest.updatedAt.localeCompare(clearedAt) > 0);
  const failureIsUncleared =
    latestIsUncleared &&
    Boolean(latest.failure) &&
    ["failed", "interrupted", "cancellation_failed"].includes(latest.status);

  let state: AgentActivitySnapshot["state"];
  if (failureIsUncleared) state = "error";
  else if (active && pendingInteractionCount > 0) state = "awaiting_user";
  else if (active?.run.status === "waiting") state = "error";
  else if (active && ACTIVE_STATUSES.has(active.run.status)) state = "running";
  else if (pendingAsyncCount > 0) state = "awaiting_async";
  else if (latestIsUncleared && latest.status === "cancelled")
    state = "aborted";
  else state = "idle";

  const updatedAt = latestTimestamp([
    agent.updatedAt,
    conversation?.updatedAt,
    // Metadata actions intentionally do not reorder conversations by updating
    // ConversationRecord.updatedAt. The clear marker still has to advance the
    // activity projection so clients accept the idle replacement.
    clearedAt,
    active?.run.updatedAt,
    latest?.updatedAt,
    ...obligations.map((obligation) => obligation.updatedAt),
  ]);
  return {
    agentId: agent.id,
    conversationId: agent.conversationId,
    state,
    ...(active ? { activeRunId: active.run.runId } : {}),
    pendingInteractionCount,
    pendingAsyncCount,
    updatedAt,
  };
}

function projectConversationActivity(
  conversation: ConversationRecord,
  activities: readonly AgentActivitySnapshot[],
): ConversationActivitySnapshot {
  const active = conversation.activeAgentId
    ? activities.find(
        (activity) => activity.agentId === conversation.activeAgentId,
      )
    : undefined;
  const selected = active ?? highestPrecedenceActivity(activities);
  const projectedState = selected?.state ?? "idle";
  const state =
    conversation.completedAt && projectedState === "idle"
      ? "completed"
      : projectedState;
  return {
    conversationId: conversation.id,
    ...(conversation.activeAgentId
      ? { activeAgentId: conversation.activeAgentId }
      : {}),
    state,
    pendingInteractionCount: activities.reduce(
      (total, activity) => total + activity.pendingInteractionCount,
      0,
    ),
    pendingAsyncCount: activities.reduce(
      (total, activity) => total + activity.pendingAsyncCount,
      0,
    ),
    updatedAt: latestTimestamp([
      conversation.updatedAt,
      ...activities.map((activity) => activity.updatedAt),
    ]),
  };
}

const ACTIVITY_PRECEDENCE: Record<AgentActivitySnapshot["state"], number> = {
  error: 6,
  awaiting_user: 5,
  running: 4,
  awaiting_async: 3,
  aborted: 2,
  idle: 1,
};

function highestPrecedenceActivity(
  activities: readonly AgentActivitySnapshot[],
): AgentActivitySnapshot | undefined {
  return [...activities].sort(
    (left, right) =>
      ACTIVITY_PRECEDENCE[right.state] - ACTIVITY_PRECEDENCE[left.state] ||
      right.updatedAt.localeCompare(left.updatedAt),
  )[0];
}

function latestTimestamp(values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)!;
}
