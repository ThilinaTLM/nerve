import { createId } from "@nervekit/contracts";
import type { Project } from "@nervekit/contracts/core";
import type { CoreStorage } from "../storage/core-storage.js";

export class ProjectService {
  constructor(
    private readonly storage: CoreStorage,
    private readonly deleteConversation: (id: string) => Promise<void>,
    private readonly now: () => string,
  ) {}
  create(input: { id?: string; name: string; directory: string }): Project {
    const id = input.id ?? createId("proj");
    const existing = this.get(id);
    if (existing) {
      if (
        existing.name !== input.name ||
        existing.directory !== input.directory
      )
        throw new Error("Project ID already in use");
      return existing;
    }
    const now = this.now();
    return this.storage.projects.insert({
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    });
  }
  get(id: string) {
    return this.storage.projects.get(id);
  }
  list() {
    return this.storage.projects.list();
  }
  update(id: string, patch: Partial<Pick<Project, "name" | "directory">>) {
    return this.storage.projects.update(id, {
      ...patch,
      updatedAt: this.now(),
    });
  }
  async delete(id: string): Promise<void> {
    for (const conversation of this.storage.conversations.list({
      projectId: id,
      parentConversationId: null,
    }))
      await this.deleteConversation(conversation.id);
    this.storage.projects.delete(id);
  }
}
