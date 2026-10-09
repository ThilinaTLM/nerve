import {
  findExecutableCommandBlocks,
  replaceExecutableCommandBlocks,
} from "@nervekit/contracts/completions";
import { commandPreparationSchema } from "@nervekit/contracts/core";
import type { EventMapping } from "./events.mapper.js";
import { iso, type Legacy } from "./legacy.reader.js";

export function importPendingInput(
  mapping: EventMapping,
  conversationId: string,
  input: Legacy,
): void {
  if (input.state !== "pending") {
    mapping.report.skip(`Non-pending input (${input.state})`);
    return;
  }
  const source =
    input.origin?.kind === "parent"
      ? "parent_conversation"
      : input.origin?.kind === "system"
        ? "system"
        : "user";
  const parent =
    mapping.storage.conversations.get(conversationId)!.parentConversationId;
  if (source === "parent_conversation" && !parent) {
    mapping.report.skip("Parent input without parent conversation");
    return;
  }
  if (input.eligibility?.kind === "run")
    mapping.report.loss(
      "Pending run-targeted input retargeted to next turn after migration settlement",
    );
  const text = input.text ?? "";
  const blocks = source === "system" ? [] : findExecutableCommandBlocks(text);
  const receipts: Legacy[] = input.importPreparation?.blocks ?? [];
  const preparation = blocks.length
    ? commandPreparationSchema.parse({
        blocks: blocks.map((block, index) => {
          const receipt = receipts.find(
            (item) => item.index === index && item.command === block.command,
          );
          const state =
            receipt?.state === "completed" && receipt.resultText
              ? "completed"
              : receipt?.state === "running"
                ? "indeterminate"
                : "not_run";
          return {
            index,
            command: block.command,
            state,
            result:
              state === "completed"
                ? { stdout: receipt!.resultText, stderr: "", exitCode: null }
                : null,
          };
        }),
      })
    : null;
  const preparedText = preparation
    ? replaceExecutableCommandBlocks(
        text,
        preparation.blocks.map((block) => ({
          block: blocks[block.index],
          text:
            block.result?.stdout ??
            `[Command ${block.state} during migration; it was not repeated: ${block.command}]`,
        })),
      )
    : source === "system"
      ? null
      : text;
  if (preparation?.blocks.some((block) => block.state !== "completed"))
    mapping.report.loss(
      "Pending command blocks settled without replaying external effects",
    );
  mapping.storage.inputs.insert({
    inputId: mapping.ids.get("input", input.id),
    conversationId,
    source,
    senderConversationId: source === "parent_conversation" ? parent : null,
    content:
      source === "system"
        ? {
            subtype: "notification",
            producer: input.origin.producer ?? "import",
            text,
          }
        : text,
    deliveryTarget:
      input.eligibility?.kind === "next_run" ? "next_execution" : "next_turn",
    targetExecutionId: null,
    commandPreparation: preparation,
    preparedText,
    wakeWhenIdle: input.activation === "wake_if_idle",
    acceptedAt: iso(input.acceptedAt),
  });
}
