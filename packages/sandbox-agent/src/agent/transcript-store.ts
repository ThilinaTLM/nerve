import path from "node:path";
import { JsonlStore } from "../state/jsonl-store.js";

export type TranscriptScope = {
  conversationId: string;
  agentId: string;
  runId: string;
};

export class TranscriptStore {
  constructor(private readonly stateDir: string) {}
  async append(scope: TranscriptScope, entry: unknown): Promise<void> {
    await new JsonlStore(this.pathFor(scope)).append(entry);
  }
  async read(scope: TranscriptScope): Promise<unknown[]> {
    return new JsonlStore(this.pathFor(scope)).readAll();
  }
  pathFor(scope: TranscriptScope): string {
    return path.join(
      this.stateDir,
      "conversations",
      scope.conversationId,
      "agents",
      scope.agentId,
      "runs",
      scope.runId,
      "transcript.jsonl",
    );
  }
}
