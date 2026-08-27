import type { ToolView } from "../../views/tool-result-view";

export type ToolDetailSection =
  | "formatted"
  | "agent-preview"
  | "arguments"
  | "complete-result";

export function hasFormattedToolView(
  view: ToolView,
  hasStoredPreview = false,
): boolean {
  switch (view.kind) {
    case "read":
      return Boolean(view.image || view.content?.length);
    case "bash":
      return Boolean(view.output.length || view.command);
    case "python":
      return Boolean(view.output.length || view.code);
    case "edit":
      return Boolean(view.diff);
    case "write":
      return Boolean(view.content?.length);
    case "grep":
      return view.matchCount > 0;
    case "find":
      return view.count > 0;
    case "ls":
      return view.total > 0;
    case "todos":
      return view.items.length > 0;
    case "task_action":
      return Boolean(
        view.task ||
        view.tasks?.length ||
        view.otherActiveTasks?.length ||
        view.liveLog?.length,
      );
    case "task_status":
      return view.tasks.length > 0;
    case "task_logs":
      return view.events.length > 0;
    case "explore":
      return Boolean(
        view.reports.length || view.liveUpdates.length || view.liveLog?.length,
      );
    case "web_search":
      return Boolean(view.answer || view.results.length);
    case "web_fetch":
      return Boolean(view.content?.length);
    case "explain_image":
      return Boolean(
        view.explanation?.length ||
        view.thinking?.length ||
        view.liveExplanation?.length,
      );
    case "jira":
    case "confluence":
      return hasStoredPreview;
    case "ask_user":
    case "plan_mode":
      return true;
    case "generic":
      return false;
  }
}

export function initialToolDetailSection(
  view: ToolView,
  hasStoredPreview = false,
): ToolDetailSection {
  return hasFormattedToolView(view, hasStoredPreview)
    ? "formatted"
    : "agent-preview";
}

export type RawTextSegment = { key: number; text: string };

export function segmentRawText(
  text: string,
  maxChars = 2_000,
): RawTextSegment[] {
  if (text.length === 0) return [];
  const segments: RawTextSegment[] = [];
  let key = 0;
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      segments.push({ key: key++, text: " " });
      continue;
    }
    for (let offset = 0; offset < line.length; offset += maxChars) {
      segments.push({
        key: key++,
        text: line.slice(offset, offset + maxChars),
      });
    }
  }
  return segments;
}
