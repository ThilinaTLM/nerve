import type { LiveToolCallDraft } from "../../state/transcript-types";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import type { ToolView } from "./tool-view-types";

type JiraView = Extract<ToolView, { kind: "jira" }>;
type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;

export type ArgSource = {
  args: Record<string, unknown>;
  argsText?: string;
  status?: string;
};

export type SummaryBudget = {
  itemLimit: number;
  excerptLines: number;
  excerptChars: number;
};

export type AtlassianSummaryOptions = {
  expanded?: boolean;
};

const COLLAPSED_ITEM_LIMIT = 5;
const EXPANDED_ITEM_LIMIT = 20;
const COLLAPSED_EXCERPT_LINES = 4;
const EXPANDED_EXCERPT_LINES = 12;
const COLLAPSED_EXCERPT_CHARS = 600;
const EXPANDED_EXCERPT_CHARS = 2_000;

export function summaryBudget(options: AtlassianSummaryOptions): SummaryBudget {
  return options.expanded
    ? {
        itemLimit: EXPANDED_ITEM_LIMIT,
        excerptLines: EXPANDED_EXCERPT_LINES,
        excerptChars: EXPANDED_EXCERPT_CHARS,
      }
    : {
        itemLimit: COLLAPSED_ITEM_LIMIT,
        excerptLines: COLLAPSED_EXCERPT_LINES,
        excerptChars: COLLAPSED_EXCERPT_CHARS,
      };
}

export function stageTitle(
  service: "Jira" | "Confluence",
  action: string,
  status: string,
  dryRun: boolean | undefined,
): string {
  if (status === "pending_approval") return `Review ${service} ${action}`;
  if (status === "requested" || status === "running") {
    return `Executing ${service} ${action}`;
  }
  if (status === "completed") {
    return `${dryRun ? "Dry run" : "Completed"} ${service} ${action}`;
  }
  if (status === "denied") return `Denied ${service} ${action}`;
  if (status === "error") return `Failed ${service} ${action}`;
  return `${service} ${action}`;
}

export function toolArgSource(toolCall: ToolCallDisplayRecord): ArgSource {
  const payloads = toolCall as ToolCallDisplayRecord & {
    args?: unknown;
    argsPreview?: unknown;
  };
  return {
    args: asRecord(payloads.args ?? payloads.argsPreview),
    status: toolCall.status,
  };
}

export function draftArgSource(draft: LiveToolCallDraft): ArgSource {
  return {
    args: draft.args ?? parseJsonRecord(draft.argsText),
    argsText: draft.argsText,
    status: draft.done ? "draft_done" : "drafting",
  };
}

export function toolResultDetails(
  toolCall: ToolCallDisplayRecord,
): Record<string, unknown> {
  const payloads = toolCall as ToolCallDisplayRecord & {
    result?: unknown;
    resultPreview?: unknown;
  };
  const result = asRecord(payloads.result ?? payloads.resultPreview);
  return asRecord(result.details);
}

function parseJsonRecord(text: string | undefined): Record<string, unknown> {
  if (!text?.trim()) return {};
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return {};
  }
}

export function appendJiraAssignee(
  lines: string[],
  source: ArgSource,
  view: JiraView | undefined,
): void {
  if (view?.resolvedAssignee) {
    addLine(lines, "Resolved assignee", formatJiraUser(view.resolvedAssignee));
    return;
  }
  const accountId = sourceString(source, "assignee_account_id");
  const query = sourceString(source, "assignee_query");
  if (accountId) addLine(lines, "Assignee", `account ${accountId}`);
  else if (query) addLine(lines, "Assignee", `query "${query}"`);
}

export function appendResolvedAssignee(lines: string[], view: JiraView): void {
  if (view.resolvedAssignee) {
    addLine(lines, "Resolved assignee", formatJiraUser(view.resolvedAssignee));
  }
}

export function appendMutationOptions(
  lines: string[],
  source: ArgSource,
  verb: string,
  dryRun: boolean | undefined,
): void {
  const requestedDryRun = dryRun ?? sourceBoolean(source, "dry_run");
  if (requestedDryRun === true) {
    addLine(lines, "Mode", "dry run / no mutation");
  } else if (source.status !== "completed") {
    addLine(lines, "Mode", `will ${verb}`);
  }
}
export function appendSavePreference(lines: string[], source: ArgSource): void {
  const save = sourceBoolean(source, "save_to_file");
  if (save === false) addLine(lines, "Raw JSON", "not saved");
}

export function appendLimitLines(
  lines: string[],
  source: ArgSource,
  fields: Array<[string, string]>,
): void {
  for (const [label, key] of fields)
    addLine(lines, label, sourceNumber(source, key));
}

export function appendConfluenceBodySource(
  lines: string[],
  source: ArgSource,
  budget: SummaryBudget,
): void {
  const pageFile = sourceString(source, "page_file");
  const bodyFile = sourceString(source, "body_file");
  const body = sourceString(source, "body");
  if (pageFile) addLine(lines, "Page file", pageFile);
  if (bodyFile) addLine(lines, "Body file", bodyFile);
  if (body) addTextBlock(lines, "Body", body, budget);
}

export function appendConfluencePagePaths(
  lines: string[],
  page: ConfluenceView["page"],
): void {
  if (!page) return;
  addLine(lines, "Storage", page.storagePath);
  addLine(lines, "Markdown", page.markdownPath);
  addLine(lines, "Attachments dir", page.attachmentDir);
}

export function jiraBodyText(
  source: ArgSource,
  textKey: string,
  adfKey: string,
): string | undefined {
  return sourceString(source, textKey) ?? adfPlainText(source.args[adfKey]);
}

export function enabledFlags(
  source: ArgSource,
  flags: Record<string, string>,
): string[] {
  return Object.entries(flags).flatMap(([key, label]) =>
    sourceBoolean(source, key) === true ? [label] : [],
  );
}

export function addIncludedCounts(
  lines: string[],
  counts: Record<string, unknown> | undefined,
  labels: Record<string, string>,
  label: string,
): void {
  if (!counts) return;
  const parts = Object.entries(labels).flatMap(([key, noun]) => {
    const value = counts[key];
    return typeof value === "number" && Number.isFinite(value)
      ? [`${value.toLocaleString()} ${noun}`]
      : [];
  });
  if (parts.length > 0) addLine(lines, label, parts.join(", "));
}

export function appendArtifactLines(
  lines: string[],
  view: JiraView | ConfluenceView,
  budget: SummaryBudget,
): void {
  const artifacts = view.outputArtifacts ?? [];
  for (const artifact of artifacts.slice(0, budget.itemLimit)) {
    addLine(lines, artifact.label ?? artifact.kind, artifact.path);
  }
  if (artifacts.length > budget.itemLimit) {
    lines.push(`… ${artifacts.length - budget.itemLimit} more artifacts`);
  }
}

export function appendPreviewHint(
  lines: string[],
  toolCall: ToolCallDisplayRecord,
  options: AtlassianSummaryOptions,
): void {
  const overflow =
    "previewOverflow" in toolCall ? toolCall.previewOverflow : undefined;
  if (!options.expanded && overflow?.hidden) {
    lines.push(`… open Details for ${overflow.hidden} more ${overflow.noun}`);
  }
}

export function appendPayloadSummary(
  lines: string[],
  payload: unknown,
  budget: SummaryBudget,
): void {
  const record = asRecord(payload);
  if (Object.keys(record).length === 0) return;
  appendRecordKeys(lines, "Payload fields", asRecord(record.fields), budget);
  appendRecordKeys(
    lines,
    "Payload update ops",
    asRecord(record.update),
    budget,
  );
  const otherKeys = Object.keys(record).filter(
    (key) => key !== "fields" && key !== "update",
  );
  if (otherKeys.length > 0)
    addLine(lines, "Payload keys", formatList(otherKeys, budget.itemLimit));
}

export function appendRecordKeys(
  lines: string[],
  label: string,
  value: unknown,
  budget: SummaryBudget,
): void {
  const keys = Object.keys(asRecord(value));
  if (keys.length > 0)
    addLine(lines, label, formatList(keys, budget.itemLimit));
}

export function appendList(
  lines: string[],
  label: string,
  items: Array<string | undefined>,
  budget: SummaryBudget,
): void {
  const visible = items.filter((item): item is string => Boolean(item?.trim()));
  if (visible.length === 0) return;
  lines.push(`${label}:`);
  for (const item of visible.slice(0, budget.itemLimit))
    lines.push(`- ${item}`);
  if (visible.length > budget.itemLimit) {
    lines.push(`… ${visible.length - budget.itemLimit} more`);
  }
}

export function addListLine(
  lines: string[],
  label: string,
  values: string[] | undefined,
  budget: SummaryBudget,
): void {
  if (!values || values.length === 0) return;
  addLine(lines, label, formatList(values, budget.itemLimit));
}

export function addLine(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  lines.push(`${label}: ${String(value)}`);
}

export function addTextBlock(
  lines: string[],
  label: string,
  value: string | undefined,
  budget: SummaryBudget,
): void {
  const excerpt = excerptText(value, budget);
  if (!excerpt) return;
  if (!excerpt.text.includes("\n")) {
    addLine(lines, label, excerpt.omitted ? `${excerpt.text}…` : excerpt.text);
    return;
  }
  lines.push(`${label}:`);
  for (const line of excerpt.text.split("\n")) lines.push(`  ${line}`);
  if (excerpt.omitted) lines.push("  …");
}

export function excerptText(
  value: string | undefined,
  budget: SummaryBudget,
): { text: string; omitted: boolean } | undefined {
  const normalized = normalizeLines(value).trim();
  if (!normalized) return undefined;
  const sourceLines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(
      (line, index, lines) =>
        line.trim().length > 0 || (index > 0 && index < lines.length - 1),
    );
  let selected = sourceLines.slice(0, budget.excerptLines).join("\n");
  let omitted = sourceLines.length > budget.excerptLines;
  if (selected.length > budget.excerptChars) {
    selected = `${selected.slice(0, budget.excerptChars - 1).trimEnd()}…`;
    omitted = true;
  }
  return { text: selected, omitted };
}

export function formatList(values: string[], limit: number): string {
  const visible = values.filter((value) => value.trim().length > 0);
  const head = visible.slice(0, limit).join(", ");
  const hidden = visible.length - limit;
  return hidden > 0 ? `${head} (+${hidden} more)` : head;
}

export function formatJiraIssue(issue: JiraView["issues"][number]): string {
  const left = [
    issue.key,
    issue.issueType,
    issue.status,
    issue.assignee ? `assignee ${issue.assignee}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return issue.summary ? `${left} — ${issue.summary}` : left;
}

export function formatJiraProject(
  project: NonNullable<JiraView["project"]>,
): string {
  return [
    project.key,
    project.name,
    project.projectTypeKey,
    project.lead ? `lead ${project.lead}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatJiraTransition(
  transition: JiraView["transitions"][number],
): string {
  return [
    transition.id,
    transition.name,
    transition.to ? `→ ${transition.to}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatJiraUser(user: JiraView["users"][number]): string {
  const label = user.displayName ?? user.emailAddress ?? user.accountId;
  const email =
    user.displayName && user.emailAddress ? ` <${user.emailAddress}>` : "";
  const status = user.active === false ? "inactive" : undefined;
  return [`${label}${email}`, user.accountId, user.accountType, status]
    .filter(Boolean)
    .join(" · ");
}

export function formatJiraField(field: JiraView["fields"][number]): string {
  return [
    field.id,
    field.name,
    field.required ? "required" : undefined,
    field.type,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatConfluenceSpace(
  space: ConfluenceView["spaces"][number],
): string {
  return [space.key, space.name, space.id, space.status]
    .filter(Boolean)
    .join(" · ");
}

export function formatConfluencePage(
  page: ConfluenceView["pages"][number],
): string {
  return [
    page.id,
    page.title,
    page.spaceKey ? `space ${page.spaceKey}` : undefined,
    page.status,
    page.versionNumber !== undefined ? `v${page.versionNumber}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatConfluenceAttachment(
  attachment: ConfluenceView["attachments"][number],
): string {
  return [
    attachment.filename ??
      attachment.title ??
      attachment.id ??
      attachment.fileId,
    attachment.mediaType,
    attachment.fileSize !== undefined
      ? formatBytes(attachment.fileSize)
      : undefined,
    attachment.versionNumber !== undefined
      ? `v${attachment.versionNumber}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatConfluenceOutcome(
  outcome: ConfluenceView["outcomes"][number],
): string {
  return [
    outcome.index !== undefined ? `#${outcome.index}` : undefined,
    outcome.operation,
    outcome.id,
    outcome.title ? `"${outcome.title}"` : undefined,
    outcome.status,
    outcome.message,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function outcomeStatusSummary(
  outcomes: ConfluenceView["outcomes"],
): string | undefined {
  if (outcomes.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    const status = outcome.status ?? "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function countLabel(
  count: number | undefined,
  noun: string,
): string | undefined {
  if (count === undefined) return undefined;
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

export function yesNo(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? "yes" : "no";
}

export function sourceString(
  source: ArgSource,
  key: string,
): string | undefined {
  return (
    stringField(source.args[key]) ??
    extractJsonStringValues(source.argsText, key, { maxChars: 1_000 })[0]
  );
}

export function sourceStringArray(
  source: ArgSource,
  key: string,
): string[] | undefined {
  const value = source.args[key];
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" ? [item] : []))
    : undefined;
}

export function sourceBoolean(
  source: ArgSource,
  key: string,
): boolean | undefined {
  const value = source.args[key];
  return typeof value === "boolean" ? value : undefined;
}

export function sourceNumber(
  source: ArgSource,
  key: string,
): number | undefined {
  const value = source.args[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function compactLines(lines: string[]): string[] {
  const compacted: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) continue;
    if (compacted.at(-1) === trimmed) continue;
    compacted.push(trimmed);
  }
  return compacted;
}

export function normalizeLines(value: string | undefined): string {
  return value?.replace(/\r\n/g, "\n").replace(/\r/g, "\n") ?? "";
}

export function adfPlainText(value: unknown): string | undefined {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const record = asRecord(node);
    if (Object.keys(record).length === 0) return;
    const type = stringField(record.type);
    if (type === "text") {
      const text = stringField(record.text);
      if (text) parts.push(text);
      return;
    }
    if (type === "hardBreak") {
      parts.push("\n");
      return;
    }
    const block =
      type &&
      [
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "bulletList",
        "orderedList",
        "listItem",
      ].includes(type);
    if (block && parts.length > 0 && !parts.at(-1)?.endsWith("\n"))
      parts.push("\n");
    visit(record.content);
    if (block && parts.length > 0 && !parts.at(-1)?.endsWith("\n"))
      parts.push("\n");
  };
  visit(value);
  const text = parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

export function propertyValuePattern(property: string): RegExp {
  return new RegExp(`"${escapeRegExp(property)}"\\s*:\\s*"`, "g");
}

export function extractJsonStringValues(
  text: string | undefined,
  property: string,
  options: { maxChars?: number } = {},
): string[] {
  if (!text) return [];
  const values: string[] = [];
  const pattern = propertyValuePattern(property);
  let match = pattern.exec(text);
  while (match) {
    const maxChars = options.maxChars ?? Number.POSITIVE_INFINITY;
    let value = "";
    let index = match.index + match[0].length;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") {
        if (index + 1 >= text.length) break;
        const escaped = text[index + 1];
        if (value.length < maxChars) value += decodeJsonEscape(escaped);
        index += 2;
        continue;
      }
      if (char === '"') break;
      if (value.length < maxChars) value += char;
      index += 1;
    }
    values.push(value);
    match = pattern.exec(text);
  }
  return values;
}

export function decodeJsonEscape(char: string): string {
  if (char === "n") return "\n";
  if (char === "r") return "\r";
  if (char === "t") return "\t";
  return char;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
