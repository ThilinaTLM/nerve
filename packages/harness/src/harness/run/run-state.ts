import type { AgentMessage, QueueMode } from "../../agent/contracts/index.js";
import type {
  AgentHarnessPhase,
  PendingConversationWrite,
} from "../lifecycle/events.js";
import type { InboundQueuedMessage } from "../queue/operations.js";

/** Mutable state for one harness run and its inbound queues. */
export class HarnessRunState {
  phase: AgentHarnessPhase = "idle";
  abortController?: AbortController;
  promise?: Promise<void>;
  pendingConversationWrites: PendingConversationWrite[] = [];
  steerQueue: InboundQueuedMessage[] = [];
  followUpQueue: InboundQueuedMessage[] = [];
  nextTurnQueue: AgentMessage[] = [];
  forceDrainAll = false;
  readonly queuedMessageWrites = new WeakMap<
    AgentMessage,
    { id?: string; timestamp?: string }
  >();

  constructor(
    public steeringQueueMode: QueueMode,
    public followUpQueueMode: QueueMode,
  ) {}
}
