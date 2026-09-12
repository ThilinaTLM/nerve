import type {
  ExecutionAttempt,
  LifecycleInteraction,
  LifecycleWork,
  RecoveryIssue,
  RunActivityView,
  RunLifecycleRecord,
  ToolProposal,
} from "@nervekit/contracts/runs";

export interface RunLifecycleAggregate {
  run: RunLifecycleRecord;
  proposals: readonly ToolProposal[];
  interactions: readonly LifecycleInteraction[];
  attempts: readonly ExecutionAttempt[];
  work: readonly LifecycleWork[];
  recoveryIssues: readonly RecoveryIssue[];
}

export function assertRunLifecycleInvariants(
  aggregate: RunLifecycleAggregate,
): void {
  const proposalIds = new Set(aggregate.proposals.map((item) => item.id));
  const interactionIds = new Set<string>();
  const activeAttempts = new Map<string, number>();
  const activeWorkKeys = new Set<string>();

  for (const interaction of aggregate.interactions) {
    if (interactionIds.has(interaction.id)) {
      throw new Error(`Duplicate lifecycle interaction ${interaction.id}.`);
    }
    interactionIds.add(interaction.id);
    if (!proposalIds.has(interaction.proposalId)) {
      throw new Error(
        `Interaction ${interaction.id} references an unknown proposal.`,
      );
    }
    if (interaction.runId !== aggregate.run.runId) {
      throw new Error(`Interaction ${interaction.id} belongs to another run.`);
    }
  }

  for (const attempt of aggregate.attempts) {
    if (!proposalIds.has(attempt.proposalId)) {
      throw new Error(`Attempt ${attempt.id} references an unknown proposal.`);
    }
    if (attempt.runId !== aggregate.run.runId) {
      throw new Error(`Attempt ${attempt.id} belongs to another run.`);
    }
    if (attempt.state === "ready" || attempt.state === "running") {
      activeAttempts.set(
        attempt.proposalId,
        (activeAttempts.get(attempt.proposalId) ?? 0) + 1,
      );
    }
  }
  for (const [proposalId, count] of activeAttempts) {
    if (count > 1) {
      throw new Error(`Proposal ${proposalId} has multiple active attempts.`);
    }
  }

  for (const item of aggregate.work) {
    if (item.conversationId !== aggregate.run.conversationId) {
      throw new Error(`Work ${item.id} belongs to another conversation.`);
    }
    if (item.runId && item.runId !== aggregate.run.runId) {
      throw new Error(`Work ${item.id} belongs to another run.`);
    }
    if (item.proposalId && !proposalIds.has(item.proposalId)) {
      throw new Error(`Work ${item.id} references an unknown proposal.`);
    }
    if (item.state === "ready" || item.state === "leased") {
      if (activeWorkKeys.has(item.deduplicationKey)) {
        throw new Error(
          `Multiple active work items use ${item.deduplicationKey}.`,
        );
      }
      activeWorkKeys.add(item.deduplicationKey);
    }
    if (item.state === "leased" && (!item.leaseOwner || !item.leaseDeadline)) {
      throw new Error(`Leased work ${item.id} has no complete lease.`);
    }
  }

  if (aggregate.run.state !== "open") {
    if (aggregate.interactions.some((item) => item.status === "pending")) {
      throw new Error("A terminal run cannot have pending interactions.");
    }
    if (
      aggregate.work.some(
        (item) =>
          item.kind === "continue_model" &&
          (item.state === "ready" || item.state === "leased"),
      )
    ) {
      throw new Error("A terminal run cannot have runnable continuation work.");
    }
  }
}

export function projectRunActivity(
  aggregate: RunLifecycleAggregate,
): RunActivityView {
  assertRunLifecycleInvariants(aggregate);
  const actionableInteractions = aggregate.interactions.filter(
    (item) => item.status === "pending",
  );
  const ready = aggregate.work.filter((item) => item.state === "ready");
  const leased = aggregate.work.filter((item) => item.state === "leased");
  const recoveryIssues = [...aggregate.recoveryIssues];
  let phase: RunActivityView["phase"] = "idle";
  if (recoveryIssues.length > 0) phase = "recovery_required";
  else if (actionableInteractions.length > 0) phase = "awaiting_input";
  else if (
    leased.some((item) => item.kind === "execute_tool") ||
    ready.some((item) => item.kind === "execute_tool")
  )
    phase = "executing_tools";
  else if (leased.some((item) => item.kind === "continue_model"))
    phase = "model_running";
  else if (ready.some((item) => item.kind === "continue_model"))
    phase = "continuation_ready";
  else if (
    ready.some((item) => item.kind === "reconcile_conversation") ||
    leased.some((item) => item.kind === "reconcile_conversation")
  )
    phase = "reconciling";

  return {
    runId: aggregate.run.runId,
    conversationId: aggregate.run.conversationId,
    revision: aggregate.run.revision,
    lifecycleState: aggregate.run.state,
    phase,
    actionableInteractions,
    recoveryIssues,
    readyWorkCount: ready.length,
    leasedWorkCount: leased.length,
  };
}
