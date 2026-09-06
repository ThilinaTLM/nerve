import { ApplicationError } from "../../core/application-error.js";
/** Admission reservations only; cleanup's internal finishing writes remain allowed. */
export class MaintenanceScopes {
  private readonly projects = new Set<string>();
  private readonly conversations = new Set<string>();
  reserveProject(id: string): () => void {
    this.assertProject(id);
    this.projects.add(id);
    return () => {
      this.projects.delete(id);
    };
  }
  reserveConversation(id: string): () => void {
    this.assertConversation(id);
    this.conversations.add(id);
    return () => {
      this.conversations.delete(id);
    };
  }
  assertProject(id: string): void {
    if (this.projects.has(id))
      throw new ApplicationError(
        409,
        "MAINTENANCE_BUSY",
        "This project is being removed.",
      );
  }
  assertConversation(id: string): void {
    if (this.conversations.has(id))
      throw new ApplicationError(
        409,
        "MAINTENANCE_BUSY",
        "This conversation is being removed.",
      );
  }
}
