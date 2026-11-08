import type { ToolView } from "../views/tool-result-view";

export type ToolDetailSection =
  | "agent-preview"
  | "arguments"
  | "complete-result";

type ViewWithSharedBody = Exclude<
  ToolView,
  { kind: "bash" | "python" | "jira" | "confluence" | "generic" }
>;

/** Whether a view has a body worth rendering (durable-body predicate). */
export function hasSharedToolViewBody(view: ViewWithSharedBody): boolean {
  switch (view.kind) {
    case "read":
      return Boolean(view.image || view.content?.length);
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
    case "ask_user":
    case "plan_present":
      return true;
  }
}

/** Tabs with content, in display order. */
export function availableToolDetailSections(has: {
  agentPreview: boolean;
  arguments: boolean;
  completeResult: boolean;
}): ToolDetailSection[] {
  const sections: ToolDetailSection[] = [];
  if (has.agentPreview) sections.push("agent-preview");
  if (has.arguments) sections.push("arguments");
  if (has.completeResult) sections.push("complete-result");
  return sections;
}

/** The chosen tab if it exists, else the first. */
export function resolveToolDetailSection(
  available: readonly ToolDetailSection[],
  chosen: ToolDetailSection | undefined,
): ToolDetailSection | undefined {
  return chosen && available.includes(chosen) ? chosen : available[0];
}

type SerializedArguments = { text: string; language?: string };

const serializedArguments = new WeakMap<object, SerializedArguments>();

/** Pretty-prints arguments; memoized by object identity. */
export function serializeToolArguments(value: unknown): SerializedArguments {
  if (typeof value === "string") return { text: value };
  const isObject = typeof value === "object" && value !== null;
  if (isObject) {
    const cached = serializedArguments.get(value);
    if (cached) return cached;
  }
  let result: SerializedArguments;
  try {
    result = {
      text: JSON.stringify(value, null, 2) ?? String(value),
      language: "json",
    };
  } catch {
    result = { text: String(value) };
  }
  if (isObject) serializedArguments.set(value, result);
  return result;
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
