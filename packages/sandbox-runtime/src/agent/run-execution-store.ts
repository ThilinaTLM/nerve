import { readdir } from "node:fs/promises";
import path from "node:path";
import type { SandboxRunExecutionRecord } from "@nervekit/contracts";
import { JsonStore } from "../state/json-store.js";

export class RunExecutionStore {
  constructor(private readonly stateDir: string) {}

  async write(record: SandboxRunExecutionRecord): Promise<void> {
    await new JsonStore<SandboxRunExecutionRecord>(this.pathFor(record)).write(
      record,
    );
  }

  async read(scope: {
    conversationId: string;
    agentId: string;
    runId: string;
    executionId: string;
  }): Promise<SandboxRunExecutionRecord | undefined> {
    return new JsonStore<SandboxRunExecutionRecord | undefined>(
      this.pathFor(scope),
    ).read(undefined);
  }

  async list(scope?: {
    conversationId?: string;
    agentId?: string;
    runId?: string;
  }): Promise<SandboxRunExecutionRecord[]> {
    const root = path.join(this.stateDir, "conversations");
    const out: SandboxRunExecutionRecord[] = [];
    try {
      const conversations = scope?.conversationId
        ? [scope.conversationId]
        : await readdir(root);
      for (const conversationId of conversations) {
        const agentsRoot = path.join(root, conversationId, "agents");
        const agents = scope?.agentId
          ? [scope.agentId]
          : await readdir(agentsRoot).catch(() => []);
        for (const agentId of agents) {
          const runsRoot = path.join(agentsRoot, agentId, "runs");
          const runs = scope?.runId
            ? [scope.runId]
            : await readdir(runsRoot).catch(() => []);
          for (const runId of runs) {
            const executionsRoot = path.join(runsRoot, runId, "executions");
            for (const executionId of await readdir(executionsRoot).catch(
              () => [],
            )) {
              if (!executionId.endsWith(".json")) continue;
              const record = await this.read({
                conversationId,
                agentId,
                runId,
                executionId: executionId.replace(/\.json$/, ""),
              });
              if (record) out.push(record);
            }
          }
        }
      }
    } catch {
      // Missing or unreadable persisted state is ignored during discovery.
    }
    return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  pathFor(scope: {
    conversationId: string;
    agentId: string;
    runId: string;
    executionId: string;
  }): string {
    return path.join(
      this.stateDir,
      "conversations",
      scope.conversationId,
      "agents",
      scope.agentId,
      "runs",
      scope.runId,
      "executions",
      `${scope.executionId}.json`,
    );
  }
}
