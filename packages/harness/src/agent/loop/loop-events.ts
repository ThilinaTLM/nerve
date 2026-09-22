import type { AgentEvent } from "../contracts/index.js";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;
