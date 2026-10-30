import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { UnreadableConversation } from "@nervekit/contracts/activity";
import type { ActivityService } from "./activity.service.js";

type Identity = Omit<UnreadableConversation, "error">;

/** One session-only notice; raw reads never pass through the failing projection. */
export class UnreadableConversationActivity {
  readonly #failures = new Map<string, string>();
  #activityId?: string;
  #scheduled = false;
  constructor(
    private readonly options: {
      activities: Pick<ActivityService, "reportNotice" | "removeNotice">;
      lookup(id: string): Identity | null;
      delete(id: string): Promise<void>;
    },
  ) {}

  report(conversationId: string, error: unknown): void {
    const issue = error instanceof ZodError ? error.issues[0] : undefined;
    const message = (
      issue
        ? `${issue.path.map(String).join(".")}: ${issue.message}`
        : error instanceof Error
          ? error.message
          : String(error)
    ).slice(0, 500);
    if (this.#failures.get(conversationId) === message) return;
    this.#failures.set(conversationId, message);
    this.schedule();
  }
  forget(conversationId: string): void {
    if (this.#failures.delete(conversationId)) this.schedule();
  }
  async delete(conversationId: string): Promise<{ removed: number }> {
    if (!this.#failures.has(conversationId)) return { removed: 0 };
    await this.options.delete(conversationId);
    this.forget(conversationId);
    return { removed: 1 };
  }
  private schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.publish();
    });
  }
  private publish(): void {
    const conversations: UnreadableConversation[] = [];
    for (const [id, error] of this.#failures) {
      let row: Identity | null;
      try {
        row = this.options.lookup(id);
      } catch {
        row = {
          id,
          title: id,
          projectId: "",
          projectName: "Unknown project",
        };
      }
      if (!row) {
        this.#failures.delete(id);
        continue;
      }
      conversations.push({
        id,
        title: row.title.trim() || id,
        projectId: row.projectId,
        projectName: row.projectName,
        error,
      });
    }
    if (!conversations.length) {
      if (this.#activityId)
        this.options.activities.removeNotice(this.#activityId);
      this.#activityId = undefined;
      return;
    }
    this.#activityId ??= `activity_unreadable_${randomUUID()}`;
    this.options.activities.reportNotice({
      id: this.#activityId,
      kind: "conversation.unreadable",
      title: `${conversations.length} conversation${conversations.length === 1 ? "" : "s"} couldn't be loaded`,
      unreadableConversations: conversations,
    });
  }
}
