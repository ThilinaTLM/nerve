import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { completeSimpleWithModel } from "../../pi-ai-models.js";
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
  AUTO_COMPACTION_PROFILES,
  DEFAULT_AUTO_COMPACTION_SETTINGS,
  DEFAULT_COMPACTION_SETTINGS,
  deriveAutoCompactionPolicy,
  resolveAutoCompactionPercentages,
  shouldAutoCompact,
  shouldCompact,
} from "./policy.js";
export type {
  AutoCompactionConfiguration,
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
  getCompactionDecisionTokens,
  getLastAssistantUsage,
  getLatestCompactionEntry,
} from "./usage.js";

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const REQUIRED_SUMMARY_HEADINGS = [
  "Goal",
  "Requirements and Constraints",
  "Work Completed",
  "Work Remaining",
  "Key Decisions",
  "Current Working State",
  "Continuation Plan",
  "Critical References",
] as const;

const SUMMARY_FORMAT = `Use this EXACT format:

## Goal
[The user's objective and intended outcome.]

## Requirements and Constraints
- [All still-relevant user requirements, technical constraints, and preferences.]
- [Or "(none)".]

## Work Completed
- [x] [Concrete completed work with enough implementation detail to avoid repeating it. Include exact files, symbols, behavior, and validation when relevant.]
- [Do not mark an item complete without evidence.]

## Work Remaining
- [ ] [Every unfinished or partially finished item, with current status or blocker.]
- [Use "(none)" only when the task is actually complete.]

## Key Decisions
- **[Decision]**: [Rationale and implications that still constrain the work.]

## Current Working State
- [Partial/uncommitted edits, current files and symbols, test/build status, failures, commands, and errors needed to resume safely.]

## Continuation Plan
1. [Exact, ordered execution steps for completing and validating the remaining work.]

## Critical References
- [Exact paths, identifiers, commands, errors, data, and examples that must not be lost.]
- [Or "(none)".]`;

export const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Another agent will read ONLY this checkpoint and immediately continue the work, so make it a precise handover that prevents both lost steps and duplicated work.

Rules:
- Clearly separate work already completed from work remaining; never mix their status.
- Preserve enough completed implementation detail to avoid redoing it, including exact files, symbols, changed behavior, and validation already run.
- Make remaining work exhaustive, actionable, ordered, and honest about partial completion or blockers.
- Never mark work complete without evidence and never invent remaining work when the task is done.
- Preserve all still-relevant requirements, decisions, unfinished edits, test failures, commands, errors, paths, and identifiers.
- Identify the exact current working state and make the Continuation Plan the next execution sequence.
- Drop only irrelevant narration, huge logs, abandoned tangents, and explicitly superseded approaches.
- Summarize only. Do not answer questions or continue the original task in this response.

${SUMMARY_FORMAT}`;

export const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to reconcile with the existing checkpoint in <previous-summary> tags. Another agent will read ONLY the updated checkpoint.

Rules:
- Preserve every still-relevant requirement, decision, completed implementation detail, and unfinished item from the previous checkpoint.
- Add new work, evidence, decisions, errors, and context from the new messages.
- Move an item from Work Remaining to Work Completed only when the new messages prove completion.
- Keep partial work in Work Remaining and describe its exact current state.
- Remove information only when it is explicitly superseded or no longer relevant.
- Clearly separate completed work from remaining work so the next agent neither repeats completed steps nor loses unfinished ones.
- Make Continuation Plan an exact, ordered sequence for finishing and validating the task.
- Preserve exact file paths, symbols, commands, identifiers, and error messages.
- Summarize only. Do not answer questions or continue the original task in this response.

${SUMMARY_FORMAT}`;

export function missingCompactionSummaryHeadings(summary: string): string[] {
  return REQUIRED_SUMMARY_HEADINGS.filter(
    (heading) => !new RegExp(`^## ${heading}\\s*$`, "m").test(summary),
  );
}

export function isStructuredCompactionSummary(summary: string): boolean {
  return (
    summary.trim().length > 0 &&
    missingCompactionSummaryHeadings(summary).length === 0
  );
}

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
  env?: Record<string, string>,
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

  const completionOptions =
    model.reasoning && thinkingLevel && thinkingLevel !== "off"
      ? { maxTokens, signal, apiKey, headers, env, reasoning: thinkingLevel }
      : { maxTokens, signal, apiKey, headers, env };

  const requestSummary = (text: string) =>
    completeSimpleWithModel(
      model,
      {
        systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text }],
            timestamp: Date.now(),
          },
        ],
      },
      completionOptions,
    );
  const readText = (response: Awaited<ReturnType<typeof requestSummary>>) =>
    response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
  const responseError = (
    response: Awaited<ReturnType<typeof requestSummary>>,
  ): CompactionError | undefined => {
    if (response.stopReason === "aborted") {
      return new CompactionError(
        "aborted",
        response.errorMessage || "Summarization aborted",
      );
    }
    if (response.stopReason === "error") {
      return new CompactionError(
        "summarization_failed",
        `Summarization failed: ${response.errorMessage || "Unknown error"}`,
      );
    }
    return undefined;
  };

  let response = await requestSummary(promptText);
  let failure = responseError(response);
  if (failure) return err(failure);
  let textContent = readText(response);
  const missingHeadings = missingCompactionSummaryHeadings(textContent);
  if (missingHeadings.length > 0) {
    response = await requestSummary(
      `${promptText}\n\n<draft-summary>\n${textContent}\n</draft-summary>\n\nThe draft is structurally incomplete. Rewrite the entire checkpoint using the exact required format and include these missing sections: ${missingHeadings.join(", ")}.`,
    );
    failure = responseError(response);
    if (failure) return err(failure);
    textContent = readText(response);
  }
  if (!isStructuredCompactionSummary(textContent)) {
    return err(
      new CompactionError(
        "summarization_failed",
        `Summarization omitted required sections: ${missingCompactionSummaryHeadings(textContent).join(", ")}`,
      ),
    );
  }

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

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX is retained verbatim. Summarize the prefix as a precise bridge into that suffix.

Use this exact format:

## Original Request
[What the user asked for and the relevant constraints.]

## Work Completed in This Prefix
- [Concrete completed actions, exact files/symbols, decisions, and validation.]

## Work Still Remaining at the Split
- [Every unfinished step or partial edit the retained suffix must continue.]

## State Needed by the Retained Suffix
- [Exact current state, paths, identifiers, errors, and ordered next action.]

Clearly distinguish completed work from remaining work. Do not omit unfinished steps, do not mark work complete without evidence, and do not continue the task.`;

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
  env?: Record<string, string>,
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
            env,
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
        env,
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
      env,
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
  env?: Record<string, string>,
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

  const response = await completeSimpleWithModel(
    model,
    {
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      messages: summarizationMessages,
    },
    model.reasoning && thinkingLevel && thinkingLevel !== "off"
      ? { maxTokens, signal, apiKey, headers, env, reasoning: thinkingLevel }
      : { maxTokens, signal, apiKey, headers, env },
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
