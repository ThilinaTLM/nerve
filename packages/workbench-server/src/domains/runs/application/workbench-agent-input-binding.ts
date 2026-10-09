import {
  AgentInputConflictError,
  type AgentInputService,
} from "../runtime/agent-inputs.js";
import type { AgentInputRecord, AgentRecord } from "@nervekit/contracts/agents";
import type { RunRecord } from "@nervekit/contracts/runs";
import { ApplicationError } from "../../../core/application-error.js";
import type { WorkbenchRunUnitOfWork } from "../persistence/run-transition.repository.js";

/** Originating admission and actual delivery are distinct durable facts. */
export async function resolveAgentInputBinding(
  unitOfWork: Pick<
    WorkbenchRunUnitOfWork,
    "findByInitialInputId" | "loadFresh"
  >,
  agent: AgentRecord,
  inputId: string,
  receipt: AgentInputRecord | undefined,
): Promise<{ agentId: string; runId: string; attemptId: string } | undefined> {
  const invalid = (): never => {
    throw new ApplicationError(
      409,
      "AGENT_INPUT_BINDING_INVALID",
      "Assignment binding does not match its owner.",
    );
  };
  const validate = (run: RunRecord, runId: string) => {
    if (
      run.runId !== runId ||
      run.agentId !== agent.id ||
      run.conversationId !== agent.conversationId ||
      run.scopeId !== `${agent.conversationId}:${agent.id}` ||
      run.projectId !== agent.projectId
    )
      invalid();
  };
  if (
    receipt &&
    (receipt.id !== inputId ||
      receipt.agentId !== agent.id ||
      receipt.conversationId !== agent.conversationId)
  )
    invalid();
  const originating = await unitOfWork.findByInitialInputId(agent.id, inputId);
  if (originating) {
    validate(originating, originating.runId);
    if (originating.initialInputId !== inputId) invalid();
  }
  const delivery = receipt?.delivery;
  if (
    delivery &&
    receipt?.eligibility.kind === "run" &&
    receipt.eligibility.runId !== delivery.runId
  )
    invalid();
  // A corrupt receipt is not permission to admit a replacement, even when an
  // originating run exists. Never use another run's receipt as attempt proof.
  let delivered: RunRecord | undefined;
  if (delivery && delivery.runId !== originating?.runId) {
    delivered = (await unitOfWork.loadFresh(delivery.runId))?.run;
    if (!delivered) return invalid();
    validate(delivered, delivery.runId);
  }
  const selected = originating ?? delivered;
  if (!selected) return undefined;
  if (delivery?.runId === selected.runId)
    return {
      agentId: agent.id,
      runId: selected.runId,
      attemptId: delivery.attemptId,
    };
  const state = await unitOfWork.loadFresh(selected.runId);
  if (!state) return invalid();
  validate(state.run, selected.runId);
  if (state.run.initialInputId !== inputId) invalid();
  const original = state.transitions?.[0]?.run;
  if (original) {
    validate(original, selected.runId);
    if (original.initialInputId !== inputId) invalid();
  }
  return {
    agentId: agent.id,
    runId: selected.runId,
    attemptId: original?.executionId ?? selected.executionId,
  };
}

/** Cancel input and resolve identity under admission; execution cancellation stays outside. */
export async function cancelAgentInputBinding(
  unitOfWork: Pick<
    WorkbenchRunUnitOfWork,
    "findByInitialInputId" | "loadFresh"
  >,
  inputs: AgentInputService,
  agent: AgentRecord,
  inputId: string,
) {
  await inputs.cancel(agent.id, inputId).catch((error) => {
    if (!(error instanceof AgentInputConflictError)) throw error;
  });
  const receipt = await inputs.get(agent.id, inputId);
  const binding = await resolveAgentInputBinding(
    unitOfWork,
    agent,
    inputId,
    receipt,
  );
  return binding;
}
