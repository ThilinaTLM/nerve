import path from "node:path";
import { JsonStore } from "../state/json-store.js";
export type RunState = {
  conversationId: string;
  agentId: string;
  runId: string;
  status: string;
  updatedAt: string;
  [key: string]: unknown;
};
export class RunStateStore {
  constructor(private readonly stateDir: string) {}
  async write(state: RunState): Promise<void> {
    await new JsonStore<RunState>(this.pathFor(state)).write(state);
  }
  async read(
    state: Pick<RunState, "conversationId" | "agentId" | "runId">,
  ): Promise<RunState | undefined> {
    return new JsonStore<RunState | undefined>(this.pathFor(state)).read(
      undefined,
    );
  }
  private pathFor(
    state: Pick<RunState, "conversationId" | "agentId" | "runId">,
  ): string {
    return path.join(
      this.stateDir,
      "conversations",
      state.conversationId,
      "agents",
      state.agentId,
      "runs",
      state.runId,
      "state.json",
    );
  }
}
