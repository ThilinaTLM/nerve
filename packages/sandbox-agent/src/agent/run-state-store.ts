import { readdir } from "node:fs/promises";
import path from "node:path";
import { JsonStore } from "../state/json-store.js";

export type RunState = {
  conversationId: string;
  agentId: string;
  runId: string;
  status: string;
  updatedAt: string;
  createdAt?: string;
  prompt?: string;
  mode?: "coding" | "planning";
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
  async list(): Promise<RunState[]> {
    const root = path.join(this.stateDir, "conversations");
    const out: RunState[] = [];
    try {
      for (const conversation of await readdir(root)) {
        const agentsDir = path.join(root, conversation, "agents");
        for (const agent of await readdir(agentsDir).catch(() => [])) {
          const runsDir = path.join(agentsDir, agent, "runs");
          for (const run of await readdir(runsDir).catch(() => [])) {
            const state = await this.read({
              conversationId: conversation,
              agentId: agent,
              runId: run,
            });
            if (state) out.push(state);
          }
        }
      }
    } catch {}
    return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }
  pathFor(
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
