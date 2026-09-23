import { z } from "zod";
import {
  asyncSubagentStatusSchema,
  type AsyncSubagentToolName,
} from "@nervekit/contracts/agents";
import {
  SUBAGENT_LIST_PREVIEW_COUNT,
  subagentToolResultPreviewSchemas,
  type SubagentTeammatePreview,
} from "@nervekit/contracts/tools";
import {
  firstLines,
  textOverflowStats,
} from "../../tools/artifacts/transcript-text-preview.js";

/** Head lines of a teammate response kept in the status card. */
export const SUBAGENT_RESPONSE_PREVIEW_LINES = 12;
/**
 * Character cap of the response preview. At ≤4 UTF-8 bytes per character this
 * stays under 6 KB, leaving the rest of the shared 8 KB public text budget for
 * the teammate row so the final projector never truncates a second time.
 */
export const SUBAGENT_RESPONSE_PREVIEW_CHARS = 1_500;

// `agentId` is optional so records created before ids were exposed still render.
const statusDetailsSchema = asyncSubagentStatusSchema.extend({
  agentId: z.string().optional(),
});
type StatusDetails = z.infer<typeof statusDetailsSchema>;
const promptDetailsSchema = z.object({
  agentId: z.string().optional(),
  name: z.string(),
  runId: z.string(),
  accepted: z.literal(true),
});
const listDetailsSchema = z.object({
  subagents: z.array(statusDetailsSchema),
  nextCursor: z.string().optional(),
});

export type SubagentToolPreviewOverflow = {
  hidden: number;
  noun: "lines" | "characters" | "teammates";
  direction: "head";
};

export type SubagentToolTranscriptPreview = {
  resultPreview?: unknown;
  overflow?: SubagentToolPreviewOverflow;
  valid: boolean;
};

function details(value: unknown): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).details
    : undefined;
}

/** Builds a teammate row without undefined keys so projection is lossless. */
function teammate(status: StatusDetails): SubagentTeammatePreview {
  return {
    ...(status.agentId ? { agentId: status.agentId } : {}),
    name: status.name,
    state: status.state,
    ...(status.outcome ? { outcome: status.outcome } : {}),
    ...(status.runId ? { runId: status.runId } : {}),
  };
}

export function buildSubagentToolTranscriptPreview(
  toolName: AsyncSubagentToolName,
  result: unknown,
): SubagentToolTranscriptPreview {
  if (result === undefined) return { valid: true };
  const raw = details(result);
  switch (toolName) {
    case "subagent_new":
    case "subagent_stop": {
      const parsed = statusDetailsSchema.safeParse(raw);
      if (!parsed.success) return { valid: false };
      return {
        resultPreview: { teammate: teammate(parsed.data) },
        valid: true,
      };
    }
    case "subagent_status": {
      const parsed = statusDetailsSchema.safeParse(raw);
      if (!parsed.success) return { valid: false };
      const response = parsed.data.response;
      if (!response) {
        return {
          resultPreview: { teammate: teammate(parsed.data) },
          valid: true,
        };
      }
      const text = firstLines(
        response.text,
        SUBAGENT_RESPONSE_PREVIEW_LINES,
        SUBAGENT_RESPONSE_PREVIEW_CHARS,
      );
      const stats = textOverflowStats([text]);
      return {
        resultPreview: {
          teammate: teammate(parsed.data),
          response: {
            text: text.value ?? "",
            complete: response.complete,
            runId: response.runId,
          },
        },
        overflow:
          stats.hidden > 0
            ? {
                hidden: stats.hidden,
                noun: stats.noun === "lines" ? "lines" : "characters",
                direction: "head",
              }
            : undefined,
        valid: true,
      };
    }
    case "subagent_prompt": {
      const parsed = promptDetailsSchema.safeParse(raw);
      if (!parsed.success) return { valid: false };
      return {
        resultPreview: {
          teammate: teammate({
            agentId: parsed.data.agentId,
            name: parsed.data.name,
            state: "running",
            runId: parsed.data.runId,
          }),
          runId: parsed.data.runId,
        },
        valid: true,
      };
    }
    case "subagent_list": {
      const parsed = listDetailsSchema.safeParse(raw);
      if (!parsed.success) return { valid: false };
      const all = parsed.data.subagents;
      const hidden = Math.max(0, all.length - SUBAGENT_LIST_PREVIEW_COUNT);
      return {
        resultPreview: {
          teammates: all.slice(0, SUBAGENT_LIST_PREVIEW_COUNT).map(teammate),
          more: hidden > 0 || parsed.data.nextCursor !== undefined,
        },
        overflow:
          hidden > 0
            ? { hidden, noun: "teammates", direction: "head" }
            : undefined,
        valid: true,
      };
    }
  }
}

export function isSubagentToolResultPreview(
  toolName: AsyncSubagentToolName,
  value: unknown,
): boolean {
  if (value === undefined) return true;
  return subagentToolResultPreviewSchemas[toolName].safeParse(value).success;
}
