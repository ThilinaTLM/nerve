import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  JiraAttachmentSummaryPayload,
  JiraBoardSummaryPayload,
  JiraChangelogSummaryPayload,
  JiraCommentSummaryPayload,
  JiraFieldSummaryPayload,
  JiraIssueLinkSummaryPayload,
  JiraIssueSummaryPayload,
  JiraIssueTypeSummaryPayload,
  JiraProjectSummaryPayload,
  JiraRemoteLinkSummaryPayload,
  JiraSprintSummaryPayload,
  JiraTransitionSummaryPayload,
  JiraUserSummaryPayload,
  JiraWorklogSummaryPayload,
  ToolOutputLimitsPayload,
} from "@nervekit/contracts";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { atlassianPlainTextPreview } from "../common/atlassian-rich-text.js";
import { buildProcessTextResult } from "../common/process-result.js";

export const JIRA_DISPLAY_ITEM_LIMIT = 20;
export const JIRA_FIELD_DISPLAY_LIMIT = 20;
export const JIRA_TEXT_FIELD_MAX_CHARS = 300;

export async function writeJiraArtifact(
  context: ToolExecutionContext,
  kind: string,
  payload: unknown,
): Promise<{ path: string; bytes: number; chars: number; lines: number }> {
  const baseDir =
    context.artifactDir ??
    (context.dataDir
      ? join(context.dataDir, "tmp", "jira")
      : join(tmpdir(), "nerve-jira"));
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  const text = JSON.stringify(payload, null, 2);
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 10);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(baseDir, `${kind}-${timestamp}-${hash}.json`);
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  return {
    path,
    bytes: Buffer.byteLength(text, "utf8"),
    chars: text.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
  };
}

export async function maybeWriteJiraArtifact(
  context: ToolExecutionContext,
  kind: string,
  payload: unknown,
  saveToFile: unknown,
): Promise<
  { path: string; bytes: number; chars: number; lines: number } | undefined
> {
  if (saveToFile === false) return undefined;
  return writeJiraArtifact(context, kind, payload);
}

export async function buildJiraTextResult({
  text,
  context,
  details = {},
  artifact,
}: {
  text: string;
  context: ToolExecutionContext;
  details?: Record<string, unknown>;
  artifact?: { path: string; bytes: number; chars: number; lines: number };
}): Promise<ToolExecutionResult> {
  const existingOutputLimits = details.outputLimits as
    | ToolOutputLimitsPayload
    | undefined;
  const outputLimits = artifact
    ? {
        ...(existingOutputLimits ?? {}),
        artifacts: [
          ...(existingOutputLimits?.artifacts ?? []),
          {
            id: "jira_raw_json",
            role: "supporting_data" as const,
            path: artifact.path,
            format: {
              kind: "json" as const,
              mediaType: "application/json",
              encoding: "utf-8" as const,
            },
            label: "Raw Jira JSON",
            bytes: artifact.bytes,
            lines: artifact.lines,
            recommendedTools: ["read", "grep"] as ("read" | "grep")[],
          },
        ],
      }
    : existingOutputLimits;
  return buildProcessTextResult({
    text,
    outputFilePrefix: "nerve-jira",
    exitMessagePrefix: "Jira",
    dataDir: context.dataDir,
    details: { ...details, ...(outputLimits ? { outputLimits } : {}) },
  });
}

export function takeDisplayItems<T>(
  items: T[],
  limit = JIRA_DISPLAY_ITEM_LIMIT,
): { items: T[]; total: number; displayed: number; omitted: number } {
  const total = items.length;
  const displayedItems = items.slice(0, limit);
  return {
    items: displayedItems,
    total,
    displayed: displayedItems.length,
    omitted: Math.max(0, total - displayedItems.length),
  };
}

export function displayLimitNotice({
  noun,
  total,
  displayed,
  artifactPath,
}: {
  noun: string;
  total: number;
  displayed: number;
  artifactPath?: string;
}): string | undefined {
  if (total <= displayed) return undefined;
  const plural = total === 1 ? noun : `${noun}s`;
  return artifactPath
    ? `Showing first ${displayed} of ${total} ${plural}; full Jira response is saved to ${artifactPath}.`
    : `Showing first ${displayed} of ${total} ${plural}; narrow the query or save raw JSON for full details.`;
}

export function summarizeJiraIssue(
  issue: unknown,
): JiraIssueSummaryPayload | undefined {
  if (!issue || typeof issue !== "object") return undefined;
  const record = issue as Record<string, unknown>;
  const fields = asRecord(record.fields);
  const key = stringField(record.key) ?? stringField(record.id);
  if (!key) return undefined;
  return compactRecord({
    key,
    id: stringField(record.id),
    summary: truncateField(stringField(fields.summary)),
    issueType: truncateField(nameOf(fields.issuetype)),
    status: truncateField(nameOf(fields.status)),
    statusCategory: statusCategoryKeyOf(fields.status),
    assignee: truncateField(displayNameOf(fields.assignee)),
    priority: truncateField(nameOf(fields.priority)),
    created: truncateField(stringField(fields.created)),
    updated: truncateField(stringField(fields.updated)),
    resolution: truncateField(nameOf(fields.resolution)),
    resolutionDate: truncateField(stringField(fields.resolutiondate)),
    dueDate: truncateField(stringField(fields.duedate)),
    descriptionPreview: atlassianPlainTextPreview(fields.description),
  }) as JiraIssueSummaryPayload;
}

export function summarizeJiraProject(
  project: unknown,
  fallbackKey?: string,
): JiraProjectSummaryPayload | undefined {
  if (!project || typeof project !== "object") {
    return fallbackKey ? { key: fallbackKey } : undefined;
  }
  const record = project as Record<string, unknown>;
  const key = stringField(record.key) ?? fallbackKey ?? stringField(record.id);
  if (!key) return undefined;
  return compactRecord({
    key,
    id: stringField(record.id),
    name: truncateField(stringField(record.name)),
    projectTypeKey: truncateField(stringField(record.projectTypeKey)),
    lead: truncateField(displayNameOf(record.lead)),
  }) as JiraProjectSummaryPayload;
}

export function summarizeJiraTransition(
  value: unknown,
): JiraTransitionSummaryPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = stringField(record.id);
  if (!id) return undefined;
  return compactRecord({
    id,
    name: truncateField(stringField(record.name)),
    to: truncateField(nameOf(record.to) ?? stringField(record.to)),
    toStatusCategory: statusCategoryKeyOf(record.to),
  }) as JiraTransitionSummaryPayload;
}

export function summarizeJiraUser(
  value: unknown,
): JiraUserSummaryPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const accountId = stringField(record.accountId);
  if (!accountId) return undefined;
  return compactRecord({
    accountId,
    displayName: truncateField(displayNameOf(record)),
    emailAddress: truncateField(stringField(record.emailAddress)),
    active: typeof record.active === "boolean" ? record.active : undefined,
    accountType: truncateField(stringField(record.accountType)),
  }) as JiraUserSummaryPayload;
}

export function summarizeJiraField(
  value: unknown,
  fallbackId?: string,
): JiraFieldSummaryPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const schema = asRecord(record.schema);
  const id = stringField(record.id) ?? stringField(record.key) ?? fallbackId;
  if (!id) return undefined;
  return compactRecord({
    id,
    key: truncateField(stringField(record.key)),
    name: truncateField(
      stringField(record.name) ?? stringField(record.fieldId),
    ),
    required:
      typeof record.required === "boolean" ? record.required : undefined,
    type: truncateField(
      stringField(schema.type) ??
        stringField(schema.system) ??
        stringField(schema.custom),
    ),
    custom: typeof record.custom === "boolean" ? record.custom : undefined,
    allowedValues: summarizeAllowedValues(record.allowedValues),
  }) as JiraFieldSummaryPayload;
}

export function summarizeJiraIssueType(
  value: unknown,
): JiraIssueTypeSummaryPayload | undefined {
  const record = asRecord(value);
  const idValue = record.id;
  const id =
    typeof idValue === "number" ? String(idValue) : stringField(idValue);
  if (!id) return undefined;
  return compactRecord({
    id,
    name: truncateField(stringField(record.name)),
    description: truncateField(stringField(record.description)),
    subtask: typeof record.subtask === "boolean" ? record.subtask : undefined,
    hierarchyLevel:
      typeof record.hierarchyLevel === "number"
        ? Math.floor(record.hierarchyLevel)
        : undefined,
  }) as JiraIssueTypeSummaryPayload;
}

export function summarizeJiraAttachment(
  value: unknown,
): JiraAttachmentSummaryPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = stringField(record.id);
  const filename = truncateField(stringField(record.filename));
  if (!id && !filename) return undefined;
  return compactRecord({
    id,
    filename,
    mediaType: truncateField(
      stringField(record.mimeType) ?? stringField(record.mediaType),
    ),
    bytes:
      typeof record.size === "number"
        ? record.size
        : typeof record.bytes === "number"
          ? record.bytes
          : undefined,
    author: truncateField(displayNameOf(record.author)),
    created: truncateField(stringField(record.created)),
    path: stringField(record.path),
  }) as JiraAttachmentSummaryPayload;
}

export function summarizeJiraBoard(
  value: unknown,
): JiraBoardSummaryPayload | undefined {
  const record = asRecord(value);
  const idValue = record.id;
  const id =
    typeof idValue === "number" ? String(idValue) : stringField(idValue);
  if (!id) return undefined;
  const location = asRecord(record.location);
  return compactRecord({
    id,
    name: truncateField(stringField(record.name)),
    type: truncateField(stringField(record.type)),
    projectKey: truncateField(
      stringField(location.projectKey) ?? stringField(record.projectKey),
    ),
    projectName: truncateField(
      stringField(location.projectName) ?? stringField(record.projectName),
    ),
  }) as JiraBoardSummaryPayload;
}

export function summarizeJiraSprint(
  value: unknown,
): JiraSprintSummaryPayload | undefined {
  const record = asRecord(value);
  const idValue = record.id;
  const id =
    typeof idValue === "number" ? String(idValue) : stringField(idValue);
  if (!id) return undefined;
  const boardId = record.originBoardId;
  return compactRecord({
    id,
    name: truncateField(stringField(record.name)),
    state: truncateField(stringField(record.state)),
    goal: truncateField(stringField(record.goal)),
    startDate: truncateField(stringField(record.startDate)),
    endDate: truncateField(stringField(record.endDate)),
    completeDate: truncateField(stringField(record.completeDate)),
    originBoardId:
      typeof boardId === "number" ? String(boardId) : stringField(boardId),
  }) as JiraSprintSummaryPayload;
}

export function summarizeJiraComment(
  value: unknown,
): JiraCommentSummaryPayload | undefined {
  const record = asRecord(value);
  const id = stringField(record.id);
  if (!id && Object.keys(record).length === 0) return undefined;
  return compactRecord({
    id,
    author: truncateField(displayNameOf(record.author)),
    bodyPreview: atlassianPlainTextPreview(record.body),
    visibility: truncateField(nameOf(record.visibility)),
    created: truncateField(stringField(record.created)),
    updated: truncateField(stringField(record.updated)),
  }) as JiraCommentSummaryPayload;
}

export function summarizeJiraWorklog(
  value: unknown,
): JiraWorklogSummaryPayload | undefined {
  const record = asRecord(value);
  const id = stringField(record.id);
  if (!id && Object.keys(record).length === 0) return undefined;
  return compactRecord({
    id,
    author: truncateField(displayNameOf(record.author)),
    timeSpent: truncateField(stringField(record.timeSpent)),
    timeSpentSeconds:
      typeof record.timeSpentSeconds === "number"
        ? record.timeSpentSeconds
        : undefined,
    started: truncateField(stringField(record.started)),
    commentPreview: atlassianPlainTextPreview(record.comment),
  }) as JiraWorklogSummaryPayload;
}

export function summarizeJiraChangelog(
  value: unknown,
): JiraChangelogSummaryPayload | undefined {
  const record = asRecord(value);
  const items = Array.isArray(record.items) ? record.items : [];
  const changes = items
    .flatMap((item) => {
      const change = asRecord(item);
      const field = stringField(change.field) ?? stringField(change.fieldId);
      if (!field) return [];
      const from =
        stringField(change.fromString) ?? stringField(change.from) ?? "(empty)";
      const to =
        stringField(change.toString) ?? stringField(change.to) ?? "(empty)";
      return [truncateField(`${field}: ${from} -> ${to}`) ?? field];
    })
    .slice(0, 3);
  const id = stringField(record.id);
  if (!id && changes.length === 0) return undefined;
  return compactRecord({
    id,
    author: truncateField(displayNameOf(record.author)),
    created: truncateField(stringField(record.created)),
    changes: changes.length > 0 ? changes : undefined,
  }) as JiraChangelogSummaryPayload;
}

export function summarizeJiraRemoteLink(
  value: unknown,
): JiraRemoteLinkSummaryPayload | undefined {
  const record = asRecord(value);
  const object = asRecord(record.object);
  const id = stringField(record.id);
  const url = stringField(object.url) ?? stringField(record.url);
  if (!id && !url) return undefined;
  return compactRecord({
    id,
    title: truncateField(
      stringField(object.title) ?? stringField(record.title),
    ),
    url,
    relationship: truncateField(stringField(record.relationship)),
  }) as JiraRemoteLinkSummaryPayload;
}

export function summarizeJiraIssueLink(
  value: unknown,
): JiraIssueLinkSummaryPayload | undefined {
  const record = asRecord(value);
  const type = asRecord(record.type);
  const outward = asRecord(record.outwardIssue);
  const inward = asRecord(record.inwardIssue);
  const other = Object.keys(outward).length > 0 ? outward : inward;
  return compactRecord({
    id: stringField(record.id),
    issueKey: stringField(record.issueKey),
    otherIssueKey: stringField(record.otherIssueKey) ?? stringField(other.key),
    linkType: truncateField(
      stringField(record.linkType) ??
        stringField(type.name) ??
        stringField(type.outward) ??
        stringField(type.inward),
    ),
    direction:
      record.direction === "outward" || record.direction === "inward"
        ? record.direction
        : undefined,
  }) as JiraIssueLinkSummaryPayload;
}

export function formatBoardSummaryLine(
  summary: JiraBoardSummaryPayload,
): string {
  const parts = [
    summary.id,
    summary.name,
    summary.type,
    summary.projectKey
      ? `project ${summary.projectKey}`
      : summary.projectName
        ? `project ${summary.projectName}`
        : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${parts}`;
}

export function formatIssueTypeSummaryLine(
  summary: JiraIssueTypeSummaryPayload,
): string {
  const parts = [
    summary.id,
    summary.name,
    summary.subtask === true ? "subtask" : undefined,
    summary.hierarchyLevel !== undefined
      ? `hierarchy ${summary.hierarchyLevel}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${parts}${summary.description ? ` — ${summary.description}` : ""}`;
}

export function formatUserSummaryLine(summary: JiraUserSummaryPayload): string {
  const parts = [
    summary.accountId,
    summary.displayName,
    summary.emailAddress,
    summary.active === false ? "inactive" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${parts}`;
}

export function formatFieldSummaryLine(
  summary: JiraFieldSummaryPayload,
): string {
  const required = summary.required ? " · required" : "";
  const type = summary.type ? ` · ${summary.type}` : "";
  const allowed = summary.allowedValues?.length
    ? ` · allowed: ${summary.allowedValues.join(", ")}`
    : "";
  return `- ${summary.id}${summary.name ? ` · ${summary.name}` : ""}${type}${required}${allowed}`;
}

export function issueLine(issue: unknown): string {
  const summary = summarizeJiraIssue(issue);
  return summary ? formatIssueSummaryLine(summary) : JSON.stringify(issue);
}

export function formatIssueSummaryLine(
  summary: JiraIssueSummaryPayload,
): string {
  const parts = [
    summary.key,
    summary.issueType,
    summary.status,
    summary.priority ? `priority: ${summary.priority}` : undefined,
    summary.assignee ? `assignee: ${summary.assignee}` : undefined,
    summary.created ? `created: ${summary.created}` : undefined,
    summary.dueDate ? `due: ${summary.dueDate}` : undefined,
    summary.resolution ? `resolution: ${summary.resolution}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `- ${parts}${summary.summary ? ` — ${summary.summary}` : ""}`;
}

export function nameOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

function statusCategoryKeyOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const category = (value as Record<string, unknown>).statusCategory;
  if (!category || typeof category !== "object") return undefined;
  return stringField((category as Record<string, unknown>).key);
}

export function transitionLine(value: unknown): string {
  const summary = summarizeJiraTransition(value);
  return summary ? formatTransitionSummaryLine(summary) : JSON.stringify(value);
}

export function formatTransitionSummaryLine(
  summary: JiraTransitionSummaryPayload,
): string {
  return `- ${summary.id} · ${summary.name ?? "(unnamed)"}${summary.to ? ` → ${summary.to}` : ""}`;
}

function truncateField(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= JIRA_TEXT_FIELD_MAX_CHARS) return normalized;
  return `${normalized.slice(0, JIRA_TEXT_FIELD_MAX_CHARS - 1)}…`;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function displayNameOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.displayName === "string"
    ? record.displayName
    : nameOf(value);
}

function summarizeAllowedValues(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .map((item) =>
      truncateField(
        nameOf(item) ??
          (item && typeof item === "object"
            ? stringField((item as Record<string, unknown>).value)
            : undefined) ??
          stringField(item),
      ),
    )
    .filter((item): item is string => Boolean(item))
    .slice(0, 10);
  return names.length > 0 ? names : undefined;
}

function compactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}
