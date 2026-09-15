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
          }
        : {}),
      childAgentId: input.child.id,
      childConversationId: input.child.conversationId,
      childRunId: input.childRunId,
      state: "registered",
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
    await this.write(
      {
        ...registered,
        state: "running",
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
      await this.write(
        {
          ...relationship,
          state: !parentApplicable
            ? "detached"
            : childRun?.state === "completed"
              ? "completed"
              : "failed",
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
