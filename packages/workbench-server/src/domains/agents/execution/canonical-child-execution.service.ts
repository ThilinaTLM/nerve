import { createHash } from "node:crypto";
import {
  childExecutionRelationshipSchema,
  type AgentRecord,
  type ChildExecutionRelationship,
} from "@nervekit/contracts/agents";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { canonicalConversationJson } from "../../conversations/timeline/command-fingerprint.js";

const NAMESPACE = "canonical_child_execution";

export class CanonicalChildExecutionService {
  constructor(
    private readonly deps: {
      store: CanonicalStore;
      run(input: {
        agent: AgentRecord;
        prompt: string;
        runId: string;
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
  }): Promise<string> {
    const now = new Date().toISOString();
    const relationshipId = `childrel_${input.childRunId.slice("run_".length)}`;
    const registered = childExecutionRelationshipSchema.parse({
      schemaVersion: 1,
      relationshipId,
      parentAgentId: input.parent.id,
      parentConversationId: input.parent.conversationId,
      parentRunId: input.parentRunId,
      parentToolCallId: input.parentToolCallId,
      childAgentId: input.child.id,
      childConversationId: input.child.conversationId,
      childRunId: input.childRunId,
      state: "registered",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    await this.write(registered, 0);
    await this.write(
      { ...registered, state: "running", revision: 2, updatedAt: now },
      1,
    );
    try {
      const report = await this.deps.run({
        agent: input.child,
        prompt: input.prompt,
        runId: input.childRunId,
      });
      await this.write(
        {
          ...registered,
          state: "completed",
          resultDigest: digest(report),
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
          state: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          revision: 3,
          updatedAt: new Date().toISOString(),
        },
        2,
      );
      throw error;
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
