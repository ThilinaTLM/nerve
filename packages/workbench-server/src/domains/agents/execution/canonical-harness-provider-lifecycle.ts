import type { AgentMessage } from "@nervekit/harness/agent";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { CoordinatorExecutionOptions } from "./coordinator-execution-options.js";
import { settleCanonicalHarnessProviderResponse } from "./canonical-harness-provider-settlement.js";

type CanonicalAuthority = NonNullable<CoordinatorExecutionOptions["canonical"]>;

export async function prepareCanonicalHarnessProviderDispatch(
  authority: CanonicalAuthority,
  request: unknown,
): Promise<void> {
  const prepared = await authority.providerInvocation.prepareForDispatch({
    preparationWork: authority.preparationWork,
    workerId: authority.workerId,
    request,
    now: authority.now(),
  });
  if (prepared.kind === "rejected") {
    throw new Error(
      `Canonical provider dispatch rejected: ${prepared.outcome.kind}.`,
    );
  }
  authority.activeProviderSnapshot = prepared.snapshot;
}

export async function checkpointLegacyProviderResponse(
  coordinator: CoordinatorExecutionOptions,
): Promise<void> {
  if (coordinator.canonical) return;
  await coordinator.sink.checkpoint(
    await coordinator.checkpointCommand("after_provider_response"),
  );
}

export async function settleCanonicalHarnessMessage(input: {
  authority: CanonicalAuthority;
  agent: AgentRecord;
  message: AgentMessage;
}): Promise<ConversationEntry[]> {
  const snapshot = input.authority.activeProviderSnapshot;
  if (input.message.role !== "assistant" || !snapshot) {
    throw new Error(
      "Canonical harness message has no active provider settlement authority.",
    );
  }
  const mirrored = await settleCanonicalHarnessProviderResponse({
    agent: input.agent,
    session: input.authority.session,
    settlement: input.authority.providerSettlement,
    snapshot,
    workerId: input.authority.workerId,
    response: input.message,
    now: input.authority.now(),
  });
  input.authority.activeProviderSnapshot = undefined;
  return mirrored;
}
