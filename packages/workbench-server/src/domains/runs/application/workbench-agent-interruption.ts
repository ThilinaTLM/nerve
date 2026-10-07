import { randomUUID } from "node:crypto";
import { parseInlineCommandPrompt } from "@nervekit/contracts/completions";
import type {
  AgentRecord,
  AgentInputRecord,
  PromptRequest,
} from "@nervekit/contracts/agents";
import { ApplicationError } from "../../../core/application-error.js";
import { AgentControlGenerationConflictError } from "../runtime/agent-inputs.js";
import type { RunCoordinator } from "../runtime/index.js";
import type {
  WorkbenchAgentControls,
  WorkbenchRunFeatureMechanics,
} from "./workbench-run.service.js";
export interface AgentInterruptionOptions {
  authority?: "user_administration";
  parent?: { agentId: string; runId?: string };
}
export async function interruptAgent(
  deps: {
    controls: WorkbenchAgentControls;
    coordinator: RunCoordinator;
    features: WorkbenchRunFeatureMechanics;
    getAgent(id: string): AgentRecord;
    withControl<T>(id: string, action: () => Promise<T>): Promise<T>;
    abortAgent(
      id: string,
      onPaused?: (generation: number) => void,
    ): Promise<void>;
    activate(input: AgentInputRecord): void;
  },
  agentId: string,
  request: PromptRequest,
  options?: AgentInterruptionOptions,
): Promise<void> {
  const agent = deps.getAgent(agentId);
  const key = request.idempotencyKey ?? randomUUID();
  const origin: import("@nervekit/contracts/agents").AgentInputRecord["origin"] =
    options?.authority === "user_administration"
      ? { kind: "user", userId: "authorized-user" }
      : options?.parent
        ? { kind: "parent", ...options.parent }
        : { kind: "system", producer: "controls", correlationId: key };
  const deferred =
    request.behavior === "follow-up" ||
    (options?.authority === "user_administration" &&
      Boolean(parseInlineCommandPrompt(request.text)));
  const previous = request.idempotencyKey
    ? await deps.controls.inputs.acceptanceForKey(agentId, key)
    : undefined;
  if (previous) {
    await deps.controls.inputs.accept(
      agentId,
      agent.conversationId,
      {
        text: request.text,
        images: request.images,
        role: "user",
        origin,
        idempotencyKey: key,
        eligibility: deferred
          ? previous.eligibility.kind === "next_run"
            ? previous.eligibility
            : { kind: "next_run" }
          : { kind: "next_turn" },
        activation: "wake_if_idle",
      },
      async () => undefined,
    );
    return;
  }
  if (
    options?.authority === "user_administration" &&
    parseInlineCommandPrompt(request.text) &&
    (agent.readOnlyCeiling || agent.permissionLevel === "read_only")
  )
    throw new ApplicationError(
      403,
      "INLINE_COMMAND_FORBIDDEN",
      "Read-only agent policy forbids inline shell execution.",
    );
  let generation: number | undefined;
  await deps.abortAgent(agentId, (value) => {
    generation = value;
  });
  await deps.coordinator.settledForAgent(agentId);
  const accepted = await deps.withControl(agentId, async () => {
    if (generation === undefined) return undefined;
    let input;
    try {
      input = await deps.controls.inputs.accept(
        agentId,
        agent.conversationId,
        {
          text: request.text,
          images: request.images,
          role: "user",
          origin,
          idempotencyKey: key,
          eligibility: deferred ? { kind: "next_run" } : { kind: "next_turn" },
          activation: "wake_if_idle",
        },
        async () => undefined,
        generation,
        true,
      );
    } catch (error) {
      if (error instanceof AgentControlGenerationConflictError)
        return undefined;
      throw error;
    }
    await deps.controls.setActivationState?.(agentId, "enabled");
    await deps.features.reopenTeam?.(agentId);
    if (options?.authority === "user_administration")
      await deps.controls.admissionPolicy?.recordAdministrativeActivation?.({
        agentId,
        generation: generation + 1,
        cause: "user_interrupt",
      });
    return input;
  });
  if (!accepted) return;
  // Observer/admission work never holds the short control fence.
  try {
    await deps.controls.inputAccepted?.(accepted);
  } catch (error) {
    process.emitWarning(
      `Agent input accepted but observer failed: ${String(error)}`,
    );
  }
  deps.activate(accepted);
}
