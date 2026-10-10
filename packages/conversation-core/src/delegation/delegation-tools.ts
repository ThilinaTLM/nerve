import { createId } from "@nervekit/contracts";
import { conversationConfigSchema } from "@nervekit/contracts/core";
import type { ConversationCore } from "../core.js";
import type { CoreToolHandler } from "../tool-calls/core-tool.js";
import { childDefinition } from "./delegation-tool-definitions.js";
import { finalAssistantText } from "./child-report.js";
import { createExploreTool } from "./explore-tool.js";

export function createDelegationTools(
  core: ConversationCore,
  initializeChild: (
    parentId: string,
    childId: string,
    explore: boolean,
  ) => Promise<void>,
): CoreToolHandler[] {
  const exploring = new Set<string>();
  const children = (parentId: string) => core.getSnapshot(parentId).children;
  const owned = (parentId: string, args: Record<string, unknown>) => {
    if ((args.name !== undefined) === (args.conversationId !== undefined))
      throw new Error("Provide exactly one of name or conversationId");
    const child = children(parentId).find((row) =>
      args.conversationId !== undefined
        ? row.id === args.conversationId
        : row.title.toLowerCase() === String(args.name).toLowerCase(),
    );
    if (!child) throw new Error("Owned child conversation not found");
    return child;
  };
  core.onExecutionFinished((result) => {
    if (exploring.has(result.conversationId)) return;
    const snapshot = core.getSnapshot(result.conversationId);
    const parentId = snapshot.conversation.parentConversationId;
    if (!parentId) return;
    const events: ReturnType<ConversationCore["getEventsSince"]> = [];
    let sequence = 0;
    for (;;) {
      const page = core.getEventsSince(result.conversationId, sequence);
      if (!page.length) break;
      events.push(...page);
      sequence = page[page.length - 1].sequence;
    }
    const start = events.find((event) => event.id === result.executionId);
    if (!start) return;
    const report = finalAssistantText(core, result);
    for (const event of events) {
      if (
        event.sequence <= start.sequence ||
        event.sequence >= result.event.sequence ||
        event.type !== "user_message" ||
        event.payload.source !== "parent_conversation" ||
        !event.inputId
      )
        continue;
      core.inputs.enqueueNotice({
        conversationId: parentId,
        inputId: `input_${result.executionId}_${event.inputId}`,
        subtype: "sub_conversation_event",
        producer: result.conversationId,
        text: `${snapshot.conversation.title} (${result.conversationId}): ${result.transition}\n${report.slice(0, 2000)}`,
        details: {
          childConversationId: result.conversationId,
          assignmentId: event.inputId,
          status: result.transition,
          assetIds: [],
        },
        wakeWhenIdle: true,
      });
    }
  });
  const handlers: CoreToolHandler[] = [
    "subagent_new",
    "subagent_prompt",
    "subagent_status",
    "subagent_stop",
    "subagent_list",
  ].map((name) => ({
    definition: childDefinition(name),
    async execute(call) {
      const args = call.arguments;
      const parent = core.getSnapshot(call.conversationId);
      let value: unknown;
      if (name === "subagent_new") {
        if (typeof args.name !== "string" || !args.name.trim())
          throw new Error("A name is required");
        if (
          children(call.conversationId).some(
            (child) =>
              child.title.toLowerCase() === String(args.name).toLowerCase(),
          )
        )
          throw new Error("Child name already in use");
        const { conversationId, ...config } = parent.config;
        void conversationId;
        value = (
          await core.createConversation({
            projectId: parent.conversation.projectId,
            parentConversationId: call.conversationId,
            parentToolCallId: call.id,
            title: args.name,
            config,
          })
        ).conversation;
        await initializeChild(
          call.conversationId,
          (value as { id: string }).id,
          false,
        );
      } else if (name === "subagent_list")
        value = children(call.conversationId);
      else {
        const child = owned(call.conversationId, args);
        if (name === "subagent_prompt") {
          if (typeof args.prompt !== "string" || !args.prompt.trim())
            throw new Error("A prompt is required");
          if (child.paused && args.resume !== true)
            throw new Error("Child is paused; provide resume=true");
          if (args.configuration !== undefined) {
            if (
              !args.configuration ||
              typeof args.configuration !== "object" ||
              Array.isArray(args.configuration)
            )
              throw new Error("Invalid configuration");
            core.configure(
              child.id,
              conversationConfigSchema
                .omit({ conversationId: true })
                .partial()
                .strict()
                .parse(args.configuration),
            );
          }
          const inputId = createId("input");
          core.submitInput({
            conversationId: child.id,
            inputId,
            source: "parent_conversation",
            senderConversationId: call.conversationId,
            text: args.prompt,
            wakeWhenIdle: true,
          });
          if (args.resume === true) core.resume(child.id);
          value = { conversationId: child.id, assignmentId: inputId };
        } else if (name === "subagent_stop") {
          await core.stop(child.id);
          value = core.getSnapshot(child.id).conversation;
        } else value = child;
      }
      return { kind: "completed", result: { content: JSON.stringify(value) } };
    },
  }));
  handlers.push(createExploreTool(core, exploring, initializeChild));
  return handlers;
}
