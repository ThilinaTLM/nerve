import {
  agentCompletionSchema,
  effectiveTurnConfigurationSchema,
  type AgentCompletion,
} from "@nervekit/contracts/agents";
import type { RunHydratedState } from "../runs/runtime/run-unit-of-work.js";

export interface AgentCompletionPorts {
  loadRun(runId: string): Promise<RunHydratedState | undefined>;
  readSnapshot(
    agentId: string,
    runId: string,
    attemptId: string,
  ): Promise<AgentCompletion | undefined>;
  writeSnapshot(completion: AgentCompletion): Promise<void>;
}

/** Immutable run-owned records, never the agent's current branch or settings. */
export class AgentCompletionService {
  private tail = Promise.resolve();
  constructor(private readonly ports: AgentCompletionPorts) {}

  snapshot(
    agentId: string,
    runId: string,
    submittedAttemptId?: string,
  ): Promise<AgentCompletion> {
    const next = this.tail.then(() => this.capture(agentId, runId));
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next.then((completion) => {
      if (
        submittedAttemptId &&
        completion.submittedAttemptId &&
        submittedAttemptId !== completion.submittedAttemptId
      )
        throw new Error(
          "Completion does not belong to the submitted attempt of this run",
        );
      return completion;
    });
  }

  private async capture(
    agentId: string,
    runId: string,
  ): Promise<AgentCompletion> {
    const state = await this.ports.loadRun(runId);
    if (!state || state.run.agentId !== agentId)
      throw new Error("Completion source is not the submitted agent/run");
    const run = state.run;
    if (
      !["completed", "cancelled", "failed", "interrupted"].includes(run.status)
    )
      throw new Error("Completion source is not settled");
    const existing = await this.ports.readSnapshot(
      agentId,
      runId,
      run.executionId,
    );
    if (existing) {
      const snapshot = agentCompletionSchema.parse(existing);
      if (
        snapshot.agentId !== agentId ||
        snapshot.runId !== runId ||
        snapshot.attemptId !== run.executionId
      )
        throw new Error(
          "Stored completion identity does not match requested run/attempt",
        );
      return snapshot;
    }
    const allTransitions = [...state.transitions].sort(
      (a, b) => a.revision - b.revision,
    );
    const transitions = allTransitions.filter(
      (transition) => transition.run.executionId === run.executionId,
    );
    const runEntries = [
      ...new Map(
        allTransitions
          .flatMap((transition) => transition.entries)
          .filter((entry) => entry.agentId === agentId && entry.runId === runId)
          .map((entry) => [entry.id, entry]),
      ).values(),
    ];
    const entries = [
      ...new Map(
        transitions
          .flatMap((transition) => transition.entries)
          .filter((entry) => entry.agentId === agentId && entry.runId === runId)
          .map((entry) => [entry.id, entry]),
      ).values(),
    ];
    const assistants = runEntries.filter((entry) => entry.role === "assistant");
    const response = entries
      .filter((entry) => entry.role === "assistant")
      .at(-1);
    const usage = assistants.reduce(
      (sum, entry) => {
        if (entry.usage)
          for (const key of [
            "input",
            "output",
            "cacheRead",
            "cacheWrite",
            "totalTokens",
            "cost",
          ] as const)
            sum[key] += entry.usage[key];
        sum.turns++;
        return sum;
      },
      {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: 0,
        turns: 0,
      },
    );
    // The selected run's transitions are the durable effective-turn authority.
    // Completion must not enumerate agent histories to rediscover this evidence.
    const configurations = transitions
      .flatMap(
        (transition) => transition.execution?.effectiveTurnConfigurations ?? [],
      )
      .map((value) => effectiveTurnConfigurationSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data)
      .filter(
        (value) =>
          value.agentId === agentId &&
          value.runId === runId &&
          value.attemptId === run.executionId,
      );
    const effective =
      (response?.turnId
        ? configurations.find((value) => value.turnId === response.turnId)
        : undefined) ?? configurations.at(-1);
    const model =
      effective?.configurationProvenance === "resolved"
        ? effective.configuration.model
        : undefined;
    const outcome =
      run.failure?.code === "RUN_INTERRUPTED_NO_RESUME"
        ? "interrupted"
        : (run.status as AgentCompletion["outcome"]);
    const toolCalls = [
      ...new Map(
        allTransitions
          .flatMap((transition) => transition.toolCalls)
          .filter((call) => call.agentId === agentId && call.runId === runId)
          .map((call) => [call.id, call]),
      ).values(),
    ];
    const steps = [
      ...toolCalls.map((call) => ({
        type: "tool_call" as const,
        toolName: call.toolName,
        message: call.toolName,
        timestamp: call.createdAt,
      })),
      ...runEntries
        .filter(
          (entry) => entry.role === "assistant" || entry.kind === "tool_result",
        )
        .map((entry) => ({
          type:
            entry.role === "assistant"
              ? ("assistant" as const)
              : ("tool_result" as const),
          message: entry.text.slice(0, 2_048),
          timestamp: entry.createdAt,
          toolName: (entry.details as { toolName?: string } | undefined)
            ?.toolName,
        })),
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const completion = agentCompletionSchema.parse({
      agentId,
      runId,
      attemptId: run.executionId,
      submittedAttemptId:
        [...state.transitions].sort((a, b) => a.revision - b.revision).at(0)
          ?.run.executionId ?? run.executionId,
      outcome,
      completedAt: run.terminalAt ?? run.updatedAt,
      response: response
        ? {
            entryId: response.id,
            runId,
            text: response.text,
            complete: outcome === "completed",
          }
        : undefined,
      usage: assistants.length ? usage : undefined,
      model: model ? `${model.provider}/${model.modelId}` : undefined,
      modelSelection: model,
      thinkingLevel:
        effective?.configurationProvenance === "resolved"
          ? effective.configuration.thinkingLevel
          : undefined,
      stopReason:
        (response?.details as { stopReason?: string } | undefined)
          ?.stopReason ??
        (run.failure?.code
          ? `error (${run.failure.code})`
          : outcome === "completed"
            ? "stop"
            : outcome === "cancelled"
              ? "aborted"
              : "error"),
      steps,
    });
    await this.ports.writeSnapshot(completion);
    return completion;
  }
}
