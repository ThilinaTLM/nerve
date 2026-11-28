import {
  QUICK_SCRIPT_CALLS_STREAM,
  quickScriptLiveCallSchema,
  type QuickScriptHostCall,
} from "@nervekit/contracts/tools";
import type { ConversationLiveToolOutputSnapshot } from "$lib/presentation/view-models/conversation";

/** Whether the result text is the placeholder of a completed run that printed nothing (see `executeQuickScript`): `ok, no output (reason)`. */
export const isNoOutputText = (text: string): boolean =>
  /^ok, no output(?: \([^\n]*\))?$/.test(text);

/** A quick_script SDK call row: a settled call, or one still running (live only). */
export type QuickScriptCallRow =
  | QuickScriptHostCall
  | { method: string; summary?: string; outcome: "running" };

/** What a settled `files.edit` / `artifacts.edit` call changed. */
export type QuickScriptCallEdit = NonNullable<QuickScriptHostCall["edit"]>;

/** The edit a call row carries; live rows never do. */
export function callEdit(
  row: QuickScriptCallRow,
): QuickScriptCallEdit | undefined {
  return row.outcome === "running" ? undefined : row.edit;
}

/** The row's edit statistic: `2 files`, `+5`, `−3`, and whether nothing was written. */
export function editStatParts(edit: QuickScriptCallEdit): {
  files: string;
  added: string;
  removed: string;
  dryRun: boolean;
} {
  return {
    files: `${edit.files} file${edit.files === 1 ? "" : "s"}`,
    added: `+${edit.added}`,
    removed: `−${edit.removed}`,
    dryRun: edit.dryRun === true,
  };
}

/** The statistic as one phrase, for the disclosure's accessible name. */
export function editStatLabel(edit: QuickScriptCallEdit): string {
  const parts = editStatParts(edit);
  return [
    `${parts.files} changed`,
    `${edit.added} added`,
    `${edit.removed} removed`,
    ...(parts.dryRun ? ["dry run"] : []),
  ].join(", ");
}

/** One file's part of an edit diff: its hunks, without the `---`/`+++` header. */
export type QuickScriptEditFileDiff = { path: string; diff: string };

const DIFF_CUT_LINE = /^\[diff truncated(?:; full diff: \S+)?\]$/;
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

/**
 * Splits an edit call's combined diff (`--- path` / `+++ path`, then hunks,
 * per file) into one diff per file. Hunk line counts decide where a hunk ends,
 * so changed lines that look like a file header stay in their hunk. A
 * trailing `[diff truncated…]` line is dropped and reported as `cut`.
 */
export function splitEditDiff(diff: string): {
  files: QuickScriptEditFileDiff[];
  cut: boolean;
} {
  const lines = diff.split("\n");
  const cut = DIFF_CUT_LINE.test(lines.at(-1) ?? "");
  if (cut) lines.pop();
  const files: Array<{ path: string; lines: string[] }> = [];
  let oldLeft = 0;
  let newLeft = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const inHunk = oldLeft > 0 || newLeft > 0;
    const next = lines[index + 1];
    if (!inHunk && line.startsWith("--- ") && next?.startsWith("+++ ")) {
      files.push({ path: next.slice(4), lines: [] });
      index += 1;
      continue;
    }
    const hunk = inHunk ? null : HUNK_HEADER.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
    } else if (inHunk && !line.startsWith("\\")) {
      if (line.startsWith("+")) newLeft -= 1;
      else if (line.startsWith("-")) oldLeft -= 1;
      else {
        oldLeft -= 1;
        newLeft -= 1;
      }
    }
    if (files.length === 0) files.push({ path: "", lines: [] });
    files.at(-1)!.lines.push(line);
  }
  return {
    files: files
      .map((file) => ({ path: file.path, diff: file.lines.join("\n") }))
      .filter((file) => file.path || file.diff),
    cut,
  };
}

/**
 * The SDK-call rows of a running script, from its live `sdk_calls` stream
 * (one JSON event per line), in call order. Unparseable lines are skipped: the
 * client keeps only the stream's tail, so the first line may be cut.
 */
export function liveQuickScriptCalls(
  liveOutput: ConversationLiveToolOutputSnapshot | undefined,
): QuickScriptCallRow[] {
  const text = (liveOutput?.chunks ?? [])
    .filter((chunk) => chunk.stream === QUICK_SCRIPT_CALLS_STREAM)
    .map((chunk) => chunk.text)
    .join("");
  const rows = new Map<number, QuickScriptCallRow>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const event = quickScriptLiveCallSchema.safeParse(json);
    if (!event.success) continue;
    const { phase, seq, ...call } = event.data;
    if (phase === "started") {
      if (!rows.has(seq)) rows.set(seq, { ...call, outcome: "running" });
    } else rows.set(seq, call as QuickScriptHostCall);
  }
  return [...rows].sort(([a], [b]) => a - b).map(([, row]) => row);
}
