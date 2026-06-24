import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type AgentRecord, agentRecordSchema } from "@nervekit/shared";
import {
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

export class AgentRepository {
  constructor(private readonly storage: InitializedStorage) {}

  agentDir(agentId: string): string {
    return join(this.storage.paths.home, "agents", agentId);
  }

  agentPath(agentId: string): string {
    return join(this.agentDir(agentId), "agent.json");
  }

  async loadAll(): Promise<AgentRecord[]> {
    const root = join(this.storage.paths.home, "agents");
    const agents: AgentRecord[] = [];
    for (const agentId of await listChildDirs(root)) {
      const parsed = agentRecordSchema.safeParse(
        await readJsonFile<unknown>(this.agentPath(agentId)).catch(
          () => undefined,
        ),
      );
      if (parsed.success) agents.push(parsed.data);
    }
    return agents;
  }

  async write(agent: AgentRecord): Promise<void> {
    await atomicWriteJson(this.agentPath(agent.id), agent, 0o600);
  }

  async remove(agentId: string): Promise<void> {
    await rm(this.agentDir(agentId), { recursive: true, force: true });
  }
}
