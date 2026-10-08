import { createHash } from "node:crypto";
import {
  agentInputPreparationSchema,
  type AgentInputPreparation,
  type AgentInputRecord,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import {
  findExecutableCommandBlocks,
  replaceExecutableCommandBlocks,
  formatInlineCommandResultText,
} from "@nervekit/contracts/completions";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { inlineCommandDisplayText } from "./inline-command-results.js";

const namespace = "agent_input_preparation";

/** Persist before executing: uncertain external effects are never automatically replayed. */
export async function prepareAgentInputCommands(options: {
  storage: Pick<InitializedStorage, "canonicalStore">;
  input: AgentInputRecord;
  actor: AgentRecord;
  runId: string;
  attemptId: string;
  signal: AbortSignal;
  execute(
    command: string,
    executionId: string,
    recordTool: (id: string) => Promise<void>,
  ): Promise<ToolCallRecord>;
  recover(
    executionId: string,
    toolRecordId?: string,
  ): ToolCallRecord | undefined | Promise<ToolCallRecord | undefined>;
}): Promise<string> {
  const { input, actor, signal } = options;
  const blocks =
    input.role === "user" && input.origin.kind !== "system"
      ? findExecutableCommandBlocks(input.text)
      : [];
  if (!blocks.length) return input.text;
  const store = options.storage.canonicalStore;
  const saved = await store.readDocument<unknown>(
    namespace,
    input.conversationId,
    input.id,
  );
  const inputHash = createHash("sha256").update(input.text).digest("hex");
  let revision = saved?.revision ?? 0;
  const document: AgentInputPreparation = saved
    ? agentInputPreparationSchema.parse(saved.data)
    : {
        version: 1,
        agentId: input.agentId,
        conversationId: input.conversationId,
        inputId: input.id,
        inputHash,
        blocks: blocks.map((block, index) => ({
          index,
          command: block.command,
          executionId: `input-block:${input.id}:${index}`,
          state: "not_started",
        })),
      };
  if (
    document.inputHash !== inputHash ||
    document.agentId !== actor.id ||
    document.inputId !== input.id ||
    document.conversationId !== input.conversationId ||
    document.blocks.length !== blocks.length
  )
    throw new Error("Command preparation does not match accepted input");
  const save = async () => {
    await store.writeDocument({
      namespace,
      scopeId: input.conversationId,
      documentId: input.id,
      data: agentInputPreparationSchema.parse(document),
      expectedRevision: revision,
    });
    revision++;
  };
  const validateTool = (
    tool: ToolCallRecord | undefined,
    executionId: string,
  ) => {
    if (
      tool &&
      (tool.agentId !== input.agentId ||
        tool.conversationId !== input.conversationId ||
        tool.providerToolCallId !== executionId)
    )
      throw new Error("Command receipt belongs to another input or agent");
  };
  let interrupted = false;
  for (const block of document.blocks) {
    if (block.command !== blocks[block.index]?.command)
      throw new Error("Command preparation source is corrupt");
    if (block.state === "running") {
      const tool = await options.recover(block.executionId, block.toolRecordId);
      validateTool(tool, block.executionId);
      if (
        tool &&
        ["completed", "failed", "cancelled", "denied"].includes(tool.status)
      ) {
        block.state = tool.status === "cancelled" ? "cancelled" : "completed";
        block.toolRecordId = tool.id;
        block.resultText = inlineCommandDisplayText(tool);
      } else {
        block.state = "indeterminate";
        block.resultText = formatInlineCommandResultText({
          command: block.command,
          status: "indeterminate",
          output:
            "Execution was interrupted before its outcome could be confirmed. Nerve did not repeat this command.",
        });
      }
      await save();
    }
    if (block.state !== "not_started") {
      interrupted ||= ["cancelled", "indeterminate", "not_run"].includes(
        block.state,
      );
      continue;
    }
    if (interrupted || signal.aborted) {
      block.state = "not_run";
      block.resultText = formatInlineCommandResultText({
        command: block.command,
        status: "not_run",
        output: "Command not started after interruption.",
      });
      await save();
      continue;
    }
    if (actor.readOnlyCeiling || actor.permissionLevel === "read_only")
      throw new Error("Read-only agent policy forbids inline shell execution");
    block.state = "running";
    block.configurationRevision = actor.configurationRevision ?? 1;
    block.cwd = actor.projectDir;
    block.runId = options.runId;
    block.attemptId = options.attemptId;
    await save();
    try {
      const tool = await options.execute(
        block.command,
        block.executionId,
        async (id) => {
          if (block.toolRecordId === id) return;
          block.toolRecordId = id;
          await save();
        },
      );
      validateTool(tool, block.executionId);
      block.toolRecordId = tool.id;
      block.state = tool.status === "cancelled" ? "cancelled" : "completed";
      block.resultText = inlineCommandDisplayText(tool);
    } catch (error) {
      // An exception after the durable claim does not prove the process never ran.
      const tool = await options.recover(block.executionId, block.toolRecordId);
      validateTool(tool, block.executionId);
      if (
        tool &&
        ["completed", "failed", "cancelled", "denied"].includes(tool.status)
      ) {
        block.state = tool.status === "cancelled" ? "cancelled" : "completed";
        block.toolRecordId = tool.id;
        block.resultText = inlineCommandDisplayText(tool);
      } else {
        block.state = "indeterminate";
        block.resultText = formatInlineCommandResultText({
          command: block.command,
          status: "indeterminate",
          output: `Command outcome could not be confirmed; it was not repeated. ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    interrupted ||=
      block.state === "cancelled" ||
      block.state === "indeterminate" ||
      signal.aborted;
    await save();
  }
  return replaceExecutableCommandBlocks(
    input.text,
    document.blocks.map((block) => ({
      block: blocks[block.index],
      text: block.resultText!,
    })),
  );
}
