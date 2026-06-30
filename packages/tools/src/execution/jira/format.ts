import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  JiraIssueSummaryPayload,
  JiraProjectSummaryPayload,
  JiraTransitionSummaryPayload,
  ToolOutputLimitsPayload,
} from "@nervekit/shared";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { buildProcessTextResult } from "../common/process-result.js";

export const JIRA_DISPLAY_ITEM_LIMIT = 20;
export const JIRA_FIELD_DISPLAY_LIMIT = 20;
export const JIRA_TEXT_FIELD_MAX_CHARS = 300;

export async function writeJiraArtifact(
  context: ToolExecutionContext,
  kind: string,
  payload: unknown,
): Promise<{ path: string; bytes: number; chars: number; lines: number }> {
  const baseDir = context.dataDir
    ? join(context.dataDir, "tmp", "jira")
    : join(tmpdir(), "nerve-jira");
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
            kind: "raw_result" as const,
            path: artifact.path,
            label: "Raw Jira JSON",
            bytes: artifact.bytes,
            chars: artifact.chars,
            lines: artifact.lines,
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
    assignee: truncateField(displayNameOf(fields.assignee)),
    priority: truncateField(nameOf(fields.priority)),
    updated: truncateField(stringField(fields.updated)),
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
  }) as JiraTransitionSummaryPayload;
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

function compactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}
