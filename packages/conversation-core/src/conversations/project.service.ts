import { createId } from "@nervekit/contracts";
import type { Project } from "@nervekit/contracts/core";
import type { CoreStorage } from "../storage/core-storage.js";

export class ProjectService {
  private currentGeneration = 0;
  get generation(): number {
    return this.currentGeneration;
  }
  constructor(
    private readonly storage: CoreStorage,
    private readonly deleteConversation: (id: string) => Promise<void>,
    private readonly now: () => string,
    private readonly onProjectDeleted?: (
      projectId: string,
    ) => void | Promise<void>,
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
    const result = this.storage.projects.insert({
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
    });
    this.currentGeneration++;
    return result;
  }
  get(id: string) {
    return this.storage.projects.get(id);
  }
  list() {
    return this.storage.projects.list();
  }
  update(id: string, patch: Partial<Pick<Project, "name" | "directory">>) {
    const result = this.storage.projects.update(id, {
      ...patch,
      updatedAt: this.now(),
    });
    this.currentGeneration++;
    return result;
  }
  async delete(id: string): Promise<void> {
    for (const conversation of this.storage.conversations.list({
      projectId: id,
      parentConversationId: null,
    }))
      await this.deleteConversation(conversation.id);
    this.storage.projects.delete(id);
    this.currentGeneration++;
    await this.onProjectDeleted?.(id);
  }
}
