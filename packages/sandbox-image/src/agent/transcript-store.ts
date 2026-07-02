import path from "node:path";
import { JsonlStore } from "../state/jsonl-store.js";
export class TranscriptStore {
  constructor(private readonly stateDir: string) {}
  async append(
    scope: { conversationId: string; agentId: string; runId: string },
    entry: unknown,
  ): Promise<void> {
    await new JsonlStore(
      path.join(
        this.stateDir,
        "conversations",
        scope.conversationId,
        "agents",
        scope.agentId,
        "runs",
        scope.runId,
        "transcript.jsonl",
      ),
    ).append(entry);
  }
}
