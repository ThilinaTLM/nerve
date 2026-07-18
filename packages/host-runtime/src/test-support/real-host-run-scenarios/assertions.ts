import type { RunHydratedState } from "../../run-unit-of-work.js";
import type {
  NormalizedHostRunSnapshot,
  RealHostEventObservation,
} from "./fixture.js";

export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

export function requireState(
  state: RunHydratedState | undefined,
  runId: string,
): RunHydratedState {
  invariant(state, `Run ${runId} was not durably stored`);
  return state;
}

export function assertStatus(state: RunHydratedState, expected: string): void {
  invariant(
    state.run.status === expected,
    `Expected ${state.run.runId} to be ${expected}, got ${state.run.status}: ${state.run.failure?.message ?? ""}`,
  );
}

export function assertSingleTerminal(state: RunHydratedState): void {
  const terminal = state.transitions.filter((transition) =>
    ["completed", "failed", "cancelled"].includes(transition.kind),
  );
  invariant(
    terminal.length === 1,
    `Expected one terminal transition for ${state.run.runId}, got ${terminal.map((item) => item.kind).join(", ")}`,
  );
}

export function assertTerminalEventOnce(
  events: RealHostEventObservation[],
): void {
  const terminal = events.filter((event) =>
    ["run.completed", "run.failed", "run.cancelled"].includes(event.type),
  );
  invariant(
    terminal.length === 1,
    `Expected one terminal event, got ${terminal.map((event) => event.type).join(", ")}`,
  );
  invariant(
    new Set(terminal.map((event) => event.id)).size === 1,
    "Terminal event IDs diverged",
  );
}

export function normalizedTransitionProjection(state: RunHydratedState) {
  return state.transitions.map((transition) => ({
    revision: transition.revision,
    previousRevision: transition.previousRevision,
    kind: transition.kind,
    status: transition.run.status,
    attempt: transition.run.attempt,
    entryRoles: transition.entries.map((entry) => entry.role),
    toolStatuses: transition.toolCalls.map((tool) => tool.status),
    eventTypes: transition.events.map((event) => event.type),
  }));
}

export function normalizedCheckpointProjection(state: RunHydratedState) {
  return state.checkpoints.map((checkpoint) => ({
    boundary: checkpoint.boundary,
    attempt: checkpoint.attempt,
    parent: Boolean(checkpoint.parentCheckpointId),
    interaction: Boolean(checkpoint.interactionId),
    toolCalls: checkpoint.toolCalls.length,
    committed: checkpoint.committed,
    checksum: checkpoint.checksum.startsWith("sha256:"),
  }));
}

export function normalizedInteractionProjection(state: RunHydratedState) {
  return state.interactions.map((interaction) => ({
    kind: interaction.kind,
    status: interaction.status,
    ownsCheckpoint: state.checkpoints.some(
      (checkpoint) =>
        checkpoint.checkpointId === interaction.checkpointId &&
        checkpoint.interactionId === interaction.id,
    ),
    resolutionCount: state.transitions.filter((transition) =>
      transition.interactions.some(
        (candidate) =>
          candidate.id === interaction.id && candidate.status === "resolved",
      ),
    ).length,
  }));
}

export function normalizedToolProjection(state: RunHydratedState) {
  return state.transitions.flatMap((transition) =>
    transition.toolCalls.map((tool) => ({
      revision: transition.revision,
      toolName: tool.toolName,
      status: tool.status,
      hasArgs: tool.argsPreview !== undefined,
      hasResult: tool.resultPreview !== undefined,
    })),
  );
}

export function normalizedEventProjection(events: RealHostEventObservation[]) {
  return events.map((event) => ({
    type: event.type,
    delivery: event.delivery,
    sequence: event.sequence,
  }));
}

export function normalizedSnapshotProjection(
  snapshot: NormalizedHostRunSnapshot,
) {
  return {
    status: snapshot.status,
    entries: snapshot.entries.map((entry) => ({
      role: entry.role,
      text: entry.text,
    })),
    toolCalls: snapshot.toolCalls.map((tool) => ({
      toolName: tool.toolName,
      status: tool.status,
      resultPreview: tool.resultPreview,
    })),
  };
}

export function normalizedDurableProjection(state: RunHydratedState) {
  const entries = new Map<string, { role: string; text: string }>();
  const tools = new Map<
    string,
    { toolName: string; status: string; resultPreview?: unknown }
  >();
  for (const transition of state.transitions) {
    for (const entry of transition.entries) {
      entries.set(entry.id, { role: entry.role, text: entry.text });
    }
    for (const tool of transition.toolCalls) {
      tools.set(tool.id, {
        toolName: tool.toolName,
        status: tool.status,
        resultPreview: tool.resultPreview,
      });
    }
  }
  return {
    status: state.run.status,
    entries: [...entries.values()],
    toolCalls: [...tools.values()],
  };
}

export async function assertRejectsWithCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  let error: unknown;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  invariant(error, `Expected operation to reject with ${code}`);
  const candidate = error as {
    code?: unknown;
    options?: { code?: unknown };
    cause?: { code?: unknown };
  };
  const actual =
    candidate.code ?? candidate.options?.code ?? candidate.cause?.code;
  invariant(
    actual === code || String(error).includes(code),
    `Expected ${code}, got ${String(actual ?? error)}`,
  );
}

export function assertNoUnresolved(state: RunHydratedState): void {
  invariant(
    state.prompts.every((prompt) =>
      ["delivered", "cancelled", "failed"].includes(prompt.status),
    ),
    "Run retained an unresolved prompt",
  );
  invariant(
    state.interactions.every((interaction) => interaction.status !== "pending"),
    "Run retained a pending interaction",
  );
}
