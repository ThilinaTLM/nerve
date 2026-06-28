import type {
  ConversationRunStatusDetails,
  EventEnvelope,
} from "@nervekit/shared";
import type { EventBus } from "../../../infrastructure/events/event-bus.js";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { ToolService } from "../../tools/tool-service.js";
import type { AppendEntryFn } from "./message-mirror.js";

const INTERRUPTED_MESSAGE =
  "Agent run was interrupted because the Nerve daemon restarted.";

const startedType = "conversation.run.started";
const terminalTypes = new Set([
  "conversation.run.completed",
  "conversation.run.failed",
  "conversation.run.suspended",
]);

interface RunRef {
  runId: string;
  agentId?: string;
  projectId?: string;
  conversationId?: string;
}

function stringField(
  data: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = data?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Derive runs that were active (started, never reached a terminal event) when a
 * previous daemon process died, and publish a durable `conversation.run.failed`
 * for each. Live tool-draft / streaming events are transient and are never
 * replayed, so without this a crash leaves the web UI with a phantom
 * "Generating" draft and an active run that can never resolve. Emitting the
 * terminal event lets the existing client reducers clear that state on the next
 * reconnect.
 */
export async function recoverInterruptedRuns(
  events: EventEnvelope[],
  deps: {
    events: EventBus;
    logger: ApplicationLogger;
    tools: Pick<ToolService, "terminateNonTerminalToolCallsForRun">;
    appendEntry: AppendEntryFn;
  },
): Promise<number> {
  const active = new Map<string, RunRef>();
  for (const event of events) {
    const data = event.data as Record<string, unknown> | undefined;
    const runId = stringField(data, "runId");
    if (!runId) continue;
    if (event.type === startedType) {
      active.set(runId, {
        runId,
        agentId: stringField(data, "agentId"),
        projectId: stringField(data, "projectId"),
        conversationId: stringField(data, "conversationId"),
      });
    } else if (terminalTypes.has(event.type)) {
      active.delete(runId);
    }
  }

  if (active.size === 0) return 0;

  const failedAt = new Date().toISOString();
  for (const run of active.values()) {
    // Persist a continuable `interrupted` run_status entry (file-first) so the
    // conversation shows an actionable Continue card after the restart. It is
    // parented at the conversation's current leaf and never mirrored to the model.
    if (run.conversationId) {
      const details = {
        type: "agent_run_retry_status",
        state: "interrupted",
        runId: run.runId,
        errorMessage: INTERRUPTED_MESSAGE,
        retryable: true,
      } satisfies ConversationRunStatusDetails;
      try {
        const statusEntry = await deps.appendEntry(
          {
            conversationId: run.conversationId,
            agentId: run.agentId,
            runId: run.runId,
            role: "system",
            kind: "run_status",
            text: INTERRUPTED_MESSAGE,
            details,
          },
          { mirrorToHarness: false },
        );
        await deps.events.publish("conversation.entry.appended", {
          conversationId: run.conversationId,
          agentId: run.agentId,
          projectId: run.projectId,
          runId: run.runId,
          entry: statusEntry,
        });
      } catch (error) {
        await deps.logger.warn(
          "Failed to append interrupted run status entry",
          { context: { runId: run.runId }, error },
        );
      }
    }
    await deps.events.publish("conversation.run.failed", {
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      conversationId: run.conversationId,
      message: `${INTERRUPTED_MESSAGE} Click Continue to resume.`,
      aborted: true,
      interrupted: true,
      failedAt,
    });
    await deps.tools.terminateNonTerminalToolCallsForRun(
      run.runId,
      "Tool execution was interrupted because the Nerve daemon restarted.",
    );
  }

  await deps.logger.warn("Recovered interrupted agent runs after restart", {
    context: { count: active.size },
  });
  return active.size;
}
