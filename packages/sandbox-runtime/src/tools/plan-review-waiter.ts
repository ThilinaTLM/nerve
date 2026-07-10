import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  createId,
  type ModelSelection,
  type PlanReviewRecord,
  type SandboxPlanReviewDecision,
  type SandboxPlanReviewWaitRecord,
  type ThinkingLevel,
} from "@nervekit/contracts";
import { sandboxSha256Digest } from "../state/hash.js";
import { JsonlStore } from "../state/jsonl-store.js";

const UNRESOLVED_PLAN_MARKER = /\[!(QUESTION|DECISION)\]/i;

export type PlanReviewRequest = {
  providerToolCallId: string;
  conversationId: string;
  agentId: string;
  runId: string;
  cwd: string;
  filePath: string;
  title?: string;
  summary?: string;
};

export class PlanReviewWaiter {
  private readonly reviews = new Map<string, SandboxPlanReviewWaitRecord>();
  private readonly store: JsonlStore<SandboxPlanReviewWaitRecord>;
  readonly planDir: string;

  constructor(
    stateDir: string,
    private readonly projectId: string,
  ) {
    this.planDir = path.resolve(stateDir, "plans");
    this.store = new JsonlStore(
      path.join(stateDir, "waits", "plan-reviews.jsonl"),
    );
  }

  async load(): Promise<void> {
    this.reviews.clear();
    for (const record of await this.store.readAll())
      this.reviews.set(record.review.id, record);
  }

  async ensurePlanDir(): Promise<string> {
    await mkdir(this.planDir, { recursive: true, mode: 0o755 });
    return this.planDir;
  }

  async request(
    input: PlanReviewRequest,
  ): Promise<SandboxPlanReviewWaitRecord> {
    const existing = this.byProviderToolCallId(input.providerToolCallId);
    if (existing) return existing;
    await this.ensurePlanDir();
    const candidate = path.resolve(input.cwd, input.filePath);
    await assertInside(this.planDir, candidate);
    const content = await readFile(candidate, "utf8").catch(() => {
      throw new Error(`Could not read plan file: ${candidate}`);
    });
    if (!content.trim())
      throw new Error(
        "Plan file is empty. Write your plan before presenting it.",
      );
    if (UNRESOLVED_PLAN_MARKER.test(content))
      throw new Error(
        "Plan still contains unresolved question or decision callouts.",
      );
    const duplicate = this.list().find(
      (record) =>
        record.status === "pending" &&
        record.agentId === input.agentId &&
        record.review.planPath === candidate,
    );
    if (duplicate)
      throw new Error(`Plan '${candidate}' is already pending user review.`);

    const now = new Date().toISOString();
    const review: PlanReviewRecord = {
      id: createId("plan_review"),
      toolCallId: normalizeToolCallId(input.providerToolCallId),
      agentId: input.agentId,
      conversationId: input.conversationId,
      projectId: this.projectId,
      slug: planSlug(candidate),
      title: input.title ?? path.basename(candidate),
      summary: input.summary,
      planPath: candidate,
      content,
      status: "pending",
      requestedAt: now,
      updatedAt: now,
    };
    const record: SandboxPlanReviewWaitRecord = {
      review,
      providerToolCallId: input.providerToolCallId,
      conversationId: input.conversationId,
      agentId: input.agentId,
      runId: input.runId,
      status: "pending",
      createdAt: now,
    };
    await this.save(record);
    return record;
  }

  async attachCheckpoint(
    reviewId: string,
    checkpointId: string | undefined,
  ): Promise<SandboxPlanReviewWaitRecord> {
    const current = this.require(reviewId);
    if (!checkpointId || current.checkpointId === checkpointId) return current;
    return this.save({ ...current, checkpointId });
  }

  async resolve(input: {
    reviewId: string;
    conversationId?: string;
    agentId?: string;
    runId?: string;
    decision: SandboxPlanReviewDecision;
    feedback?: string;
    implementationModel?: ModelSelection;
    implementationThinkingLevel?: ThinkingLevel;
    commandId?: string;
    toolResultEntryId?: string;
  }): Promise<SandboxPlanReviewWaitRecord> {
    const current = this.require(input.reviewId);
    assertScope(current, input);
    if (current.status !== "pending") {
      if (current.decision !== input.decision)
        throw new Error(
          `Conflicting plan review resolution: ${input.reviewId}`,
        );
      return current;
    }
    const now = new Date().toISOString();
    const status =
      input.decision === "accept"
        ? "accepted"
        : input.decision === "request_changes"
          ? "changes_requested"
          : "discarded";
    return this.save({
      ...current,
      review: {
        ...current.review,
        status,
        feedback: input.feedback,
        resolvedAt: now,
        updatedAt: now,
      },
      status,
      decision: input.decision,
      feedback: input.feedback,
      implementationModel: input.implementationModel,
      implementationThinkingLevel: input.implementationThinkingLevel,
      commandId: input.commandId,
      toolResultEntryId: input.toolResultEntryId,
      resolvedAt: now,
    });
  }

  async cancelRun(scope: {
    conversationId?: string;
    agentId?: string;
    runId: string;
  }): Promise<SandboxPlanReviewWaitRecord[]> {
    const cancelled: SandboxPlanReviewWaitRecord[] = [];
    for (const record of this.reviews.values()) {
      if (record.status !== "pending") continue;
      if (
        scope.conversationId &&
        record.conversationId !== scope.conversationId
      )
        continue;
      if (scope.agentId && record.agentId !== scope.agentId) continue;
      if (record.runId !== scope.runId) continue;
      const now = new Date().toISOString();
      const next: SandboxPlanReviewWaitRecord = {
        ...record,
        status: "discarded",
        review: {
          ...record.review,
          status: "discarded",
          feedback: "Run cancelled.",
          resolvedAt: now,
          updatedAt: now,
        },
        cancelledAt: now,
        resolvedAt: now,
      };
      await this.save(next);
      cancelled.push(next);
    }
    return cancelled;
  }

  get(reviewId: string): SandboxPlanReviewWaitRecord | undefined {
    return this.reviews.get(reviewId);
  }

  byProviderToolCallId(
    toolCallId: string,
  ): SandboxPlanReviewWaitRecord | undefined {
    return this.list().find(
      (record) => record.providerToolCallId === toolCallId,
    );
  }

  pendingForRun(scope: {
    conversationId?: string;
    agentId?: string;
    runId: string;
  }): SandboxPlanReviewWaitRecord[] {
    return this.list().filter(
      (record) =>
        record.status === "pending" &&
        (!scope.conversationId ||
          record.conversationId === scope.conversationId) &&
        (!scope.agentId || record.agentId === scope.agentId) &&
        record.runId === scope.runId,
    );
  }

  list(): SandboxPlanReviewWaitRecord[] {
    return [...this.reviews.values()];
  }

  private require(reviewId: string): SandboxPlanReviewWaitRecord {
    const record = this.reviews.get(reviewId);
    if (!record) throw new Error(`Unknown plan review: ${reviewId}`);
    return record;
  }

  private async save(
    record: SandboxPlanReviewWaitRecord,
  ): Promise<SandboxPlanReviewWaitRecord> {
    this.reviews.set(record.review.id, record);
    await this.store.append(record);
    return record;
  }
}

export function normalizeToolCallId(toolCallId: string): string {
  if (toolCallId.startsWith("tool_")) return toolCallId;
  return `tool_${sandboxSha256Digest(toolCallId).slice(7, 23)}`;
}

export function sandboxProjectId(source: string): string {
  return `proj_sandbox_${sandboxSha256Digest(source).slice(7, 23)}`;
}

async function assertInside(root: string, candidate: string): Promise<void> {
  const [realRoot, realCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  const relative = path.relative(realRoot, realCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(
      `Plan file must be inside ${realRoot}. Attempted: ${candidate}`,
    );
}

function planSlug(filePath: string): string {
  const slug = path
    .basename(filePath)
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/g, "")
    .slice(0, 80);
  return slug || "plan";
}

function assertScope(
  record: SandboxPlanReviewWaitRecord,
  scope: { conversationId?: string; agentId?: string; runId?: string },
): void {
  if (scope.conversationId && scope.conversationId !== record.conversationId)
    throw new Error(`Plan review conversation mismatch: ${record.review.id}`);
  if (scope.agentId && scope.agentId !== record.agentId)
    throw new Error(`Plan review agent mismatch: ${record.review.id}`);
  if (scope.runId && scope.runId !== record.runId)
    throw new Error(`Plan review run mismatch: ${record.review.id}`);
}
