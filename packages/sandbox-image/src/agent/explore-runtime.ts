import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxAgentRelationshipRecord } from "@nervekit/shared";

export type ExploreRequest = {
  conversationId?: string;
  agentId?: string;
  runId?: string;
  task: string;
  context?: string;
  label?: string;
  depth?: number;
};

export type ExploreResult = {
  content: string;
  details: {
    childAgentId: string;
    childRunId: string;
    relationship: SandboxAgentRelationshipRecord;
  };
};

export class ExploreRuntime {
  constructor(
    readonly maxDepth = 2,
    readonly maxParallel = 2,
    private readonly stateDir?: string,
  ) {}

  async execute(input: ExploreRequest): Promise<ExploreResult> {
    const depth = input.depth ?? 1;
    if (depth > this.maxDepth)
      throw new Error(`explore depth limit exceeded: ${this.maxDepth}`);
    const now = new Date().toISOString();
    const childAgentId = `agent_explore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const childRunId = `run_explore_${Date.now()}`;
    const relationship: SandboxAgentRelationshipRecord = {
      conversationId: input.conversationId ?? "conv_unknown",
      parentAgentId: input.agentId ?? "agent_main",
      childAgentId,
      parentRunId: input.runId,
      childRunId,
      relationship: "explore",
      depth,
      label: input.label,
      status: "completed",
      createdAt: now,
      updatedAt: now,
      summary: {
        text: bound(`Read-only explore request queued: ${input.task}`),
      },
    };
    await this.persist(relationship);
    return {
      content: relationship.summary?.text ?? "Explore completed.",
      details: { childAgentId, childRunId, relationship },
    };
  }

  private async persist(record: SandboxAgentRelationshipRecord): Promise<void> {
    if (!this.stateDir) return;
    const dir = path.join(
      this.stateDir,
      "conversations",
      safe(record.conversationId),
      "agents",
      safe(record.parentAgentId),
      "relationships",
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${safe(record.childAgentId)}.json`),
      JSON.stringify(record, null, 2),
    );
  }
}

function bound(text: string): string {
  return text.length > 4_000 ? `${text.slice(0, 4_000)}…` : text;
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
