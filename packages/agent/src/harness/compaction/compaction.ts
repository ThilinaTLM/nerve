import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai";
import type { AgentMessage, AnyModel, ThinkingLevel } from "../../types.js";
import { buildConversationContext } from "../conversation/conversation.js";
import type {
  CompactionEntry,
  ConversationTreeEntry,
} from "../conversation/entries.js";
import { CompactionError } from "../errors.js";
import {
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "../messages.js";
import { err, ok, type Result } from "../result.js";
import { findCutPoint } from "./cut-points.js";
import type {
  CompactionDetails,
  CompactionPreparation,
  CompactionResult,
  CompactionSettings,
} from "./types.js";
import { estimateContextTokens } from "./usage.js";
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  type FileOperations,
  formatFileOperations,
  serializeConversation,
} from "./utils.js";

function extractFileOperations(
  messages: AgentMessage[],
  entries: ConversationTreeEntry[],
  prevCompactionIndex: number,
): FileOperations {
  const fileOps = createFileOps();
  if (prevCompactionIndex >= 0) {
    const prevCompaction = entries[prevCompactionIndex] as CompactionEntry;
    if (!prevCompaction.fromHook && prevCompaction.details) {
      const details = prevCompaction.details as CompactionDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f);
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) fileOps.edited.add(f);
      }
      const detailsRecord = details as CompactionDetails & {
        fileOps?: { read?: unknown; written?: unknown; edited?: unknown };
      };
      if (Array.isArray(detailsRecord.fileOps?.read)) {
        for (const f of detailsRecord.fileOps.read) {
          if (typeof f === "string") fileOps.read.add(f);
        }
      }
      if (Array.isArray(detailsRecord.fileOps?.written)) {
        for (const f of detailsRecord.fileOps.written) {
          if (typeof f === "string") fileOps.written.add(f);
        }
      }
      if (Array.isArray(detailsRecord.fileOps?.edited)) {
        for (const f of detailsRecord.fileOps.edited) {
          if (typeof f === "string") fileOps.edited.add(f);
        }
      }
    }
  }
  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps);
  }

  return fileOps;
}
function getMessageFromEntry(
  entry: ConversationTreeEntry,
): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message as AgentMessage;
  }
  if (entry.type === "custom_message") {
    return createCustomMessage(
      entry.customType,
      entry.content as string | (TextContent | ImageContent)[],
      entry.display,
      entry.details,
      entry.timestamp,
    );
  }
  if (entry.type === "branch_summary") {
    return createBranchSummaryMessage(
      entry.summary,
      entry.fromId,
      entry.timestamp,
    );
  }
  if (entry.type === "compaction") {
    return createCompactionSummaryMessage(
      entry.summary,
      entry.tokensBefore,
      entry.timestamp,
    );
  }
  return undefined;
}

function getMessageFromEntryForCompaction(
  entry: ConversationTreeEntry,
): AgentMessage | undefined {
  if (entry.type === "compaction") {
    return undefined;
  }
  return getMessageFromEntry(entry);
}

export { findCutPoint, findTurnStartIndex } from "./cut-points.js";
export { isContextOverflowAssistantMessage } from "./overflow.js";
export {
  DEFAULT_COMPACTION_SETTINGS,
  deriveAutoCompactionPolicy,
  shouldAutoCompact,
  shouldCompact,
} from "./policy.js";
export type {
  AutoCompactionPolicy,
  AutoCompactionReason,
  CompactionDetails,
  CompactionPreparation,
  CompactionResult,
  CompactionSettings,
  ContextUsageEstimate,
  CutPointResult,
} from "./types.js";
export {
  calculateContextTokens,
  computeContextUsage,
  estimateContextTokens,
  estimateTokens,
  getLastAssistantUsage,
  getLatestCompactionEntry,
} from "./usage.js";

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Another agent will read ONLY this summary (not the original transcript) and immediately continue the work, so write it as a handover that lets them resume without re-reading anything.

Prioritize what is needed to continue. Keep finished work terse, and drop abandoned tangents, superseded approaches, and dead ends.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the conversation covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user that still apply]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes - ONE terse line each, no narration]

### In Progress
- [ ] [Current work, with enough detail to pick it back up]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale - only decisions that still constrain the remaining work]

## Next Steps
1. [Concrete, ordered list of exactly what to do next to finish the task]

## Critical Context
- [Data, examples, exact file paths, function names, commands, or error messages needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Expand detail for unfinished work and Next Steps; compress everything already done. Preserve exact file paths, function names, commands, and error messages verbatim.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Another agent will read ONLY this summary (not the original transcript) and immediately continue the work, so keep it a tight handover focused on what remains.

Update the existing structured summary with new information. RULES:
- PRESERVE information still needed to continue; compress or drop details about work that is finished or no longer relevant
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" (and keep Done terse, one line each)
- UPDATE "Next Steps" so they are the concrete, ordered actions to finish the task
- PRESERVE exact file paths, function names, commands, and error messages verbatim

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Concrete, ordered list of exactly what to do next to finish the task]

## Critical Context
- [Preserve context still needed to continue; add new if needed]

Keep each section concise. Expand detail for unfinished work and Next Steps; compress everything already done. Preserve exact file paths, function names, commands, and error messages verbatim.`;

/** Generate or update a conversation summary for compaction. */
export async function generateSummary(
  currentMessages: AgentMessage[],
  model: AnyModel,
  reserveTokens: number,
  apiKey: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
  thinkingLevel?: ThinkingLevel,
): Promise<Result<string, CompactionError>> {
  const maxTokens = Math.min(
    Math.floor(0.8 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );
  let basePrompt = previousSummary
    ? UPDATE_SUMMARIZATION_PROMPT
    : SUMMARIZATION_PROMPT;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }
  const llmMessages = convertToLlm(currentMessages);
  const conversationText = serializeConversation(llmMessages);
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;

  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const completionOptions =
    model.reasoning && thinkingLevel && thinkingLevel !== "off"
      ? { maxTokens, signal, apiKey, headers, reasoning: thinkingLevel }
      : { maxTokens, signal, apiKey, headers };

  const response = await completeSimple(
    model,
    {
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      messages: summarizationMessages,
    },
    completionOptions,
  );
  if (response.stopReason === "aborted") {
    return err(
      new CompactionError(
        "aborted",
        response.errorMessage || "Summarization aborted",
      ),
    );
  }
  if (response.stopReason === "error") {
    return err(
      new CompactionError(
        "summarization_failed",
        `Summarization failed: ${response.errorMessage || "Unknown error"}`,
      ),
    );
  }

  const textContent = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return ok(textContent);
}

/** Prepare conversation entries for compaction, or return undefined when compaction is not applicable. */
export function prepareCompaction(
  pathEntries: ConversationTreeEntry[],
  settings: CompactionSettings,
): Result<CompactionPreparation | undefined, CompactionError> {
  if (
    pathEntries.length === 0 ||
    pathEntries[pathEntries.length - 1].type === "compaction"
  ) {
    return ok(undefined);
  }

  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === "compaction") {
      prevCompactionIndex = i;
      break;
    }
  }

  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
    previousSummary = prevCompaction.summary;
    const firstKeptEntryIndex = pathEntries.findIndex(
      (entry) => entry.id === prevCompaction.firstKeptEntryId,
    );
    boundaryStart =
      firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
  }
  const boundaryEnd = pathEntries.length;

  const tokensBefore = estimateContextTokens(
    buildConversationContext(pathEntries).messages,
  ).tokens;

  const cutPoint = findCutPoint(
    pathEntries,
    boundaryStart,
    boundaryEnd,
    settings.keepRecentTokens,
  );
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) {
    return err(
      new CompactionError(
        "invalid_conversation",
        "First kept entry has no UUID - conversation history is invalid",
      ),
    );
  }
  const firstKeptEntryId = firstKeptEntry.id;

  const historyEnd = cutPoint.isSplitTurn
    ? cutPoint.turnStartIndex
    : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize: AgentMessage[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    const msg = getMessageFromEntryForCompaction(pathEntries[i]);
    if (msg) messagesToSummarize.push(msg);
  }
  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (
      let i = cutPoint.turnStartIndex;
      i < cutPoint.firstKeptEntryIndex;
      i++
    ) {
      const msg = getMessageFromEntryForCompaction(pathEntries[i]);
      if (msg) turnPrefixMessages.push(msg);
    }
  }
  const fileOps = extractFileOperations(
    messagesToSummarize,
    pathEntries,
    prevCompactionIndex,
  );
  if (cutPoint.isSplitTurn) {
    for (const msg of turnPrefixMessages) {
      extractFileOpsFromMessage(msg, fileOps);
    }
  }

  return ok({
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  });
}

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

export { serializeConversation } from "./utils.js";

/** Generate compaction summary data from prepared conversation history. */
export async function compact(
  preparation: CompactionPreparation,
  model: AnyModel,
  apiKey: string,
  headers?: Record<string, string>,
  customInstructions?: string,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
): Promise<Result<CompactionResult, CompactionError>> {
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  } = preparation;

  if (!firstKeptEntryId) {
    return err(
      new CompactionError(
        "invalid_conversation",
        "First kept entry has no UUID - conversation history is invalid",
      ),
    );
  }

  let summary: string;

  if (isSplitTurn && turnPrefixMessages.length > 0) {
    const [historyResult, turnPrefixResult] = await Promise.all([
      messagesToSummarize.length > 0
        ? generateSummary(
            messagesToSummarize,
            model,
            settings.reserveTokens,
            apiKey,
            headers,
            signal,
            customInstructions,
            previousSummary,
            thinkingLevel,
          )
        : Promise.resolve(ok<string, CompactionError>("No prior history.")),
      generateTurnPrefixSummary(
        turnPrefixMessages,
        model,
        settings.reserveTokens,
        apiKey,
        headers,
        signal,
        thinkingLevel,
      ),
    ]);
    if (!historyResult.ok) return err(historyResult.error);
    if (!turnPrefixResult.ok) return err(turnPrefixResult.error);
    summary = `${historyResult.value}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult.value}`;
  } else {
    const summaryResult = await generateSummary(
      messagesToSummarize,
      model,
      settings.reserveTokens,
      apiKey,
      headers,
      signal,
      customInstructions,
      previousSummary,
      thinkingLevel,
    );
    if (!summaryResult.ok) return err(summaryResult.error);
    summary = summaryResult.value;
  }

  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);

  return ok({
    summary,
    firstKeptEntryId,
    tokensBefore,
    details: { readFiles, modifiedFiles } as CompactionDetails,
  });
}
async function generateTurnPrefixSummary(
  messages: AgentMessage[],
  model: AnyModel,
  reserveTokens: number,
  apiKey: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
): Promise<Result<string, CompactionError>> {
  const maxTokens = Math.min(
    Math.floor(0.5 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );
  const llmMessages = convertToLlm(messages);
  const conversationText = serializeConversation(llmMessages);
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const response = await completeSimple(
    model,
    {
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      messages: summarizationMessages,
    },
    model.reasoning && thinkingLevel && thinkingLevel !== "off"
      ? { maxTokens, signal, apiKey, headers, reasoning: thinkingLevel }
      : { maxTokens, signal, apiKey, headers },
  );
  if (response.stopReason === "aborted") {
    return err(
      new CompactionError(
        "aborted",
        response.errorMessage || "Turn prefix summarization aborted",
      ),
    );
  }
  if (response.stopReason === "error") {
    return err(
      new CompactionError(
        "summarization_failed",
        `Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`,
      ),
    );
  }

  return ok(
    response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n"),
  );
}
