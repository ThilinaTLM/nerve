import { EventStream } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentMessage } from "../../types.js";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

export function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event: AgentEvent) => event.type === "agent_end",
    (event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
  );
}
