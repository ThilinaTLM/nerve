import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { taskTone } from "@nervekit/ui-kit/display/status";
import type { TaskEventNotice } from "../../state/transcript-types";
import type { CardGlyph } from "../../cards/card-presentation";
import type { NoticeChip, TranscriptNoticeModel } from "./notice-presentation";

type EventVocabulary = {
  tone: StatusTone;
  glyph: CardGlyph;
  /** Mono event name shown in the tool-name slot. */
  badge: string;
  /** Task statuses this event already communicates through its name. */
  impliedStatuses: readonly string[];
};

/**
 * Tone comes from the event, not `taskTone(status)`: that helper deliberately
 * mutes finished tasks for panel lists, which is wrong for a one-shot
 * completion notice in the transcript.
 */
function vocabularyFor(notice: TaskEventNotice): EventVocabulary {
  switch (notice.event) {
    case "ready":
      return {
        tone: "info",
        glyph: "bell-ring",
        badge: "task ready",
        impliedStatuses: ["ready", "running"],
      };
    case "completed":
      return notice.exitCode !== undefined &&
        notice.exitCode !== null &&
        notice.exitCode !== 0
        ? {
            tone: "destructive",
            glyph: "bell-dot",
            badge: "task exited",
            impliedStatuses: ["completed", "exited", "stopped", "failed"],
          }
        : {
            tone: "success",
            glyph: "bell",
            badge: "task completed",
            impliedStatuses: ["completed", "exited", "stopped"],
          };
    case "failed":
      return {
        tone: "destructive",
        glyph: "bell-dot",
        badge: "task failed",
        impliedStatuses: ["failed"],
      };
    case "timed_out":
    case "ready_timeout":
      return {
        tone: "destructive",
        glyph: "bell-dot",
        badge: "task timed out",
        impliedStatuses: ["timed_out", "running", "ready"],
      };
    case "cancelled":
      return {
        tone: "warning",
        glyph: "bell-dot",
        badge: "task cancelled",
        impliedStatuses: ["cancelled", "stopped", "aborted"],
      };
    case "interrupted":
      return {
        tone: "warning",
        glyph: "bell-dot",
        badge: "task interrupted",
        impliedStatuses: ["interrupted", "stopped"],
      };
    case "orphaned":
    case "recovery_unknown":
      return {
        tone: "destructive",
        glyph: "bell-dot",
        badge: "task state unknown",
        impliedStatuses: ["orphaned", "recovery_unknown"],
      };
    case "recovered":
      return {
        tone: "info",
        glyph: "bell-ring",
        badge: "task recovered",
        impliedStatuses: ["recovered", "running", "ready"],
      };
    default:
      return {
        tone: "neutral",
        glyph: "bell",
        badge: "task update",
        impliedStatuses: [],
      };
  }
}

function chipsFor(
  notice: TaskEventNotice,
  implied: readonly string[],
): NoticeChip[] {
  const chips: NoticeChip[] = [];
  if (notice.exitCode !== undefined && notice.exitCode !== null) {
    chips.push({
      text: `exit ${notice.exitCode}`,
      tone: notice.exitCode === 0 ? "success" : "destructive",
    });
  } else if (notice.signal) {
    chips.push({ text: `signal ${notice.signal}`, tone: "warning" });
  }
  // Only surface the raw status when it says something the name does not.
  if (notice.status && !implied.includes(notice.status)) {
    chips.push({ text: notice.status, tone: taskTone(notice.status) });
  }
  if (notice.groupName) chips.push({ text: `group ${notice.groupName}` });
  return chips;
}

export function taskEventNoticeModel(
  notice: TaskEventNotice,
  options: { onOpenTask?: (taskId: string) => void } = {},
): TranscriptNoticeModel {
  const vocabulary = vocabularyFor(notice);
  const taskId = notice.taskId;
  const onOpenTask = options.onOpenTask;
  const name = notice.taskName ?? notice.groupName;
  return {
    kind: "task",
    tone: vocabulary.tone,
    glyph: vocabulary.glyph,
    badge: vocabulary.badge,
    arg: name,
    statusLabel: name
      ? `Background ${vocabulary.badge}: ${name}`
      : `Background ${vocabulary.badge}`,
    chips: chipsFor(notice, vocabulary.impliedStatuses),
    action:
      taskId && onOpenTask
        ? {
            label: "Open task",
            ariaLabel: `Open task ${name ?? taskId}`,
            onClick: () => onOpenTask(taskId),
          }
        : undefined,
  };
}
