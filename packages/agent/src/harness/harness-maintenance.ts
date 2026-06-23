import type { AgentTool, AnyModel, ThinkingLevel } from "../types.js";
import {
  collectEntriesForBranchSummary,
  generateBranchSummary,
} from "./compaction/branch-summarization.js";
import {
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
} from "./compaction/compaction.js";
import type { Conversation } from "./conversation/conversation.js";
import { editorTextForNavigatedEntry } from "./conversation/text-extraction.js";
import { AgentHarnessError } from "./errors.js";
import type {
  AgentHarnessOwnEvent,
  AgentHarnessPhase,
  NavigateTreeResult,
} from "./events.js";
import { normalizeHarnessError } from "./harness-events.js";
import type { AgentHarnessOptions, PromptTemplate, Skill } from "./options.js";

type EmitHook = (event: AgentHarnessOwnEvent) => Promise<unknown>;
type EmitOwn = (event: AgentHarnessOwnEvent) => Promise<void>;

export type HarnessMaintenanceContext<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
> = {
  getPhase(): AgentHarnessPhase;
  setPhase(phase: AgentHarnessPhase): void;
  conversation: Conversation;
  getModel(): AnyModel;
  getThinkingLevel(): ThinkingLevel;
  getApiKeyAndHeaders?: AgentHarnessOptions<
    TSkill,
    TPromptTemplate,
    TTool
  >["getApiKeyAndHeaders"];
  emitHook: EmitHook;
  emitOwn: EmitOwn;
};

type BeforeCompactResult = {
  cancel?: boolean;
  compaction?: Awaited<ReturnType<typeof compact>> extends {
    ok: true;
    value: infer T;
  }
    ? T
    : never;
};

type BeforeTreeResult = {
  cancel?: boolean;
  summary?: { summary: string; details?: unknown };
  customInstructions?: string;
  replaceInstructions?: boolean;
};

export async function compactHarnessConversation<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  context: HarnessMaintenanceContext<TSkill, TPromptTemplate, TTool>,
  customInstructions?: string,
): Promise<{
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
}> {
  if (context.getPhase() !== "idle") {
    throw new AgentHarnessError("busy", "compact() requires idle harness");
  }
  context.setPhase("compaction");
  try {
    const model = context.getModel();
    if (!model) {
      throw new AgentHarnessError(
        "invalid_state",
        "No model set for compaction",
      );
    }
    const auth = await context.getApiKeyAndHeaders?.(model);
    if (!auth) {
      throw new AgentHarnessError("auth", "No auth available for compaction");
    }
    const branchEntries = await context.conversation.getBranch();
    const preparationResult = prepareCompaction(
      branchEntries,
      DEFAULT_COMPACTION_SETTINGS,
    );
    if (!preparationResult.ok) throw preparationResult.error;
    const preparation = preparationResult.value;
    if (!preparation) {
      throw new AgentHarnessError("compaction", "Nothing to compact");
    }
    const hookResult = (await context.emitHook({
      type: "conversation_before_compact",
      preparation,
      branchEntries,
      customInstructions,
      signal: new AbortController().signal,
    } as AgentHarnessOwnEvent)) as BeforeCompactResult | undefined;
    if (hookResult?.cancel) {
      throw new AgentHarnessError("compaction", "Compaction cancelled");
    }
    const provided = hookResult?.compaction;
    const compactResult = provided
      ? { ok: true as const, value: provided }
      : await compact(
          preparation,
          model,
          auth.apiKey,
          auth.headers,
          customInstructions,
          undefined,
          context.getThinkingLevel(),
        );
    if (!compactResult.ok) throw compactResult.error;
    const result = compactResult.value;
    const entryId = await context.conversation.appendCompaction(
      result.summary,
      result.firstKeptEntryId,
      result.tokensBefore,
      result.details,
      provided !== undefined,
    );
    const entry = await context.conversation.getEntry(entryId);
    if (entry?.type === "compaction") {
      await context.emitOwn({
        type: "conversation_compact",
        compactionEntry: entry,
        fromHook: provided !== undefined,
      } as AgentHarnessOwnEvent);
    }
    return result;
  } catch (error) {
    throw normalizeHarnessError(error, "compaction");
  } finally {
    context.setPhase("idle");
  }
}

export async function navigateHarnessTree<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  context: HarnessMaintenanceContext<TSkill, TPromptTemplate, TTool>,
  targetId: string,
  options?: {
    summarize?: boolean;
    customInstructions?: string;
    replaceInstructions?: boolean;
    label?: string;
  },
): Promise<NavigateTreeResult> {
  if (context.getPhase() !== "idle") {
    throw new AgentHarnessError("busy", "navigateTree() requires idle harness");
  }
  context.setPhase("branch_summary");
  try {
    const oldLeafId = await context.conversation.getLeafId();
    if (oldLeafId === targetId) return { cancelled: false };
    const targetEntry = await context.conversation.getEntry(targetId);
    if (!targetEntry) {
      throw new AgentHarnessError(
        "invalid_argument",
        `Entry ${targetId} not found`,
      );
    }
    const { entries, commonAncestorId } = await collectEntriesForBranchSummary(
      context.conversation,
      oldLeafId,
      targetId,
    );
    const preparation = {
      targetId,
      oldLeafId,
      commonAncestorId,
      entriesToSummarize: entries,
      userWantsSummary: options?.summarize ?? false,
      customInstructions: options?.customInstructions,
      replaceInstructions: options?.replaceInstructions,
      label: options?.label,
    };
    const signal = new AbortController().signal;
    const hookResult = (await context.emitHook({
      type: "conversation_before_tree",
      preparation,
      signal,
    } as AgentHarnessOwnEvent)) as BeforeTreeResult | undefined;
    if (hookResult?.cancel) return { cancelled: true };
    let summaryEntry: NavigateTreeResult["summaryEntry"];
    let summaryText: string | undefined = hookResult?.summary?.summary;
    let summaryDetails: unknown = hookResult?.summary?.details;
    if (!summaryText && options?.summarize && entries.length > 0) {
      const model = context.getModel();
      if (!model) {
        throw new AgentHarnessError(
          "invalid_state",
          "No model set for branch summary",
        );
      }
      const auth = await context.getApiKeyAndHeaders?.(model);
      if (!auth) {
        throw new AgentHarnessError(
          "auth",
          "No auth available for branch summary",
        );
      }
      const branchSummary = await generateBranchSummary(entries, {
        model,
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal: new AbortController().signal,
        customInstructions:
          hookResult?.customInstructions ?? options?.customInstructions,
        replaceInstructions:
          hookResult?.replaceInstructions ?? options?.replaceInstructions,
      });
      if (!branchSummary.ok) {
        if (branchSummary.error.code === "aborted") return { cancelled: true };
        throw new AgentHarnessError(
          "branch_summary",
          branchSummary.error.message,
          branchSummary.error,
        );
      }
      summaryText = branchSummary.value.summary;
      summaryDetails = {
        readFiles: branchSummary.value.readFiles,
        modifiedFiles: branchSummary.value.modifiedFiles,
      };
    }
    const { newLeafId, editorText } = editorTextForNavigatedEntry(
      targetEntry,
      targetId,
    );
    const summaryId = await context.conversation.moveTo(
      newLeafId,
      summaryText
        ? {
            summary: summaryText,
            details: summaryDetails,
            fromHook: hookResult?.summary !== undefined,
          }
        : undefined,
    );
    if (summaryId) {
      const entry = await context.conversation.getEntry(summaryId);
      if (entry?.type === "branch_summary") summaryEntry = entry;
    }
    await context.emitOwn({
      type: "conversation_tree",
      newLeafId: await context.conversation.getLeafId(),
      oldLeafId,
      summaryEntry,
      fromHook: hookResult?.summary !== undefined,
    } as AgentHarnessOwnEvent);
    return { cancelled: false, editorText, summaryEntry };
  } catch (error) {
    throw normalizeHarnessError(error, "branch_summary");
  } finally {
    context.setPhase("idle");
  }
}
