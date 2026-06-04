import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentRecord,
  createId,
  type Mode,
  type PlanReviewRecord,
  type PlanReviewStatus,
  planReviewRecordSchema,
  planSlugSchema,
  type ToolCallRecord,
} from "@nerve/shared";
import type { EventBus } from "./events.js";
import type { InitializedStorage } from "./storage.js";
import { appendJsonLine, pathExists, readJsonLines } from "./storage.js";

export type PlanReviewResult = {
  review: PlanReviewRecord;
  outcome: PlanReviewStatus;
  feedback?: string;
  mode: Mode;
};

export type PlanWriteResult = {
  slug: string;
  title?: string;
  planPath: string;
  bytes: number;
};

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

  planDir(agent: AgentRecord): string {
    return join(this.storage.paths.home, "plans", agent.sessionId, agent.id);
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

  async writePlan(
    agent: AgentRecord,
    args: Record<string, unknown>,
  ): Promise<PlanWriteResult> {
    const slug = this.slugArg(args.slug);
    const content = stringArg(args, "content");
    const title = optionalStringArg(args.title);
    const planPath = this.planPath(agent, slug);
    await mkdir(this.planDir(agent), { recursive: true, mode: 0o755 });
    await writeFile(planPath, content, { encoding: "utf8", mode: 0o644 });
    await this.events.publish("plan.written", {
      agentId: agent.id,
      sessionId: agent.sessionId,
      projectId: agent.projectId,
      slug,
      title,
      planPath,
    });
    return { slug, title, planPath, bytes: Buffer.byteLength(content, "utf8") };
  }

  async presentPlan(
    toolCall: ToolCallRecord,
    agent: AgentRecord,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<PlanReviewResult> {
    const slug = this.slugArg(args.slug);
    const title = optionalStringArg(args.title);
    const summary = optionalStringArg(args.summary);
    const planPath = this.planPath(agent, slug);
    if (!(await pathExists(planPath))) {
      throw new Error(
        `No plan exists for slug '${slug}'. Call plan_write before plan_mode_present.`,
      );
    }
    const existingPending = this.listPlanReviews("pending").find(
      (review) => review.agentId === agent.id && review.slug === slug,
    );
    if (existingPending) {
      throw new Error(`Plan '${slug}' is already pending user review.`);
    }

    const now = new Date().toISOString();
    const review: PlanReviewRecord = {
      id: createId("plan_review"),
      toolCallId: toolCall.id,
      agentId: agent.id,
      sessionId: agent.sessionId,
      projectId: agent.projectId,
      slug,
      title,
      summary,
      planPath,
      content: await readFile(planPath, "utf8"),
      status: "pending",
      requestedAt: now,
      updatedAt: now,
    };
    await this.upsertPlanReview(review);
    await this.events.publish("plan_review.requested", { planReview: review });

    const resolved = await this.waitForPlanReview(review.id, signal);
    return {
      review: resolved,
      outcome: resolved.status,
      feedback: resolved.feedback,
      mode: this.getAgent(agent.id).mode,
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
      sessionId: updated.sessionId,
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

  private planPath(agent: AgentRecord, slug: string): string {
    return join(this.planDir(agent), `${slug}.md`);
  }

  private slugArg(value: unknown): string {
    if (typeof value !== "string") {
      throw new Error("Tool argument 'slug' must be a string.");
    }
    const slug = value.trim();
    const parsed = planSlugSchema.safeParse(slug);
    if (!parsed.success) {
      throw new Error(
        "Tool argument 'slug' must match /^[a-z0-9][a-z0-9._-]{0,79}$/ and cannot contain path separators or spaces.",
      );
    }
    return parsed.data;
  }

  private planReviewsPath(): string {
    return join(this.storage.paths.home, "plans", "plan-reviews.jsonl");
  }
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Tool argument '${name}' must be a non-empty string.`);
  }
  return value;
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
