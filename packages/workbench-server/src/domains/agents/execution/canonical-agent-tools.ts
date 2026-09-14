import { AgentToolSuspension } from "@nervekit/harness/agent";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ToolName } from "@nervekit/contracts/tools";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { PolicyDocumentObservation } from "@nervekit/contracts/permissions";
import type { CanonicalToolWorkerService } from "../../conversations/timeline/canonical-tool-worker.service.js";
import type { CanonicalToolRuntimeService } from "../../tools/execution/canonical-tool-runtime.service.js";
import { createAgentToolsWithExternalExecutor } from "../../tools/orchestration/agent-tool-adapter.js";

/** Binds harness tool callbacks to canonical effect work rather than legacy records. */
export function createCanonicalAgentTools(input: {
  store: CanonicalStore;
  worker: CanonicalToolWorkerService;
  workerId: string;
  agent: AgentRecord;
  runId: string;
  activeToolNames: readonly ToolName[];
  tools: CanonicalToolRuntimeService;
}) {
  return createAgentToolsWithExternalExecutor({
    allowedToolNames: input.activeToolNames,
    execute: async (toolName, providerToolCallId, _args, signal) => {
      const authority = await input.store.execution.readRunExecutionAuthority(
        input.runId,
      );
      const proposalManifest = authority.waitGroup
        ? ((await input.store.execution.readArtifactManifest(
            authority.waitGroup.membershipManifestId.replace(
              "wait_members",
              "wait_proposals",
            ),
          )) as
            | {
                proposals: Array<{
                  memberId: string;
                  suffix: string;
                  admission: string;
                  providerToolCallId: string;
                }>;
              }
            | undefined)
        : undefined;
      const proposal = proposalManifest?.proposals.find(
        (candidate) => candidate.providerToolCallId === providerToolCallId,
      );
      const member = authority.waitGroup?.members.find(
        (candidate) => candidate.memberId === proposal?.memberId,
      );
      if (!member) {
        throw new Error("Canonical tool callback has no member authority.");
      }
      if (member.executionState === "awaiting_approval") {
        throw new AgentToolSuspension({
          toolCallId: providerToolCallId,
          toolName,
          reason: `Tool ${toolName} is awaiting canonical interaction resolution.`,
        });
      }
      if (member.executionState === "denied") {
        throw new Error(`Tool ${toolName} was denied by canonical policy.`);
      }
      if (proposal?.admission === "internal_command") {
        const work = await input.store.execution.claimReadyLifecycleWork({
          workId: `canonical_work_internal_${proposal.suffix}`,
          workerId: input.workerId,
          now: new Date().toISOString(),
          leaseDurationMs: 60_000,
        });
        if (!work) {
          throw new Error("Canonical internal command work is unavailable.");
        }
        return input.worker.executeInternal({
          agent: input.agent,
          work,
          now: new Date().toISOString(),
          signal,
        });
      }
      const effect = authority.effects.find(
        (candidate) => candidate.memberId === member.memberId,
      );
      if (!effect || effect.toolName !== toolName) {
        throw new Error(
          "Canonical tool callback has no matching effect authority.",
        );
      }
      const workId = `canonical_work_${effect.effectId.slice("effect_".length)}_claim`;
      const work = await input.store.execution.claimReadyLifecycleWork({
        workId,
        workerId: input.workerId,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
      });
      if (!work) {
        throw new Error("Canonical tool claim work is unavailable.");
      }
      const manifest = work.inputManifestId
        ? ((await input.store.execution.readArtifactManifest(
            work.inputManifestId,
          )) as {
            normalizedInput: Record<string, unknown>;
            normalizedInputFingerprint: string;
            policyObservation: PolicyDocumentObservation;
            exactApproval?: boolean;
          })
        : undefined;
      if (!manifest)
        throw new Error("Canonical tool input evidence is missing.");
      return input.worker.execute({
        agent: input.agent,
        claimWork: work,
        workerId: input.workerId,
        now: new Date().toISOString(),
        signal,
        revalidatePolicy: () =>
          input.tools.revalidateCanonicalToolProposal({
            agent: input.agent,
            toolName,
            args: manifest.normalizedInput,
            providerToolCallId,
            normalizedInputFingerprint: manifest.normalizedInputFingerprint,
            completeDocumentDigest:
              manifest.policyObservation.completeDocumentDigest,
            selectedRuleSetDigest:
              manifest.policyObservation.selectedRuleSetDigest,
            exactApproval: manifest.exactApproval,
          }),
      });
    },
  });
}
