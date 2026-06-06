import { completeSimple } from "@earendil-works/pi-ai";
import type { AgentMessage, AnyModel } from "../../types.js";
import type {
  Conversation,
  ConversationTreeEntry,
} from "../conversation/entries.js";
import { BranchSummaryError, ConversationError } from "../errors.js";
import type { BranchSummaryResult } from "../events.js";
import {
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "../messages.js";
import { err, ok, type Result } from "../result.js";
import { estimateTokens, SUMMARIZATION_SYSTEM_PROMPT } from "./compaction.js";
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  type FileOperations,
  formatFileOperations,
  serializeConversation,
} from "./utils.js";

/** File-operation details stored on generated branch summary entries. */
export interface BranchSummaryDetails {
  /** Files read while exploring the summarized branch. */
  readFiles: string[];
  /** Files modified while exploring the summarized branch. */
  modifiedFiles: string[];
}

export type { FileOperations } from "./utils.js";

/** Prepared branch content for summarization. */
export interface BranchPreparation {
  /** Messages selected for the branch summary. */
  messages: AgentMessage[];
  /** File operations extracted from the branch. */
  fileOps: FileOperations;
  /** Estimated token count for selected messages. */
  totalTokens: number;
}

/** Entries selected for branch summarization. */
export interface CollectEntriesResult {
  /** Entries to summarize in chronological order. */
  entries: ConversationTreeEntry[];
  /** Deepest common ancestor between the previous leaf and target entry. */
  commonAncestorId: string | null;
}

/** Options for generating a branch summary. */
export interface GenerateBranchSummaryOptions {
  /** Model used for summarization. */
  model: AnyModel;
  /** API key forwarded to the provider. */
  apiKey: string;
  /** Optional request headers forwarded to the provider. */
  headers?: Record<string, string>;
  /** Abort signal for the summarization request. */
  signal: AbortSignal;
  /** Optional instructions appended to or replacing the default prompt. */
  customInstructions?: string;
  /** Replace the default prompt with custom instructions instead of appending them. */
  replaceInstructions?: boolean;
  /** Tokens reserved for prompt and model output. Defaults to 16384. */
  reserveTokens?: number;
}

/** Collect entries that should be summarized before navigating to a different conversation tree entry. */
export async function collectEntriesForBranchSummary(
  conversation: Conversation,
  oldLeafId: string | null,
  targetId: string,
): Promise<CollectEntriesResult> {
  if (!oldLeafId) {
    return { entries: [], commonAncestorId: null };
  }
  const oldPath = new Set(
    (await conversation.getBranch(oldLeafId)).map((e) => e.id),
  );
  const targetPath = await conversation.getBranch(targetId);
  let commonAncestorId: string | null = null;
  for (let i = targetPath.length - 1; i >= 0; i--) {
    if (oldPath.has(targetPath[i].id)) {
      commonAncestorId = targetPath[i].id;
      break;
    }
  }
  const entries: ConversationTreeEntry[] = [];
  let current: string | null = oldLeafId;

  while (current && current !== commonAncestorId) {
    const entry = await conversation.getEntry(current);
    if (!entry)
      throw new ConversationError(
        "invalid_conversation",
        `Entry ${current} not found`,
      );
    entries.push(entry as ConversationTreeEntry);
    current = entry.parentId;
  }
  entries.reverse();

  return { entries, commonAncestorId };
}
function getMessageFromEntry(
  entry: ConversationTreeEntry,
): AgentMessage | undefined {
  switch (entry.type) {
    case "message":
      if (entry.message.role === "toolResult") return undefined;
      return entry.message;

    case "custom_message":
      return createCustomMessage(
        entry.customType,
        entry.content,
        entry.display,
        entry.details,
        entry.timestamp,
      );

    case "branch_summary":
      return createBranchSummaryMessage(
        entry.summary,
        entry.fromId,
        entry.timestamp,
      );

    case "compaction":
      return createCompactionSummaryMessage(
        entry.summary,
        entry.tokensBefore,
        entry.timestamp,
      );
    case "thinking_level_change":
    case "model_change":
    case "active_tools_change":
    case "custom":
    case "label":
    case "conversation_info":
    case "leaf":
      return undefined;
  }
}

/** Prepare branch entries for summarization within an optional token budget. */
export function prepareBranchEntries(
  entries: ConversationTreeEntry[],
  tokenBudget: number = 0,
): BranchPreparation {
  const messages: AgentMessage[] = [];
  const fileOps = createFileOps();
  let totalTokens = 0;
  for (const entry of entries) {
    if (entry.type === "branch_summary" && !entry.fromHook && entry.details) {
      const details = entry.details as BranchSummaryDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f);
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) {
          fileOps.edited.add(f);
        }
      }
    }
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const message = getMessageFromEntry(entry);
    if (!message) continue;
    extractFileOpsFromMessage(message, fileOps);

    const tokens = estimateTokens(message);
    if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
      if (entry.type === "compaction" || entry.type === "branch_summary") {
        if (totalTokens < tokenBudget * 0.9) {
          messages.unshift(message);
          totalTokens += tokens;
        }
      }
      break;
    }

    messages.unshift(message);
    totalTokens += tokens;
  }

  return { messages, fileOps, totalTokens };
}

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/** Generate a summary for abandoned branch entries. */
export async function generateBranchSummary(
  entries: ConversationTreeEntry[],
  options: GenerateBranchSummaryOptions,
): Promise<Result<BranchSummaryResult, BranchSummaryError>> {
  const {
    model,
    apiKey,
    headers,
    signal,
    customInstructions,
    replaceInstructions,
    reserveTokens = 16384,
  } = options;
  const contextWindow = model.contextWindow || 128000;
  const tokenBudget = contextWindow - reserveTokens;

  const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);

  if (messages.length === 0) {
    return ok({
      summary: "No content to summarize",
      readFiles: [],
      modifiedFiles: [],
    });
  }
  const llmMessages = convertToLlm(messages);
  const conversationText = serializeConversation(llmMessages);
  let instructions: string;
  if (replaceInstructions && customInstructions) {
    instructions = customInstructions;
  } else if (customInstructions) {
    instructions = `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`;
  } else {
    instructions = BRANCH_SUMMARY_PROMPT;
  }
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`;

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
    { apiKey, headers, signal, maxTokens: 2048 },
  );
  if (response.stopReason === "aborted") {
    return err(
      new BranchSummaryError(
        "aborted",
        response.errorMessage || "Branch summary aborted",
      ),
    );
  }
  if (response.stopReason === "error") {
    return err(
      new BranchSummaryError(
        "summarization_failed",
        `Branch summary failed: ${response.errorMessage || "Unknown error"}`,
      ),
    );
  }

  let summary = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  summary = BRANCH_SUMMARY_PREAMBLE + summary;
  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);

  return ok({
    summary: summary || "No summary generated",
    readFiles,
    modifiedFiles,
  });
}
