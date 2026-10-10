import { createId } from "@nervekit/contracts";
import type { ConversationCore, ExecutionFinished } from "../core.js";
import type { CoreToolHandler } from "../tool-calls/core-tool.js";
import { definition } from "./delegation-tool-definitions.js";
import { finalAssistantText } from "./child-report.js";

const EXPLORE_CONCURRENCY = 3;

export function createExploreTool(
  core: ConversationCore,
  exploring: Set<string>,
  initializeChild: (
    parentId: string,
    childId: string,
    explore: boolean,
  ) => Promise<void>,
): CoreToolHandler {
  const base = definition("explore");
  const tasks = { ...base.parameters.properties.tasks };
  delete (tasks as Record<string, unknown>).maxItems;
  return {
    definition: {
      ...base,
      parameters: {
        ...base.parameters,
        properties: { ...base.parameters.properties, tasks },
      },
      description:
        "Delegate read-only research to isolated child conversations. Provide shared context and labeled tasks. Waits for reports; cancelling stops the children.",
    },
    async execute(call, ctx) {
      const args = call.arguments;
      if (!Array.isArray(args.tasks) || !args.tasks.length)
        throw new Error("Explore tasks are required");
      const parent = core.getSnapshot(call.conversationId);
      const { conversationId, ...config } = parent.config;
      void conversationId;
      const reports: unknown[] = new Array(args.tasks.length);
      const active = new Set<string>();
      const controller = new AbortController();
      const signal = AbortSignal.any([ctx.signal, controller.signal]);
      let index = 0;
      const run = async () => {
        while (index < (args.tasks as unknown[]).length) {
          signal.throwIfAborted();
          const taskIndex = index++;
          const task = (args.tasks as Record<string, unknown>[])[taskIndex];
          if (
            !task ||
            typeof task.task !== "string" ||
            typeof task.label !== "string"
          )
            throw new Error("Invalid explore task");
          const child = await core.createConversation({
            projectId: parent.conversation.projectId,
            parentConversationId: call.conversationId,
            parentToolCallId: call.id,
            title: task.label,
            config: {
              ...config,
              permissionRuleSetId: "read_only",

              systemPrompt:
                "You are a read-only research teammate. Investigate the assigned task and return a clear report with relevant paths and findings. Do not modify files.",
            },
          });
          const id = child.conversation.id;
          await initializeChild(call.conversationId, id, true);
          exploring.add(id);
          active.add(id);
          try {
            const result = await new Promise<ExecutionFinished>(
              (resolve, reject) => {
                const unsubscribe = core.onExecutionFinished((result) => {
                  if (result.conversationId !== id) return;
                  cleanup();
                  resolve(result);
                });
                const abort = () => {
                  cleanup();
                  reject(signal.reason ?? new Error("Explore cancelled"));
                };
                const cleanup = () => {
                  unsubscribe();
                  signal.removeEventListener("abort", abort);
                };
                signal.addEventListener("abort", abort, { once: true });
                if (signal.aborted) {
                  abort();
                  return;
                }
                try {
                  core.submitInput({
                    conversationId: id,
                    inputId: createId("input"),
                    source: "parent_conversation",
                    senderConversationId: call.conversationId,
                    text: `${args.context ?? ""}\n${task.context ?? ""}\n${task.task}`,
                    wakeWhenIdle: true,
                  });
                } catch (error) {
                  cleanup();
                  reject(error);
                }
              },
            );
            reports[taskIndex] = {
              conversationId: id,
              label: task.label,
              status: result.transition,
              report: finalAssistantText(core, result),
            };
            active.delete(id);
          } finally {
            if (!active.has(id)) exploring.delete(id);
          }
        }
      };
      const workers = Array.from(
        { length: Math.min(EXPLORE_CONCURRENCY, args.tasks.length) },
        run,
      );
      try {
        await Promise.all(workers);
      } catch (error) {
        controller.abort(error);
        await Promise.allSettled(workers);
        await Promise.all([...active].map((id) => core.stop(id)));
        throw error;
      } finally {
        for (const id of active) exploring.delete(id);
      }
      return {
        kind: "completed",
        result: { content: JSON.stringify(reports) },
      };
    },
  };
}
