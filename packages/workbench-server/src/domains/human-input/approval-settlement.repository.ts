import { randomUUID } from "node:crypto";
import type {
  ApprovalSettlement,
  ConversationJournalEvent,
} from "@nervekit/contracts/conversations";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import type { RunRecord, RunInteractionRecord } from "@nervekit/contracts/runs";
import { ApplicationError } from "../../core/application-error.js";
import {
  ConversationJournalRepository,
  type ConversationJournalState,
} from "../conversations/conversation-journal.repository.js";
import { WorkbenchRunIntegrity } from "../runs/adapters/workbench-run-integrity.js";
import { prepareApprovalTranscript } from "./approval-settlement-transcript.js";
import {
  activeBranchEntryIds,
  activeBranchEndsWithCheckpoint,
} from "../runs/application/workbench-run.service.js";
import { RunEventFactory } from "../runs/runtime/run-events.js";
import { toToolCallTranscriptRecord } from "../tools/artifacts/tool-call-transcript-preview.js";
import { buildTransition, revise } from "../runs/runtime/run-transitions.js";

const integrity = new WorkbenchRunIntegrity();
const ids = { next: () => randomUUID() };

/** The journal owns decisions, work obligations and run transitions together. */
export class ApprovalSettlementRepository {
  constructor(readonly journal: ConversationJournalRepository) {}

  async list(): Promise<ApprovalSettlement[]> {
    return this.journal.listApprovalSettlements();
  }

  async get(
    conversationId: string,
    id: string,
  ): Promise<ApprovalSettlement | undefined> {
    return (await this.journal.load(conversationId)).approvalSettlements.get(
      id,
    );
  }

  acceptanceEvents(
    state: ConversationJournalState,
    tool: ToolCallRecord,
  ): ConversationJournalEvent[] {
    const projection = tool.runId
      ? state.runProjections.get(tool.runId)
      : undefined;
    const target = projection?.interactions.find(
      (item) =>
        item.toolCallId === tool.id &&
        item.checkpointId === projection?.run.lastCheckpointId,
    );
    if (
      tool.runId &&
      (!projection ||
        !target ||
        !["waiting", "suspended", "settling"].includes(projection.run.status))
    ) {
      throw new ApplicationError(
        409,
        "RUN_INTERACTION_NOT_PENDING",
        "The approval no longer belongs to a waiting run.",
      );
    }
    const id = target
      ? `approval:${target.checkpointId}`
      : `approval:${tool.id}`;
    const previous = state.approvalSettlements.get(id);
    const members = target
      ? projection!.interactions.filter(
          (item) => item.checkpointId === target.checkpointId,
        )
      : [];
    const toolCallIds = previous?.toolCallIds ?? [
      ...(target?.batchToolCallIds ?? [tool.id]),
    ];
    const interactions = members.map((item): RunInteractionRecord => {
      const canonical =
        item.toolCallId === tool.id
          ? tool
          : state.toolCalls.get(item.toolCallId);
      const decision = canonical?.interactions[item.interactionOrdinal];
      if (decision?.kind !== "approval" || decision.status !== "resolved")
        return item;
      const resolution = {
        decision: decision.resolution?.action === "allow" ? "allow" : "deny",
        note: decision.resolution?.note,
      };
      return {
        ...item,
        status: "resolved",
        toolCallRevision: canonical!.revision,
        resolvedAt: decision.resolvedAt,
        resolutionRequestId: decision.resolutionRequestId,
        resolution,
        resolutionHash: integrity.checksum(resolution),
      };
    });
    const pending = interactions.filter((item) => item.status === "pending");
    const now = tool.updatedAt;
    const settlement: ApprovalSettlement = {
      id,
      conversationId: tool.conversationId,
      runId: tool.runId,
      executionId: projection?.run.executionId,
      checkpointId: target?.checkpointId,
      toolCallIds,
      phase: pending.length ? "awaiting_decisions" : "ready",
      revision: (previous?.revision ?? 0) + 1,
      attempts: 0,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const events: ConversationJournalEvent[] = [];
    if (projection) {
      const run = revise(
        projection.run,
        {
          status: pending.length ? "waiting" : "settling",
          activeInteractionId: pending[0]?.id,
          approvalSettlementId: settlement.id,
          failure: undefined,
        },
        now,
      );
      const transcript = toToolCallTranscriptRecord(tool);
      const factory = new RunEventFactory("workbench_server");
      events.push({
        kind: "run.transition_committed",
        conversationId: tool.conversationId,
        transition: buildTransition(
          run,
          "approval.accepted",
          projection.run.revision,
          {
            interactions,
            toolCalls: [transcript],
            events: [
              factory.toolCallUpdated(run, transcript),
              factory.settlementUpdated(run, settlement),
            ],
          },
          ids,
          integrity,
        ),
      });
    }
    events.push({
      kind: "approval_settlement.upserted",
      conversationId: tool.conversationId,
      settlement,
    });
    return events;
  }

  async assertContext(
    value: ApprovalSettlement,
  ): Promise<ConversationJournalState> {
    const state = await this.journal.load(value.conversationId);
    if (!value.runId) return state;
    const projection = state.runProjections.get(value.runId);
    const checkpoint = projection?.checkpoints.find(
      (item) => item.checkpointId === value.checkpointId,
    );
    if (
      !projection ||
      !checkpoint ||
      projection.run.executionId !== value.executionId ||
      !["settling", "waiting", "suspended"].includes(projection.run.status)
    ) {
      throw new ApplicationError(
        409,
        "RUN_CHECKPOINT_STALE",
        "The approval run is no longer active.",
      );
    }
    const appended = state.entries.filter((entry) =>
      value.toolCallIds.includes(
        (entry.details as { toolRecordId?: string } | undefined)
          ?.toolRecordId ?? "",
      ),
    );
    const expected = [
      ...checkpoint.entryIds,
      ...appended
        .filter((entry) => !checkpoint.entryIds.includes(entry.id))
        .map((entry) => entry.id),
    ];
    if (
      !activeBranchEndsWithCheckpoint(
        activeBranchEntryIds(state.entries, state.conversation?.activeEntryId),
        expected,
      )
    ) {
      throw new ApplicationError(
        409,
        "RUN_CHECKPOINT_STALE",
        "The conversation changed after approval. No further work will be started.",
      );
    }
    return state;
  }

  async settleResults(value: ApprovalSettlement): Promise<ApprovalSettlement> {
    const state = await this.assertContext(value);
    const { entries, events } = value.runId
      ? prepareApprovalTranscript(state, value)
      : { entries: [], events: [] as ConversationJournalEvent[] };
    const now = new Date().toISOString();
    const settlement: ApprovalSettlement = {
      ...value,
      phase: value.runId ? "continuation_pending" : "completed",
      attempts: 0,
      failure: undefined,
      nextAttemptAt: undefined,
      revision: value.revision + 1,
      updatedAt: now,
    };
    if (value.runId) {
      const projection = state.runProjections.get(value.runId)!;
      const run = revise(
        projection.run,
        {
          status: "suspended",
          activeInteractionId: undefined,
          failure: undefined,
        },
        now,
      );
      const factory = new RunEventFactory("workbench_server");
      const toolCalls = value.toolCallIds.map((id) =>
        toToolCallTranscriptRecord(state.toolCalls.get(id)!),
      );
      events.push({
        kind: "run.transition_committed",
        conversationId: value.conversationId,
        transition: buildTransition(
          run,
          "approval.results_settled",
          projection.run.revision,
          {
            entries,
            toolCalls,
            events: [
              ...entries.map((entry) => factory.entryAppended(run, entry)),
              factory.settlementUpdated(run, settlement),
            ],
          },
          ids,
          integrity,
        ),
      });
      const suspension = [...state.suspensions.values()].find(
        (item) => item.checkpointId === value.checkpointId,
      );
      if (suspension)
        events.push({
          kind: "suspension.upserted",
          conversationId: value.conversationId,
          suspension: { ...suspension, status: "resolved", updatedAt: now },
        });
    }
    events.push({
      kind: "approval_settlement.upserted",
      conversationId: value.conversationId,
      settlement,
    });
    await this.journal.commit(
      value.conversationId,
      { kind: "approval.results_settled", events },
      state.revision,
    );
    return settlement;
  }

  async update(
    value: ApprovalSettlement,
    patch: Partial<ApprovalSettlement>,
    runPatch?: Partial<RunRecord>,
  ): Promise<ApprovalSettlement> {
    const state = await this.journal.load(value.conversationId);
    if (state.approvalSettlements.get(value.id)?.revision !== value.revision)
      throw new Error("Approval settlement revision conflict.");
    const now = new Date().toISOString();
    const settlement = {
      ...value,
      ...patch,
      revision: value.revision + 1,
      updatedAt: now,
    };
    const events: ConversationJournalEvent[] = [];
    if (value.runId && patch.phase !== "cancelled") {
      const projection = state.runProjections.get(value.runId);
      if (
        !projection ||
        projection.run.executionId !== value.executionId ||
        !["waiting", "settling", "suspended"].includes(projection.run.status)
      ) {
        throw new ApplicationError(
          409,
          "RUN_CHECKPOINT_STALE",
          "Approval settlement no longer owns this run.",
        );
      }
      events.push(
        runEvent(
          revise(projection.run, runPatch ?? {}, now),
          projection.run.revision,
          "approval.settlement",
          settlement,
        ),
      );
    }
    events.push({
      kind: "approval_settlement.upserted",
      conversationId: value.conversationId,
      settlement,
    });
    await this.journal.commit(
      value.conversationId,
      { kind: "approval.settlement", events },
      state.revision,
    );
    return settlement;
  }

  /** Old accepted decisions acquire the same obligation as new decisions; no SQL patching. */
  async normalize(
    conversationId: string,
    tool: ToolCallRecord,
  ): Promise<ApprovalSettlement> {
    const state = await this.journal.load(conversationId);
    const events = this.acceptanceEvents(state, tool);
    const settlement = events.find(
      (event) => event.kind === "approval_settlement.upserted",
    );
    if (!settlement)
      throw new Error("Approval normalization produced no obligation.");
    const existing = state.approvalSettlements.get(settlement.settlement.id);
    if (existing) return existing;
    await this.journal.commit(
      conversationId,
      {
        kind: "approval.normalized",
        events,
        idempotencyKey: `normalize:${settlement.settlement.id}`,
      },
      state.revision,
    );
    return settlement.settlement;
  }
}

function runEvent(
  run: RunRecord,
  previousRevision: number,
  kind: string,
  settlement: ApprovalSettlement,
): ConversationJournalEvent {
  return {
    kind: "run.transition_committed",
    conversationId: run.conversationId,
    transition: buildTransition(
      run,
      kind,
      previousRevision,
      {
        events: [
          new RunEventFactory("workbench_server").settlementUpdated(
            run,
            settlement,
          ),
        ],
      },
      ids,
      integrity,
    ),
  };
}
