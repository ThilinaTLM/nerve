import type { AgentRecord } from "@nerve/shared";
import type { EventBus } from "../../infrastructure/events/index.js";

export async function setAgentStatus(
  agent: AgentRecord,
  status: AgentRecord["status"],
  updateAgent: (agent: AgentRecord) => Promise<void>,
  events: EventBus,
): Promise<void> {
  const updated = { ...agent, status, updatedAt: new Date().toISOString() };
  await updateAgent(updated);
  await events.publish("agent.status_changed", {
    agent: updated,
    agentId: updated.id,
    status,
  });
}
