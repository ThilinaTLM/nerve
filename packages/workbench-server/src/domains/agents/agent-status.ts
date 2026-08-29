import type { AgentRecord } from "@nervekit/contracts/agents";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";

export type AgentStatus = AgentRecord["status"];

export async function setAgentStatus(
  agent: AgentRecord,
  status: AgentStatus,
  updateAgent: (agent: AgentRecord) => Promise<void>,
  events: StreamLogRegistry,
): Promise<void> {
  const updated = { ...agent, status, updatedAt: new Date().toISOString() };
  await updateAgent(updated);
  await events.publish("agent.status_changed", {
    agent: updated,
    agentId: updated.id,
    status,
  });
}
