import type {
  AgentProjection,
  ConversationEvent,
  ModelContent,
} from "@nervekit/contracts/core";
import {
  convertToLlm,
  createCompactionSummaryMessage,
  createHarnessMessage,
} from "@nervekit/harness/messages";

export type Message = ReturnType<typeof convertToLlm>[number];
export interface ProjectionOptions {
  /** The host resolves image paths in prompt text; core performs no file I/O. */
  resolveAgentProjection?: (projection: AgentProjection) => ModelContent;
  resolveUserContent?: (text: string, event: ConversationEvent) => ModelContent;
}
export interface ProjectedMessage {
  event: ConversationEvent;
  message: Message;
}

export function selectContextEvents(path: ConversationEvent[]): {
  compaction: Extract<ConversationEvent, { type: "compaction" }> | undefined;
  events: ConversationEvent[];
} {
  let index = path.length - 1;
  while (index >= 0 && path[index].type !== "compaction") index--;
  const compaction = index < 0 ? undefined : path[index];
  if (!compaction || compaction.type !== "compaction")
    return { compaction: undefined, events: path };
  const firstKept = compaction.payload.firstKeptEventId;
  const start =
    firstKept === null
      ? index
      : path.findIndex((event) => event.id === firstKept);
  if (start < 0 || start > index)
    throw new Error("Compaction boundary is not on the selected path");
  return {
    compaction,
    events: [...path.slice(start, index), ...path.slice(index + 1)].filter(
      (event) => event.type !== "compaction",
    ),
  };
}

/** Project with source identities for compaction planning. Results follow their assistant. */
export function projectModelMessages(
  path: ConversationEvent[],
  options: ProjectionOptions = {},
): ProjectedMessage[] {
  const { compaction, events } = selectContextEvents(path);
  const projected: ProjectedMessage[] = [];
  const add = (event: ConversationEvent, message: Message) =>
    projected.push({ event, message });
  if (compaction) {
    add(
      compaction,
      convertToLlm([
        createCompactionSummaryMessage(
          compaction.payload.summary,
          compaction.payload.tokensBefore,
          compaction.createdAt,
        ),
      ])[0],
    );
  }
  const responses = new Map<
    string,
    Extract<ConversationEvent, { type: "tool_call_response" }>
  >();
  for (const event of events) {
    if (event.type !== "tool_call_response" || event.payload.origin !== "model")
      continue;
    const { assistantEventId, contentIndex } = event.payload;
    const key = `${assistantEventId}:${contentIndex}`;
    if (!responses.has(key)) responses.set(key, event);
  }
  for (const event of events) {
    const timestamp = Date.parse(event.createdAt);
    if (event.llmRepresentation === "none") continue;
    switch (event.type) {
      case "user_message":
        add(event, {
          role: "user",
          content:
            options.resolveUserContent?.(event.payload.text, event) ??
            event.payload.text,
          timestamp,
        });
        break;
      case "assistant_message": {
        add(event, { role: "assistant", ...event.payload, timestamp });
        event.payload.content.forEach((block, index) => {
          if (block.type !== "toolCall") return;
          const response = responses.get(`${event.id}:${index}`);
          const valid =
            response?.payload.providerCallId === block.id &&
            response.payload.toolName === block.name;
          add(valid ? response : event, {
            role: "toolResult",
            toolCallId: block.id,
            toolName: block.name,
            content: valid
              ? resolveProjection(response.payload.agentProjection, options)
              : [{ type: "text", text: "Tool call was interrupted" }],
            isError: !valid || response.payload.outcome !== "completed",
            timestamp: valid ? Date.parse(response.createdAt) : timestamp,
          });
        });
        break;
      }
      case "tool_call_response":
        if (
          event.payload.origin === "user" &&
          event.llmRepresentation === "user"
        ) {
          // The durable response's model content includes the command/output framing.
          add(event, {
            role: "user",
            content: resolveProjection(event.payload.agentProjection, options),
            timestamp,
          });
        }
        break;
      case "system_event":
        if (event.payload.subtype !== "execution_state") {
          add(
            event,
            convertToLlm([
              createHarnessMessage(
                event.payload.subtype === "async_bash_event"
                  ? "task_event"
                  : event.payload.subtype,
                event.payload.text,
                event.payload,
                event.createdAt,
              ),
            ])[0],
          );
        }
        break;
      case "compaction":
        break;
    }
  }
  return projected;
}

/** The supplied path is root-to-head (oldest first), not repository pagination order. */
export function buildModelMessages(
  path: ConversationEvent[],
  options: ProjectionOptions = {},
): Message[] {
  return projectModelMessages(path, options).map(({ message }) => message);
}

function resolveProjection(
  projection: AgentProjection,
  options: ProjectionOptions,
): ModelContent {
  if (options.resolveAgentProjection)
    return options.resolveAgentProjection(projection);
  return projection.map((block) =>
    block.type === "text"
      ? block
      : { type: "text", text: `[Image asset: ${block.assetId}]` },
  );
}
