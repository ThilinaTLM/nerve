import type { SystemEventNotice } from "../../state/transcript-types";
import { parseSubagentNotice } from "../../tools/views/subagent-result-parser";
import { plural } from "../../tools/views/tool-presentation-helpers";
import {
  COLLAPSED_LINES,
  countLogicalLines,
} from "../../tools/views/tool-view-helpers";
import type { NoticeChip, TranscriptNoticeModel } from "./notice-presentation";

function detailsOf(notice: SystemEventNotice): Record<string, unknown> {
  return notice.details && typeof notice.details === "object"
    ? (notice.details as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isSubagentNotice(notice: SystemEventNotice): boolean {
  return (
    notice.kind === "subagent_run_event" ||
    textValue(detailsOf(notice).type) === "subagent_event"
  );
}

/** Text rendered in the notice body; the transcript shows only its first lines. */
export function systemEventNoticeBody(notice: SystemEventNotice): string {
  if (isSubagentNotice(notice)) {
    const parsed = parseSubagentNotice(notice.text);
    if (parsed)
      return [
        parsed.outcome === "waiting" ? parsed.detail : undefined,
        parsed.response,
      ]
        .filter(Boolean)
        .join("\n");
  }
  return (notice.summary ?? notice.text).trim();
}

/** Mirrors tool cards: surface the full length once the preview is clipped. */
function bodyChips(notice: SystemEventNotice): NoticeChip[] {
  const lines = countLogicalLines(systemEventNoticeBody(notice));
  return lines > COLLAPSED_LINES ? [{ text: plural(lines, "line") }] : [];
}

export function systemEventNoticeModel(
  notice: SystemEventNotice,
  options: { onOpenFile?: (path: string) => void } = {},
): TranscriptNoticeModel {
  const model = systemEventNoticeHeader(notice, options);
  const chips = [...(model.chips ?? []), ...bodyChips(notice)];
  return chips.length > 0 ? { ...model, chips } : model;
}

function subagentNoticeHeader(
  notice: SystemEventNotice,
  onOpenFile: ((path: string) => void) | undefined,
): TranscriptNoticeModel {
  const details = detailsOf(notice);
  const parsed = parseSubagentNotice(notice.text);
  const outcome =
    parsed?.outcome ??
    textValue(details.outcome) ??
    textValue(details.status) ??
    "update";
  const reportPath = parsed?.reportPath;
  return {
    kind: "subagent",
    tone:
      outcome === "completed"
        ? "success"
        : outcome === "failed"
          ? "destructive"
          : "warning",
    glyph: "subagent",
    badge: `subagent_${outcome}`,
    arg: parsed?.name ?? textValue(details.childName) ?? "sub-agent",
    statusLabel: `Sub-agent ${parsed?.name ?? ""} ${outcome}; agent notified`,
    error: outcome === "failed" ? parsed?.detail : undefined,
    chips: parsed?.profile ? [{ text: parsed.profile }] : [],
    action:
      reportPath && onOpenFile
        ? {
            label: "Open report",
            ariaLabel: `Open full report for ${parsed?.name ?? "sub-agent"}`,
            onClick: () => onOpenFile(reportPath),
          }
        : undefined,
  };
}

function systemEventNoticeHeader(
  notice: SystemEventNotice,
  options: { onOpenFile?: (path: string) => void },
): TranscriptNoticeModel {
  const details = detailsOf(notice);
  const type = textValue(details.type);
  if (notice.kind === "branch_summary") {
    return {
      kind: "branch",
      tone: "info",
      glyph: "branch",
      badge: "branch_summarized",
      arg: "context carried to this branch",
      statusLabel: "Branch summary added to agent context",
      chips: notice.fromEntryId
        ? [{ text: `from ${notice.fromEntryId}`, mono: true }]
        : [],
    };
  }
  if (isSubagentNotice(notice))
    return subagentNoticeHeader(notice, options.onOpenFile);
  if (
    notice.kind === "tool_result" ||
    notice.kind === "inline_command_result"
  ) {
    return {
      kind: "tool_result",
      tone: details.isError === true ? "destructive" : "neutral",
      glyph: "system",
      badge:
        notice.kind === "tool_result" ? "tool_result" : "inline_command_result",
      arg: textValue(details.toolName) ?? textValue(details.command),
      statusLabel: "Unpaired tool result in agent context",
    };
  }
  return {
    kind: "system",
    tone: "info",
    glyph: "system",
    badge:
      type && /^[a-z][a-z0-9_]*$/.test(type)
        ? type
        : notice.kind === "message"
          ? "system_event"
          : notice.kind,
    statusLabel: "System event in conversation",
  };
}
