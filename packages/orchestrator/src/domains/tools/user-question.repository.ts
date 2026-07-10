import { join } from "node:path";
import type {
  UserQuestionRecord,
  UserQuestionStatus,
} from "@nervekit/contracts";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import {
  appendJsonLine,
  type InitializedStorage,
  readJsonLines,
  rewriteJsonLines,
} from "../../infrastructure/storage/index.js";

export class UserQuestionRepository {
  readonly records = new Map<string, UserQuestionRecord>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly index: IndexStore,
  ) {}

  async hydrate(): Promise<void> {
    for (const question of await this.readLatest()) {
      this.records.set(question.id, question);
      this.index.upsertUserQuestion(question);
    }
  }

  list(status?: UserQuestionStatus): UserQuestionRecord[] {
    return [...this.records.values()]
      .filter((question) => !status || question.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(questionId: string): UserQuestionRecord | undefined {
    return this.records.get(questionId);
  }

  getPending(questionId: string): UserQuestionRecord {
    const question = this.records.get(questionId);
    if (!question) throw new Error("User question not found.");
    if (question.status !== "pending") {
      throw new Error("User question is already resolved.");
    }
    return question;
  }

  async upsert(question: UserQuestionRecord): Promise<void> {
    this.records.set(question.id, question);
    this.index.upsertUserQuestion(question);
    await appendJsonLine(this.path(), question, 0o600);
  }

  async removeForConversations(conversationIds: Set<string>): Promise<void> {
    for (const [id, question] of this.records) {
      if (conversationIds.has(question.conversationId)) {
        this.records.delete(id);
        this.index.deleteUserQuestion(id);
      }
    }
    await rewriteJsonLines(this.path(), this.list(), 0o600);
  }

  private async readLatest(): Promise<UserQuestionRecord[]> {
    const values = await readJsonLines<UserQuestionRecord>(this.path()).catch(
      () => [],
    );
    return latestById(values);
  }

  private path(): string {
    return join(
      this.storage.paths.home,
      "user-questions",
      "user-questions.jsonl",
    );
  }
}

function latestById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()];
}
