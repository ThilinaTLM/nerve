import { createHash } from "node:crypto";
import {
  childExecutionRelationshipSchema,
  type AgentRecord,
  type ChildExecutionRelationship,
} from "@nervekit/contracts/agents";
import type { WaitGroup } from "@nervekit/contracts/runs";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import {
  canonicalConversationJson,
  conversationCommandFingerprint,
} from "../../conversations/timeline/command-fingerprint.js";
import { CanonicalTimelineIdentityService } from "../../conversations/timeline/canonical-timeline-identity.service.js";

const NAMESPACE = "canonical_child_execution";

export class CanonicalChildExecutionService {
  constructor(
    private readonly deps: {
      store: CanonicalStore;
      run(input: {
        agent: AgentRecord;
        prompt: string;
        runId: string;
        signal?: AbortSignal;
      }): Promise<string>;
    },
  ) {}

  async run(input: {
    parent: AgentRecord;
    parentRunId: string;
    parentToolCallId: string;
    child: AgentRecord;
    childRunId: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const now = new Date().toISOString();
    const relationshipId = `childrel_${input.childRunId.slice("run_".length)}`;
    const existing = await this.deps.store.readDocument<unknown>(
      NAMESPACE,
      input.parentRunId,
      relationshipId,
    );
    if (existing) {
      const relationship = childExecutionRelationshipSchema.parse(
        existing.data,
      );
      this.assertSameRelationship(relationship, input);
      if (relationship.state === "completed" && relationship.resultText) {
        return relationship.resultText;
      }
      throw new Error(
        `Canonical child execution '${relationshipId}' is already ${relationship.state}.`,
      );
    }
    const parentWait =
      await this.deps.store.execution.findWaitGroupByMemberOwner(
        input.parentToolCallId,
      );
    const parentMember = parentWait?.members.find(
      (member) =>
        member.ownerId === input.parentToolCallId &&
        member.memberKind === "child_agent",
    );
    const registeredParentHead = parentWait
      ? await this.deps.store.readTimelineConversationHead(
          input.parent.conversationId,
        )
      : undefined;
    const registered = childExecutionRelationshipSchema.parse({
      schemaVersion: 1,
      relationshipId,
      parentAgentId: input.parent.id,
      parentConversationId: input.parent.conversationId,
      parentRunId: input.parentRunId,
      parentToolCallId: input.parentToolCallId,
      ...(parentWait && parentMember
        ? {
            parentWaitGroupId: parentWait.waitGroupId,
            parentMemberId: parentMember.memberId,
            registrationRevision: parentWait.revision + 1,
            registeredParentHeadId: registeredParentHead?.activeEntryId ?? null,
            registeredParentSelectionEpoch:
              registeredParentHead?.selectionEpoch ?? 0,
          }
        : {}),
      childAgentId: input.child.id,
      childConversationId: input.child.conversationId,
      childRunId: input.childRunId,
      state: "registered",
      dispatchEvidence: "not_dispatched",
      attachmentState: parentWait && parentMember ? "pending" : "detached",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    if (parentWait && parentMember) {
      await this.registerWithParent(registered, parentWait);
    } else {
      await this.write(registered, 0);
    }
    const dispatchStartedAt = new Date().toISOString();
    if (parentWait && parentMember) {
      const applicable = await this.parentDispatchIsApplicable(registered);
      if (!applicable) {
        await this.write(
          {
            ...registered,
            state: "detached",
            dispatchEvidence: "not_dispatched",
            attachmentState: "detached",
            nonDispatchProvenAt: dispatchStartedAt,
            revision: 2,
            updatedAt: dispatchStartedAt,
          },
          1,
        );
        throw new Error(
          "Canonical child dispatch was fenced by its parent state.",
        );
      }
    }
    await this.write(
      {
        ...registered,
        state: "running",
        dispatchEvidence: "dispatch_started",
        dispatchStartedAt,
        revision: 2,
        updatedAt: dispatchStartedAt,
      },
      1,
    );
    try {
      const report = await this.deps.run({
        agent: input.child,
        prompt: input.prompt,
        runId: input.childRunId,
        signal: input.signal,
      });
      await this.write(
        {
          ...registered,
          state: "completed",
          dispatchEvidence: "dispatch_started",
          terminalOutcome: "completed",
          resultDigest: digest(report),
          resultText: report,
          dispatchStartedAt,
          revision: 3,
          updatedAt: new Date().toISOString(),
        },
        2,
      );
      return report;
    } catch (error) {
      await this.write(
        {
          ...registered,
          state: input.signal?.aborted ? "cancelled" : "failed",
          dispatchEvidence: "possibly_dispatched",
          terminalOutcome: input.signal?.aborted ? "cancelled" : "failed",
          ...(input.signal?.aborted
            ? { cancellationRequestedAt: new Date().toISOString() }
            : {}),
          dispatchStartedAt,
          errorMessage: error instanceof Error ? error.message : String(error),
          revision: 3,
          updatedAt: new Date().toISOString(),
        },
        2,
      );
      throw error;
    }
  }

  private async parentDispatchIsApplicable(
    relationship: ChildExecutionRelationship,
  ): Promise<boolean> {
    if (!relationship.parentWaitGroupId || !relationship.parentMemberId)
      return false;
    const [run, head, waitGroup] = await Promise.all([
      this.deps.store.readTimelineRunControl(
        relationship.parentConversationId,
        relationship.parentRunId,
      ),
      this.deps.store.readTimelineConversationHead(
        relationship.parentConversationId,
      ),
      this.deps.store.execution.findWaitGroupByMemberOwner(
        relationship.parentToolCallId,
      ),
    ]);
    const member = waitGroup?.members.find(
      (candidate) => candidate.memberId === relationship.parentMemberId,
    );
    return Boolean(
      run?.foregroundOwned &&
      ["running", "waiting", "partially_waiting"].includes(run.state) &&
      head?.selectionEpoch === relationship.registeredParentSelectionEpoch &&
      head?.activeEntryId === relationship.registeredParentHeadId &&
      waitGroup?.waitGroupId === relationship.parentWaitGroupId &&
      waitGroup.revision >= (relationship.registrationRevision ?? 0) &&
      member?.executionState === "executing",
    );
  }

  private assertSameRelationship(
    relationship: ChildExecutionRelationship,
    input: {
      parent: AgentRecord;
      parentRunId: string;
      parentToolCallId: string;
      child: AgentRecord;
      childRunId: string;
    },
  ): void {
    if (
      relationship.parentAgentId !== input.parent.id ||
      relationship.parentConversationId !== input.parent.conversationId ||
      relationship.parentRunId !== input.parentRunId ||
      relationship.parentToolCallId !== input.parentToolCallId ||
      relationship.childAgentId !== input.child.id ||
      relationship.childConversationId !== input.child.conversationId ||
      relationship.childRunId !== input.childRunId
    ) {
      throw new Error(
        "Canonical child execution identity does not match its receipt.",
      );
    }
  }

  async recoverPending(): Promise<void> {
    const keys = await this.deps.store.listDocumentKeys(NAMESPACE);
    for (const key of keys) {
      const document = await this.deps.store.readDocument<unknown>(
        NAMESPACE,
        key.scopeId,
        key.documentId,
      );
      if (!document) continue;
      const relationship = childExecutionRelationshipSchema.parse(
        document.data,
      );
      if (!["registered", "running"].includes(relationship.state)) continue;
      const childRun = await this.deps.store.readTimelineRunControl(
        relationship.childConversationId,
        relationship.childRunId,
      );
      const parentRun = await this.deps.store.readTimelineRunControl(
        relationship.parentConversationId,
        relationship.parentRunId,
      );
      const parentApplicable = Boolean(
        parentRun?.foregroundOwned &&
        ["running", "waiting", "partially_waiting"].includes(parentRun.state),
      );
      const childActive = Boolean(
        childRun &&
        ["running", "waiting", "partially_waiting"].includes(childRun.state),
      );
      if (childActive && parentApplicable) continue;
      const detached = !parentApplicable;
      const registeredWithoutDispatch =
        relationship.state === "registered" &&
        relationship.dispatchEvidence !== "dispatch_started" &&
        relationship.dispatchEvidence !== "possibly_dispatched";
      await this.write(
        {
          ...relationship,
          state: detached
            ? "detached"
            : childRun?.state === "completed"
              ? "completed"
              : "failed",
          dispatchEvidence: registeredWithoutDispatch
            ? "not_dispatched"
            : (relationship.dispatchEvidence ?? "possibly_dispatched"),
          attachmentState: detached ? "detached" : relationship.attachmentState,
          ...(registeredWithoutDispatch
            ? { nonDispatchProvenAt: new Date().toISOString() }
            : {}),
          ...(detached && !registeredWithoutDispatch
            ? { cancellationRequestedAt: new Date().toISOString() }
            : {}),
          ...(childRun?.recoveryReason
            ? { errorMessage: childRun.recoveryReason }
            : {}),
          revision: relationship.revision + 1,
          updatedAt: new Date().toISOString(),
        },
        document.revision,
      );
    }
  }

  async listForParentRun(
    parentRunId: string,
  ): Promise<ChildExecutionRelationship[]> {
    return (
      await this.deps.store.listDocuments<unknown>(NAMESPACE, parentRunId)
    ).map((document) => childExecutionRelationshipSchema.parse(document.data));
  }

  private async registerWithParent(
    relationship: ChildExecutionRelationship,
    waitGroup: WaitGroup,
  ): Promise<void> {
    const identity = await new CanonicalTimelineIdentityService(
      this.deps.store,
    ).resolve();
    const outcome = await this.deps.store.commitConversationCommand({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "register_child_execution",
      ownerKind: "conversation",
      ownerId: relationship.parentConversationId,
      commandId: `register-child:${relationship.relationshipId}`,
      fingerprintVersion: 1,
      fingerprint: conversationCommandFingerprint({
        operation: "register_child_execution",
        relationship,
      }),
      expectedHeads: [],
      transitions: [],
      waitGroups: [{ ...waitGroup, revision: waitGroup.revision + 1 }],
      domainDocuments: [
        {
          namespace: NAMESPACE,
          scopeId: relationship.parentRunId,
          documentId: relationship.relationshipId,
          expectedRevision: 0,
          payloadVersion: 1,
          data: relationship,
        },
      ],
      outcome: relationship,
      publicationIntents: [],
      now: relationship.updatedAt,
    });
    if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
      throw new Error(
        `Child relationship registration rejected: ${outcome.kind}.`,
      );
    }
  }

  private async write(
    relationship: ChildExecutionRelationship,
    expectedRevision: number,
  ): Promise<void> {
    await this.deps.store.writeDocument({
      namespace: NAMESPACE,
      scopeId: relationship.parentRunId,
      documentId: relationship.relationshipId,
      data: relationship,
      expectedRevision,
      now: relationship.updatedAt,
    });
  }
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalConversationJson(value))
    .digest("hex")}`;
}
