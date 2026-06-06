import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  type AgentRecord,
  createId,
  type Mode,
  type PlanReviewRecord,
  type PlanReviewStatus,
  planReviewRecordSchema,
  type ToolCallRecord,
} from "@nerve/shared";
import type { EventBus } from "./events.js";
import {
  isPathInsidePlanDir,
  planDirForStorageHome,
  planSlugFromPath,
  resolvePlanPath,
} from "./plan-paths.js";
import type { InitializedStorage } from "./storage.js";
import { appendJsonLine, pathExists, readJsonLines } from "./storage.js";

export type PlanReviewResult = {
  review: PlanReviewRecord;
  outcome: PlanReviewStatus;
  feedback?: string;
  mode: Mode;
  contentBlocks?: Array<{ type: "text"; text: string }>;
};

const UNRESOLVED_PLAN_MARKER = /\[!(QUESTION|DECISION)\]/i;

export type SetAgentMode = (
  agentId: string,
  mode: Mode,
  reason: string,
) => Promise<AgentRecord>;

export class PlanService {
  readonly planReviews = new Map<string, PlanReviewRecord>();
  private readonly waiters = new Map<
    string,
    Set<(review: PlanReviewRecord) => void>
  >();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly getAgent: (agentId: string) => AgentRecord,
    private readonly setAgentMode: SetAgentMode,
  ) {}

  async hydrate(): Promise<void> {
    for (const review of await this.readLatestPlanReviews()) {
      this.planReviews.set(review.id, review);
    }
  }

  listPlanReviews(status?: PlanReviewStatus): PlanReviewRecord[] {
    return [...this.planReviews.values()]
      .filter((review) => !status || review.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  planDir(_agent: AgentRecord): string {
    return planDirForStorageHome(this.storage.paths.home);
  }

  async listPlanFiles(agent: AgentRecord): Promise<string[]> {
    const dir = this.planDir(agent);
    if (!(await pathExists(dir))) return [];
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort();
  }

  async createPlanReview(
    toolCall: ToolCallRecord,
    agent: AgentRecord,
    args: Record<string, unknown>,
  ): Promise<PlanReviewRecord> {
    const planPath = resolvePlanPath(toolCall.cwd, args.file_path);
    const planDir = this.planDir(agent);
    if (!isPathInsidePlanDir(planDir, planPath)) {
      throw new Error(
        `Plan file must be inside ${planDir}. Attempted: ${planPath}`,
      );
    }
    if (!(await pathExists(planPath))) {
      throw new Error(`Could not read plan file: ${planPath}`);
    }
    const content = await readFile(planPath, "utf8");
    if (!content.trim()) {
      throw new Error(
        "Plan file is empty. Write your plan first, then present it.",
      );
    }
    if (UNRESOLVED_PLAN_MARKER.test(content)) {
      throw new Error(
        "Plan still contains unresolved question or decision callouts. Resolve them before presenting.",
      );
    }

    const slug = planSlugFromPath(planPath);
    const title = optionalStringArg(args.title) ?? basename(planPath);
    const summary = optionalStringArg(args.summary);
    const existingPending = this.listPlanReviews("pending").find(
      (review) => review.agentId === agent.id && review.planPath === planPath,
    );
    if (existingPending) {
      throw new Error(`Plan '${planPath}' is already pending user review.`);
    }

    const now = new Date().toISOString();
    const review: PlanReviewRecord = {
      id: createId("plan_review"),
      toolCallId: toolCall.id,
      agentId: agent.id,
      conversationId: agent.conversationId,
      projectId: agent.projectId,
      slug,
      title,
      summary,
      planPath,
      content,
      status: "pending",
      requestedAt: now,
      updatedAt: now,
    };
    await this.upsertPlanReview(review);
    await this.events.publish("plan_review.requested", { planReview: review });
    return review;
  }

  async presentPlan(
    toolCall: ToolCallRecord,
    agent: AgentRecord,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PlanReviewResult> {
    const review = await this.createPlanReview(toolCall, agent, args);
    const resolved = await this.waitForPlanReview(review.id, signal);
    return this.planReviewResult(resolved);
  }

  planReviewResult(review: PlanReviewRecord): PlanReviewResult {
    return {
      review,
      outcome: review.status,
      feedback: review.feedback,
      mode: this.getAgent(review.agentId).mode,
      contentBlocks: [
        {
          type: "text",
          text: this.planReviewOutcomeMessage(review),
        },
      ],
    };
  }

  async acceptPlanReview(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    const review = this.getPendingPlanReview(reviewId);
    await this.setAgentMode(review.agentId, "coding", "Plan accepted by user.");
    const updated = await this.resolvePlanReview(review, "accepted", feedback);
    await this.events.publish("plan_review.accepted", { planReview: updated });
    return updated;
  }

  async requestPlanChanges(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    const review = this.getPendingPlanReview(reviewId);
    const updated = await this.resolvePlanReview(
      review,
      "changes_requested",
      feedback,
    );
    await this.events.publish("plan_review.changes_requested", {
      planReview: updated,
    });
    return updated;
  }

  async rejectPlanReview(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    const review = this.getPendingPlanReview(reviewId);
    const updated = await this.resolvePlanReview(
      review,
      "changes_requested",
      feedback ?? "Plan rejected by user.",
    );
    await this.events.publish("plan_review.rejected", { planReview: updated });
    return updated;
  }

  async discardPlanReview(
    reviewId: string,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    const review = this.getPendingPlanReview(reviewId);
    const updated = await this.resolvePlanReview(review, "discarded", feedback);
    await this.events.publish("plan_review.discarded", { planReview: updated });
    return updated;
  }

  async forceExitAgentPlanning(
    agentId: string,
    reason: string,
  ): Promise<AgentRecord> {
    const updated = await this.setAgentMode(agentId, "coding", reason);
    await this.events.publish("plan_review.force_exited", {
      agentId,
      conversationId: updated.conversationId,
      projectId: updated.projectId,
      reason,
    });
    return updated;
  }

  private async waitForPlanReview(
    reviewId: string,
    signal?: AbortSignal,
  ): Promise<PlanReviewRecord> {
    if (signal?.aborted) {
      void this.discardPlanReview(reviewId, "Agent run aborted.").catch(
        () => undefined,
      );
    }

    return new Promise<PlanReviewRecord>((resolve) => {
      const settle = (review: PlanReviewRecord) => {
        if (review.status === "pending") return;
        cleanup();
        resolve(review);
      };
      const onAbort = () => {
        void this.discardPlanReview(reviewId, "Agent run aborted.").catch(
          () => undefined,
        );
      };
      const cleanup = () => {
        const waiters = this.waiters.get(reviewId);
        waiters?.delete(settle);
        if (waiters && waiters.size === 0) this.waiters.delete(reviewId);
        signal?.removeEventListener("abort", onAbort);
      };

      const current = this.planReviews.get(reviewId);
      if (current && current.status !== "pending") {
        resolve(current);
        return;
      }

      let waiters = this.waiters.get(reviewId);
      if (!waiters) {
        waiters = new Set();
        this.waiters.set(reviewId, waiters);
      }
      waiters.add(settle);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private getPendingPlanReview(reviewId: string): PlanReviewRecord {
    const review = this.planReviews.get(reviewId);
    if (!review) throw new Error("Plan review not found.");
    if (review.status !== "pending") {
      throw new Error("Plan review is already resolved.");
    }
    return review;
  }

  private async resolvePlanReview(
    review: PlanReviewRecord,
    status: Exclude<PlanReviewStatus, "pending" | "force_exited">,
    feedback?: string,
  ): Promise<PlanReviewRecord> {
    const updated: PlanReviewRecord = {
      ...review,
      status,
      feedback: optionalStringArg(feedback),
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.upsertPlanReview(updated);
    this.notifyWaiters(updated);
    return updated;
  }

  private notifyWaiters(review: PlanReviewRecord): void {
    const waiters = this.waiters.get(review.id);
    if (!waiters) return;
    this.waiters.delete(review.id);
    for (const waiter of waiters) waiter(review);
  }

  private async upsertPlanReview(review: PlanReviewRecord): Promise<void> {
    this.planReviews.set(review.id, review);
    await appendJsonLine(this.planReviewsPath(), review, 0o600);
  }

  private async readLatestPlanReviews(): Promise<PlanReviewRecord[]> {
    const values = await readJsonLines<unknown>(this.planReviewsPath()).catch(
      () => [],
    );
    const parsed = values
      .map((value) => planReviewRecordSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data);
    return latestById(parsed);
  }

  private planReviewOutcomeMessage(review: PlanReviewRecord): string {
    if (review.status === "accepted") {
      return `Plan accepted. Proceed with implementation using ${review.planPath} as the source of truth.`;
    }
    if (review.status === "changes_requested") {
      return `Plan rejected. The current mode remains unchanged; wait for the user's follow-up instructions before presenting another plan.`;
    }
    if (review.status === "discarded") {
      return `Plan review discarded. Plan mode remains active; continue planning or exit with plan_mode_force_exit.`;
    }
    return `Plan review status: ${review.status}.`;
  }

  private planReviewsPath(): string {
    return join(this.storage.paths.home, "plans", "plan-reviews.jsonl");
  }
}

function optionalStringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function latestById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()];
}
