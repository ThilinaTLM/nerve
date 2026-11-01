import type { ToolView } from "../views/tool-result-view";

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
    case "subagent":
      return view.action === "prompt"
        ? view.assignments.length > 0
        : view.action === "status"
          ? view.rows.length > 0 || Boolean(view.header)
          : view.lines.length > 0;
    case "web_search":
      return Boolean(view.answer || view.results.length);
    case "web_fetch":
      return Boolean(view.content?.length);
    case "generate_image":
      return view.paths.length > 0;
    case "kroki_export":
      return Boolean(view.path);
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
    case "plan_present":
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

/** Tabs with content, in display order. */
export function availableToolDetailSections(has: {
  formatted: boolean;
  agentPreview: boolean;
  arguments: boolean;
  completeResult: boolean;
}): ToolDetailSection[] {
  const sections: ToolDetailSection[] = [];
  if (has.formatted) sections.push("formatted");
  if (has.agentPreview) sections.push("agent-preview");
  if (has.arguments) sections.push("arguments");
  if (has.completeResult) sections.push("complete-result");
  return sections;
}

/** The chosen tab if it exists, else the preferred one, else the first. */
export function resolveToolDetailSection(
  available: readonly ToolDetailSection[],
  chosen: ToolDetailSection | undefined,
  preferred: ToolDetailSection,
): ToolDetailSection | undefined {
  if (chosen && available.includes(chosen)) return chosen;
  return available.includes(preferred) ? preferred : available[0];
}

export function serializeToolArguments(value: unknown): {
  text: string;
  language?: string;
} {
  if (typeof value === "string") return { text: value };
  try {
    return {
      text: JSON.stringify(value, null, 2) ?? String(value),
      language: "json",
    };
  } catch {
    return { text: String(value) };
  }
}

/** Plain text of the text blocks the agent received. */
export function agentPreviewText(
  preview:
    | { blocks: ReadonlyArray<{ type: string; text?: string }> }
    | undefined,
): string {
  return (preview?.blocks ?? [])
    .flatMap((block) =>
      block.type === "text" && block.text !== undefined ? [block.text] : [],
    )
    .join("\n\n");
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
