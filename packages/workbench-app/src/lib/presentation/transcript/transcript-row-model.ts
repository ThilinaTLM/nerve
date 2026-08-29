import type {
  ApprovalWithToolCall,
  PlanReviewRecord,
  QueuedPromptRecord,
  UserQuestionRecord,
} from "../state/tool-types";
import type { TranscriptDisplayNode } from "./transcript-presentation";
import type { TranscriptEntranceMotion } from "./transcript-entry-motion";
import { toolLifecycleSpec } from "../tools/lifecycle/registry";

export type TimelineRowItem = {
  kind: "timeline";
  key: string;
  node: TranscriptDisplayNode;
  entranceMotion?: TranscriptEntranceMotion;
};

export type TranscriptRowItem =
  | TimelineRowItem
  | { kind: "waiting"; key: string }
  | { kind: "queued"; key: string; prompt: QueuedPromptRecord };

export function uniqueRowKey(key: string, seen: Map<string, number>): string {
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  return count === 0 ? key : `${key}:duplicate:${count}`;
}

export function entranceEligible(node: TranscriptDisplayNode): boolean {
  if (node.kind === "message") return Boolean(node.item.live);
  if (node.kind === "thinking_group") {
    return node.items.some((member) => Boolean(member.item.live));
  }
  return node.kind === "tool" && Boolean(node.draft);
}

export interface TranscriptMeasurementContext {
  readonly approvalsByToolCallId: ReadonlyMap<string, ApprovalWithToolCall>;
  readonly questionsByToolCallId: ReadonlyMap<string, UserQuestionRecord>;
  readonly reviewsByToolCallId: ReadonlyMap<string, PlanReviewRecord>;
  readonly active: boolean;
}

export function measurementVersionForRow(
  row: TranscriptRowItem,
  context: TranscriptMeasurementContext,
): string {
  if (row.kind === "waiting") return "waiting";
  if (row.kind === "queued") {
    return `${row.prompt.status}:${row.prompt.updatedAt}`;
  }

  const node = row.node;
  if (node.kind === "thinking_group") {
    return node.items
      .map(
        (member) =>
          `${member.item.text.length}:${member.item.live ? "live" : "stored"}:${member.item.done ? "done" : "open"}`,
      )
      .join("|");
  }
  if (node.kind === "message") {
    const item = node.item;
    return [
      item.text.length,
      item.live ? "live" : "stored",
      item.done ? "done" : "open",
      item.optimistic ? "optimistic" : "settled",
      item.stopReason ?? "ok",
      item.errorMessage?.length ?? 0,
    ].join(":");
  }
  if (node.kind === "tool") {
    if (!node.toolCall) {
      const block = node.draft?.block;
      const progress = block?.progress;
      const lifecycle = toolLifecycleSpec(block?.toolName ?? "tool");
      return [
        "draft",
        `arg:${lifecycle.argumentRegion}`,
        `placeholder:${lifecycle.resultPlaceholder?.variant ?? "none"}`,
        block?.argsText.length ?? 0,
        block?.done ? "done" : "open",
        progress?.lineCount ?? 0,
        progress?.generatedLineCount ?? 0,
        progress?.generatedPreview?.length ?? 0,
        block?.argsText || progress?.generatedPreview
          ? "activity-visible"
          : "header-only",
      ].join(":");
    }
    const toolCallId = node.toolCall.id;
    const lifecycle = toolLifecycleSpec(node.toolCall.toolName);
    const approval = context.approvalsByToolCallId.get(toolCallId);
    const question = context.questionsByToolCallId.get(toolCallId);
    const plan = context.reviewsByToolCallId.get(toolCallId);
    return [
      "tool",
      `arg:${lifecycle.argumentRegion}`,
      `placeholder:${lifecycle.resultPlaceholder?.variant ?? "none"}`,
      node.toolCall.status,
      node.toolCall.updatedAt,
      node.liveOutput?.updatedAt ?? "no-output",
      context.active ? "body-hydrated" : "body-deferred",
      node.toolCall.status === "failed" || node.toolCall.status === "denied"
        ? "activity-error"
        : "activity-visible",
      approval ? `${approval.id}:${approval.status}` : "no-approval",
      question ? `${question.id}:${question.status}` : "no-question",
      plan ? `${plan.id}:${plan.status}` : "no-plan",
    ].join(":");
  }
  if (node.kind === "compaction") {
    const notice = node.notice;
    return [
      "compaction",
      notice.state,
      notice.summaryPreview?.length ?? 0,
      notice.summary?.length ?? 0,
      notice.errorMessage?.length ?? 0,
    ].join(":");
  }
  return node.key;
}
