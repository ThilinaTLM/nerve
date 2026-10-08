import { z } from "zod";

export const agentInputPreparationSchema = z
  .object({
    version: z.literal(1),
    agentId: z.string(),
    conversationId: z.string(),
    inputId: z.string(),
    inputHash: z.string(),
    blocks: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          command: z.string(),
          executionId: z.string(),
          state: z.enum([
            "not_started",
            "running",
            "completed",
            "cancelled",
            "indeterminate",
            "not_run",
          ]),
          configurationRevision: z.number().int().positive().optional(),
          cwd: z.string().optional(),
          runId: z.string().optional(),
          attemptId: z.string().optional(),
          toolRecordId: z.string().optional(),
          resultText: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((document, context) => {
    for (const [index, block] of document.blocks.entries()) {
      if (
        block.index !== index ||
        block.executionId !== `input-block:${document.inputId}:${index}`
      )
        context.addIssue({
          code: "custom",
          path: ["blocks", index],
          message:
            "Block execution identity must match accepted input and source order.",
        });
      if (
        ["completed", "cancelled", "indeterminate", "not_run"].includes(
          block.state,
        ) &&
        !block.resultText
      )
        context.addIssue({
          code: "custom",
          path: ["blocks", index, "resultText"],
          message: "Terminal preparation requires its retained result.",
        });
      if (
        block.state === "running" &&
        (!block.runId ||
          !block.attemptId ||
          !block.cwd ||
          !block.configurationRevision)
      )
        context.addIssue({
          code: "custom",
          path: ["blocks", index],
          message: "Running commands require captured execution authority.",
        });
    }
  });
export type AgentInputPreparation = z.infer<typeof agentInputPreparationSchema>;
