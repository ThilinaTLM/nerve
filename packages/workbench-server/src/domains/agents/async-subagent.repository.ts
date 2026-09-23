import {
  asyncSubagentAssignmentSchema,
  type AsyncSubagentAssignment,
} from "@nervekit/contracts/agents";
import {
  asyncSubagentControlSchema,
  type AsyncSubagentControl,
} from "@nervekit/contracts/agents";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";

export class AsyncSubagentRepository {
  constructor(readonly store: CanonicalStore) {}

  async control(agentId: string): Promise<AsyncSubagentControl> {
    const record = await this.store.readDocument(
      "async-subagent-control",
      "global",
      agentId,
    );
    return record
      ? asyncSubagentControlSchema.parse(record.data)
      : { agentId, generation: 0, stopped: false, stopping: false };
  }

  async writeControl(control: AsyncSubagentControl): Promise<void> {
    const current = await this.store.readDocument(
      "async-subagent-control",
      "global",
      control.agentId,
    );
    await this.store.writeDocument({
      namespace: "async-subagent-control",
      scopeId: "global",
      documentId: control.agentId,
      expectedRevision: current?.revision ?? 0,
      data: asyncSubagentControlSchema.parse(control),
    });
  }

  async reserveAssignment(assignment: AsyncSubagentAssignment): Promise<void> {
    await this.store.writeDocument({
      namespace: "async-subagent-assignment",
      scopeId: assignment.leadId,
      documentId: assignment.runId,
      expectedRevision: 0,
      data: asyncSubagentAssignmentSchema.parse(assignment),
    });
  }

  async assignments(): Promise<AsyncSubagentAssignment[]> {
    return (
      await this.store.listDocuments<AsyncSubagentAssignment>(
        "async-subagent-assignment",
      )
    ).map((record) => asyncSubagentAssignmentSchema.parse(record.data));
  }
}
